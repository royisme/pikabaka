import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import TopPill from './ui/TopPill';
import ChatColumn from './meeting/ChatColumn';
import SplitterShell from './meeting/SplitterShell';
import TranscriptColumn from './meeting/TranscriptColumn';
import { analytics } from '../lib/analytics/analytics.service';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getDefaultOverlayOpacity, getOverlayAppearance } from '../lib/overlayAppearance';
import { useMeetingChat, type Message } from '../hooks/useMeetingChat';
import { useMeetingTranscript } from '../hooks/useMeetingTranscript';
import { useMeetingAudio } from '../hooks/useMeetingAudio';

interface PikaInterfaceProps { onEndMeeting?: () => void; overlayOpacity?: number; }

const SPLITTER_STORAGE_KEY = 'pika_splitter_position';
const SPLITTER_STORAGE_VERSION_KEY = 'pika_splitter_position_version';
const SPLITTER_STORAGE_VERSION = 'chat-polish-v2';
const DEFAULT_TRANSCRIPT_SPLIT = 28;
const MIN_TRANSCRIPT_SPLIT = 20;
const MAX_TRANSCRIPT_SPLIT = 55;

const clampSplitterPosition = (value: unknown) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_TRANSCRIPT_SPLIT;
    return Math.min(MAX_TRANSCRIPT_SPLIT, Math.max(MIN_TRANSCRIPT_SPLIT, parsed));
};

const readStoredSplitterPosition = () => {
    try {
        const storedVersion = localStorage.getItem(SPLITTER_STORAGE_VERSION_KEY);
        const stored = storedVersion === SPLITTER_STORAGE_VERSION ? localStorage.getItem(SPLITTER_STORAGE_KEY) : null;
        const next = stored === null ? DEFAULT_TRANSCRIPT_SPLIT : clampSplitterPosition(stored);
        localStorage.setItem(SPLITTER_STORAGE_KEY, String(next));
        localStorage.setItem(SPLITTER_STORAGE_VERSION_KEY, SPLITTER_STORAGE_VERSION);
        return next;
    } catch {
        return DEFAULT_TRANSCRIPT_SPLIT;
    }
};
type ScreenshotAttachment = { path: string; preview: string };

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return String(error);
}
type CommandHandlers = { handleWhatToSay: () => void; handleFollowUp: (intent?: string) => void; handleFollowUpQuestions: () => void; handleRecap: () => void; handleAnswerNow: () => void; handleClarify: () => void; handleCodeHint: () => void; handleBrainstorm: () => void; };
type GeneralHandlers = { toggleVisibility: () => void; processScreenshots: () => void; resetCancel: () => Promise<void>; toggleMousePassthrough: () => void; takeScreenshot: () => Promise<void>; selectiveScreenshot: () => Promise<void>; };

