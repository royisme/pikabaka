import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { electronChatFetch } from '../lib/electronChatFetch';

type Message = {
  id: string;
  role: 'user' | 'system' | 'interviewer';
  text: string;
  isStreaming?: boolean;
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
        text: `Error: ${error}`,
      },
    ]);
  }, []);

  const handleWhatToSay = useCallback(async () => {
    setIsProcessing(true);
    const currentAttachments = attachedContext;

    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      setSystemMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'user',
          text: 'What should I say about this?',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
    }

    try {
      await window.electronAPI.generateWhatToSay(undefined, currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined);
    } catch (err) {
      pushSystemError(err);
    } finally {
      setIsProcessing(false);
    }
  }, [attachedContext, pushSystemError]);

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
      // Text-only: try RAG first, then use useChat/sendMessage
      try {
        const ragResult = await window.electronAPI.ragQueryLive?.(userText || '');
        if (ragResult?.success) return;
      } catch {
        // RAG unavailable — continue to useChat
      }

      sendMessage({ text: userText });
    }
  }, [inputValue, attachedContext, sendMessage, pushSystemError]);

  return {
    knowledgeContext,
    attachedContext,
    setAttachedContext,
    actionButtonMode,
    conversationContext,
    inputValue,
    setInputValue,
    isProcessing: isProcessing || isChatLoading,
    messages,
    stop,
    handleWhatToSay,
    handleClarify,
    handleFollowUpQuestions,
    handleRecap,
    handleBrainstorm,
    handleAnswerNow,
    handleManualSubmit,
  };
}
