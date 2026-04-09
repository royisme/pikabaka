import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// import { ModelSelector } from './ui/ModelSelector'; // REMOVED
import TopPill from './ui/TopPill';
import TranscriptPanel from './meeting/TranscriptPanel';
import ChatPanel from './meeting/ChatPanel';
import ResizableSplitter from './ui/ResizableSplitter';
import { analytics } from '../lib/analytics/analytics.service';
import { useShortcuts, type ShortcutConfig } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getOverlayAppearance, getDefaultOverlayOpacity } from '../lib/overlayAppearance';
import { upsertTranscriptSegment, type TranscriptDisplayMode, type TranscriptSegment } from '../lib/transcriptSegments';

interface Message {
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
}

interface PikaInterfaceProps {
    onEndMeeting?: () => void;
    overlayOpacity?: number;
}

interface KnowledgeContext {
    matchedJDSignals: Array<{ requirement: string; relevance: number }>;
    resumeEvidence: Array<{ source: string; text: string }>;
    mustHitKeywords: string[];
    questionCategory: string;
}

const PikaInterface: React.FC<PikaInterfaceProps> = ({ onEndMeeting, overlayOpacity = getDefaultOverlayOpacity() }) => {
    const isLightTheme = useResolvedTheme() === 'light';
    const [isExpanded, setIsExpanded] = useState(true);
    const [inputValue, setInputValue] = useState('');
    const { shortcuts, isShortcutPressed } = useShortcuts();
    const [messages, setMessages] = useState<Message[]>([]);
    const [knowledgeContext, setKnowledgeContext] = useState<KnowledgeContext | null>(null);
    const knowledgeContextTimeoutRef = useRef<number | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [nativeAudioHealth, setNativeAudioHealth] = useState<{
        connected: boolean;
        meetingActive: boolean;
        hasRecentSystemAudioChunk: boolean;
        hasRecentInterviewerTranscript: boolean;
        lastSystemAudioChunkAt: number | null;
        lastInterviewerTranscriptAt: number | null;
        lastError: string | null;
    }>({
        connected: false,
        meetingActive: false,
        hasRecentSystemAudioChunk: false,
        hasRecentInterviewerTranscript: false,
        lastSystemAudioChunkAt: null,
        lastInterviewerTranscriptAt: null,
        lastError: null,
    });
    const [noSystemAudioSince, setNoSystemAudioSince] = useState<number | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [conversationContext, setConversationContext] = useState<string>('');
    const [isManualRecording, setIsManualRecording] = useState(false);
    const isRecordingRef = useRef(false);  // Ref to track recording state (avoids stale closure)
    const [manualTranscript, setManualTranscript] = useState('');
    const manualTranscriptRef = useRef<string>('');
    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('pika_interviewer_transcript');
        return stored !== 'false';
    });
    const [splitterPosition, setSplitterPosition] = useState(() => {
        const stored = localStorage.getItem('pika_splitter_position');
        const parsed = stored ? Number(stored) : 40;
        return Number.isFinite(parsed) ? Math.min(80, Math.max(20, parsed)) : 40;
    });

    // Analytics State
    const requestStartTimeRef = useRef<number | null>(null);

    // Sync transcript setting
    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('pika_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    useEffect(() => {
        localStorage.setItem('pika_splitter_position', String(splitterPosition));
    }, [splitterPosition]);

    const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
    const [transcriptDisplayMode, setTranscriptDisplayMode] = useState<TranscriptDisplayMode>('original');
    const [currentInterviewerPartial, setCurrentInterviewerPartial] = useState('');
    const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);  // Track if actively speaking
    const [voiceInput, setVoiceInput] = useState('');  // Accumulated user voice input
    const voiceInputRef = useRef<string>('');  // Ref for capturing in async handlers
    const textInputRef = useRef<HTMLInputElement>(null); // Ref for input focus
    const isStealthRef = useRef<boolean>(false); // Tracks if the next expansion should be stealthy
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    // const settingsButtonRef = useRef<HTMLButtonElement>(null);

    // Latent Context State (Screenshots attached but not sent)
    const [attachedContext, setAttachedContext] = useState<Array<{ path: string, preview: string }>>([]);

    // Settings State with Persistence
    const [isUndetectable, setIsUndetectable] = useState(false);

    // Model Selection State
    const [currentModel, setCurrentModel] = useState<string>('gemini-3-flash-preview');

    // Dynamic Action Button Mode (Recap vs Brainstorm)
    const [actionButtonMode, setActionButtonMode] = useState<'recap' | 'brainstorm'>('recap');

    useEffect(() => {
        // Load persisted mode
        window.electronAPI?.getActionButtonMode?.()?.then((mode: 'recap' | 'brainstorm') => {
            if (mode) setActionButtonMode(mode);
        }).catch(() => {});

        // Listen for live changes from SettingsPopup / IPC
        const unsubscribe = window.electronAPI?.onActionButtonModeChanged?.((mode: 'recap' | 'brainstorm') => {
            setActionButtonMode(mode);
        });
        return () => { unsubscribe?.(); };
    }, []);

    const appearance = useMemo(
        () => getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'),
        [overlayOpacity, isLightTheme]
    );
    const isSttActivelyReceiving = isInterviewerSpeaking || nativeAudioHealth.hasRecentInterviewerTranscript;
    const sttStatus = useMemo(() => {
        if (!nativeAudioHealth.meetingActive) {
            return { label: 'STT idle', toneClass: 'text-text-tertiary', dotClass: 'bg-slate-500/50' };
        }
        if (!isConnected) {
            return { label: 'STT disconnected', toneClass: 'text-red-400', dotClass: 'bg-red-400' };
        }
        if (isSttActivelyReceiving) {
            return { label: 'STT receiving transcript', toneClass: 'text-emerald-400', dotClass: 'bg-emerald-400 animate-pulse' };
        }
        if (nativeAudioHealth.hasRecentSystemAudioChunk) {
            return { label: 'STT listening (no transcript yet)', toneClass: 'text-amber-300', dotClass: 'bg-amber-300' };
        }
        return { label: 'No system audio signal', toneClass: 'text-red-300', dotClass: 'bg-red-300' };
    }, [isConnected, isSttActivelyReceiving, nativeAudioHealth]);
    const sttNeedsTroubleshooting = useMemo(() => {
        if (!nativeAudioHealth.meetingActive || !isConnected) return false;
        if (nativeAudioHealth.hasRecentSystemAudioChunk || nativeAudioHealth.hasRecentInterviewerTranscript) return false;
        if (nativeAudioHealth.lastError) return true;
        if (!noSystemAudioSince) return false;
        return Date.now() - noSystemAudioSince >= 8000;
    }, [isConnected, nativeAudioHealth, noSystemAudioSince]);
    const showSttErrorDetail = !!nativeAudioHealth.lastError && !isSttActivelyReceiving;
    const overlayPanelClass = 'overlay-text-primary';

    useEffect(() => {
        const shouldTrackMissingSystemAudio =
            nativeAudioHealth.meetingActive &&
            isConnected &&
            !nativeAudioHealth.hasRecentSystemAudioChunk &&
            !nativeAudioHealth.hasRecentInterviewerTranscript;

        if (!shouldTrackMissingSystemAudio) {
            setNoSystemAudioSince(null);
            return;
        }

        setNoSystemAudioSince((prev) => prev ?? Date.now());
    }, [
        isConnected,
        nativeAudioHealth.meetingActive,
        nativeAudioHealth.hasRecentSystemAudioChunk,
        nativeAudioHealth.hasRecentInterviewerTranscript,
    ]);

    useEffect(() => {
        // Load the persisted default model (not the runtime model)
        // Each new meeting starts with the default from settings
        if (window.electronAPI?.getDefaultModel) {
            window.electronAPI.getDefaultModel()
                .then((result: any) => {
                    if (result && result.model) {
                        setCurrentModel(result.model);
                        // Also set the runtime model to the default
                        window.electronAPI.setModel(result.model).catch(() => { });
                    }
                })
                .catch((err: any) => console.error("Failed to fetch default model:", err));
        }
    }, []);

    useEffect(() => {
        window.electronAPI?.getTranscriptTranslationSettings?.()
            .then((settings) => {
                if (settings?.displayMode) {
                    setTranscriptDisplayMode(settings.displayMode);
                }
            })
            .catch(() => { });
    }, []);

    const handleTranslateTranscriptSegment = useCallback(async (segment: TranscriptSegment) => {
        try {
            const result = await window.electronAPI.translateTranscriptSegment({
                segmentId: segment.segmentId,
                text: segment.sourceText,
                speaker: segment.speakerLabel === 'Me' ? 'user' : 'interviewer',
                speakerLabel: segment.speakerLabel,
                timestamp: segment.timestamp,
            });

            if (!result?.success) {
                setTranscriptSegments((prev) =>
                    upsertTranscriptSegment(prev, {
                        final: true,
                        text: segment.sourceText,
                        sourceText: segment.sourceText,
                        segmentId: segment.segmentId,
                        speakerLabel: segment.speakerLabel,
                        timestamp: segment.timestamp,
                        translationState: 'error',
                    })
                );
            }
        } catch {
            setTranscriptSegments((prev) =>
                upsertTranscriptSegment(prev, {
                    final: true,
                    text: segment.sourceText,
                    sourceText: segment.sourceText,
                    segmentId: segment.segmentId,
                    speakerLabel: segment.speakerLabel,
                    timestamp: segment.timestamp,
                    translationState: 'error',
                })
            );
        }
    }, []);

    // Listen for default model changes from Settings
    useEffect(() => {
        if (!window.electronAPI?.onModelChanged) return;
        const unsubscribe = window.electronAPI.onModelChanged((modelId: string) => {
            setCurrentModel(prev => prev === modelId ? prev : modelId);
        });
        return () => unsubscribe();
    }, []);

    // Global State Sync
    useEffect(() => {
        // Fetch initial state
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

    // Persist Settings
    useEffect(() => {
        localStorage.setItem('pika_undetectable', String(isUndetectable));
    }, [isUndetectable]);

    // Mouse Passthrough State
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    useEffect(() => {
        window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => {});
        const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v) => setIsMousePassthrough(v));
        return () => unsub?.();
    }, []);

    // Auto-resize Window
    useLayoutEffect(() => {
        if (!contentRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Use getBoundingClientRect to get the exact rendered size including padding
                const rect = entry.target.getBoundingClientRect();

                // Send exact dimensions to Electron
                // Removed buffer to ensure tight fit
                console.log('[PikaInterface] ResizeObserver:', Math.ceil(rect.width), Math.ceil(rect.height));
                window.electronAPI?.updateContentDimensions({
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height)
                });
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    // Force resize when attachedContext changes (screenshots added/removed)
    useEffect(() => {
        if (!contentRef.current) return;
        // Let the DOM settle, then measure and push new dimensions
        requestAnimationFrame(() => {
            if (!contentRef.current) return;
            const rect = contentRef.current.getBoundingClientRect();
            window.electronAPI?.updateContentDimensions({
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height)
            });
        });
    }, [attachedContext]);

    // Force initial sizing safety check
    useEffect(() => {
        const timer = setTimeout(() => {
            if (contentRef.current) {
                const rect = contentRef.current.getBoundingClientRect();
                window.electronAPI?.updateContentDimensions({
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height)
                });
            }
        }, 600);
        return () => clearTimeout(timer);
    }, []);

    // Auto-scroll
    useEffect(() => {
        if (isExpanded) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isExpanded, isProcessing]);

    // Build bounded conversation context from chat + transcript state
    useEffect(() => {
        const maxContextChars = 8000;
        const transcriptBudget = Math.floor(maxContextChars * 0.45);
        const chatBudget = maxContextChars - transcriptBudget;

        const transcriptLines: string[] = [];
        let transcriptChars = 0;

        if (currentInterviewerPartial.trim()) {
            const partialLine = `Interviewer (partial): ${currentInterviewerPartial.trim()}`;
            transcriptLines.unshift(partialLine);
            transcriptChars += partialLine.length;
        }

        for (let i = transcriptSegments.length - 1; i >= 0; i -= 1) {
            const segment = transcriptSegments[i];
            const text = (segment.translatedText || segment.sourceText || '').trim();
            if (!text) continue;

            const speaker = segment.speakerLabel || 'Interviewer';
            const line = `${speaker}: ${text}`;
            const nextChars = transcriptChars + line.length + (transcriptLines.length > 0 ? 1 : 0);
            if (nextChars > transcriptBudget) break;

            transcriptLines.unshift(line);
            transcriptChars = nextChars;
        }

        const chatLines: string[] = [];
        let chatChars = 0;

        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const message = messages[i];
            if ((message.role === 'user' && message.hasScreenshot) || !message.text.trim()) continue;

            const roleLabel = message.role === 'interviewer'
                ? 'Interviewer'
                : message.role === 'user'
                    ? 'User'
                    : 'Assistant';
            const line = `${roleLabel}: ${message.text.trim()}`;
            const nextChars = chatChars + line.length + (chatLines.length > 0 ? 1 : 0);
            if (nextChars > chatBudget) break;

            chatLines.unshift(line);
            chatChars = nextChars;
        }

        const sections = [
            transcriptLines.length > 0 ? `Recent transcript:\n${transcriptLines.join('\n')}` : '',
            chatLines.length > 0 ? `Recent chat:\n${chatLines.join('\n')}` : ''
        ].filter(Boolean);

        const context = sections.join('\n\n');
        setConversationContext(context.length > maxContextChars ? context.slice(-maxContextChars) : context);
    }, [currentInterviewerPartial, messages, transcriptSegments]);

    // Listen for settings window visibility changes
    useEffect(() => {
        if (!window.electronAPI?.onSettingsVisibilityChange) return;
        const unsubscribe = window.electronAPI.onSettingsVisibilityChange((isVisible) => {
            setIsSettingsOpen(isVisible);
        });
        return () => unsubscribe();
    }, []);

    // Sync Window Visibility with Expanded State
    useEffect(() => {
        if (isExpanded) {
            window.electronAPI.showWindow(isStealthRef.current);
            isStealthRef.current = false; // Reset back to default
        } else {
            // Slight delay to allow animation to clean up if needed, though immediate is safer for click-through
            // Using setTimeout to ensure the render cycle completes first
            // Increased to 400ms to allow "contract to bottom" exit animation to finish
            setTimeout(() => window.electronAPI.hideWindow(), 400);
        }
    }, [isExpanded]);

    // Keyboard shortcut to toggle expanded state (via Main Process)
    useEffect(() => {
        if (!window.electronAPI?.onToggleExpand) return;
        const unsubscribe = window.electronAPI.onToggleExpand(() => {
            setIsExpanded(prev => !prev);
        });
        return () => unsubscribe();
    }, []);

    // Ensure overlay is expanded when requested by main process (e.g. after switching to overlay mode).
    // IMPORTANT: set isStealthRef before setIsExpanded so that if isExpanded was false, the
    // isExpanded effect fires showWindow(true) instead of showWindow(false). Without this,
    // ensure-expanded on a collapsed overlay would trigger show()+focus(), breaking stealth.
    useEffect(() => {
        if (!window.electronAPI?.onEnsureExpanded) return;
        const unsubscribe = window.electronAPI.onEnsureExpanded(() => {
            isStealthRef.current = true;
            setIsExpanded(true);
        });
        return () => unsubscribe();
    }, []);

    // Session Reset Listener - Clears UI when a NEW meeting starts
    useEffect(() => {
        if (!window.electronAPI?.onSessionReset) return;
        const unsubscribe = window.electronAPI.onSessionReset(() => {
            console.log('[PikaInterface] Resetting session state...');
            setMessages([]);
            setInputValue('');
            setAttachedContext([]);
            setManualTranscript('');
            setVoiceInput('');
            setIsProcessing(false);
            // Optionally reset connection status if needed, but connection persists

            // Track new conversation/session if applicable?
            // Actually 'app_opened' is global, 'assistant_started' is overlay.
            // Maybe 'conversation_started' event?
            analytics.trackConversationStarted();
        });
        return () => unsubscribe();
    }, []);


    const handleScreenshotAttach = (data: { path: string; preview: string }) => {
        setIsExpanded(true);
        setAttachedContext(prev => {
            // Prevent duplicates and cap at 5
            if (prev.some(s => s.path === data.path)) return prev;
            const updated = [...prev, data];
            return updated.slice(-5); // Keep last 5
        });
    };

    // Connect to Native Audio Backend
    useEffect(() => {
        const cleanups: (() => void)[] = [];
        const fallbackStatus = {
            connected: false,
            meetingActive: false,
            hasRecentSystemAudioChunk: false,
            hasRecentInterviewerTranscript: false,
            lastSystemAudioChunkAt: null,
            lastInterviewerTranscriptAt: null,
            lastError: null,
        };
        const refreshNativeAudioStatus = () => {
            window.electronAPI.getNativeAudioStatus()
                .then((status) => {
                    setIsConnected(status.connected);
                    setNativeAudioHealth(status);
                })
                .catch(() => {
                    setIsConnected(false);
                    setNativeAudioHealth(fallbackStatus);
                });
        };

        // Connection Status
        refreshNativeAudioStatus();
        const statusTimer = window.setInterval(refreshNativeAudioStatus, 1500);
        cleanups.push(() => window.clearInterval(statusTimer));

        cleanups.push(window.electronAPI.onNativeAudioConnected(() => {
            setIsConnected(true);
            refreshNativeAudioStatus();
        }));
        cleanups.push(window.electronAPI.onNativeAudioDisconnected(() => {
            setIsConnected(false);
            refreshNativeAudioStatus();
        }));

        // Real-time Transcripts
        cleanups.push(window.electronAPI.onNativeAudioTranscript((transcript) => {
            // When Answer button is active, capture USER transcripts for voice input
            // Use ref to avoid stale closure issue
            if (isRecordingRef.current && transcript.speaker === 'user') {
                if (transcript.final) {
                    // Accumulate final transcripts
                    setVoiceInput(prev => {
                        const updated = prev + (prev ? ' ' : '') + transcript.text;
                        voiceInputRef.current = updated;
                        return updated;
                    });
                    setManualTranscript('');  // Clear partial preview
                    manualTranscriptRef.current = '';
                } else {
                    // Show live partial transcript
                    setManualTranscript(transcript.text);
                    manualTranscriptRef.current = transcript.text;
                }
                return;  // Don't add to messages while recording
            }

            if (transcript.speaker === 'user') {
                if (transcript.final) {
                    const normalizedSegmentId =
                        transcript.segmentId ||
                        `user_${transcript.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    setTranscriptSegments((prev) =>
                    upsertTranscriptSegment(prev, {
                        final: true,
                        text: transcript.text,
                        sourceText: transcript.sourceText,
                        translatedText: transcript.translatedText,
                        segmentId: normalizedSegmentId,
                        speaker: 'user',
                        speakerLabel: 'Me',
                        timestamp: transcript.timestamp,
                        translationState: transcript.translationState,
                    })
                    );
                    if (transcript.displayMode) {
                        setTranscriptDisplayMode(transcript.displayMode);
                    }
                }
                return;
            }

            // Only show interviewer (system audio) transcripts in rolling bar
            if (transcript.speaker !== 'interviewer') {
                return;  // Safety check for any other speaker types
            }

            // Route to rolling transcript bar - accumulate text continuously
            setIsInterviewerSpeaking(!transcript.final);
            setNativeAudioHealth((prev) => ({
                ...prev,
                connected: true,
                meetingActive: true,
                hasRecentInterviewerTranscript: true,
                lastInterviewerTranscriptAt: Date.now(),
                lastError: null,
            }));

            if (transcript.final) {
                setCurrentInterviewerPartial('');
                const normalizedSegmentId = transcript.segmentId || `legacy_${transcript.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const speakerFromPayload = (transcript as { speakerLabel?: string }).speakerLabel?.trim();
                setTranscriptSegments((prev) =>
                    upsertTranscriptSegment(prev, {
                        final: true,
                        text: transcript.text,
                        sourceText: transcript.sourceText,
                        translatedText: transcript.translatedText,
                        segmentId: normalizedSegmentId,
                        speaker: 'interviewer',
                        speakerLabel: speakerFromPayload || undefined,
                        timestamp: transcript.timestamp,
                        translationState: transcript.translationState,
                    })
                );
                if (transcript.displayMode) {
                    setTranscriptDisplayMode(transcript.displayMode);
                }

                // Clear speaking indicator after pause
                setTimeout(() => {
                    setIsInterviewerSpeaking(false);
                }, 3000);
            } else {
                setCurrentInterviewerPartial(transcript.text);
            }
        }));

        // AI Suggestions from native audio (legacy)
        cleanups.push(window.electronAPI.onSuggestionProcessingStart(() => {
            setIsProcessing(true);
            setIsExpanded(true);
        }));

        cleanups.push(window.electronAPI.onSuggestionGenerated((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: data.suggestion
            }]);
        }));

        cleanups.push(window.electronAPI.onSuggestionError((err) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err.error}`
            }]);
        }));



        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {
            // Progressive update for 'what_to_answer' mode
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];

                // If we already have a streaming message for this intent, append
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + data.token
                    };
                    return updated;
                }

                // Otherwise, start a new one (First token)
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.token,
                    intent: 'what_to_answer',
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];

                // If we were streaming, finalize it
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
                    // Start new array to avoid mutation
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.answer, // Ensure final consistency
                        isStreaming: false
                    };
                    return updated;
                }

                // If we missed the stream (or not streaming), append fresh
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.answer,  // Plain text, no markdown - ready to speak
                    intent: 'what_to_answer'
                }];
            });
        }));

        // STREAMING: Refinement
        cleanups.push(window.electronAPI.onIntelligenceRefinedAnswerToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === data.intent) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + data.token
                    };
                    return updated;
                }
                // New stream start (e.g. user clicked Shorten)
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.token,
                    intent: data.intent,
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceRefinedAnswer((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === data.intent) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.answer,
                        isStreaming: false
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.answer,
                    intent: data.intent
                }];
            });
        }));

        cleanups.push(window.electronAPI.onKnowledgeContextUpdate((data) => {
            setKnowledgeContext(data);
            if (knowledgeContextTimeoutRef.current) {
                window.clearTimeout(knowledgeContextTimeoutRef.current);
            }
            knowledgeContextTimeoutRef.current = window.setTimeout(() => {
                setKnowledgeContext(null);
                knowledgeContextTimeoutRef.current = null;
            }, 30000);
        }));

        // STREAMING: Recap
        cleanups.push(window.electronAPI.onIntelligenceRecapToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'recap') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + data.token
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.token,
                    intent: 'recap',
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceRecap((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'recap') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.summary,
                        isStreaming: false
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.summary,
                    intent: 'recap'
                }];
            });
        }));

        // STREAMING: Follow-Up Questions (Rendered as message? Or specific UI?)
        // Currently interface typically renders follow-up Qs as a message or button update.
        // Let's assume message for now based on existing 'follow_up_questions_update' handling
        // But wait, existing handle just sets state?
        // Let's check how 'follow_up_questions_update' was handled.
        // It was handled separate locally in this component maybe?
        // Ah, I need to see the existing listener for 'onIntelligenceFollowUpQuestionsUpdate'

        // Let's implemented token streaming for it anyway, likely it updates a message bubble 
        // OR it might update a specialized "Suggested Questions" area.
        // Assuming it's a message for consistency with "Copilot" approach.

        cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'follow_up_questions') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + data.token
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.token,
                    intent: 'follow_up_questions',
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsUpdate((data) => {
            // This event name is slightly different ('update' vs 'answer')
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'follow_up_questions') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.questions,
                        isStreaming: false
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.questions,
                    intent: 'follow_up_questions'
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceManualResult((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `🎯 **Answer:**\n\n${data.answer}`
            }]);
        }));

        cleanups.push(window.electronAPI.onIntelligenceError((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `❌ Error (${data.mode}): ${data.error}`
            }]);
        }));
        // Screenshot taken - attach to chat input instead of auto-analyzing
        cleanups.push(window.electronAPI.onScreenshotTaken(handleScreenshotAttach));

        // Selective Screenshot (Latent Context)
        if (window.electronAPI.onScreenshotAttached) {
            cleanups.push(window.electronAPI.onScreenshotAttached(handleScreenshotAttach));
        }


        return () => {
            cleanups.forEach(fn => fn());
            if (knowledgeContextTimeoutRef.current) {
                window.clearTimeout(knowledgeContextTimeoutRef.current);
                knowledgeContextTimeoutRef.current = null;
            }
        };
    }, [isExpanded]);

    // Stable mount-only effect for clarify streaming listeners.
    // These MUST NOT be inside the [isExpanded] effect — if the user
    // expands/collapses the panel while a clarify stream is in-flight,
    // the [isExpanded] effect would tear down and re-register listeners,
    // orphaning the final 'clarify' event and leaving isProcessing=true forever.
    useEffect(() => {
        const cleanupToken = window.electronAPI.onIntelligenceClarifyToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'clarify') {
                    const updated = [...prev];
                    updated[prev.length - 1] = { ...lastMsg, text: lastMsg.text + data.token };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system' as const,
                    text: data.token,
                    intent: 'clarify',
                    isStreaming: true
                }];
            });
        });

        const cleanupFinal = window.electronAPI.onIntelligenceClarify((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'clarify') {
                    const updated = [...prev];
                    updated[prev.length - 1] = { ...lastMsg, text: data.clarification, isStreaming: false };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system' as const,
                    text: data.clarification,
                    intent: 'clarify'
                }];
            });
        });

        return () => {
            cleanupToken();
            cleanupFinal();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // intentionally empty — these listeners must survive isExpanded changes

    // Quick Actions - Updated to use new Intelligence APIs

    const submitPrompt = useCallback(async ({
        userText,
        attachments = attachedContext,
        clearAttachments = true,
        addUserMessage = true,
        placeholderIntent,
        skipRag = false,
        streamOptions
    }: {
        userText: string;
        attachments?: Array<{ path: string, preview: string }>;
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

        if (clearAttachments) {
            setAttachedContext([]);
        }

        if (addUserMessage) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: promptText,
                hasScreenshot: currentAttachments.length > 0,
                screenshotPreview: currentAttachments[0]?.preview
            }]);
        }

        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            text: '',
            isStreaming: true,
            ...(placeholderIntent ? { intent: placeholderIntent } : {})
        }]);

        setIsExpanded(true);
        setIsProcessing(true);

        try {
            if (!skipRag && currentAttachments.length === 0) {
                const ragResult = await window.electronAPI.ragQueryLive?.(promptText);
                if (ragResult?.success) {
                    return;
                }
            }

            requestStartTimeRef.current = Date.now();
            await window.electronAPI.streamGeminiChat(
                promptText,
                currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
                conversationContext,
                streamOptions
            );
        } catch (err) {
            setIsProcessing(false);
            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.isStreaming && last.text === '') {
                    return prev.slice(0, -1).concat({
                        id: Date.now().toString(),
                        role: 'system',
                        text: `❌ Error starting stream: ${err}`,
                        ...(last.intent ? { intent: last.intent } : {})
                    });
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: `❌ Error: ${err}`
                }];
            });
        }
    }, [attachedContext, conversationContext]);

    const handleWhatToSay = async () => {
        analytics.trackCommandExecuted('what_to_say');
        await submitPrompt({
            userText: attachedContext.length > 0 ? 'What should I say about this?' : 'What should I say in response to the latest interviewer context?',
            placeholderIntent: 'what_to_answer'
        });
    };

    const handleFollowUp = async (intent: string = 'rephrase') => {
        setIsExpanded(true);
        setIsProcessing(true);
        analytics.trackCommandExecuted('follow_up_' + intent);

        try {
            await window.electronAPI.generateFollowUp(intent);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRecap = async () => {
        analytics.trackCommandExecuted('recap');
        await submitPrompt({
            userText: 'Give me a concise recap of the latest interview discussion.',
            placeholderIntent: 'recap'
        });
    };

    const handleFollowUpQuestions = async () => {
        analytics.trackCommandExecuted('suggest_questions');
        await submitPrompt({
            userText: 'Suggest smart follow-up questions I can ask next.',
            placeholderIntent: 'follow_up_questions'
        });
    };

    const handleClarify = async () => {
        analytics.trackCommandExecuted('clarify');
        await submitPrompt({
            userText: 'Clarify what the interviewer is asking and what they likely want to hear.',
            placeholderIntent: 'clarify'
        });
    };

    const handleCodeHint = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        analytics.trackCommandExecuted('code_hint');

        const currentAttachments = attachedContext;
        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: 'Give me a code hint for this',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0].preview
            }]);
        }

        try {
            await window.electronAPI.generateCodeHint(currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleBrainstorm = async () => {
        analytics.trackCommandExecuted('brainstorm');
        await submitPrompt({
            userText: attachedContext.length > 0 ? 'Brainstorm with this context.' : 'Brainstorm the best angles and talking points for the current discussion.',
            placeholderIntent: 'brainstorm'
        });
    };

    const handleAnswerNow = async () => {
        if (isManualRecording) {
            isRecordingRef.current = false;
            setIsManualRecording(false);
            setManualTranscript('');

            window.electronAPI.finalizeMicSTT().catch(err => console.error('[PikaInterface] Failed to send finalizeMicSTT:', err));

            const currentAttachments = attachedContext;
            setAttachedContext([]);

            const question = (voiceInputRef.current + (manualTranscriptRef.current ? ' ' + manualTranscriptRef.current : '')).trim();
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            manualTranscriptRef.current = '';

            if (!question && currentAttachments.length === 0) {
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: '⚠️ No speech detected. Try speaking closer to your microphone.'
                }]);
                return;
            }

            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: question,
                hasScreenshot: currentAttachments.length > 0,
                screenshotPreview: currentAttachments[0]?.preview
            }]);

            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: '',
                isStreaming: true
            }]);

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
                    if (ragResult?.success) {
                        return;
                    }

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
                await window.electronAPI.streamGeminiChat(question, currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined, prompt, { skipSystemPrompt: true });

            } catch (err) {
                setIsProcessing(false);
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.isStreaming && last.text === '') {
                        return prev.slice(0, -1).concat({
                            id: Date.now().toString(),
                            role: 'system',
                            text: `❌ Error starting stream: ${err}`
                        });
                    }
                    return [...prev, {
                        id: Date.now().toString(),
                        role: 'system',
                        text: `❌ Error: ${err}`
                    }];
                });
            }
        } else {
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            isRecordingRef.current = true;
            setIsManualRecording(true);

            try {
            } catch (err) {
            }
        }
    };

    const handleManualSubmit = async () => {
        if (!inputValue.trim() && attachedContext.length === 0) return;

        const userText = inputValue;
        const currentAttachments = attachedContext;

        setInputValue('');

        await submitPrompt({
            userText,
            attachments: currentAttachments
        });
    };

    // We use a ref to hold the latest handlers to avoid re-binding the event listener on every render
    const handlersRef = useRef({
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm
    });

    // Update ref on every render so the event listener always access latest state/props
    handlersRef.current = {
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const { handleWhatToSay, handleFollowUpQuestions, handleRecap, handleAnswerNow, handleClarify, handleCodeHint, handleBrainstorm } = handlersRef.current;

            // Chat Shortcuts (Scope: Local to Chat/Overlay usually, but we allow them here if focused)
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
                if (actionButtonMode === 'brainstorm') {
                    handleBrainstorm();
                } else {
                    handleRecap();
                }
            } else if (isShortcutPressed(e, 'answer')) {
                e.preventDefault();
                handleAnswerNow();
            } else if (isShortcutPressed(e, 'clarify')) {
                e.preventDefault();
                handleClarify();
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
                // Prevent default scrolling when moving window
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isShortcutPressed]);

    // General Global Shortcuts (Rebindable)
    // We listen here to handle them when the window is focused (renderer side)
    // Global shortcuts (when window blurred) are handled by Main process -> GlobalShortcuts
    // But Main process events might not reach here if we don't listen, or we want unified handling.
    // Actually, KeybindManager registers global shortcuts. If they are registered as global, 
    // Electron might consume them before they reach here?
    // 'toggle-app' is Global.
    // 'toggle-visibility' is NOT Global in default config (isGlobal: false), so it depends on focus.
    // So we MUST listen for them here.

    const generalHandlersRef = useRef({
        toggleVisibility: () => window.electronAPI.toggleWindow(),
        processScreenshots: handleWhatToSay,
        resetCancel: async () => {
            if (isProcessing) {
                setIsProcessing(false);
            } else {
                await window.electronAPI.resetIntelligence();
                setMessages([]);
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
                if (data && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering screenshot:", err);
            }
        },
        selectiveScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeSelectiveScreenshot();
                if (data && !data.cancelled && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering selective screenshot:", err);
            }
        }
    });

    // Update ref
    generalHandlersRef.current = {
        toggleVisibility: () => window.electronAPI.toggleWindow(),
        processScreenshots: handleWhatToSay,
        resetCancel: async () => {
            if (isProcessing) {
                setIsProcessing(false);
            } else {
                await window.electronAPI.resetIntelligence();
                setMessages([]);
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
                if (data && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering screenshot:", err);
            }
        },
        selectiveScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeSelectiveScreenshot();
                if (data && !data.cancelled && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering selective screenshot:", err);
            }
        }
    };

    useEffect(() => {
        const handleGeneralKeyDown = (e: KeyboardEvent) => {
            const handlers = generalHandlersRef.current;
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (isShortcutPressed(e, 'toggleVisibility')) {
                // Always allow toggling visibility
                e.preventDefault();
                handlers.toggleVisibility();
            } else if (isShortcutPressed(e, 'processScreenshots')) {
                if (!isInput) {
                    e.preventDefault();
                    handlers.processScreenshots();
                }
                // If input focused, let default behavior (Enter) happen or handle it via onKeyDown in Input
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

    // Global "Capture & Process" shortcut handler (issue #90)
    // Registered separately so it always has the latest handlersRef via stable ref access.
    // Main process takes the screenshot and sends "capture-and-process" with path+preview;
    // we attach the screenshot to context and immediately trigger AI analysis.
    useEffect(() => {
        if (!window.electronAPI.onCaptureAndProcess) return;
        const unsubscribe = window.electronAPI.onCaptureAndProcess((data) => {
            setIsExpanded(true);
            setAttachedContext(prev => {
                if (prev.some(s => s.path === data.path)) return prev;
                return [...prev, data].slice(-5);
            });
            // Wait one tick for React to flush the state update before triggering analysis
            setTimeout(() => {
                handlersRef.current.handleWhatToSay();
            }, 0);
        });
        return unsubscribe;
    }, []);

    // Stealth Global Shortcuts Handler
    // Listens for shortcuts triggered when the app is in the background
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
            }
            else if (action === 'answer') handlers.handleAnswerNow();
            else if (action === 'clarify') handlers.handleClarify();
            else if (action === 'codeHint') handlers.handleCodeHint();
            else if (action === 'brainstorm') handlers.handleBrainstorm();
            else if (action === 'scrollUp') scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' });
            else if (action === 'scrollDown') scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
            else if (action === 'processScreenshots') generalHandlers.processScreenshots();
            else if (action === 'resetCancel') generalHandlers.resetCancel();
            
            // Safety reset if it didn't trigger an expansion
            setTimeout(() => { isStealthRef.current = false; }, 500);
        });
        return unsubscribe;
    }, []);

    return (
        <div ref={contentRef} className="flex flex-col items-center w-fit mx-auto h-fit min-h-0 bg-transparent p-0 rounded-[24px] font-sans gap-2 overlay-text-primary">

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="flex flex-col items-center gap-2 w-full"
                    >
                        <TopPill
                            expanded={isExpanded}
                            onToggle={() => setIsExpanded(!isExpanded)}
                            onQuit={() => onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp()}
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
                                <ResizableSplitter position={splitterPosition} onPositionChange={setSplitterPosition} />
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
