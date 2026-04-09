import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [messages, setMessages] = useState<Message[]>([]);
  const knowledgeContextTimeoutRef = useRef<number | null>(null);

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

  useEffect(() => {
    const context = messages
      .filter((m) => m.role !== 'user' || !m.hasScreenshot)
      .map((m) => `${m.role === 'interviewer' ? 'Interviewer' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .slice(-20)
      .join('\n');

    setConversationContext(context);
  }, [messages]);

  const pushSystemError = useCallback((error: unknown) => {
    setMessages((prev) => [
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
      setMessages((prev) => [
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
      setMessages((prev) => [
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
    setIsProcessing(true);
    try {
      const ragResult = await window.electronAPI.ragQueryLive?.(inputValue || '');
      if (ragResult?.success) return;

      await window.electronAPI.streamGeminiChat(inputValue || '', undefined, conversationContext);
    } catch (err) {
      pushSystemError(err);
    } finally {
      setIsProcessing(false);
    }
  }, [conversationContext, inputValue, pushSystemError]);

  const handleManualSubmit = useCallback(async () => {
    if (!inputValue.trim() && attachedContext.length === 0) return;

    const userText = inputValue;
    const currentAttachments = attachedContext;

    setInputValue('');
    setAttachedContext([]);
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: 'user',
        text: userText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : ''),
        hasScreenshot: currentAttachments.length > 0,
        screenshotPreview: currentAttachments[0]?.preview,
      },
    ]);

    setIsProcessing(true);

    try {
      if (currentAttachments.length === 0) {
        const ragResult = await window.electronAPI.ragQueryLive?.(userText || '');
        if (ragResult?.success) return;
      }

      await window.electronAPI.streamGeminiChat(
        userText || 'Analyze this screenshot',
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
        conversationContext
      );
    } catch (err) {
      pushSystemError(err);
    } finally {
      setIsProcessing(false);
    }
  }, [attachedContext, conversationContext, inputValue, pushSystemError]);

  return {
    knowledgeContext,
    attachedContext,
    setAttachedContext,
    actionButtonMode,
    conversationContext,
    inputValue,
    setInputValue,
    isProcessing,
    messages,
    handleWhatToSay,
    handleClarify,
    handleFollowUpQuestions,
    handleRecap,
    handleBrainstorm,
    handleAnswerNow,
    handleManualSubmit,
  };
}
