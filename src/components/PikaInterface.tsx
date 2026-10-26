import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ChatColumn from './meeting/ChatColumn';
import SplitterShell from './meeting/SplitterShell';
import TranscriptColumn from './meeting/TranscriptColumn';
import OverlayTopBar from './meeting/OverlayTopBar';
import { analytics } from '../lib/analytics/analytics.service';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getDefaultOverlayOpacity, getOverlayAppearance } from '../lib/overlayAppearance';
import { useMeetingChat, type Message } from '../hooks/useMeetingChat';
import { useMeetingTranscript } from '../hooks/useMeetingTranscript';
import { useMeetingAudio } from '../hooks/useMeetingAudio';
import { isNearBottom, nextScrollAction } from '../lib/answerScroll';
import { toggleOriginal } from '../lib/transcriptDisplay';
import { audioStatus } from '../lib/audioStatus';
import { modelLabel } from '../lib/modelLabel';
import { latestOtherPartyText } from '../lib/answerLead';

interface PikaInterfaceProps { onEndMeeting?: () => void; overlayOpacity?: number; }
type ScreenshotAttachment = { path: string; preview: string };
type CommandHandlers = { handleWhatToSay: () => void; handleFollowUp: (intent?: string) => void; handleFollowUpQuestions: () => void; handleRecap: () => void; handleAnswerNow: () => void; handleClarify: () => void; handleCodeHint: () => void; handleBrainstorm: () => void; };
type GeneralHandlers = { toggleVisibility: () => void; processScreenshots: () => void; resetCancel: () => Promise<void>; toggleMousePassthrough: () => void; takeScreenshot: () => Promise<void>; selectiveScreenshot: () => Promise<void>; };

