import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useQuery, useQueryClient } from 'react-query';
import { electronChatFetch } from '../lib/electronChatFetch';
import { userEchoMessage } from '../lib/userEcho';
import { useMainEvent } from './useMainEvent';
import { failureReasonText } from '../lib/transcriptRow';

/** " (check the API key)" and the like for a failed agent run; empty when the reason is unknown. */
function agentFailureWords(errorClass: string): string {
  const words = failureReasonText(errorClass as Parameters<typeof failureReasonText>[0]);
  return words ? ` (${words})` : '';
}

/** What the user asked last, so a failed or unwanted answer can be asked again. */
type LastAction =
  | { kind: 'what_to_say' | 'clarify' | 'recap' | 'follow_up_questions' | 'brainstorm' | 'code_hint' }
  | { kind: 'manual'; text: string };

export type Message = {
  id: string;
  role: 'user' | 'system' | 'them';
  text: string;
  isStreaming?: boolean;
  /** A failure message: shown as an error, not as an answer. */
  isError?: boolean;
  /** What the other party said last, for the "Re:" line of a what-to-say answer. */
  replyTo?: string;
  hasScreenshot?: boolean;
  screenshotPreview?: string;
  isCode?: boolean;
  intent?: string;
  isWorkingState?: boolean;
};

function toolWorkingMessage(toolName: string): string {
  switch (toolName) {
    case 'search_transcript':
      return 'Searching the transcript…';
    case 'recent_transcript':
      return 'Reading the latest lines…';
    case 'search_meetings':
      return 'Searching past meetings…';
    case 'search_materials':
      return 'Searching your notes…';
    case 'screenshot':
      return 'Looking at the screen…';
    default:
      return 'Working…';
  }
}

type AttachedContext = Array<{ path: string; preview: string }>;