const PikaInterface: React.FC<PikaInterfaceProps> = ({ onEndMeeting, overlayOpacity = getDefaultOverlayOpacity() }) => {
    const isLightTheme = useResolvedTheme() === 'light';
    const [isExpanded, setIsExpanded] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [splitterPosition, setSplitterPosition] = useState(readStoredSplitterPosition);
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [currentModel, setCurrentModel] = useState('gemini-3.1-flash-lite-preview');
    const isStealthRef = useRef(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const textInputRef = useRef<HTMLInputElement>(null);
    const { shortcuts, isShortcutPressed } = useShortcuts();
    const transcript = useMeetingTranscript();
    const audio = useMeetingAudio();
    const chat = useMeetingChat();
    const appearance = useMemo(() => getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'), [overlayOpacity, isLightTheme]);

    useEffect(() => { try { localStorage.setItem(SPLITTER_STORAGE_KEY, String(clampSplitterPosition(splitterPosition))); localStorage.setItem(SPLITTER_STORAGE_VERSION_KEY, SPLITTER_STORAGE_VERSION); } catch {} }, [splitterPosition]);
    useEffect(() => { window.electronAPI?.getDefaultModel?.().then((result: any) => { if (result?.model) { setCurrentModel(result.model); window.electronAPI.setModel(result.model).catch(() => {}); } }).catch((err: any) => console.error('Failed to fetch default model:', err)); }, []);
    useEffect(() => { const unsubscribe = window.electronAPI?.onModelChanged?.((modelId: string) => setCurrentModel((prev) => (prev === modelId ? prev : modelId))); return () => unsubscribe?.(); }, []);
    useEffect(() => { window.electronAPI?.getUndetectable?.().then(setIsUndetectable); const unsubscribe = window.electronAPI?.onUndetectableChanged?.(setIsUndetectable); return () => unsubscribe?.(); }, []);
    useEffect(() => localStorage.setItem('pika_undetectable', String(isUndetectable)), [isUndetectable]);
    useEffect(() => { window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => {}); const unsubscribe = window.electronAPI?.onOverlayMousePassthroughChanged?.(setIsMousePassthrough); return () => unsubscribe?.(); }, []);
    useEffect(() => window.electronAPI?.onSettingsVisibilityChange?.(setIsSettingsOpen), []);
    useEffect(() => { if (isExpanded) { window.electronAPI.showWindow(isStealthRef.current); isStealthRef.current = false; } else setTimeout(() => window.electronAPI.hideWindow(), 400); }, [isExpanded]);
    useEffect(() => window.electronAPI?.onToggleExpand?.(() => setIsExpanded((prev) => !prev)), []);
    useEffect(() => window.electronAPI?.onEnsureExpanded?.(() => { isStealthRef.current = true; setIsExpanded(true); }), []);
    useEffect(() => window.electronAPI?.onSessionReset?.(() => { console.log('[PikaInterface] Resetting session state...'); chat.setSystemMessages([]); chat.setInputValue(''); chat.setAttachedContext([]); audio.setManualTranscript(''); audio.setVoiceInput(''); chat.setIsProcessing(false); analytics.trackConversationStarted(); }), [chat.setSystemMessages, chat.setInputValue, chat.setAttachedContext, audio.setManualTranscript, audio.setVoiceInput, chat.setIsProcessing]);

    const pushScreenshotError = useCallback((error: unknown) => {
        const message = getErrorMessage(error);
        setIsExpanded(true);
        chat.setSystemMessages((prev) => [
            ...prev,
            {
                id: Date.now().toString(),
                role: 'system',
                text: `Screenshot failed: ${message}`,
            },
        ]);
    }, [chat.setSystemMessages]);
    const handleScreenshotAttach = useCallback((data: ScreenshotAttachment) => {
        if (!data?.path || !data?.preview) return;
        setIsExpanded(true);
        chat.setAttachedContext((prev) => (prev.some((s) => s.path === data.path) ? prev : [...prev, data].slice(-5)));
    }, [chat.setAttachedContext]);
    const handleSplitterChange = useCallback((next: number) => {
        const safeNext = clampSplitterPosition(next);
        setSplitterPosition(safeNext);
        try {
            localStorage.setItem(SPLITTER_STORAGE_KEY, String(safeNext));
            localStorage.setItem(SPLITTER_STORAGE_VERSION_KEY, SPLITTER_STORAGE_VERSION);
        } catch {
            // Ignore storage failures; the in-memory split is still updated.
        }
    }, []);
    const updateContentDimensions = useCallback(() => {
        if (isExpanded) return;
        const rect = contentRef.current?.getBoundingClientRect();
        if (rect) window.electronAPI?.updateContentDimensions({ width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
    }, [isExpanded]);
    useLayoutEffect(() => { if (!contentRef.current) return; const observer = new ResizeObserver(updateContentDimensions); observer.observe(contentRef.current); return () => observer.disconnect(); }, [updateContentDimensions]);
    useEffect(() => { requestAnimationFrame(updateContentDimensions); }, [chat.attachedContext, updateContentDimensions]);
    useEffect(() => { const timer = setTimeout(updateContentDimensions, 600); return () => clearTimeout(timer); }, [updateContentDimensions]);
    useEffect(() => { if (isExpanded) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.messages, isExpanded, chat.isProcessing]);

    const handleAnswerNow = useCallback(() => chat.handleWhatToSay(), [chat.handleWhatToSay]);

    const handlersRef = useRef<CommandHandlers>(null!);
    handlersRef.current = { handleWhatToSay: chat.handleWhatToSay, handleFollowUp: chat.handleFollowUp, handleFollowUpQuestions: chat.handleFollowUpQuestions, handleRecap: chat.handleRecap, handleAnswerNow, handleClarify: chat.handleClarify, handleCodeHint: chat.handleCodeHint, handleBrainstorm: chat.handleBrainstorm };
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const h = handlersRef.current;
            if (isShortcutPressed(e, 'whatToAnswer')) { e.preventDefault(); h.handleWhatToSay(); } else if (isShortcutPressed(e, 'clarify')) { e.preventDefault(); h.handleClarify(); } else if (isShortcutPressed(e, 'followUp')) { e.preventDefault(); h.handleFollowUpQuestions(); }
            else if (isShortcutPressed(e, 'dynamicAction4')) { e.preventDefault(); chat.actionButtonMode === 'brainstorm' ? h.handleBrainstorm() : h.handleRecap(); } else if (isShortcutPressed(e, 'answer')) { e.preventDefault(); h.handleAnswerNow(); } else if (isShortcutPressed(e, 'codeHint')) { e.preventDefault(); h.handleCodeHint(); }
            else if (isShortcutPressed(e, 'brainstorm')) { e.preventDefault(); h.handleBrainstorm(); } else if (isShortcutPressed(e, 'scrollUp')) { e.preventDefault(); scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' }); } else if (isShortcutPressed(e, 'scrollDown')) { e.preventDefault(); scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' }); }
            else if (isShortcutPressed(e, 'moveWindowUp') || isShortcutPressed(e, 'moveWindowDown')) e.preventDefault();
        };
        window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isShortcutPressed, chat.actionButtonMode]);

    const generalHandlersRef = useRef<GeneralHandlers>(null!);
    generalHandlersRef.current = {
        toggleVisibility: () => window.electronAPI.toggleWindow(), processScreenshots: chat.handleWhatToSay,
        resetCancel: async () => { if (chat.isProcessing) chat.setIsProcessing(false); else { await window.electronAPI.resetIntelligence(); chat.setSystemMessages([]); chat.setAttachedContext([]); chat.setInputValue(''); } },
        toggleMousePassthrough: () => { const next = !isMousePassthrough; setIsMousePassthrough(next); window.electronAPI?.setOverlayMousePassthrough?.(next); },
        takeScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeScreenshot();
                if (data?.path) handleScreenshotAttach(data as ScreenshotAttachment);
            } catch (err) {
                console.error('Error triggering screenshot:', err);
                pushScreenshotError(err);
            }
        },
        selectiveScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeSelectiveScreenshot();
                if (data && !data.cancelled && data.path) handleScreenshotAttach(data as ScreenshotAttachment);
            } catch (err) {
                console.error('Error triggering selective screenshot:', err);
                pushScreenshotError(err);
            }
        },
    };
    useEffect(() => {
        const handleGeneralKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement; const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable; const h = generalHandlersRef.current;
            if (isShortcutPressed(e, 'toggleVisibility')) { e.preventDefault(); h.toggleVisibility(); } else if (isShortcutPressed(e, 'processScreenshots') && !isInput) { e.preventDefault(); h.processScreenshots(); } else if (isShortcutPressed(e, 'resetCancel')) { e.preventDefault(); h.resetCancel(); }
            else if (isShortcutPressed(e, 'takeScreenshot')) { e.preventDefault(); h.takeScreenshot(); } else if (isShortcutPressed(e, 'selectiveScreenshot')) { e.preventDefault(); h.selectiveScreenshot(); } else if (isShortcutPressed(e, 'toggleMousePassthrough')) { e.preventDefault(); h.toggleMousePassthrough(); }
        };
        window.addEventListener('keydown', handleGeneralKeyDown); return () => window.removeEventListener('keydown', handleGeneralKeyDown);
    }, [isShortcutPressed]);

    useEffect(() => window.electronAPI.onCaptureAndProcess?.((data) => { handleScreenshotAttach(data as ScreenshotAttachment); setTimeout(() => handlersRef.current.handleWhatToSay(), 0); }), [handleScreenshotAttach]);
    useEffect(() => {
        const cleanups: Array<() => void> = [];
        const subscribe = (fn?: (callback: (data: ScreenshotAttachment) => void) => () => void) => {
            const cleanup = fn?.(handleScreenshotAttach);
            if (cleanup) cleanups.push(cleanup);
        };
        subscribe(window.electronAPI.onScreenshotTaken);
        subscribe(window.electronAPI.onScreenshotAttached);
        const errorCleanup = window.electronAPI.onScreenshotError?.((error) => pushScreenshotError(error));
        if (errorCleanup) cleanups.push(errorCleanup);
        return () => cleanups.forEach((fn) => fn());
    }, [handleScreenshotAttach, pushScreenshotError]);
    useEffect(() => {
        window.electronAPI?.companionUpdateSnapshot?.({
            transcriptSegments: transcript.transcriptSegments,
            currentInterviewerPartial: transcript.currentInterviewerPartial,
            messages: chat.messages,
            currentModel,
            audioHealth: audio.nativeAudioHealth,
            meetingActive: audio.nativeAudioHealth?.meetingActive,
        }).catch(() => {});
    }, [transcript.transcriptSegments, transcript.currentInterviewerPartial, chat.messages, currentModel, audio.nativeAudioHealth]);
    useEffect(() => window.electronAPI?.onCompanionCommand?.((command) => {
        const text = String(command.payload?.text || '').trim();
        if (command.type === 'ask') {
            if (text || command.payload?.path) void chat.submitPrompt({ userText: text || `Review phone upload: ${command.payload?.name || command.payload?.path || 'file'}`, placeholderIntent: 'manual' });
        } else if (command.type === 'what_to_answer') {
            if (text) void chat.submitPrompt({ userText: text, placeholderIntent: 'manual' }); else void chat.handleWhatToSay();
        } else if (command.type === 'clarify') {
            void chat.handleClarify();
        } else if (command.type === 'recap') {
            void chat.handleRecap();
        } else if (command.type === 'brainstorm') {
            void chat.handleBrainstorm();
        } else if (command.type === 'follow_up') {
            if (text) void chat.handleFollowUp(text); else void chat.handleFollowUpQuestions();
        } else if (command.type === 'code_hint') {
            void chat.handleCodeHint();
        } else if (command.type === 'reset_cancel') {
            void generalHandlersRef.current?.resetCancel?.();
        } else if (command.type === 'toggle_visibility') {
            generalHandlersRef.current?.toggleVisibility?.();
        } else if (command.type === 'mouse_passthrough') {
            generalHandlersRef.current?.toggleMousePassthrough?.();
        } else if (command.type === 'screenshot') {
            void generalHandlersRef.current?.takeScreenshot?.();
        } else if (command.type === 'selective_screenshot') {
            void generalHandlersRef.current?.selectiveScreenshot?.();
        } else if (command.type === 'attach-file') {
            const path = command.payload?.path; const preview = command.payload?.preview;
            if (path && preview) handleScreenshotAttach({ path, preview });
            else if (path) void chat.submitPrompt({ userText: `Phone uploaded ${command.payload?.name || 'a file'} at ${path}`, placeholderIntent: 'manual' });
        }
    }), [chat.submitPrompt, chat.handleWhatToSay, chat.handleClarify, chat.handleRecap, chat.handleBrainstorm, chat.handleFollowUp, chat.handleFollowUpQuestions, chat.handleCodeHint, handleScreenshotAttach]);
    useEffect(() => window.electronAPI.onSuggestionProcessingStart?.(() => { chat.setIsProcessing(true); setIsExpanded(true); }), [chat.setIsProcessing]);
    useEffect(() => window.electronAPI.onGlobalShortcut?.(({ action }) => {
        const h = handlersRef.current; const g = generalHandlersRef.current; isStealthRef.current = true;
        if (action === 'whatToAnswer') h.handleWhatToSay(); else if (action === 'shorten') h.handleFollowUp('shorten'); else if (action === 'followUp') h.handleFollowUpQuestions(); else if (action === 'recap') h.handleRecap(); else if (action === 'dynamicAction4') chat.actionButtonMode === 'brainstorm' ? h.handleBrainstorm() : h.handleRecap();
        else if (action === 'answer') h.handleAnswerNow(); else if (action === 'clarify') h.handleClarify(); else if (action === 'codeHint') h.handleCodeHint(); else if (action === 'brainstorm') h.handleBrainstorm(); else if (action === 'scrollUp') scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' }); else if (action === 'scrollDown') scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
        else if (action === 'processScreenshots') g.processScreenshots(); else if (action === 'resetCancel') g.resetCancel();
        setTimeout(() => { isStealthRef.current = false; }, 500);
    }), [chat.actionButtonMode]);

    const handlePasteImage = useCallback(async () => {
        try {
            const data = await window.electronAPI.saveClipboardImage();
            handleScreenshotAttach(data as ScreenshotAttachment);
        } catch (err) {
            console.error('Error attaching clipboard image:', err);
            pushScreenshotError(err);
        }
    }, [handleScreenshotAttach, pushScreenshotError]);
    const setMessages = useCallback((updater: React.SetStateAction<Message[]>) => { chat.setSystemMessages((prev) => (typeof updater === 'function' ? (updater as (p: Message[]) => Message[])(prev) : updater)); }, [chat.setSystemMessages]);
    const transcriptProps = { ...transcript, ...audio, appearance, isLightTheme };
    const chatProps = { messages: chat.messages, knowledgeContext: chat.knowledgeContext, attachedContext: chat.attachedContext, setAttachedContext: chat.setAttachedContext, actionButtonMode: chat.actionButtonMode, inputValue: chat.inputValue, setInputValue: chat.setInputValue, isProcessing: chat.isProcessing, handleWhatToSay: chat.handleWhatToSay, handleClarify: chat.handleClarify, handleFollowUpQuestions: chat.handleFollowUpQuestions, handleRecap: chat.handleRecap, handleBrainstorm: chat.handleBrainstorm, handleAnswerNow, handleManualSubmit: chat.handleManualSubmit, handlePasteImage, isManualRecording: audio.isManualRecording, manualTranscript: audio.manualTranscript, voiceInput: audio.voiceInput, appearance, isLightTheme, currentModel, isSettingsOpen, isMousePassthrough, setIsMousePassthrough, shortcuts, scrollContainerRef, messagesEndRef, textInputRef, contentRef, setMessages };

    return (
        <div ref={contentRef} className={`flex flex-col items-center w-full mx-auto ${isExpanded ? 'h-screen min-h-[560px]' : 'h-fit'} min-h-0 bg-transparent p-0 rounded-[24px] font-sans gap-2 overlay-text-primary`}>
            <AnimatePresence>
                {isExpanded && (
                    <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} transition={{ duration: 0.3, ease: 'easeInOut' }} className="flex flex-col items-center gap-2 w-full flex-1 min-h-0 min-w-[420px]">
                        <TopPill expanded={isExpanded} onToggle={() => setIsExpanded((prev) => !prev)} onQuit={() => (onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp())} appearance={appearance} onLogoClick={() => window.electronAPI?.setWindowMode?.('launcher')} />
                        <SplitterShell left={<TranscriptColumn {...transcriptProps} />} right={<ChatColumn {...chatProps} />} splitterPosition={splitterPosition} onSplitterChange={handleSplitterChange} isExpanded={isExpanded} appearance={appearance} overlayPanelClass="overlay-text-primary" />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default PikaInterface;
