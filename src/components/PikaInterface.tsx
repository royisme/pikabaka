import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { AnimatePresence, motion } from 'framer-motion';
import ChatColumn from './meeting/ChatColumn';
import SplitterShell from './meeting/SplitterShell';
import TranscriptColumn from './meeting/TranscriptColumn';
import OverlayTopBar from './meeting/OverlayTopBar';
import ProactiveCard from './agent/ProactiveCard';
import ApprovalDock from './agent/ApprovalDock';
import type { AgentProactiveCard } from '../types/electron';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getDefaultOverlayOpacity, getOverlayAppearance } from '../lib/overlayAppearance';
import { useMeetingChat, type Message } from '../hooks/useMeetingChat';
import { useMeetingTranscript } from '../hooks/useMeetingTranscript';
import { useMeetingAudio } from '../hooks/useMeetingAudio';
import { isNearBottom, nextScrollAction } from '../lib/answerScroll';
import { toggleOriginal } from '../lib/transcriptDisplay';
import { audioStatus } from '../lib/audioStatus';
import { latestOtherPartyText } from '../lib/answerLead';
import { useMainEvent } from '../hooks/useMainEvent';
import { useWindowEvent } from '../hooks/useWindowEvent';
import { useLocalStorageValue } from '../hooks/useLocalStorageValue';

interface PikaInterfaceProps { onEndMeeting?: () => void; overlayOpacity?: number; }
type ScreenshotAttachment = { path: string; preview: string };
type GeneralHandlers = { toggleVisibility: () => void; resetCancel: () => Promise<void>; toggleMousePassthrough: () => void; takeScreenshot: () => Promise<void>; selectiveScreenshot: () => Promise<void>; toggleTranslation: () => void; toggleOriginal: () => void; };