const PikaInterface: React.FC<PikaInterfaceProps> = ({ onEndMeeting, overlayOpacity = getDefaultOverlayOpacity() }) => {
    const isLightTheme = useResolvedTheme() === 'light';
    const [isExpanded, setIsExpanded] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [splitterPosition, setSplitterPosition] = useState(() => { const parsed = Number(localStorage.getItem('pika_splitter_position') ?? 40); return Number.isFinite(parsed) ? Math.min(80, Math.max(20, parsed)) : 40; });
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [currentModel, setCurrentModel] = useState('gemini-3-flash-preview');
    const isStealthRef = useRef(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const textInputRef = useRef<HTMLInputElement>(null);
    const { shortcuts, isShortcutPressed } = useShortcuts();
    const transcript = useMeetingTranscript();
    const audio = useMeetingAudio();
    const replyContextRef = useRef<() => string | undefined>(() => undefined);
    const chat = useMeetingChat({ getReplyContext: () => replyContextRef.current() });
    const appearance = useMemo(() => getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'), [overlayOpacity, isLightTheme]);

    // The split is the user's once they move it. Until then it follows what the zone is for: more room for the
    // transcript while translating, since the translation is what is read first.
    const splitterIsUserSet = useRef(localStorage.getItem('pika_splitter_position') !== null);
    const defaultSplitter = transcript.translationEnabled ? 55 : 40;
    useEffect(() => { if (!splitterIsUserSet.current) setSplitterPosition(defaultSplitter); }, [defaultSplitter]);
    const changeSplitter = useCallback((next: number) => { splitterIsUserSet.current = true; localStorage.setItem('pika_splitter_position', String(next)); setSplitterPosition(next); }, []);
    const resetSplitter = useCallback(() => { splitterIsUserSet.current = false; localStorage.removeItem('pika_splitter_position'); setSplitterPosition(defaultSplitter); }, [defaultSplitter]);
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

    const handleScreenshotAttach = useCallback((data: ScreenshotAttachment) => { setIsExpanded(true); chat.setAttachedContext((prev) => (prev.some((s) => s.path === data.path) ? prev : [...prev, data].slice(-5))); }, [chat.setAttachedContext]);
    const shownMessageIdRef = useRef<string | undefined>(undefined);
    const followingRef = useRef(true);
    useEffect(() => {
        const list = scrollContainerRef.current;
        if (!isExpanded || !list) return;
        const onScroll = () => { followingRef.current = isNearBottom(list); };
        list.addEventListener('scroll', onScroll, { passive: true });
        return () => list.removeEventListener('scroll', onScroll);
    }, [isExpanded]);
    useEffect(() => {
        const list = scrollContainerRef.current;
        if (!isExpanded || !list) { shownMessageIdRef.current = undefined; return; }
        const last = chat.messages[chat.messages.length - 1];
        const action = nextScrollAction(last?.id, shownMessageIdRef.current, followingRef.current);
        shownMessageIdRef.current = last?.id;
        if (action === 'follow') list.scrollTop = list.scrollHeight;
        else if (action === 'show-start') {
            const item = Array.from(list.children).find((child) => (child as HTMLElement).dataset.messageId === last.id);
            if (item) list.scrollTop += item.getBoundingClientRect().top - list.getBoundingClientRect().top;
        }
    }, [chat.messages, isExpanded, chat.isProcessing]);

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

    const translateInto = transcript.translationEnabled
        ? transcript.languageOptions.find((option) => option.value === transcript.targetLanguage)?.label
        : undefined;
    const audioState = useMemo(
        () => audioStatus({ ...audio.audioStatusInput, translateInto }),
        [audio.audioStatusInput, translateInto]
    );
    // Windows the menu opens (model list, quick settings) are placed just under the overlay, left-aligned with the menu's trigger.
    const belowOverlay = useCallback((triggerRect: DOMRect) => {
        const overlayRect = contentRef.current?.getBoundingClientRect();
        if (!overlayRect) return undefined;
        return { x: window.screenX + triggerRect.left, y: window.screenY + overlayRect.bottom + 8 };
    }, []);
    const openModelSelector = useCallback((triggerRect: DOMRect) => {
        const at = belowOverlay(triggerRect);
        if (at) window.electronAPI.toggleModelSelector(at);
    }, [belowOverlay]);
    const openSettings = useCallback((triggerRect: DOMRect) => {
        if (isSettingsOpen) { void window.electronAPI.toggleSettingsWindow(); return; }
        const at = belowOverlay(triggerRect);
        void window.electronAPI.toggleSettingsWindow(at);
    }, [belowOverlay, isSettingsOpen]);

    const fixAudio = useCallback(() => { void window.electronAPI.openSettingsSection('audio'); }, []);
    const hasTranscriptRows = transcript.transcriptSegments.length > 0 || transcript.isInterviewerSpeaking;
    // Where the transcript area does not spell the status out (it is hidden), the bar's chip must.
    const statusInBar = hasTranscriptRows || !transcript.showTranscript;

    replyContextRef.current = () => latestOtherPartyText(transcript.transcriptSegments, transcript.currentInterviewerPartial);

    const transcriptRef = useRef(transcript);
    transcriptRef.current = transcript;

    const generalHandlersRef = useRef<GeneralHandlers>(null!);
    generalHandlersRef.current = {
        toggleVisibility: () => window.electronAPI.toggleWindow(), processScreenshots: chat.handleWhatToSay,
        resetCancel: async () => { if (chat.isProcessing) await chat.stopGeneration(); else { await window.electronAPI.resetIntelligence(); chat.setSystemMessages([]); chat.setAttachedContext([]); chat.setInputValue(''); } },
        toggleMousePassthrough: () => { const next = !isMousePassthrough; setIsMousePassthrough(next); window.electronAPI?.setOverlayMousePassthrough?.(next); },
        takeScreenshot: async () => { const data = await window.electronAPI.takeScreenshot().catch((err) => console.error('Error triggering screenshot:', err)); if (data?.path) handleScreenshotAttach(data as ScreenshotAttachment); },
        selectiveScreenshot: async () => { const data = await window.electronAPI.takeSelectiveScreenshot().catch((err) => console.error('Error triggering selective screenshot:', err)); if (data && !data.cancelled && data.path) handleScreenshotAttach(data as ScreenshotAttachment); },
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
    useEffect(() => { const cleanups = [window.electronAPI.onScreenshotTaken(handleScreenshotAttach)]; const attachedCleanup = window.electronAPI.onScreenshotAttached?.(handleScreenshotAttach); if (attachedCleanup) cleanups.push(attachedCleanup); return () => cleanups.forEach((fn) => fn()); }, [handleScreenshotAttach]);
    useEffect(() => window.electronAPI.onSuggestionProcessingStart?.(() => { chat.setIsProcessing(true); setIsExpanded(true); }), [chat.setIsProcessing]);
    useEffect(() => window.electronAPI.onGlobalShortcut?.(({ action }) => {
        const h = handlersRef.current; const g = generalHandlersRef.current; isStealthRef.current = true;
        if (action === 'whatToAnswer') h.handleWhatToSay(); else if (action === 'shorten') h.handleFollowUp('shorten'); else if (action === 'followUp') h.handleFollowUpQuestions(); else if (action === 'recap') h.handleRecap(); else if (action === 'dynamicAction4') chat.actionButtonMode === 'brainstorm' ? h.handleBrainstorm() : h.handleRecap();
        else if (action === 'answer') h.handleAnswerNow(); else if (action === 'clarify') h.handleClarify(); else if (action === 'codeHint') h.handleCodeHint(); else if (action === 'brainstorm') h.handleBrainstorm(); else if (action === 'scrollUp') scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' }); else if (action === 'scrollDown') scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
        else if (action === 'processScreenshots') g.processScreenshots(); else if (action === 'resetCancel') g.resetCancel();
        else if (action === 'toggleTranslation') { if (transcriptRef.current.translationConfigured) transcriptRef.current.saveTranslationSettings({ enabled: !transcriptRef.current.translationEnabled }); }
        else if (action === 'toggleOriginal') transcriptRef.current.saveTranslationSettings({ displayMode: toggleOriginal(transcriptRef.current.transcriptDisplayMode) });
        setTimeout(() => { isStealthRef.current = false; }, 500);
    }), [chat.actionButtonMode]);

    const setMessages = useCallback((updater: React.SetStateAction<Message[]>) => { chat.setSystemMessages((prev) => (typeof updater === 'function' ? (updater as (p: Message[]) => Message[])(prev) : updater)); }, [chat.setSystemMessages]);
    const transcriptProps = { ...transcript, ...audio, appearance, isLightTheme };
    const chatProps = { messages: chat.messages, knowledgeContext: chat.knowledgeContext, attachedContext: chat.attachedContext, setAttachedContext: chat.setAttachedContext, actionButtonMode: chat.actionButtonMode, inputValue: chat.inputValue, setInputValue: chat.setInputValue, isProcessing: chat.isProcessing, handleWhatToSay: chat.handleWhatToSay, primaryQuiet: audioState.action === 'fix-audio' || (audioState.key !== 'live' && !hasTranscriptRows), onStop: chat.stopGeneration, onRetry: chat.canRetry ? chat.retryLast : undefined, audioKey: audioState.key, hasTranscriptRows, handleClarify: chat.handleClarify, handleFollowUpQuestions: chat.handleFollowUpQuestions, handleRecap: chat.handleRecap, handleBrainstorm: chat.handleBrainstorm, handleManualSubmit: chat.handleManualSubmit, appearance, isLightTheme, shortcuts, scrollContainerRef, textInputRef, setMessages };

    return (
        <div ref={contentRef} className={`flex flex-col items-center w-full mx-auto ${isExpanded ? 'h-screen' : 'h-fit'} min-h-0 bg-transparent p-0 rounded-[24px] font-sans overlay-text-primary`}>
            <AnimatePresence>
                {isExpanded && (
                    <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} transition={{ duration: 0.3, ease: 'easeInOut' }} className="flex flex-col w-full flex-1 min-h-0">
                        <SplitterShell
                            topBar={<OverlayTopBar status={audioState} hasRows={statusInBar} onFixAudio={fixAudio} displayMode={transcript.transcriptDisplayMode} translationEnabled={transcript.translationEnabled} translationConfigured={transcript.translationConfigured} targetLanguage={transcript.targetLanguage} languageOptions={transcript.languageOptions} onToggleTranslation={() => transcript.saveTranslationSettings({ enabled: !transcript.translationEnabled })} onChangeTargetLanguage={(targetLanguage) => transcript.saveTranslationSettings({ targetLanguage })} onToggleOriginal={() => transcript.saveTranslationSettings({ displayMode: toggleOriginal(transcript.transcriptDisplayMode) })} onSetUpTranslation={() => { void window.electronAPI.toggleSettingsWindow(); }} modelName={modelLabel(currentModel)} isMousePassthrough={isMousePassthrough} toggleOriginalKeys={shortcuts.toggleOriginal} toggleTranslationKeys={shortcuts.toggleTranslation} onHide={() => setIsExpanded((prev) => !prev)} onQuit={() => (onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp())} onOpenModelSelector={openModelSelector} onOpenSettings={openSettings} onToggleMousePassthrough={() => generalHandlersRef.current.toggleMousePassthrough()} onOpenLauncher={() => window.electronAPI?.setWindowMode?.('launcher')} />}
                            left={<TranscriptColumn {...transcriptProps} status={audioState} onFixAudio={fixAudio} />}
                            right={<ChatColumn {...chatProps} />}
                            splitterPosition={splitterPosition}
                            onSplitterChange={changeSplitter}
                            onSplitterReset={resetSplitter}
                            isExpanded={isExpanded}
                            appearance={appearance}
                            overlayPanelClass="overlay-text-primary"
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default PikaInterface;
