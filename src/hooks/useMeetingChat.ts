import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { electronChatFetch } from '../lib/electronChatFetch';
import { analytics } from '../lib/analytics/analytics.service';
import { sanitizeChatError } from '../utils/chatErrorUtils';

export type Message = {
  id: string;
  role: 'user' | 'system' | 'interviewer';
  text: string;
  isStreaming?: boolean;
  streamStatus?: string;
  hasScreenshot?: boolean;
  screenshotPreview?: string;
  isCode?: boolean;
  intent?: string;
  isNegotiationCoaching?: boolean;
  negotiationCoachingData?: {
    tacticalNote: string;
    exactScript: string;
    showSilenceTimer: boolean;
    phase: string;
    theirOffer: number | null;
    yourTarget: number | null;
    currency: string;
  };
};

type KnowledgeContext = {
  matchedJDSignals: Array<{ requirement: string; relevance: number }>;
  resumeEvidence: Array<{ source: string; text: string }>;
  mustHitKeywords: string[];
  questionCategory: string;
};

type AttachedContext = Array<{ path: string; preview: string }>;

export function useMeetingChat() {
  const [knowledgeContext, setKnowledgeContext] = useState<KnowledgeContext | null>(null);
  const [attachedContext, setAttachedContext] = useState<AttachedContext>([]);
  const [actionButtonMode, setActionButtonMode] = useState<'recap' | 'brainstorm'>('recap');
  const [conversationContext, setConversationContext] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  // systemMessages holds quick-action responses (WhatToSay, Clarify, Recap, etc.)
  const [systemMessages, setSystemMessages] = useState<Message[]>([]);
  const knowledgeContextTimeoutRef = useRef<number | null>(null);
  const conversationContextRef = useRef(conversationContext);

  // Keep ref in sync so DefaultChatTransport body getter always reads latest value
  useEffect(() => {
    conversationContextRef.current = conversationContext;
  }, [conversationContext]);

  const { messages: chatMessages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: electronChatFetch as typeof globalThis.fetch,
      body: () => ({ context: conversationContextRef.current.slice(-8000) }),
    }),
  });

  const isChatLoading = status === 'submitted' || status === 'streaming';

  const appendStreamingText = useCallback((message: Message, token: string): Message => {
    return { ...message, text: (message.text || '') + token };
  }, []);

  useEffect(() => {
    window.electronAPI?.getActionButtonMode?.()
      .then((mode) => {
        if (mode) setActionButtonMode(mode);
      })
      .catch(() => {});

    const unsubscribe = window.electronAPI?.onActionButtonModeChanged?.((mode) => {
      setActionButtonMode(mode);
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onKnowledgeContextUpdate) return;

    const unsubscribe = window.electronAPI.onKnowledgeContextUpdate((data) => {
      setKnowledgeContext(data);
      if (knowledgeContextTimeoutRef.current) {
        window.clearTimeout(knowledgeContextTimeoutRef.current);
      }
      knowledgeContextTimeoutRef.current = window.setTimeout(() => {
        setKnowledgeContext(null);
        knowledgeContextTimeoutRef.current = null;
      }, 30000);
    });

    return () => {
      unsubscribe();
      if (knowledgeContextTimeoutRef.current) {
        window.clearTimeout(knowledgeContextTimeoutRef.current);
        knowledgeContextTimeoutRef.current = null;
      }
    };
  }, []);

  // Build conversationContext from all messages (chat + system) for IPC quick actions
  const allMessagesForContext = useMemo(() => {
    const fromChat: Message[] = chatMessages.map((m) => ({
      id: m.id,
      role: m.role === 'assistant' ? ('interviewer' as const) : ('user' as const),
      text: m.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { type: 'text'; text: string }).text)
        .join(''),
    }));
    return [...fromChat, ...systemMessages];
  }, [chatMessages, systemMessages]);

  useEffect(() => {
    const context = allMessagesForContext
      .filter((m) => m.role !== 'user' || !m.hasScreenshot)
      .map((m) => `${m.role === 'interviewer' ? 'Interviewer' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .slice(-20)
      .join('\n');

    setConversationContext(context);
  }, [allMessagesForContext]);

  // Merged messages for UI rendering (chat + system quick-action responses)
  const messages = useMemo<Message[]>(() => {
    const lastChatId = chatMessages[chatMessages.length - 1]?.id;
    const fromChat: Message[] = chatMessages.map((m) => ({
      id: m.id,
      role: m.role === 'assistant' ? ('interviewer' as const) : ('user' as const),
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
        text: `Error: ${sanitizeChatError(error)}`,
      },
    ]);
  }, []);

  // IPC response listeners — update systemMessages with streaming AI responses
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanups: Array<() => void> = [];

    // ---- Assist (generic insight from streaming) ----
    if (window.electronAPI.onGeminiStreamStatus) {
      cleanups.push(window.electronAPI.onGeminiStreamStatus((data) => {
        if (!data?.message) return;
        setSystemMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || !last.isStreaming) return prev;
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            streamStatus: data.message,
          };
          return updated;
        });
      }));
    }

    if (window.electronAPI.onIntelligenceAssistUpdate) {
      cleanups.push(window.electronAPI.onIntelligenceAssistUpdate((data) => {
        setSystemMessages((prev) => {
          const last = prev[prev.length - 1];
          const text = (data as { insight?: string; token?: string }).insight ?? (data as { token?: string }).token ?? '';
          if (last && last.isStreaming && last.intent === 'assist') {
            const updated = [...prev];
            updated[updated.length - 1] = appendStreamingText(last, text);
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text, intent: 'assist', isStreaming: true }];
        });
      }));
    }

    // ---- Streaming: Gemini Chat (streamGeminiChat / suggested answer) ----
    if (window.electronAPI.onIntelligenceSuggestedAnswerToken) {
      cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {
        setSystemMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === 'what_to_answer') {
            const updated = [...prev];
            updated[updated.length - 1] = appendStreamingText(last, data.token);
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.token, intent: 'what_to_answer', isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onIntelligenceSuggestedAnswer) {
      cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
        setIsProcessing(false);
        setSystemMessages((prev) => {
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
        setSystemMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === data.intent) {
            const updated = [...prev];
            updated[updated.length - 1] = appendStreamingText(last, data.token);
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.token, intent: data.intent, isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onIntelligenceRefinedAnswer) {
      cleanups.push(window.electronAPI.onIntelligenceRefinedAnswer((data) => {
        setIsProcessing(false);
        setSystemMessages((prev) => {
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
        setSystemMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === 'recap') {
            const updated = [...prev];
            updated[updated.length - 1] = appendStreamingText(last, data.token);
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.token, intent: 'recap', isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onIntelligenceRecap) {
      cleanups.push(window.electronAPI.onIntelligenceRecap((data) => {
        setIsProcessing(false);
        setSystemMessages((prev) => {
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
        setSystemMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.isStreaming && last.intent === 'follow_up_questions') {
            const updated = [...prev];
            updated[updated.length - 1] = appendStreamingText(last, data.token);
            return updated;
          }
          return [...prev, { id: Date.now().toString(), role: 'system', text: data.token, intent: 'follow_up_questions', isStreaming: true }];
        });
      }));
    }
    if (window.electronAPI.onIntelligenceFollowUpQuestionsUpdate) {
      cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsUpdate((data) => {
        setIsProcessing(false);
        setSystemMessages((prev) => {
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
        setSystemMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'system', text: `\uD83C\uDFAF **Answer:**\n\n${data.answer}` },
        ]);
      }));
    }
    if (window.electronAPI.onIntelligenceError) {
      cleanups.push(window.electronAPI.onIntelligenceError((data) => {
        setIsProcessing(false);
        setSystemMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'system', text: `\u274C Error (${data.mode}): ${data.error}` },
        ]);
      }));
    }
    if (window.electronAPI.onSuggestionGenerated) {
      cleanups.push(window.electronAPI.onSuggestionGenerated((data) => {
        setIsProcessing(false);
        setSystemMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'system', text: data.suggestion },
        ]);
      }));
    }
    if (window.electronAPI.onSuggestionError) {
      cleanups.push(window.electronAPI.onSuggestionError((data) => {
        setIsProcessing(false);
        setSystemMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'system', text: `Error: ${data.error}` },
        ]);
      }));
    }

    // ---- Streaming: generic gemini-chat-stream (used by submitPrompt / handleWhatToSay) ----
    console.log('[useMeetingChat] registering gemini-stream listeners. has onGeminiStreamToken:', !!window.electronAPI.onGeminiStreamToken);
    if (window.electronAPI.onGeminiStreamToken) {
      cleanups.push(window.electronAPI.onGeminiStreamToken((token) => {
        console.log('[gemini-stream-token]', String(token).slice(0, 40));
        setSystemMessages((prev) => {
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
        setSystemMessages((prev) => {
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
        setSystemMessages((prev) => {
          const last = prev[prev.length - 1];
          const errMsg = { id: Date.now().toString(), role: 'system' as const, text: `❌ Error: ${sanitizeChatError(error)}` };
          if (last && last.isStreaming && last.text === '') return prev.slice(0, -1).concat(errMsg);
          return [...prev, errMsg];
        });
      }));
    }

    // ---- Streaming: RAG live query (rag:query-live) ----
    if (window.electronAPI.onRAGStreamChunk) {
      cleanups.push(window.electronAPI.onRAGStreamChunk((data) => {
        console.log('[rag-stream-chunk]', String(data.chunk).slice(0, 40));
        setSystemMessages((prev) => {
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
        setSystemMessages((prev) => {
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
        setSystemMessages((prev) => {
          const last = prev[prev.length - 1];
          const errMsg = { id: Date.now().toString(), role: 'system' as const, text: `❌ Error: ${data.error}` };
          if (last && last.isStreaming && last.text === '') return prev.slice(0, -1).concat(errMsg);
          return [...prev, errMsg];
        });
      }));
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  // Clarify streaming listeners — intentionally empty dep array so they survive
  // expand/collapse cycles without orphaning an in-flight stream.
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanupToken = window.electronAPI.onIntelligenceClarifyToken((data: { token: string }) => {
      setSystemMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.isStreaming && last.intent === 'clarify') {
          const updated = [...prev];
          updated[updated.length - 1] = appendStreamingText(last, data.token);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — these listeners must survive isExpanded changes

  const submitPrompt = useCallback(async ({
    userText,
    attachments,
    clearAttachments = true,
    addUserMessage = true,
    placeholderIntent,
    skipRag = false,
    streamOptions,
  }: {
    userText: string;
    attachments?: Array<{ path: string; preview: string }>;
    clearAttachments?: boolean;
    addUserMessage?: boolean;
    placeholderIntent?: string;
    skipRag?: boolean;
    streamOptions?: { skipSystemPrompt?: boolean };
  }) => {
    const currentAttachments = attachments ?? attachedContext;
    const trimmedText = userText.trim();
    const promptText = trimmedText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : '');

    if (!promptText && currentAttachments.length === 0) return;
    if (clearAttachments) setAttachedContext([]);

    console.log('[submitPrompt] entry', { promptText: promptText.slice(0, 60), placeholderIntent, addUserMessage, attachments: currentAttachments.length });

    if (addUserMessage) {
      setSystemMessages((prev) => {
        const next = [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'user' as const,
            text: promptText,
            hasScreenshot: currentAttachments.length > 0,
            screenshotPreview: currentAttachments[0]?.preview,
          },
        ];
        console.log('[submitPrompt] added user msg, systemMessages count =', next.length);
        return next;
      });
    }

    setSystemMessages((prev) => {
      const next = [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'system' as const,
          text: '',
          isStreaming: true,
          ...(placeholderIntent ? { intent: placeholderIntent } : {}),
        },
      ];
      console.log('[submitPrompt] added streaming placeholder, systemMessages count =', next.length);
      return next;
    });

    setIsProcessing(true);

    try {
      if (!skipRag && currentAttachments.length === 0) {
        console.log('[submitPrompt] calling ragQueryLive…');
        const ragResult = await window.electronAPI.ragQueryLive?.(promptText);
        console.log('[submitPrompt] ragQueryLive result', ragResult);
        if (ragResult?.success) return;
      }

      console.log('[submitPrompt] calling streamGeminiChat…');
      await window.electronAPI.streamGeminiChat(
        promptText,
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
        conversationContextRef.current,
        streamOptions
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
            text: `\u274C Error starting stream: ${err}`,
            ...(last.intent ? { intent: last.intent } : {}),
          });
        }
        return [...prev, { id: Date.now().toString(), role: 'system', text: `\u274C Error: ${err}` }];
      });
    }
  }, [attachedContext, conversationContextRef, setAttachedContext, setIsProcessing, setSystemMessages]);

  const stopActiveResponse = useCallback(() => {
    stop?.();
    setIsProcessing(false);
    window.electronAPI?.cancelGeminiChat?.().catch(() => {});
    window.electronAPI?.ragCancelQuery?.({ meetingId: 'live-meeting-current' }).catch(() => {});
  }, [stop]);

  const handleWhatToSay = useCallback(async () => {
    analytics.trackCommandExecuted('what_to_say');
    await submitPrompt({
      userText: attachedContext.length > 0
        ? 'What should I say about this?'
        : 'What should I say in response to the latest interviewer context?',
      placeholderIntent: 'what_to_answer',
    });
  }, [submitPrompt, attachedContext.length]);

  const handleFollowUp = useCallback(async (intent: string = 'rephrase') => {
    setIsProcessing(true);
    analytics.trackCommandExecuted('follow_up_' + intent);
    try {
      await window.electronAPI.generateFollowUp(intent);
    } catch (err) {
      setSystemMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'system', text: `Error: ${err}` },
      ]);
    } finally {
      setIsProcessing(false);
    }
  }, [appendStreamingText, setIsProcessing, setSystemMessages]);

  const handleCodeHint = useCallback(async () => {
    setIsProcessing(true);
    analytics.trackCommandExecuted('code_hint');

    const currentAttachments = attachedContext;
    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      setSystemMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'user',
          text: 'Give me a code hint for this',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
    }

    try {
      await window.electronAPI.generateCodeHint(
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined
      );
    } catch (err) {
      setSystemMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: 'system', text: `Error: ${err}` },
      ]);
    } finally {
      setIsProcessing(false);
    }
  }, [attachedContext, setAttachedContext, setIsProcessing, setSystemMessages]);

  const handleClarify = useCallback(async () => {
    setIsProcessing(true);
    try {
      await window.electronAPI.generateClarify();
    } catch (err) {
      pushSystemError(err);
      setIsProcessing(false);
    }
  }, [pushSystemError]);

  const handleFollowUpQuestions = useCallback(async () => {
    setIsProcessing(true);
    try {
      await window.electronAPI.generateFollowUpQuestions();
    } catch (err) {
      pushSystemError(err);
      setIsProcessing(false);
    }
  }, [pushSystemError]);

  const handleRecap = useCallback(async () => {
    setIsProcessing(true);
    try {
      await window.electronAPI.generateRecap();
    } catch (err) {
      pushSystemError(err);
    } finally {
      setIsProcessing(false);
    }
  }, [pushSystemError]);

  const handleBrainstorm = useCallback(async () => {
    setIsProcessing(true);
    const currentAttachments = attachedContext;

    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      setSystemMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'user',
          text: 'Brainstorm with this context',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
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
      // Screenshots: use legacy streamGeminiChat (supports image paths)
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
      setIsProcessing(true);
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
      // Text-only: route through submitPrompt so IPC/RAG streams update the placeholder listeners.
      await submitPrompt({
        userText,
        placeholderIntent: 'manual',
      });
    }
  }, [inputValue, attachedContext, submitPrompt, pushSystemError]);

  return {
    knowledgeContext,
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
    stopActiveResponse,
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
  };
}