const PikaInterface: React.FC<PikaInterfaceProps> = ({ onEndMeeting, overlayOpacity = getDefaultOverlayOpacity() }) => {
    const queryClient = useQueryClient();
    const isLightTheme = useResolvedTheme() === 'light';
    const [isExpanded, setIsExpanded] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const { data: chatModel } = useQuery(['chat-model'], () => window.electronAPI.chatModelGet());
    const { data: connections = [] } = useQuery(['ai-connections'], () => window.electronAPI.aiConnectionsList());
    const connection = connections.find((c) => c.id === chatModel?.connectionId);
    const modelName = connection && chatModel?.model ? `${connection.name}: ${chatModel.model}` : 'Choose a model';
    const isStealthRef = useRef(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const textInputRef = useRef<HTMLInputElement>(null);
    const { shortcuts, isShortcutPressed } = useShortcuts();
    const transcript = useMeetingTranscript();
    const audio = useMeetingAudio();
    const replyContextRef = useRef<() => string | undefined>(() => undefined);
    const chat = useMeetingChat({ getReplyContext: () => replyContextRef.current() });
    const [proactiveCard, setProactiveCard] = useState<AgentProactiveCard | null>(null);
    useMainEvent(window.electronAPI?.onAgentProactive, setProactiveCard);
    const askAboutCard = useCallback((card: AgentProactiveCard) => {
        // Pika's suggestion is quoted as Pika's, not as the user's own words.
        chat.setInputValue(`About Pika's suggestion "${card.text}": tell me more.`);
        setProactiveCard(null);
        textInputRef.current?.focus();
    }, [chat.setInputValue]);
    const appearance = useMemo(() => getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'), [overlayOpacity, isLightTheme]);

    // The split is the user's once they move it. Until then it follows what the zone is for: more room for the
    // transcript while translating, since the translation is what is read first.
    const [storedSplitter, setStoredSplitter] = useLocalStorageValue('pika_splitter_position');
    const defaultSplitter = transcript.translationEnabled ? 55 : 40;
    const splitterPosition = useMemo(() => {
        if (storedSplitter === null) return defaultSplitter;
        const parsed = Number(storedSplitter);
        return Number.isFinite(parsed) ? Math.min(80, Math.max(20, parsed)) : defaultSplitter;
    }, [storedSplitter, defaultSplitter]);
    const changeSplitter = useCallback((next: number) => {
        setStoredSplitter(String(next));
    }, [setStoredSplitter]);
    const resetSplitter = useCallback(() => {
        setStoredSplitter(null);
    }, [setStoredSplitter]);

    useMainEvent(window.electronAPI?.onModelChanged, () => {
        void queryClient.invalidateQueries(['chat-model']);
        void queryClient.invalidateQueries(['ai-connections']);
    });

    // Undetectable state: read via query, stream via useMainEvent
    useQuery<boolean>(
        ['undetectable'],
        async () => {
            const val = (await window.electronAPI?.getUndetectable?.()) ?? false;
            localStorage.setItem('pika_undetectable', String(val));
            return val;
        }
    );
    useMainEvent(window.electronAPI?.onUndetectableChanged, (newState: boolean) => {
        queryClient.setQueryData(['undetectable'], newState);
        localStorage.setItem('pika_undetectable', String(newState));
    });

    // Microphone mute: read via query, stream via useMainEvent, change via mutation
    const { data: microphoneMuted = false } = useQuery<boolean>(['microphone-muted'], async () => (await window.electronAPI?.getMicrophoneMuted?.()) ?? false);
    useMainEvent(window.electronAPI?.onMicrophoneMutedChanged, (muted: boolean) => {
        queryClient.setQueryData(['microphone-muted'], muted);
    });
    const toggleMicrophoneMute = useMutation((muted: boolean) => window.electronAPI.setMicrophoneMuted(muted));

    // Mouse passthrough: read via query, stream via useMainEvent
    const { data: isMousePassthrough = false } = useQuery<boolean>(
        ['overlay-mouse-passthrough'],
        () => window.electronAPI?.getOverlayMousePassthrough?.() ?? Promise.resolve(false)
    );
    useMainEvent(window.electronAPI?.onOverlayMousePassthroughChanged, (val: boolean) => {
        queryClient.setQueryData(['overlay-mouse-passthrough'], val);
    });

    useMainEvent(window.electronAPI?.onSettingsVisibilityChange, setIsSettingsOpen);
    useEffect(() => {
        if (isExpanded) {
            window.electronAPI.showWindow(isStealthRef.current);
            isStealthRef.current = false;
        } else {
            const timer = setTimeout(() => window.electronAPI.hideWindow(), 400);
            return () => clearTimeout(timer);
        }
    }, [isExpanded]);
    useEffect(() => window.electronAPI?.onToggleExpand?.(() => setIsExpanded((prev) => !prev)), []);
    useEffect(() => window.electronAPI?.onEnsureExpanded?.(() => { isStealthRef.current = true; setIsExpanded(true); }), []);
    useEffect(() => window.electronAPI?.onSessionReset?.(() => {
        console.log('[PikaInterface] Resetting session state...');
        chat.setSystemMessages([]);
        chat.setInputValue('');
        chat.setAttachedContext([]);
        audio.setManualTranscript('');
        audio.setVoiceInput('');
        chat.setIsProcessing(false);
    }), [chat.setSystemMessages, chat.setInputValue, chat.setAttachedContext, audio.setManualTranscript, audio.setVoiceInput, chat.setIsProcessing]);

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

    useWindowEvent('keydown', (e: KeyboardEvent) => {
        if (isShortcutPressed(e, 'whatToAnswer')) { e.preventDefault(); chat.handleWhatToSay(); }
        else if (isShortcutPressed(e, 'moveWindowUp') || isShortcutPressed(e, 'moveWindowDown')) e.preventDefault();
    });

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

    const generalHandlersRef = useRef<GeneralHandlers>(null!);
    generalHandlersRef.current = {
        toggleVisibility: () => window.electronAPI.toggleWindow(),
        resetCancel: async () => { if (chat.isProcessing) await chat.stopGeneration(); },
        toggleMousePassthrough: () => {
            const next = !isMousePassthrough;
            queryClient.setQueryData(['overlay-mouse-passthrough'], next);
            window.electronAPI?.setOverlayMousePassthrough?.(next);
        },
        takeScreenshot: async () => { const data = await window.electronAPI.takeScreenshot().catch((err) => console.error('Error triggering screenshot:', err)); if (data?.path) handleScreenshotAttach(data as ScreenshotAttachment); },
        selectiveScreenshot: async () => { const data = await window.electronAPI.takeSelectiveScreenshot().catch((err) => console.error('Error triggering selective screenshot:', err)); if (data && !data.cancelled && data.path) handleScreenshotAttach(data as ScreenshotAttachment); },
        toggleTranslation: () => {
            if (transcript.translationConfigured) transcript.saveTranslationSettings({ enabled: !transcript.translationEnabled });
        },
        toggleOriginal: () => transcript.saveTranslationSettings({ displayMode: toggleOriginal(transcript.transcriptDisplayMode) }),
    };
    useWindowEvent('keydown', (e: KeyboardEvent) => {
        const h = generalHandlersRef.current;
        if (isShortcutPressed(e, 'toggleVisibility')) { e.preventDefault(); h.toggleVisibility(); }
        else if (isShortcutPressed(e, 'resetCancel')) { e.preventDefault(); void h.resetCancel(); }
        else if (isShortcutPressed(e, 'selectiveScreenshot')) { e.preventDefault(); void h.selectiveScreenshot(); }
        else if (isShortcutPressed(e, 'toggleMousePassthrough')) { e.preventDefault(); h.toggleMousePassthrough(); }
        else if (isShortcutPressed(e, 'toggleTranslation')) { e.preventDefault(); h.toggleTranslation(); }
        else if (isShortcutPressed(e, 'toggleOriginal')) { e.preventDefault(); h.toggleOriginal(); }
    });

    useMainEvent(window.electronAPI?.onScreenshotTaken, handleScreenshotAttach);
    useMainEvent(window.electronAPI?.onScreenshotAttached, handleScreenshotAttach);
    useEffect(() => window.electronAPI.onSuggestionProcessingStart?.(() => { chat.setIsProcessing(true); setIsExpanded(true); }), [chat.setIsProcessing]);
    useMainEvent(window.electronAPI?.onGlobalShortcut, ({ action }) => {
        const g = generalHandlersRef.current;
        isStealthRef.current = true;
        if (action === 'whatToAnswer') chat.handleWhatToSay();
        else if (action === 'resetCancel') void g.resetCancel();
        else if (action === 'toggleTranslation') g.toggleTranslation();
        else if (action === 'toggleOriginal') g.toggleOriginal();
        setTimeout(() => { isStealthRef.current = false; }, 500);
    });

    const setMessages = useCallback((updater: React.SetStateAction<Message[]>) => { chat.setSystemMessages((prev) => (typeof updater === 'function' ? (updater as (p: Message[]) => Message[])(prev) : updater)); }, [chat.setSystemMessages]);
    const transcriptProps = { ...transcript, ...audio, appearance, isLightTheme };
    const chatProps = { onCaptureScreen: () => void generalHandlersRef.current.takeScreenshot(), onCaptureArea: () => void generalHandlersRef.current.selectiveScreenshot(), messages: chat.messages, knowledgeContext: chat.knowledgeContext, attachedContext: chat.attachedContext, setAttachedContext: chat.setAttachedContext, actionButtonMode: chat.actionButtonMode, inputValue: chat.inputValue, setInputValue: chat.setInputValue, isProcessing: chat.isProcessing, handleWhatToSay: chat.handleWhatToSay, primaryQuiet: audioState.action === 'fix-audio' || (audioState.key !== 'live' && !hasTranscriptRows), onStop: chat.stopGeneration, onRetry: chat.canRetry ? chat.retryLast : undefined, audioKey: audioState.key, hasTranscriptRows, handleClarify: chat.handleClarify, handleFollowUpQuestions: chat.handleFollowUpQuestions, handleRecap: chat.handleRecap, handleBrainstorm: chat.handleBrainstorm, handleManualSubmit: chat.handleManualSubmit, appearance, isLightTheme, shortcuts, scrollContainerRef, textInputRef, setMessages };

    return (
        <div ref={contentRef} className={`flex flex-col items-center w-full mx-auto ${isExpanded ? 'h-screen' : 'h-fit'} min-h-0 bg-transparent p-0 rounded-[24px] font-sans overlay-text-primary`}>
            <AnimatePresence>
                {isExpanded && (
                    <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} transition={{ duration: 0.3, ease: 'easeInOut' }} className="flex flex-col w-full flex-1 min-h-0">
                        <SplitterShell
                            topBar={<OverlayTopBar status={audioState} hasRows={statusInBar} onFixAudio={fixAudio} microphoneMuted={microphoneMuted} onToggleMicrophoneMute={() => toggleMicrophoneMute.mutate(!microphoneMuted)} displayMode={transcript.transcriptDisplayMode} translationEnabled={transcript.translationEnabled} translationConfigured={transcript.translationConfigured} theirLanguage={transcript.theirLanguage} myLanguage={transcript.myLanguage} targetLanguage={transcript.targetLanguage} languageOptions={transcript.languageOptions} onToggleTranslation={() => transcript.saveTranslationSettings({ enabled: !transcript.translationEnabled })} onChangeSpokenLanguage={transcript.changeSpokenLanguage} onChangeTargetLanguage={(targetLanguage) => transcript.saveTranslationSettings({ targetLanguage })} onToggleOriginal={() => transcript.saveTranslationSettings({ displayMode: toggleOriginal(transcript.transcriptDisplayMode) })} onSetUpTranslation={() => { void window.electronAPI.toggleSettingsWindow(); }} modelName={modelName} isMousePassthrough={isMousePassthrough} toggleOriginalKeys={shortcuts.toggleOriginal} toggleTranslationKeys={shortcuts.toggleTranslation} onHide={() => setIsExpanded((prev) => !prev)} onQuit={() => (onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp())} onOpenModelSelector={openModelSelector} onOpenSettings={openSettings} onToggleMousePassthrough={() => generalHandlersRef.current.toggleMousePassthrough()} onOpenLauncher={() => window.electronAPI?.setWindowMode?.('launcher')} />}
                            left={<TranscriptColumn {...transcriptProps} status={audioState} onFixAudio={fixAudio} />}
                            right={<div className="relative flex-1 min-h-0 min-w-0 flex flex-col"><ApprovalDock />{proactiveCard && <ProactiveCard card={proactiveCard} onDismiss={() => setProactiveCard(null)} onAskMore={() => askAboutCard(proactiveCard)} />}<div className="flex-1 min-h-0 min-w-0 flex flex-col"><ChatColumn {...chatProps} /></div></div>}
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