export function useMeetingChat(options: { getReplyContext?: () => string | undefined } = {}) {
  const queryClient = useQueryClient();
  const [attachedContext, setAttachedContext] = useState<AttachedContext>([]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  // After the user stops an answer, tokens already on their way must not open a new message; the next request clears this.
  const cancelledRef = useRef(false);
  const lastActionRef = useRef<LastAction | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  // Remember what was asked so Retry can ask it again; null where asking again would not repeat it (a screenshot, a rewrite).
  const remember = (action: LastAction | null) => {
    lastActionRef.current = action;
    setCanRetry(action !== null);
  };
  const beginProcessing = () => {
    cancelledRef.current = false;
    setIsProcessing(true);
  };
  // systemMessages holds quick-action responses (WhatToSay, Clarify, Recap, etc.)
  const [systemMessages, setSystemMessages] = useState<Message[]>([]);
  const isAgentRunRef = useRef(false);
  const setSystemMessagesIfLive = useCallback<typeof setSystemMessages>((update) => {
    if (!cancelledRef.current) setSystemMessages(update);
  }, []);

  const agentStatusQuery = useQuery<boolean>(
    ['agent-status'],
    async () => {
      if (!window.electronAPI?.agentStatus) return false;
      try {
        const res = await window.electronAPI.agentStatus();
        return Boolean(res?.available);
      } catch {
        return false;
      }
    }
  );
  const isAgentAvailable = agentStatusQuery.data ?? false;

  useMainEvent(window.electronAPI?.onMeetingStateChanged, ({ isActive }) => {
    if (isActive) {
      void queryClient.invalidateQueries(['agent-status']);
    } else {
      queryClient.setQueryData(['agent-status'], false);
    }
  });

  const conversationContextRef = useRef('');

  const { messages: chatMessages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: electronChatFetch as typeof globalThis.fetch,
      body: () => ({ context: conversationContextRef.current.slice(-8000) }),
    }),
  });

  const isChatLoading = status === 'submitted' || status === 'streaming';

  const actionButtonModeQuery = useQuery<'recap' | 'brainstorm'>(
    ['action-button-mode'],
    async () => {
      const mode = await window.electronAPI?.getActionButtonMode?.();
      return mode ?? 'recap';
    }
  );
  const actionButtonMode = actionButtonModeQuery.data ?? 'recap';

  useMainEvent(window.electronAPI?.onActionButtonModeChanged, (mode: 'recap' | 'brainstorm') => {
    queryClient.setQueryData(['action-button-mode'], mode);
  });

  // Build conversationContext from all messages (chat + system) for IPC quick actions
  const allMessagesForContext = useMemo(() => {
    const fromChat: Message[] = chatMessages.map((m) => ({
      id: m.id,
      role: m.role === 'assistant' ? ('them' as const) : ('user' as const),
      text: m.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { type: 'text'; text: string }).text)
        .join(''),
    }));
    return [...fromChat, ...systemMessages];
  }, [chatMessages, systemMessages]);

  const conversationContext = useMemo(() => {
    return allMessagesForContext
      .filter((m) => m.role !== 'user' || !m.hasScreenshot)
      .map((m) => `${m.role === 'them' ? 'Them' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .slice(-20)
      .join('\n');
  }, [allMessagesForContext]);
  conversationContextRef.current = conversationContext;

  // Merged messages for UI rendering (chat + system quick-action responses)
  const messages = useMemo<Message[]>(() => {
    const lastChatId = chatMessages[chatMessages.length - 1]?.id;
    const fromChat: Message[] = chatMessages.map((m) => ({
      id: m.id,
      role: m.role === 'assistant' ? ('them' as const) : ('user' as const),
      text: m.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { type: 'text'; text: string }).text)
        .join(''),
      isStreaming: isChatLoading && m.id === lastChatId && m.role === 'assistant',
    }));
    // Sort by id (timestamp-based ids sort chronologically)
    return [...fromChat, ...systemMessages].sort((a, b) => a.id.localeCompare(b.id));
  }, [chatMessages, systemMessages, isChatLoading]);

  const pushSystemError = useCallback((error: unknown) => {
    setSystemMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: 'system',
        text: `Error: ${error}`, isError: true,
      },
    ]);
  }, []);

  // IPC response listeners — update systemMessages with streaming AI responses
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanups: Array<() => void> = [];

    // ---- Assist (generic insight from streaming) ----
    if (window.electronAPI.onIntelligenceAssistUpdate) {
      cleanups.push(window.electronAPI.onIntelligenceAssistUpdate((data) => {
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          const text = (data as { insight?: string; token?: string }).insight ?? (data as { token?: string }).token ?? '';
          if (last && last.isStreaming && last.intent === 'assist') {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: last.text + text };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text, intent: 'assist', isStreaming: true }];
        });
      }));
    }

    // ---- Streaming: Gemini Chat (streamGeminiChat / suggested answer) ----
    if (window.electronAPI.onIntelligenceSuggestedAnswerToken) {
      cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === 'what_to_answer') {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: last.text + data.token };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.token, intent: 'what_to_answer', isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onIntelligenceSuggestedAnswer) {
      cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === 'what_to_answer') {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: data.answer, isStreaming: false };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.answer, intent: 'what_to_answer' }];
        });
      }));
    }

    // ---- Streaming: Refinement ----
    if (window.electronAPI.onIntelligenceRefinedAnswerToken) {
      cleanups.push(window.electronAPI.onIntelligenceRefinedAnswerToken((data) => {
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === data.intent) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: last.text + data.token };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.token, intent: data.intent, isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onIntelligenceRefinedAnswer) {
      cleanups.push(window.electronAPI.onIntelligenceRefinedAnswer((data) => {
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === data.intent) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: data.answer, isStreaming: false };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.answer, intent: data.intent }];
        });
      }));
    }

    // ---- Streaming: Recap ----
    if (window.electronAPI.onIntelligenceRecapToken) {
      cleanups.push(window.electronAPI.onIntelligenceRecapToken((data) => {
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === 'recap') {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: last.text + data.token };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.token, intent: 'recap', isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onIntelligenceRecap) {
      cleanups.push(window.electronAPI.onIntelligenceRecap((data) => {
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === 'recap') {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: data.summary, isStreaming: false };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.summary, intent: 'recap' }];
        });
      }));
    }

    // ---- Streaming: Follow-Up Questions ----
    if (window.electronAPI.onIntelligenceFollowUpQuestionsToken) {
      cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsToken((data) => {
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === 'follow_up_questions') {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: last.text + data.token };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.token, intent: 'follow_up_questions', isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onIntelligenceFollowUpQuestionsUpdate) {
      cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsUpdate((data) => {
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === 'follow_up_questions') {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: data.questions, isStreaming: false };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.questions, intent: 'follow_up_questions' }];
        });
      }));
    }

    // ---- Manual result / generic error ----
    if (window.electronAPI.onIntelligenceManualResult) {
      cleanups.push(window.electronAPI.onIntelligenceManualResult((data) => {
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'system', text: `\uD83C\uDFAF **Answer:**\n\n${data.answer}` },
        ]);
      }));
    }
    if (window.electronAPI.onIntelligenceError) {
      cleanups.push(window.electronAPI.onIntelligenceError((data) => {
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'system', text: `Error (${data.mode}): ${data.error}`, isError: true },
        ]);
      }));
    }
    if (window.electronAPI.onSuggestionGenerated) {
      cleanups.push(window.electronAPI.onSuggestionGenerated((data) => {
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'system', text: data.suggestion },
        ]);
      }));
    }
    if (window.electronAPI.onSuggestionError) {
      cleanups.push(window.electronAPI.onSuggestionError((data) => {
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'system', text: `Error: ${data.error}`, isError: true },
        ]);
      }));
    }

    // ---- Streaming: generic gemini-chat-stream (used by submitPrompt / handleWhatToSay) ----
    console.log('[useMeetingChat] registering gemini-stream listeners. has onGeminiStreamToken:', !!window.electronAPI.onGeminiStreamToken);
    if (window.electronAPI.onGeminiStreamToken) {
      cleanups.push(window.electronAPI.onGeminiStreamToken((token) => {
        console.log('[gemini-stream-token]', String(token).length);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: last.text + token };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: token, isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onGeminiStreamDone) {
      cleanups.push(window.electronAPI.onGeminiStreamDone(() => {
        console.log('[gemini-stream-done]');
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, isStreaming: false };
            return updated;
          }
          return prev;
        });
      }));
    }
    if (window.electronAPI.onGeminiStreamError) {
      cleanups.push(window.electronAPI.onGeminiStreamError((error) => {
        console.log('[gemini-stream-error]', error);
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          const errMsg = { id: Date.now().toString(), role: 'system' as const, text: `Error: ${error}`, isError: true };
          if (last && last.isStreaming && last.text === '') return prev.slice(0, -1).concat(errMsg);
          return [...prev, errMsg];
        });
      }));
    }

    // ---- Streaming: RAG live query (rag:query-live) ----
    if (window.electronAPI.onRAGStreamChunk) {
      cleanups.push(window.electronAPI.onRAGStreamChunk((data) => {
        console.log('[rag-stream-chunk]', String(data.chunk).length);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, text: last.text + data.chunk };
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.chunk, isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onRAGStreamComplete) {
      cleanups.push(window.electronAPI.onRAGStreamComplete((data) => {
        console.log('[rag-stream-complete]', data);
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming) {
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, isStreaming: false };
            return updated;
          }
          return prev;
        });
      }));
    }
    if (window.electronAPI.onRAGStreamError) {
      cleanups.push(window.electronAPI.onRAGStreamError((data) => {
        console.log('[rag-stream-error]', data);
        setIsProcessing(false);
        setSystemMessagesIfLive((prev) => {
          const last = prev[prev.length - 1];
          const errMsg = { id: Date.now().toString(), role: 'system' as const, text: `Error: ${data.error}`, isError: true };
          if (last && last.isStreaming && last.text === '') return prev.slice(0, -1).concat(errMsg);
          return [...prev, errMsg];
        });
      }));
    }

    // ---- Agent Events (MeetingAgent) ----
    if (window.electronAPI.onAgentEvent) {
      cleanups.push(window.electronAPI.onAgentEvent((event) => {
        switch (event.type) {
          case 'run_started':
            setIsProcessing(true);
            break;
          case 'text_delta':
            setSystemMessagesIfLive((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.isStreaming) {
                const updated = [...prev];
                const baseText = last.isWorkingState ? '' : last.text;
                updated[updated.length - 1] = {
                  ...last,
                  text: baseText + event.text,
                  isWorkingState: false,
                };
                return updated;
              }
              // A later step of the same run (after a tool call) starts a new message.
              if (!isAgentRunRef.current) return prev;
              return [...prev, { id: `${Date.now()}-${prev.length}`, role: 'system', text: event.text, isStreaming: true, intent: 'manual' }];
            });
            break;
          case 'text_final':
            setSystemMessagesIfLive((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.isStreaming) {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...last,
                  text: event.text,
                  isStreaming: false,
                  isWorkingState: false,
                };
                return updated;
              }
              if (!isAgentRunRef.current || !event.text.trim() || last?.text === event.text) return prev;
              return [...prev, { id: `${Date.now()}-${prev.length}`, role: 'system', text: event.text, intent: 'manual' }];
            });
            break;
          case 'tool_started':
            setSystemMessagesIfLive((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.isStreaming && (!last.text || last.isWorkingState)) {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...last,
                  text: toolWorkingMessage(event.toolName),
                  isWorkingState: true,
                };
                return updated;
              }
              // The step before the tool call already ended its message: show the working state as a new one.
              if (!isAgentRunRef.current || (last && last.isStreaming)) return prev;
              return [...prev, { id: `${Date.now()}-${prev.length}`, role: 'system', text: toolWorkingMessage(event.toolName), isStreaming: true, isWorkingState: true, intent: 'manual' }];
            });
            break;
          case 'run_settled':
            setIsProcessing(false);
            isAgentRunRef.current = false;
            setSystemMessagesIfLive((prev) =>
              prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false, isWorkingState: false } : m))
            );
            break;
          case 'run_failed':
            setIsProcessing(false);
            isAgentRunRef.current = false;
            setSystemMessagesIfLive((prev) => {
              const nonStreaming = prev.filter((m) => !(m.isStreaming && (!m.text || m.isWorkingState)));
              const finalized = nonStreaming.map((m) => (m.isStreaming ? { ...m, isStreaming: false, isWorkingState: false } : m));
              return [
                ...finalized,
                {
                  id: Date.now().toString(),
                  role: 'system',
                  text: `The agent could not answer${agentFailureWords(event.errorClass)}. Try again, or test the agent model in Settings, Models & Agent.`,
                  isError: true,
                },
              ];
            });
            break;
        }
      }));
    }

    return () => cleanups.forEach((fn) => fn());
  }, [setSystemMessagesIfLive]);

  // Clarify streaming listeners — intentionally empty dep array so they survive
  // expand/collapse cycles without orphaning an in-flight stream.
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanupToken = window.electronAPI.onIntelligenceClarifyToken((data: { token: string }) => {
      setSystemMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.isStreaming && last.intent === 'clarify') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, text: last.text + data.token };
          return updated;
        }
        return [...prev, { id: Date.now().toString(), role: 'system' as const, text: data.token, intent: 'clarify', isStreaming: true }];
      });
    });
    const cleanupFinal = window.electronAPI.onIntelligenceClarify((data: { clarification: string }) => {
      setIsProcessing(false);
      setSystemMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.isStreaming && last.intent === 'clarify') {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, text: data.clarification, isStreaming: false };
          return updated;
        }
        return [...prev, { id: Date.now().toString(), role: 'system' as const, text: data.clarification, intent: 'clarify' }];
      });
    });
    return () => {
      cleanupToken();
      cleanupFinal();
    };
  }, []); // intentionally empty — these listeners must survive isExpanded changes

  const submitPrompt = useCallback(async ({
    userText,
    attachments,
    clearAttachments = true,
    echoPrompt = true,
    placeholderIntent,
    skipRag = false,
    streamOptions,
  }: {
    userText: string;
    attachments?: Array<{ path: string; preview: string }>;
    clearAttachments?: boolean;
    /** False for a quick action: the prompt text is the app's, not the user's, so it is not shown. */
    echoPrompt?: boolean;
    placeholderIntent?: string;
    skipRag?: boolean;
    streamOptions?: { skipSystemPrompt?: boolean };
  }) => {
    const currentAttachments = attachments ?? attachedContext;
    const trimmedText = userText.trim();
    const promptText = trimmedText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : '');

    if (!promptText && currentAttachments.length === 0) return;
    if (clearAttachments) setAttachedContext([]);

    console.log('[submitPrompt] entry', { promptLength: promptText.length, placeholderIntent, echoPrompt, attachments: currentAttachments.length });

    const replyTo = placeholderIntent === 'what_to_answer' ? options.getReplyContext?.() : undefined;
    const echo = userEchoMessage({ id: Date.now().toString(), promptText, echoPrompt, attachments: currentAttachments });
    if (echo) setSystemMessages((prev) => [...prev, echo]);

    setSystemMessages((prev) => {
      const next = [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'system' as const,
          text: '',
          isStreaming: true,
          ...(placeholderIntent ? { intent: placeholderIntent } : {}),
          ...(replyTo ? { replyTo } : {}),
        },
      ];
      console.log('[submitPrompt] added streaming placeholder, systemMessages count =', next.length);
      return next;
    });

    beginProcessing();

    // The record and the user's materials had nothing for this question: the answer then says so to the model.
    let ragMissed = false;
    try {
      if (!skipRag && currentAttachments.length === 0) {
        console.log('[submitPrompt] calling ragQueryLive…');
        const ragResult = await window.electronAPI.ragQueryLive?.(promptText);
        if (cancelledRef.current) return;
        console.log('[submitPrompt] ragQueryLive result', ragResult);
        if (ragResult?.success) return;
        ragMissed = ragResult?.fallback === true;
      }

      console.log('[submitPrompt] calling streamGeminiChat…');
      await window.electronAPI.streamGeminiChat(
        promptText,
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
        conversationContextRef.current,
        { ...streamOptions, ...(ragMissed ? { ragMiss: true } : {}) }
      );
      console.log('[submitPrompt] streamGeminiChat invoke resolved');
    } catch (err) {
      setIsProcessing(false);
      setSystemMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.isStreaming && last.text === '') {
          return prev.slice(0, -1).concat({
            id: Date.now().toString(),
            role: 'system',
            text: `Error starting stream: ${err}`, isError: true,
            ...(last.intent ? { intent: last.intent } : {}),
          });
        }
        return [...prev, { id: Date.now().toString(), role: 'system', text: `Error: ${err}`, isError: true }];
      });
    }
  }, [attachedContext, conversationContextRef, setAttachedContext, setIsProcessing, setSystemMessages]);

  const handleWhatToSay = useCallback(async () => {
    remember({ kind: 'what_to_say' });
    await submitPrompt({
      userText: attachedContext.length > 0
        ? 'What should I say about this?'
        : "What should I say in response to the other party's latest message?",
      placeholderIntent: 'what_to_answer',
      echoPrompt: false,
    });
  }, [submitPrompt, attachedContext.length]);

  const handleFollowUp = useCallback(async (intent: string = 'rephrase') => {
    remember(null);
    beginProcessing();
    try {
      await window.electronAPI.generateFollowUp(intent);
    } catch (err) {
      setSystemMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'system', text: `Error: ${err}`, isError: true },
      ]);
    } finally {
      setIsProcessing(false);
    }
  }, [setIsProcessing, setSystemMessages]);

  const handleCodeHint = useCallback(async () => {
    remember({ kind: 'code_hint' });
    beginProcessing();

    const currentAttachments = attachedContext;
    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      const echo = userEchoMessage({ id: Date.now().toString(), promptText: '', echoPrompt: false, attachments: currentAttachments });
      if (echo) setSystemMessages((prev) => [...prev, echo]);
    }

    try {
      await window.electronAPI.generateCodeHint(
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined
      );
    } catch (err) {
      setSystemMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'system', text: `Error: ${err}`, isError: true },
      ]);
    } finally {
      setIsProcessing(false);
    }
  }, [attachedContext, setAttachedContext, setIsProcessing, setSystemMessages]);

  const handleClarify = useCallback(async () => {
    remember({ kind: 'clarify' });
    beginProcessing();
    try {
      await window.electronAPI.generateClarify();
    } catch (err) {
      pushSystemError(err);
      setIsProcessing(false);
    }
  }, [pushSystemError]);

  const handleFollowUpQuestions = useCallback(async () => {
    remember({ kind: 'follow_up_questions' });
    beginProcessing();
    try {
      await window.electronAPI.generateFollowUpQuestions();
    } catch (err) {
      pushSystemError(err);
    } finally {
      setIsProcessing(false);
    }
  }, [pushSystemError]);

  const handleRecap = useCallback(async () => {
    remember({ kind: 'recap' });
    beginProcessing();
    try {
      await window.electronAPI.generateRecap();
    } catch (err) {
      pushSystemError(err);
    } finally {
      setIsProcessing(false);
    }
  }, [pushSystemError]);

  const handleBrainstorm = useCallback(async () => {
    remember({ kind: 'brainstorm' });
    beginProcessing();
    const currentAttachments = attachedContext;

    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      const echo = userEchoMessage({ id: Date.now().toString(), promptText: '', echoPrompt: false, attachments: currentAttachments });
      if (echo) setSystemMessages((prev) => [...prev, echo]);
    }

    try {
      await window.electronAPI.generateBrainstorm(currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined);
    } catch (err) {
      pushSystemError(err);
    } finally {
      setIsProcessing(false);
    }
  }, [attachedContext, pushSystemError]);

  const handleAnswerNow = useCallback(async () => {
    remember(null);
    if (!inputValue) return;

    // Try RAG first; fall back to useChat/sendMessage
    try {
      const ragResult = await window.electronAPI.ragQueryLive?.(inputValue || '');
      if (ragResult?.success) return;
    } catch {
      // RAG unavailable — continue to useChat
    }

    sendMessage({ text: inputValue });
  }, [inputValue, sendMessage]);

  const handleManualSubmit = useCallback(async () => {
    if (!inputValue.trim() && attachedContext.length === 0) return;

    const userText = inputValue.trim();
    const currentAttachments = attachedContext;

    setInputValue('');
    if (currentAttachments.length > 0) setAttachedContext([]);

    if (currentAttachments.length > 0) {
      // Screenshots: use legacy streamGeminiChat (supports image paths). The attachment is gone afterwards, so there is nothing to repeat.
      remember(null);
      setSystemMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'user',
          text: userText || 'Analyze this screenshot',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      beginProcessing();
      try {
        await window.electronAPI.streamGeminiChat(
          userText || 'Analyze this screenshot',
          currentAttachments.map((s) => s.path),
          conversationContextRef.current.slice(-8000)
        );
      } catch (err) {
        pushSystemError(err);
      } finally {
        setIsProcessing(false);
      }
    } else {
      let isAvailable = false;
      try {
        const agentStatus = await window.electronAPI?.agentStatus?.();
        isAvailable = Boolean(agentStatus?.available);
        queryClient.setQueryData(['agent-status'], isAvailable);
      } catch {
        isAvailable = false;
        queryClient.setQueryData(['agent-status'], false);
      }

      if (isAvailable) {
        remember({ kind: 'manual', text: userText });
        const echo = userEchoMessage({ id: Date.now().toString(), promptText: userText, echoPrompt: true, attachments: [] });
        const placeholderId = (Date.now() + 1).toString();
        const placeholder: Message = {
          id: placeholderId,
          role: 'system',
          text: '',
          isStreaming: true,
          intent: 'manual',
        };
        setSystemMessages((prev) => (echo ? [...prev, echo, placeholder] : [...prev, placeholder]));
        beginProcessing();
        isAgentRunRef.current = true;

        try {
          const result = await window.electronAPI.agentSubmit({ text: userText });
          if (cancelledRef.current) return;
          if (!result || !result.ok) {
            isAgentRunRef.current = false;
            setIsProcessing(false);
            const reason = (result && !result.ok && result.reason) ? result.reason : 'Agent submission failed';
            setSystemMessages((prev) => {
              const withoutPlaceholder = prev.filter((m) => m.id !== placeholderId);
              return [
                ...withoutPlaceholder,
                {
                  id: Date.now().toString(),
                  role: 'system',
                  text: reason,
                  isError: true,
                },
              ];
            });
          }
        } catch (err) {
          isAgentRunRef.current = false;
          setIsProcessing(false);
          setSystemMessages((prev) => {
            const withoutPlaceholder = prev.filter((m) => m.id !== placeholderId);
            return [
              ...withoutPlaceholder,
              {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`,
                isError: true,
              },
            ];
          });
        }
      } else {
        // Text-only: route through submitPrompt so IPC/RAG streams update the placeholder listeners.
        remember({ kind: 'manual', text: userText });
        await submitPrompt({
          userText,
          placeholderIntent: 'manual',
        });
      }
    }
  }, [inputValue, attachedContext, submitPrompt, pushSystemError]);

  /**
   * Stops the answer being generated. The main process ends its streams at their next token; the tokens
   * already on their way are ignored here, and what has been written stays as the answer.
   */
  const stopGeneration = useCallback(async () => {
    cancelledRef.current = true;
    if (isAgentRunRef.current) {
      try {
        await window.electronAPI.agentAbort?.();
      } catch (error) {
        console.warn('[useMeetingChat] agentAbort failed:', error);
      }
      isAgentRunRef.current = false;
    }
    try {
      await window.electronAPI.cancelGeneration();
    } catch (error) {
      console.warn('[useMeetingChat] cancelGeneration failed:', error);
    }
    // The user may have asked something new while the main process was answering: that request owns the state now.
    if (!cancelledRef.current) return;
    stop();
    setIsProcessing(false);
    setSystemMessages((prev) =>
      prev.filter((m) => !(m.isStreaming && m.text === '')).map((m) => (m.isStreaming ? { ...m, isStreaming: false, isWorkingState: false } : m))
    );
    // Tokens already on their way arrive within moments; after that, answers the engine starts by itself are wanted again.
    window.setTimeout(() => { cancelledRef.current = false; }, 1000);
  }, [stop]);

  /** Asks again what was asked last; a failure message at the end of the list is removed first. */
  const retryLast = useCallback(async () => {
    const action = lastActionRef.current;
    if (!action) return;
    setSystemMessages((prev) => (prev.length > 0 && prev[prev.length - 1].isError ? prev.slice(0, -1) : prev));
    switch (action.kind) {
      case 'what_to_say': return handleWhatToSay();
      case 'clarify': return handleClarify();
      case 'recap': return handleRecap();
      case 'follow_up_questions': return handleFollowUpQuestions();
      case 'brainstorm': return handleBrainstorm();
      case 'code_hint': return handleCodeHint();
      case 'manual': {
        let isAvailable = false;
        try {
          const status = await window.electronAPI?.agentStatus?.();
          isAvailable = Boolean(status?.available);
        } catch {
          isAvailable = false;
        }
        if (isAvailable) {
          const placeholderId = (Date.now() + 1).toString();
          const placeholder: Message = {
            id: placeholderId,
            role: 'system',
            text: '',
            isStreaming: true,
            intent: 'manual',
          };
          setSystemMessages((prev) => [...prev, placeholder]);
          beginProcessing();
          isAgentRunRef.current = true;
          try {
            const result = await window.electronAPI.agentSubmit({ text: action.text });
            if (cancelledRef.current) return;
            if (!result || !result.ok) {
              isAgentRunRef.current = false;
              setIsProcessing(false);
              const reason = (result && !result.ok && result.reason) ? result.reason : 'Agent submission failed';
              setSystemMessages((prev) => {
                const withoutPlaceholder = prev.filter((m) => m.id !== placeholderId);
                return [
                  ...withoutPlaceholder,
                  { id: Date.now().toString(), role: 'system', text: reason, isError: true },
                ];
              });
            }
          } catch (err) {
            isAgentRunRef.current = false;
            setIsProcessing(false);
            setSystemMessages((prev) => {
              const withoutPlaceholder = prev.filter((m) => m.id !== placeholderId);
              return [
                ...withoutPlaceholder,
                { id: Date.now().toString(), role: 'system', text: `Error: ${err}`, isError: true },
              ];
            });
          }
          return;
        }
        return submitPrompt({ userText: action.text, placeholderIntent: 'manual', echoPrompt: false });
      }
    }
  }, [handleWhatToSay, handleClarify, handleRecap, handleFollowUpQuestions, handleBrainstorm, handleCodeHint, submitPrompt]);

  return {
    stopGeneration,
    retryLast,
    canRetry,
    attachedContext,
    setAttachedContext,
    actionButtonMode,
    conversationContext,
    inputValue,
    setInputValue,
    isProcessing: isProcessing || isChatLoading,
    setIsProcessing,
    messages,
    setSystemMessages,
    stop,
    submitPrompt,
    handleWhatToSay,
    handleFollowUp,
    handleCodeHint,
    handleClarify,
    handleFollowUpQuestions,
    handleRecap,
    handleBrainstorm,
    handleAnswerNow,
    handleManualSubmit,
    isAgentAvailable,
  };
}
