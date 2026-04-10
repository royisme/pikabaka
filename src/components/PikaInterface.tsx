import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TopPill from './ui/TopPill';
import TranscriptPanel from './meeting/TranscriptPanel';
import ChatPanel from './meeting/ChatPanel';
import ResizableSplitter from './ui/ResizableSplitter';
import { analytics } from '../lib/analytics/analytics.service';
import { useShortcuts, type ShortcutConfig } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getOverlayAppearance, getDefaultOverlayOpacity } from '../lib/overlayAppearance';
import { useMeetingChat, type Message } from '../hooks/useMeetingChat';
import { useMeetingTranscript } from '../hooks/useMeetingTranscript';
import { useMeetingAudio } from '../hooks/useMeetingAudio';

interface PikaInterfaceProps {
    onEndMeeting?: () => void;
    overlayOpacity?: number;
}

const PikaInterface: React.FC<PikaInterfaceProps> = ({ onEndMeeting, overlayOpacity = getDefaultOverlayOpacity() }) => {
    const isLightTheme = useResolvedTheme() === 'light';

    // --- UI-only state (not covered by hooks) ---
    const [isExpanded, setIsExpanded] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [splitterPosition, setSplitterPosition] = useState(() => {
        const stored = localStorage.getItem('pika_splitter_position');
        const parsed = stored ? Number(stored) : 40;
        return Number.isFinite(parsed) ? Math.min(80, Math.max(20, parsed)) : 40;
    });
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [currentModel, setCurrentModel] = useState<string>('gemini-3-flash-preview');

    // Analytics
    const requestStartTimeRef = useRef<number | null>(null);

    // Refs for DOM / layout
    const isStealthRef = useRef<boolean>(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const textInputRef = useRef<HTMLInputElement>(null);

    const { shortcuts, isShortcutPressed } = useShortcuts();

    // --- Delegate to hooks ---
    const {
        transcriptSegments,
        isInterviewerSpeaking,
        currentInterviewerPartial,
        transcriptDisplayMode,
        showTranscript,
        handleTranslateTranscriptSegment,
    } = useMeetingTranscript();

    const {
        isManualRecording,
        setIsManualRecording,
        isRecordingRef,
        manualTranscript,
        setManualTranscript,
        manualTranscriptRef,
        voiceInput,
        setVoiceInput,
        voiceInputRef,
        nativeAudioHealth,
        sttStatus,
        sttNeedsTroubleshooting,
        showSttErrorDetail,
    } = useMeetingAudio();

    const {
        messages,
        setSystemMessages,
        knowledgeContext,
        attachedContext,
        setAttachedContext,
        actionButtonMode,
        inputValue,
        setInputValue,
        isProcessing,
        setIsProcessing,
        handleClarify,
        handleFollowUpQuestions,
        handleRecap,
        handleBrainstorm,
        handleManualSubmit,
        conversationContext,
    } = useMeetingChat();

    // --- Persist splitter position ---
    useEffect(() => {
        localStorage.setItem('pika_splitter_position', String(splitterPosition));
    }, [splitterPosition]);

    // --- Model ---
    useEffect(() => {
        if (window.electronAPI?.getDefaultModel) {
            window.electronAPI.getDefaultModel()
                .then((result: any) => {
                    if (result?.model) {
                        setCurrentModel(result.model);
                        window.electronAPI.setModel(result.model).catch(() => {});
                    }
                })
                .catch((err: any) => console.error('Failed to fetch default model:', err));
        }
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onModelChanged) return;
        const unsubscribe = window.electronAPI.onModelChanged((modelId: string) => {
            setCurrentModel((prev) => (prev === modelId ? prev : modelId));
        });
        return () => unsubscribe();
    }, []);

    // --- Undetectable ---
    useEffect(() => {
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then(setIsUndetectable);
        }
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((state) => {
                setIsUndetectable(state);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('pika_undetectable', String(isUndetectable));
    }, [isUndetectable]);

    // --- Mouse passthrough ---
    useEffect(() => {
        window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => {});
        const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v) => setIsMousePassthrough(v));
        return () => unsub?.();
    }, []);

    // --- Settings visibility ---
    useEffect(() => {
        if (!window.electronAPI?.onSettingsVisibilityChange) return;
        const unsubscribe = window.electronAPI.onSettingsVisibilityChange((isVisible) => {
            setIsSettingsOpen(isVisible);
        });
        return () => unsubscribe();
    }, []);

    // --- Window visibility tied to isExpanded ---
    useEffect(() => {
        if (isExpanded) {
            window.electronAPI.showWindow(isStealthRef.current);
            isStealthRef.current = false;
        } else {
            setTimeout(() => window.electronAPI.hideWindow(), 400);
        }
    }, [isExpanded]);

    useEffect(() => {
        if (!window.electronAPI?.onToggleExpand) return;
        const unsubscribe = window.electronAPI.onToggleExpand(() => {
            setIsExpanded((prev) => !prev);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onEnsureExpanded) return;
        const unsubscribe = window.electronAPI.onEnsureExpanded(() => {
            isStealthRef.current = true;
            setIsExpanded(true);
        });
        return () => unsubscribe();
    }, []);

    // --- Session reset ---
    useEffect(() => {
        if (!window.electronAPI?.onSessionReset) return;
        const unsubscribe = window.electronAPI.onSessionReset(() => {
            console.log('[PikaInterface] Resetting session state...');
            setSystemMessages([]);
            setInputValue('');
            setAttachedContext([]);
            setManualTranscript('');
            setVoiceInput('');
            setIsProcessing(false);
            analytics.trackConversationStarted();
        });
        return () => unsubscribe();
    }, [setSystemMessages, setInputValue, setAttachedContext, setManualTranscript, setVoiceInput, setIsProcessing]);

    // --- Screenshot attach ---
    const handleScreenshotAttach = useCallback((data: { path: string; preview: string }) => {
        setIsExpanded(true);
        setAttachedContext((prev) => {
            if (prev.some((s) => s.path === data.path)) return prev;
            return [...prev, data].slice(-5);
        });
    }, [setAttachedContext]);

    // --- Auto-resize window ---
    useLayoutEffect(() => {
        if (!contentRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const rect = entry.target.getBoundingClientRect();
                console.log('[PikaInterface] ResizeObserver:', Math.ceil(rect.width), Math.ceil(rect.height));
                window.electronAPI?.updateContentDimensions({
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height),
                });
            }
        });
        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!contentRef.current) return;
        requestAnimationFrame(() => {
            if (!contentRef.current) return;
            const rect = contentRef.current.getBoundingClientRect();
            window.electronAPI?.updateContentDimensions({
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height),
            });
        });
    }, [attachedContext]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (contentRef.current) {
                const rect = contentRef.current.getBoundingClientRect();
                window.electronAPI?.updateContentDimensions({
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height),
                });
            }
        }, 600);
        return () => clearTimeout(timer);
    }, []);

    // --- Auto-scroll ---
    useEffect(() => {
        if (isExpanded) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isExpanded, isProcessing]);

    // --- Appearance ---
    const appearance = useMemo(
        () => getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'),
        [overlayOpacity, isLightTheme]
    );
    const overlayPanelClass = 'overlay-text-primary';

    // --- Action handlers that still live here (use streamGeminiChat + conversationContext) ---

    const submitPrompt = useCallback(async ({
        userText,
        attachments = attachedContext,
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
        const trimmedText = userText.trim();
        const currentAttachments = attachments;
        const promptText = trimmedText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : '');

        if (!promptText && currentAttachments.length === 0) return;
        if (clearAttachments) setAttachedContext([]);

        if (addUserMessage) {
            setSystemMessages((prev) => [
                ...prev,
                {
                    id: Date.now().toString(),
                    role: 'user',
                    text: promptText,
                    hasScreenshot: currentAttachments.length > 0,
                    screenshotPreview: currentAttachments[0]?.preview,
                },
            ]);
        }

        setSystemMessages((prev) => [
            ...prev,
            {
                id: Date.now().toString(),
                role: 'system',
                text: '',
                isStreaming: true,
                ...(placeholderIntent ? { intent: placeholderIntent } : {}),
            },
        ]);

        setIsExpanded(true);
        setIsProcessing(true);

        try {
            if (!skipRag && currentAttachments.length === 0) {
                const ragResult = await window.electronAPI.ragQueryLive?.(promptText);
                if (ragResult?.success) return;
            }

            requestStartTimeRef.current = Date.now();
            await window.electronAPI.streamGeminiChat(
                promptText,
                currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
                conversationContext,
                streamOptions
            );
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
    }, [attachedContext, conversationContext, setAttachedContext, setIsProcessing, setSystemMessages]);

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
        setIsExpanded(true);
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
    }, [setIsProcessing, setSystemMessages]);

    const handleCodeHint = useCallback(async () => {
        setIsExpanded(true);
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

    const handleAnswerNow = useCallback(async () => {
        if (isManualRecording) {
            isRecordingRef.current = false;
            setIsManualRecording(false);
            setManualTranscript('');

            window.electronAPI.finalizeMicSTT().catch((err) =>
                console.error('[PikaInterface] Failed to send finalizeMicSTT:', err)
            );

            const currentAttachments = attachedContext;
            setAttachedContext([]);

            const question = (
                voiceInputRef.current + (manualTranscriptRef.current ? ' ' + manualTranscriptRef.current : '')
            ).trim();
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            manualTranscriptRef.current = '';

            if (!question && currentAttachments.length === 0) {
                setSystemMessages((prev) => [
                    ...prev,
                    {
                        id: Date.now().toString(),
                        role: 'system',
                        text: '\u26A0\uFE0F No speech detected. Try speaking closer to your microphone.',
                    },
                ]);
                return;
            }

            setSystemMessages((prev) => [
                ...prev,
                {
                    id: Date.now().toString(),
                    role: 'user',
                    text: question,
                    hasScreenshot: currentAttachments.length > 0,
                    screenshotPreview: currentAttachments[0]?.preview,
                },
                { id: (Date.now() + 1).toString(), role: 'system', text: '', isStreaming: true },
            ]);

            setIsProcessing(true);

            try {
                let prompt = '';
                if (currentAttachments.length > 0) {
                    prompt = `You are a helper. The user has provided a screenshot and a spoken question/command.
User said: "${question}"

Instructions:
1. Analyze the screenshot in the context of what the user said.
2. Provide a direct, helpful answer.
3. Be concise.`;
                } else {
                    const ragResult = await window.electronAPI.ragQueryLive?.(question);
                    if (ragResult?.success) return;

                    prompt = `You are a real-time interview assistant. The user just repeated or paraphrased a question from their interviewer.
Instructions:
1. Extract the core question being asked
2. Provide a clear, concise, and professional answer that the user can say out loud
3. Keep the answer conversational but informative (2-4 sentences ideal)
4. Do NOT include phrases like "The question is..." - just give the answer directly
5. Format for speaking out loud, not for reading

Provide only the answer, nothing else.`;
                }

                requestStartTimeRef.current = Date.now();
                await window.electronAPI.streamGeminiChat(
                    question,
                    currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
                    prompt,
                    { skipSystemPrompt: true }
                );
            } catch (err) {
                setIsProcessing(false);
                setSystemMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last && last.isStreaming && last.text === '') {
                        return prev.slice(0, -1).concat({
                            id: Date.now().toString(),
                            role: 'system',
                            text: `\u274C Error starting stream: ${err}`,
                        });
                    }
                    return [...prev, { id: Date.now().toString(), role: 'system', text: `\u274C Error: ${err}` }];
                });
            }
        } else {
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            isRecordingRef.current = true;
            setIsManualRecording(true);
        }
    }, [
        isManualRecording,
        isRecordingRef,
        setIsManualRecording,
        manualTranscriptRef,
        voiceInputRef,
        attachedContext,
        setAttachedContext,
        setManualTranscript,
        setVoiceInput,
        setIsProcessing,
        setSystemMessages,
    ]);

    // Handlers ref pattern — avoids re-binding event listener on every render
    const handlersRef = useRef({
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm,
    });
    handlersRef.current = {
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm,
    };

    // --- Keyboard shortcuts ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const {
                handleWhatToSay,
                handleFollowUpQuestions,
                handleRecap,
                handleAnswerNow,
                handleClarify,
                handleCodeHint,
                handleBrainstorm,
            } = handlersRef.current;

            if (isShortcutPressed(e, 'whatToAnswer')) {
                e.preventDefault();
                handleWhatToSay();
            } else if (isShortcutPressed(e, 'clarify')) {
                e.preventDefault();
                handleClarify();
            } else if (isShortcutPressed(e, 'followUp')) {
                e.preventDefault();
                handleFollowUpQuestions();
            } else if (isShortcutPressed(e, 'dynamicAction4')) {
                e.preventDefault();
                if (actionButtonMode === 'brainstorm') handleBrainstorm();
                else handleRecap();
            } else if (isShortcutPressed(e, 'answer')) {
                e.preventDefault();
                handleAnswerNow();
            } else if (isShortcutPressed(e, 'codeHint')) {
                e.preventDefault();
                handleCodeHint();
            } else if (isShortcutPressed(e, 'brainstorm')) {
                e.preventDefault();
                handleBrainstorm();
            } else if (isShortcutPressed(e, 'scrollUp')) {
                e.preventDefault();
                scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' });
            } else if (isShortcutPressed(e, 'scrollDown')) {
                e.preventDefault();
                scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
            } else if (isShortcutPressed(e, 'moveWindowUp') || isShortcutPressed(e, 'moveWindowDown')) {
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isShortcutPressed, actionButtonMode]);

    const generalHandlersRef = useRef({
        toggleVisibility: () => window.electronAPI.toggleWindow(),
        processScreenshots: handleWhatToSay,
        resetCancel: async () => {
            if (isProcessing) {
                setIsProcessing(false);
            } else {
                await window.electronAPI.resetIntelligence();
                setSystemMessages([]);
                setAttachedContext([]);
                setInputValue('');
            }
        },
        toggleMousePassthrough: () => {
            const newState = !isMousePassthrough;
            setIsMousePassthrough(newState);
            window.electronAPI?.setOverlayMousePassthrough?.(newState);
        },
        takeScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeScreenshot();
                if (data?.path) handleScreenshotAttach(data as { path: string; preview: string });
            } catch (err) {
                console.error('Error triggering screenshot:', err);
            }
        },
        selectiveScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeSelectiveScreenshot();
                if (data && !data.cancelled && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error('Error triggering selective screenshot:', err);
            }
        },
    });
    generalHandlersRef.current = {
        toggleVisibility: () => window.electronAPI.toggleWindow(),
        processScreenshots: handleWhatToSay,
        resetCancel: async () => {
            if (isProcessing) {
                setIsProcessing(false);
            } else {
                await window.electronAPI.resetIntelligence();
                setSystemMessages([]);
                setAttachedContext([]);
                setInputValue('');
            }
        },
        toggleMousePassthrough: () => {
            const newState = !isMousePassthrough;
            setIsMousePassthrough(newState);
            window.electronAPI?.setOverlayMousePassthrough?.(newState);
        },
        takeScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeScreenshot();
                if (data?.path) handleScreenshotAttach(data as { path: string; preview: string });
            } catch (err) {
                console.error('Error triggering screenshot:', err);
            }
        },
        selectiveScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeSelectiveScreenshot();
                if (data && !data.cancelled && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error('Error triggering selective screenshot:', err);
            }
        },
    };

    useEffect(() => {
        const handleGeneralKeyDown = (e: KeyboardEvent) => {
            const handlers = generalHandlersRef.current;
            const target = e.target as HTMLElement;
            const isInput =
                target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (isShortcutPressed(e, 'toggleVisibility')) {
                e.preventDefault();
                handlers.toggleVisibility();
            } else if (isShortcutPressed(e, 'processScreenshots')) {
                if (!isInput) {
                    e.preventDefault();
                    handlers.processScreenshots();
                }
            } else if (isShortcutPressed(e, 'resetCancel')) {
                e.preventDefault();
                handlers.resetCancel();
            } else if (isShortcutPressed(e, 'takeScreenshot')) {
                e.preventDefault();
                handlers.takeScreenshot();
            } else if (isShortcutPressed(e, 'selectiveScreenshot')) {
                e.preventDefault();
                handlers.selectiveScreenshot();
            } else if (isShortcutPressed(e, 'toggleMousePassthrough')) {
                e.preventDefault();
                handlers.toggleMousePassthrough();
            }
        };

        window.addEventListener('keydown', handleGeneralKeyDown);
        return () => window.removeEventListener('keydown', handleGeneralKeyDown);
    }, [isShortcutPressed]);

    useEffect(() => {
        if (!window.electronAPI.onCaptureAndProcess) return;
        const unsubscribe = window.electronAPI.onCaptureAndProcess((data) => {
            setIsExpanded(true);
            setAttachedContext((prev) => {
                if (prev.some((s) => s.path === data.path)) return prev;
                return [...prev, data].slice(-5);
            });
            setTimeout(() => {
                handlersRef.current.handleWhatToSay();
            }, 0);
        });
        return unsubscribe;
    }, []);

    // Screenshot IPC listeners
    useEffect(() => {
        const cleanups: Array<() => void> = [];
        cleanups.push(window.electronAPI.onScreenshotTaken(handleScreenshotAttach));
        if (window.electronAPI.onScreenshotAttached) {
            cleanups.push(window.electronAPI.onScreenshotAttached(handleScreenshotAttach));
        }
        return () => cleanups.forEach((fn) => fn());
    }, [handleScreenshotAttach]);

    // Legacy suggestion processing start — expand and mark processing
    useEffect(() => {
        if (!window.electronAPI.onSuggestionProcessingStart) return;
        const unsubscribe = window.electronAPI.onSuggestionProcessingStart(() => {
            setIsProcessing(true);
            setIsExpanded(true);
        });
        return unsubscribe;
    }, [setIsProcessing]);

    // Stealth global shortcuts
    useEffect(() => {
        if (!window.electronAPI.onGlobalShortcut) return;
        const unsubscribe = window.electronAPI.onGlobalShortcut(({ action }) => {
            const handlers = handlersRef.current;
            const generalHandlers = generalHandlersRef.current;

            isStealthRef.current = true;

            if (action === 'whatToAnswer') handlers.handleWhatToSay();
            else if (action === 'shorten') handlers.handleFollowUp('shorten');
            else if (action === 'followUp') handlers.handleFollowUpQuestions();
            else if (action === 'recap') handlers.handleRecap();
            else if (action === 'dynamicAction4') {
                if (actionButtonMode === 'brainstorm') handlers.handleBrainstorm();
                else handlers.handleRecap();
            } else if (action === 'answer') handlers.handleAnswerNow();
            else if (action === 'clarify') handlers.handleClarify();
            else if (action === 'codeHint') handlers.handleCodeHint();
            else if (action === 'brainstorm') handlers.handleBrainstorm();
            else if (action === 'scrollUp')
                scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' });
            else if (action === 'scrollDown')
                scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
            else if (action === 'processScreenshots') generalHandlers.processScreenshots();
            else if (action === 'resetCancel') generalHandlers.resetCancel();

            setTimeout(() => {
                isStealthRef.current = false;
            }, 500);
        });
        return unsubscribe;
    }, [actionButtonMode]);

    // setMessages shim for ChatPanel (NegotiationCoachingCard timer callback)
    const setMessages = useCallback(
        (updater: React.SetStateAction<Message[]>) => {
            setSystemMessages((prev) => {
                const next = typeof updater === 'function' ? (updater as (p: Message[]) => Message[])(prev) : updater;
                return next;
            });
        },
        [setSystemMessages]
    );

    return (
        <div
            ref={contentRef}
            className="flex flex-col items-center w-fit mx-auto h-fit min-h-0 bg-transparent p-0 rounded-[24px] font-sans gap-2 overlay-text-primary"
        >
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="flex flex-col items-center gap-2 w-full"
                    >
                        <TopPill
                            expanded={isExpanded}
                            onToggle={() => setIsExpanded(!isExpanded)}
                            onQuit={() => (onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp())}
                            appearance={appearance}
                            onLogoClick={() => window.electronAPI?.setWindowMode?.('launcher')}
                        />
                        <div
                            className={`relative w-[1000px] max-w-[90vw] border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
                            style={appearance.shellStyle}
                        >
                            <div className="flex-1 min-h-0 flex">
                                <div className="min-w-0 min-h-0" style={{ width: `${splitterPosition}%` }}>
                                    <TranscriptPanel
                                        transcriptSegments={transcriptSegments}
                                        isInterviewerSpeaking={isInterviewerSpeaking}
                                        currentInterviewerPartial={currentInterviewerPartial}
                                        transcriptDisplayMode={transcriptDisplayMode}
                                        showTranscript={showTranscript}
                                        handleTranslateTranscriptSegment={handleTranslateTranscriptSegment}
                                        sttStatus={sttStatus}
                                        sttNeedsTroubleshooting={sttNeedsTroubleshooting}
                                        showSttErrorDetail={showSttErrorDetail}
                                        nativeAudioHealth={nativeAudioHealth}
                                        appearance={appearance}
                                        isLightTheme={isLightTheme}
                                    />
                                </div>
                                <ResizableSplitter
                                    position={splitterPosition}
                                    onPositionChange={setSplitterPosition}
                                />
                                <div className="min-w-0 min-h-0 flex-1">
                                    <ChatPanel
                                        messages={messages}
                                        knowledgeContext={knowledgeContext}
                                        attachedContext={attachedContext}
                                        setAttachedContext={setAttachedContext}
                                        actionButtonMode={actionButtonMode}
                                        inputValue={inputValue}
                                        setInputValue={setInputValue}
                                        isProcessing={isProcessing}
                                        handleWhatToSay={handleWhatToSay}
                                        handleClarify={handleClarify}
                                        handleFollowUpQuestions={handleFollowUpQuestions}
                                        handleRecap={handleRecap}
                                        handleBrainstorm={handleBrainstorm}
                                        handleAnswerNow={handleAnswerNow}
                                        handleManualSubmit={handleManualSubmit}
                                        isManualRecording={isManualRecording}
                                        manualTranscript={manualTranscript}
                                        voiceInput={voiceInput}
                                        appearance={appearance}
                                        isLightTheme={isLightTheme}
                                        currentModel={currentModel}
                                        isSettingsOpen={isSettingsOpen}
                                        isMousePassthrough={isMousePassthrough}
                                        setIsMousePassthrough={setIsMousePassthrough}
                                        shortcuts={shortcuts as ShortcutConfig}
                                        scrollContainerRef={scrollContainerRef}
                                        messagesEndRef={messagesEndRef}
                                        textInputRef={textInputRef}
                                        contentRef={contentRef}
                                        setMessages={setMessages}
                                    />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default PikaInterface;
