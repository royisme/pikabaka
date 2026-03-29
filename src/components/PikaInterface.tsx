import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import {
    Sparkles,
    Pencil,
    MessageSquare,
    RefreshCw,
    Settings,
    ArrowUp,
    ArrowRight,
    HelpCircle,
    ChevronUp,
    ChevronDown,
    Lightbulb,
    CornerDownLeft,
    Mic,
    MicOff,
    Image,
    Camera,
    X,
    LogOut,
    Zap,
    Edit3,
    SlidersHorizontal,
    Ghost,
    Link,
    Code,
    Copy,
    Check,
    PointerOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
// import { ModelSelector } from './ui/ModelSelector'; // REMOVED
import TopPill from './ui/TopPill';
import RollingTranscript from './ui/RollingTranscript';
import { NegotiationCoachingCard } from '../premium';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { analytics, detectProviderType } from '../lib/analytics/analytics.service';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getOverlayAppearance, OVERLAY_OPACITY_DEFAULT } from '../lib/overlayAppearance';
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

const PikaInterface: React.FC<PikaInterfaceProps> = ({ onEndMeeting, overlayOpacity = OVERLAY_OPACITY_DEFAULT }) => {
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
    const [hideChatHidesWidget, setHideChatHidesWidget] = useState(() => {
        const stored = localStorage.getItem('pika_hideChatHidesWidget');
        return stored ? stored === 'true' : true;
    });

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

    const codeTheme = isLightTheme ? oneLight : vscDarkPlus;
    const codeLineNumberColor = isLightTheme ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.2)';
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
    const subtleSurfaceClass = 'overlay-subtle-surface';
    const codeBlockClass = 'overlay-code-block-surface';
    const codeHeaderClass = 'overlay-code-header-surface';
    const codeHeaderTextClass = 'overlay-text-muted';
    const quickActionClass = 'overlay-chip-surface overlay-text-interactive hover:overlay-text-primary';
    const inputClass = `${isLightTheme ? 'focus:ring-black/10' : 'focus:ring-white/10'} overlay-input-surface overlay-input-text`;
    const controlSurfaceClass = 'overlay-control-surface overlay-text-interactive';

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

    const handleModelSelect = (modelId: string) => {
        setCurrentModel(modelId);
        // Session-only: update runtime but don't persist as default
        window.electronAPI.setModel(modelId)
            .catch((err: any) => console.error("Failed to set model:", err));
    };

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
        localStorage.setItem('pika_hideChatHidesWidget', String(hideChatHidesWidget));
    }, [isUndetectable, hideChatHidesWidget]);

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

    // Build conversation context from messages
    useEffect(() => {
        const context = messages
            .filter(m => m.role !== 'user' || !m.hasScreenshot)
            .map(m => `${m.role === 'interviewer' ? 'Interviewer' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .slice(-20)
            .join('\n');
        setConversationContext(context);
    }, [messages]);

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

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        analytics.trackCopyAnswer();
        // Optional: Trigger a small toast or state change for visual feedback
    };

    const handleWhatToSay = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        analytics.trackCommandExecuted('what_to_say');

        // Capture and clear attached image context
        const currentAttachments = attachedContext;
        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            // Show the attached image in chat
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: 'What should I say about this?',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0].preview
            }]);
        }

        try {
            // Pass imagePath if attached
            await window.electronAPI.generateWhatToSay(undefined, currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined);
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
        setIsExpanded(true);
        setIsProcessing(true);
        analytics.trackCommandExecuted('recap');

        try {
            await window.electronAPI.generateRecap();
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

    const handleFollowUpQuestions = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        analytics.trackCommandExecuted('suggest_questions');

        try {
            await window.electronAPI.generateFollowUpQuestions();
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

    const handleClarify = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        analytics.trackCommandExecuted('clarify');

        try {
            await window.electronAPI.generateClarify();
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

    const handleCodeHint = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        analytics.trackCommandExecuted('code_hint');

        const currentAttachments = attachedContext;
        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            // Show the attached image in chat
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
        setIsExpanded(true);
        setIsProcessing(true);
        analytics.trackCommandExecuted('brainstorm');

        const currentAttachments = attachedContext;
        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            // Show the attached image in chat
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: 'Brainstorm with this context',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0].preview
            }]);
        }

        try {
            await window.electronAPI.generateBrainstorm(currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined);
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


    // Setup Streaming Listeners
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        // Stream Token
        cleanups.push(window.electronAPI.onGeminiStreamToken((token) => {
            // Guard: if this token is the negotiation coaching JSON sentinel, accumulate it
            // silently. The JSON is always emitted as a single complete `yield JSON.stringify(...)`
            // call, so one parse attempt is sufficient. The onGeminiStreamDone handler will
            // detect the accumulated JSON and render the proper card UI — we just prevent the
            // raw JSON characters from ever appearing in the chat bubble.
            try {
                const parsed = JSON.parse(token);
                if (parsed?.__negotiationCoaching) {
                    // Store the raw JSON text (Done handler needs it) but don't show it.
                    setMessages(prev => {
                        const lastMsg = prev[prev.length - 1];
                        if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                            const updated = [...prev];
                            updated[prev.length - 1] = { ...lastMsg, text: token };
                            return updated;
                        }
                        return prev;
                    });
                    return; // Skip the normal append below
                }
            } catch {
                // Not JSON — normal text token, fall through to the standard append.
            }

            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + token,
                        // re-check code status on every token? Expensive but needed for progressive highlighting
                        isCode: (lastMsg.text + token).includes('```') || (lastMsg.text + token).includes('def ') || (lastMsg.text + token).includes('function ')
                    };
                    return updated;
                }
                return prev;
            });
        }));

        // Stream Done
        cleanups.push(window.electronAPI.onGeminiStreamDone(() => {
            setIsProcessing(false);

            // Calculate latency if we have a start time
            let latency = 0;
            if (requestStartTimeRef.current) {
                latency = Date.now() - requestStartTimeRef.current;
                requestStartTimeRef.current = null;
            }

            // Track Usage
            analytics.trackModelUsed({
                model_name: currentModel,
                provider_type: detectProviderType(currentModel),
                latency_ms: latency
            });

            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                    // Detect negotiation coaching response
                    try {
                        const parsed = JSON.parse(lastMsg.text);
                        if (parsed?.__negotiationCoaching) {
                            const coaching = parsed.__negotiationCoaching;
                            return [...prev.slice(0, -1), {
                                ...lastMsg,
                                isStreaming: false,
                                isNegotiationCoaching: true,
                                negotiationCoachingData: coaching,
                                text: '',
                            }];
                        }
                    } catch {}
                    // Normal completion
                    return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
                }
                return prev;
            });
        }));

        // Stream Error
        cleanups.push(window.electronAPI.onGeminiStreamError((error) => {
            setIsProcessing(false);
            requestStartTimeRef.current = null; // Clear timer on error
            setMessages(prev => {
                // Append error to the current message or add new one?
                // Let's add a new error block if the previous one confusing,
                // or just update status.
                // Ideally we want to show the partial response AND the error.
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        isStreaming: false,
                        text: lastMsg.text + `\n\n[Error: ${error}]`
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: `❌ Error: ${error}`
                }];
            });
        }));

        // JIT RAG Stream listeners (for live meeting RAG responses)
        if (window.electronAPI.onRAGStreamChunk) {
            cleanups.push(window.electronAPI.onRAGStreamChunk((data: { chunk: string }) => {
                // Same guard as onGeminiStreamToken: suppress raw JSON if this chunk is
                // the negotiation coaching sentinel. The onRAGStreamComplete handler will
                // convert it to the proper card UI.
                try {
                    const parsed = JSON.parse(data.chunk);
                    if (parsed?.__negotiationCoaching) {
                        setMessages(prev => {
                            const lastMsg = prev[prev.length - 1];
                            if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                                const updated = [...prev];
                                updated[prev.length - 1] = { ...lastMsg, text: data.chunk };
                                return updated;
                            }
                            return prev;
                        });
                        return; // Skip normal append
                    }
                } catch {
                    // Normal text chunk — fall through.
                }

                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                        const updated = [...prev];
                        updated[prev.length - 1] = {
                            ...lastMsg,
                            text: lastMsg.text + data.chunk,
                            isCode: (lastMsg.text + data.chunk).includes('```')
                        };
                        return updated;
                    }
                    return prev;
                });
            }));
        }

        if (window.electronAPI.onRAGStreamComplete) {
            cleanups.push(window.electronAPI.onRAGStreamComplete(() => {
                setIsProcessing(false);
                requestStartTimeRef.current = null;
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                        // Detect negotiation coaching response
                        try {
                            const parsed = JSON.parse(lastMsg.text);
                            if (parsed?.__negotiationCoaching) {
                                const coaching = parsed.__negotiationCoaching;
                                return [...prev.slice(0, -1), {
                                    ...lastMsg,
                                    isStreaming: false,
                                    isNegotiationCoaching: true,
                                    negotiationCoachingData: coaching,
                                    text: '',
                                }];
                            }
                        } catch {}
                        // Normal completion
                        return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
                    }
                    if (lastMsg && lastMsg.isStreaming) {
                        const updated = [...prev];
                        updated[prev.length - 1] = { ...lastMsg, isStreaming: false };
                        return updated;
                    }
                    return prev;
                });
            }));
        }

        if (window.electronAPI.onRAGStreamError) {
            cleanups.push(window.electronAPI.onRAGStreamError((data: { error: string }) => {
                setIsProcessing(false);
                requestStartTimeRef.current = null;
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.isStreaming) {
                        const updated = [...prev];
                        updated[prev.length - 1] = {
                            ...lastMsg,
                            isStreaming: false,
                            text: lastMsg.text + `\n\n[RAG Error: ${data.error}]`
                        };
                        return updated;
                    }
                    return prev;
                });
            }));
        }

        return () => cleanups.forEach(fn => fn());
    }, [currentModel]); // Ensure tracking captures correct model


    const handleAnswerNow = async () => {
        if (isManualRecording) {
            // Stop recording - send accumulated voice input to Gemini
            isRecordingRef.current = false;  // Update ref immediately
            setIsManualRecording(false);
            setManualTranscript('');  // Clear live preview

            // Send manual finalization signal to STT Providers
            window.electronAPI.finalizeMicSTT().catch(err => console.error('[PikaInterface] Failed to send finalizeMicSTT:', err));

            const currentAttachments = attachedContext;
            setAttachedContext([]); // Clear context immediately on send

            const question = (voiceInputRef.current + (manualTranscriptRef.current ? ' ' + manualTranscriptRef.current : '')).trim();
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            manualTranscriptRef.current = '';

            if (!question && currentAttachments.length === 0) {
                // No voice input and no image
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: '⚠️ No speech detected. Try speaking closer to your microphone.'
                }]);
                return;
            }

            // Show user's spoken question
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: question,
                hasScreenshot: currentAttachments.length > 0,
                screenshotPreview: currentAttachments[0]?.preview
            }]);

            // Add placeholder for streaming response
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
                    // Image + Voice Context
                    prompt = `You are a helper. The user has provided a screenshot and a spoken question/command.
User said: "${question}"

Instructions:
1. Analyze the screenshot in the context of what the user said.
2. Provide a direct, helpful answer.
3. Be concise.`;
                } else {
                    // JIT RAG pre-flight: try to use indexed meeting context first
                    const ragResult = await window.electronAPI.ragQueryLive?.(question);
                    if (ragResult?.success) {
                        // JIT RAG handled it — response streamed via rag:stream-chunk events
                        return;
                    }

                    // Voice Only (Smart Extract) — fallback
                    prompt = `You are a real-time interview assistant. The user just repeated or paraphrased a question from their interviewer.
Instructions:
1. Extract the core question being asked
2. Provide a clear, concise, and professional answer that the user can say out loud
3. Keep the answer conversational but informative (2-4 sentences ideal)
4. Do NOT include phrases like "The question is..." - just give the answer directly
5. Format for speaking out loud, not for reading

Provide only the answer, nothing else.`;
                }

                // Call Streaming API: message = question, context = instructions
                requestStartTimeRef.current = Date.now();
                await window.electronAPI.streamGeminiChat(question, currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined, prompt, { skipSystemPrompt: true });

            } catch (err) {
                // Initial invocation failing (e.g. IPC error before stream starts)
                setIsProcessing(false);
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    // If we just added the empty streaming placeholder, remove it or fill it with error
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
            // Start recording - reset voice input state
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            isRecordingRef.current = true;  // Update ref immediately
            setIsManualRecording(true);


            // Ensure native audio is connected
            try {
                // Native audio is now managed by main process
                // await window.electronAPI.invoke('native-audio-connect');
            } catch (err) {
                // Already connected, that's fine
            }
        }
    };

    const handleManualSubmit = async () => {
        if (!inputValue.trim() && attachedContext.length === 0) return;

        const userText = inputValue;
        const currentAttachments = attachedContext;

        // Clear inputs immediately
        setInputValue('');
        setAttachedContext([]);

        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            text: userText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : ''),
            hasScreenshot: currentAttachments.length > 0,
            screenshotPreview: currentAttachments[0]?.preview
        }]);

        // Add placeholder for streaming response
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            text: '',
            isStreaming: true
        }]);

        setIsExpanded(true);
        setIsProcessing(true);

        try {
            // JIT RAG pre-flight: try to use indexed meeting context first
            if (currentAttachments.length === 0) {
                const ragResult = await window.electronAPI.ragQueryLive?.(userText || '');
                if (ragResult?.success) {
                    // JIT RAG handled it — response streamed via rag:stream-chunk events
                    return;
                }
            }

            // Pass imagePath if attached, AND conversation context
            requestStartTimeRef.current = Date.now();
            await window.electronAPI.streamGeminiChat(
                userText || 'Analyze this screenshot',
                currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
                conversationContext // Pass context so "answer this" works
            );
        } catch (err) {
            setIsProcessing(false);
            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.isStreaming && last.text === '') {
                    // remove the empty placeholder
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
    };

    const clearChat = () => {
        setMessages([]);
    };




    const renderMessageText = (msg: Message) => {
        // Negotiation coaching card takes priority
        if (msg.isNegotiationCoaching && msg.negotiationCoachingData) {
            return (
                <NegotiationCoachingCard
                    {...msg.negotiationCoachingData}
                    phase={msg.negotiationCoachingData.phase as any}
                    onSilenceTimerEnd={() => {
                        setMessages(prev => prev.map(m =>
                            m.id === msg.id
                                ? { ...m, negotiationCoachingData: m.negotiationCoachingData ? { ...m.negotiationCoachingData, showSilenceTimer: false } : undefined }
                                : m
                        ));
                    }}
                />
            );
        }

        // Code-containing messages get special styling
        // We split by code blocks to keep the "Code Solution" UI intact for the code parts
        // But use ReactMarkdown for the text parts around it
        if (msg.isCode || (msg.role === 'system' && msg.text.includes('```'))) {
            const parts = msg.text.split(/(```[\s\S]*?```)/g);
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-violet-600' : 'text-purple-300'}`}>
                        <Code className="w-3.5 h-3.5" />
                        <span>Code Solution</span>
                    </div>
                    <div className={`space-y-2 text-[13px] leading-relaxed ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        {parts.map((part, i) => {
                            if (part.startsWith('```')) {
                                const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
                                if (match) {
                                    const lang = match[1] || 'python';
                                    const code = match[2].trim();
                                    return (
                                        <div key={i} className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`} style={appearance.codeBlockStyle}>
                                            {/* Minimalist Apple Header */}
                                            <div className={`px-3 py-1.5 border-b ${codeHeaderClass}`} style={appearance.codeHeaderStyle}>
                                                <span className={`text-[10px] tracking-[0.12em] font-medium font-mono ${codeHeaderTextClass}`}>
                                                    {lang || 'CODE'}
                                                </span>
                                            </div>
                                            <div className="bg-transparent">
                                                <SyntaxHighlighter
                                                    language={lang}
                                                    style={codeTheme}
                                                    customStyle={{
                                                        margin: 0,
                                                        borderRadius: 0,
                                                        fontSize: '13px',
                                                        lineHeight: '1.6',
                                                        background: 'transparent',
                                                        padding: '16px',
                                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                    }}
                                                    wrapLongLines={true}
                                                    showLineNumbers={true}
                                                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: codeLineNumberColor, textAlign: 'right', fontSize: '11px' }}
                                                >
                                                    {code}
                                                </SyntaxHighlighter>
                                            </div>
                                        </div>
                                    );
                                }
                            }
                            // Regular text - Render with Markdown
                            return (
                                <div key={i} className="markdown-content">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                                            strong: ({ node, ...props }: any) => <strong className="font-bold overlay-text-strong" {...props} />,
                                            em: ({ node, ...props }: any) => <em className="italic overlay-text-secondary" {...props} />,
                                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                            ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                                            h1: ({ node, ...props }: any) => <h1 className="text-lg font-bold mb-2 mt-3 overlay-text-strong" {...props} />,
                                            h2: ({ node, ...props }: any) => <h2 className="text-base font-bold mb-2 mt-3 overlay-text-strong" {...props} />,
                                            h3: ({ node, ...props }: any) => <h3 className="text-sm font-bold mb-1 mt-2 overlay-text-primary" {...props} />,
                                            code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono whitespace-pre-wrap ${isLightTheme ? 'text-violet-700' : 'text-purple-200'}`} {...props} />,
                                            blockquote: ({ node, ...props }: any) => <blockquote className={`border-l-2 pl-3 italic my-2 ${isLightTheme ? 'border-violet-500/30 text-slate-600' : 'border-purple-500/50 text-slate-400'}`} {...props} />,
                                            a: ({ node, ...props }: any) => <a className={`hover:underline ${isLightTheme ? 'text-blue-600 hover:text-blue-700' : 'text-blue-400 hover:text-blue-300'}`} target="_blank" rel="noopener noreferrer" {...props} />,
                                        }}
                                    >
                                        {part}
                                    </ReactMarkdown>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // Custom Styled Labels (Shorten, Recap, Follow-up) - also use Markdown for content
        if (msg.intent === 'shorten') {
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-cyan-700' : 'text-cyan-300'}`}>
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Shortened</span>
                    </div>
                    <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-cyan-800' : 'text-cyan-100'}`} {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        }}>
                            {msg.text}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (msg.intent === 'recap') {
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-indigo-700' : 'text-indigo-300'}`}>
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Recap</span>
                    </div>
                    <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-indigo-800' : 'text-indigo-100'}`} {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        }}>
                            {msg.text}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (msg.intent === 'follow_up_questions') {
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-medium text-[11px] tracking-[0.02em] ${isLightTheme ? 'text-amber-700' : 'text-[#FFD60A]'}`}>
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>Follow-Up Questions</span>
                    </div>
                    <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-amber-800' : 'text-[#FFF9C4]'}`} {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        }}>
                            {msg.text}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (msg.intent === 'what_to_answer') {
            // Split text by code blocks (Handle unclosed blocks at EOF)
            const parts = msg.text.split(/(```[\s\S]*?(?:```|$))/g);

            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className="flex items-center gap-2 mb-2 text-emerald-400 font-medium text-[11px] tracking-[0.02em]">
                        <span>Say this</span>
                    </div>
                    <div className="text-[14px] leading-relaxed overlay-text-primary">
                        {parts.map((part, i) => {
                            if (part.startsWith('```')) {
                                // Robust matching: handles unclosed blocks for streaming (```...$)
                                const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);

                                // Fallback logic: if it starts with ticks, treat as code (even if unclosed)
                                if (match || part.startsWith('```')) {
                                    const lang = (match && match[1]) ? match[1] : 'python';
                                    let code = '';

                                    if (match && match[2]) {
                                        code = match[2].trim();
                                    } else {
                                        // Manual strip if regex failed
                                        code = part.replace(/^```\w*\s*/, '').replace(/```$/, '').trim();
                                    }

                                    return (
                                        <div key={i} className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`} style={appearance.codeBlockStyle}>
                                            {/* Minimalist Apple Header */}
                                            <div className={`px-3 py-1.5 border-b ${codeHeaderClass}`} style={appearance.codeHeaderStyle}>
                                                <span className={`text-[10px] tracking-[0.12em] font-medium font-mono ${codeHeaderTextClass}`}>
                                                    {lang || 'CODE'}
                                                </span>
                                            </div>

                                            <div className="bg-transparent">
                                                <SyntaxHighlighter
                                                    language={lang}
                                                    style={codeTheme}
                                                    customStyle={{
                                                        margin: 0,
                                                        borderRadius: 0,
                                                        fontSize: '13px',
                                                        lineHeight: '1.6',
                                                        background: 'transparent',
                                                        padding: '16px',
                                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                    }}
                                                    wrapLongLines={true}
                                                    showLineNumbers={true}
                                                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: codeLineNumberColor, textAlign: 'right', fontSize: '11px' }}
                                                >
                                                    {code}
                                                </SyntaxHighlighter>
                                            </div>
                                        </div>
                                    );
                                }
                            }
                            // Regular text - Render Markdown
                            return (
                                <div key={i} className="markdown-content">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-emerald-700' : 'text-emerald-100'}`} {...props} />,
                                            em: ({ node, ...props }: any) => <em className={`italic ${isLightTheme ? 'text-emerald-700/80' : 'text-emerald-200/80'}`} {...props} />,
                                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                            ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                                        }}
                                    >
                                        {part}
                                    </ReactMarkdown>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // Standard Text Messages (e.g. from User or Interviewer)
        // We still want basic markdown support here too
        return (
            <div className="markdown-content">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                        p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                        strong: ({ node, ...props }: any) => <strong className="font-bold opacity-100 overlay-text-strong" {...props} />,
                        em: ({ node, ...props }: any) => <em className="italic opacity-90 overlay-text-secondary" {...props} />,
                        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                        ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono ${isLightTheme ? 'text-slate-800' : ''}`} {...props} />,
                        a: ({ node, ...props }: any) => <a className="underline hover:opacity-80" target="_blank" rel="noopener noreferrer" {...props} />,
                    }}
                >
                    {msg.text}
                </ReactMarkdown>
            </div>
        );
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
            const { handleWhatToSay, handleFollowUp, handleFollowUpQuestions, handleRecap, handleAnswerNow, handleClarify, handleCodeHint, handleBrainstorm } = handlersRef.current;

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
                            className={`relative w-[600px] max-w-full border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
                            style={appearance.shellStyle}
                        >




                            {/* Transcript notes panel */}
                            {showTranscript && (transcriptSegments.length > 0 || isInterviewerSpeaking) && (
                                <RollingTranscript
                                    segments={transcriptSegments}
                                    partialText={isInterviewerSpeaking ? currentInterviewerPartial : undefined}
                                    displayMode={transcriptDisplayMode}
                                    isActive={isInterviewerSpeaking}
                                    surfaceStyle={appearance.transcriptStyle}
                                    onTranslateSegment={handleTranslateTranscriptSegment}
                                />
                            )}

                            <div className="px-4 pt-2 pb-1 no-drag" aria-live="polite" aria-atomic="true">
                                <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium border border-border-subtle/70 ${subtleSurfaceClass} ${sttStatus.toneClass}`} style={appearance.subtleStyle}>
                                    <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${sttStatus.dotClass}`} />
                                    <span>{sttStatus.label}</span>
                                    {showSttErrorDetail && (
                                        <span className="opacity-80">- {nativeAudioHealth.lastError}</span>
                                    )}
                                </div>
                            </div>
                            {sttNeedsTroubleshooting && (
                                <div className="mx-4 mb-2 p-2 rounded-lg border border-amber-500/30 bg-amber-500/10 no-drag">
                                    <p className="text-[10px] text-amber-200">
                                        STT has no usable system audio input. Check output device routing and permissions.
                                    </p>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                if (!contentRef.current) return;
                                                const contentRect = contentRef.current.getBoundingClientRect();
                                                const buttonRect = e.currentTarget.getBoundingClientRect();
                                                const POPUP_WIDTH = 270;
                                                const GAP = 8;
                                                const x = Math.round(window.screenX + buttonRect.left + buttonRect.width / 2 - POPUP_WIDTH / 2);
                                                const y = Math.round(window.screenY + contentRect.bottom + GAP);
                                                window.electronAPI.toggleSettingsWindow({ x, y });
                                            }}
                                            className="px-2.5 py-1 rounded-md text-[10px] font-medium border border-border-subtle bg-bg-input hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary text-text-primary transition-colors"
                                        >
                                            Open audio settings
                                        </button>
                                        <span className="text-[10px] text-amber-200/80">Tips: play audio on selected output device, then restart meeting if needed.</span>
                                    </div>
                                </div>
                            )}

                            {/* Chat History - Only show if there are messages OR active states */}
                            {(messages.length > 0 || isManualRecording || isProcessing) && (
                                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-3.5 space-y-2.5 max-h-[clamp(300px,35vh,450px)] no-drag" style={{ scrollbarWidth: 'none' }}>
                                    {messages.map((msg) => (
                                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
                                            <div className={`
                      ${msg.role === 'user' ? 'max-w-[72.25%] px-[13.6px] py-[10.2px]' : 'max-w-[85%] px-4 py-2.5'} text-[14px] leading-6 relative group whitespace-pre-wrap
                      ${msg.role === 'user'
                                                    ? (isLightTheme
                                                        ? 'bg-blue-500/12 border border-blue-500/25 text-blue-950 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                                                        : 'bg-blue-500/18 border border-blue-400/30 text-blue-50 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium')
                                                    : ''
                                                }
                      ${msg.role === 'system'
                                                    ? 'overlay-text-primary font-normal'
                                                    : ''
                                                }
                      ${msg.role === 'interviewer'
                                                    ? 'overlay-text-muted italic pl-0 text-[13px]'
                                                    : ''
                                                }
                    `}>
                                                {msg.role === 'interviewer' && (
                                                    <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium tracking-[0.08em] overlay-text-muted/90">
                                                        Interviewer
                                                        {msg.isStreaming && <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />}
                                                    </div>
                                                )}
                                                {msg.role === 'user' && msg.hasScreenshot && (
                                                    <div className={`flex items-center gap-1 text-[10px] opacity-70 mb-1 border-b pb-1 ${isLightTheme ? 'border-black/10' : 'border-white/10'}`}>
                                                        <Image className="w-2.5 h-2.5" />
                                                        <span>Screenshot attached</span>
                                                    </div>
                                                )}
                                                {msg.role === 'system' && !msg.isStreaming && (
                                                    <button
                                                        onClick={() => handleCopy(msg.text)}
                                                        className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                                                        title="Copy to clipboard"
                                                        style={appearance.iconStyle}
                                                    >
                                                        <Copy className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                {renderMessageText(msg)}
                                            </div>
                                        </div>
                                    ))}

                                    {/* Active Recording State with Live Transcription */}
                                    {isManualRecording && (
                                        <div className="flex flex-col items-end gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            {/* Live transcription preview */}
                                            {(manualTranscript || voiceInput) && (
                                                <div className="max-w-[85%] px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-[18px] rounded-tr-[4px]">
                                                    <span className="text-[13px] text-emerald-300">
                                                        {voiceInput}{voiceInput && manualTranscript ? ' ' : ''}{manualTranscript}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="px-3 py-2 flex gap-1.5 items-center">
                                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                                <span className="text-[10px] text-emerald-400/70 ml-1">Listening...</span>
                                            </div>
                                        </div>
                                    )}

                                    {isProcessing && (
                                        <div className="flex justify-start">
                                            <div className="px-3 py-2 flex gap-1.5">
                                                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                        </div>
                                    )}

                                    {knowledgeContext && knowledgeContext.matchedJDSignals.length > 0 && (
                                        <div className="mx-3 mb-2 p-3.5 rounded-2xl border border-white/12 bg-[rgba(10,14,28,0.82)] shadow-[0_10px_28px_rgba(0,0,0,0.18)]">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <span className="text-[10px] font-semibold text-blue-100/90 tracking-[0.08em]">Role focus</span>
                                            </div>
                                            <div className="space-y-1.5">
                                                {knowledgeContext.matchedJDSignals.slice(0, 5).map((sig, i) => (
                                                    <div key={i} className="flex items-center gap-2.5">
                                                        <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-blue-300" />
                                                        <span className="text-[11.5px] text-white/88 leading-relaxed">{sig.requirement}</span>
                                                        <div className="ml-auto w-8 h-1.5 rounded-full bg-white/10 overflow-hidden shrink-0">
                                                            <div className="h-full rounded-full bg-blue-300" style={{ width: `${Math.round(sig.relevance * 100)}%` }} />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {knowledgeContext && (knowledgeContext.mustHitKeywords.length > 0 || knowledgeContext.resumeEvidence.length > 0) && (
                                        <div className="mx-3 mb-3 p-3.5 rounded-2xl border border-white/12 bg-[rgba(10,14,28,0.88)] shadow-[0_10px_28px_rgba(0,0,0,0.2)]">
                                            {knowledgeContext.mustHitKeywords.length > 0 && (
                                                <div className="mb-3">
                                                    <span className="text-[10px] font-semibold text-blue-100/90 tracking-[0.08em]">Language to weave in</span>
                                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                        {knowledgeContext.mustHitKeywords.slice(0, 8).map((kw, i) => (
                                                            <span key={i} className="text-[10.5px] font-medium text-blue-50 px-2 py-1 rounded-md bg-blue-400/16 border border-blue-300/20">
                                                                {kw}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {knowledgeContext.resumeEvidence.length > 0 && (
                                                <div>
                                                    <span className="text-[10px] font-semibold text-emerald-100/90 tracking-[0.08em]">Good examples to mention</span>
                                                    <div className="space-y-1.5 mt-1.5">
                                                        {knowledgeContext.resumeEvidence.slice(0, 3).map((ev, i) => (
                                                            <div key={i} className="text-[11px] leading-relaxed text-white/80">
                                                                <span className="font-semibold text-emerald-200">{ev.source}:</span> {ev.text.slice(0, 100)}{ev.text.length > 100 ? '...' : ''}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>
                            )}

                            {/* Quick Actions */}
                            <div className={`flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 overflow-x-auto no-scrollbar ${(transcriptSegments.length > 0 || isInterviewerSpeaking) && showTranscript ? 'pt-1.5' : 'pt-3.5'}`}>
                                <button onClick={handleWhatToSay} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-medium border border-border-subtle/55 transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
                                    <Pencil className="w-3 h-3 opacity-65" /> Guide me
                                </button>
                                <button onClick={handleClarify} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-medium border border-border-subtle/55 transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
                                    <MessageSquare className="w-3 h-3 opacity-65" /> Clarify
                                </button>
                                <button onClick={actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-medium border border-border-subtle/55 transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
                                    {actionButtonMode === 'brainstorm'
                                        ? <><Lightbulb className="w-3 h-3 opacity-65" /> Ideas</>
                                        : <><RefreshCw className="w-3 h-3 opacity-65" /> Recap</>
                                    }
                                </button>
                                <button onClick={handleFollowUpQuestions} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-medium border border-border-subtle/55 transition-colors active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`} style={appearance.chipStyle}>
                                    <HelpCircle className="w-3 h-3 opacity-65" /> Follow-up
                                </button>
                                <button
                                    onClick={handleAnswerNow}
                                    className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10.5px] font-semibold transition-colors active:scale-95 duration-200 interaction-base interaction-press min-w-[84px] whitespace-nowrap shrink-0 ${isManualRecording
                                        ? 'bg-red-500/10 text-red-300 ring-1 ring-red-400/20'
                                        : 'bg-[#007AFF] text-white shadow-[0_4px_14px_rgba(0,122,255,0.18)] hover:bg-[#0071E3]'
                                        }`}
                                >
                                    {isManualRecording ? (
                                        <>
                                            <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                            Stop
                                        </>
                                    ) : (
                                        <><Zap className="w-3 h-3 opacity-75" /> Answer</>
                                    )}
                                </button>
                            </div>

                            {/* Input Area */}
                            <div className="p-3 pt-0">
                                {/* Latent Context Preview (Attached Screenshot) */}
                                {attachedContext.length > 0 && (
                                    <div className={`mb-2 rounded-lg p-2 transition-all duration-200 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[11px] font-medium overlay-text-primary">
                                                {attachedContext.length} screenshot{attachedContext.length > 1 ? 's' : ''} attached
                                            </span>
                                            <button
                                                onClick={() => setAttachedContext([])}
                                                className="p-1 rounded-full transition-colors overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                                                title="Remove all"
                                                style={appearance.iconStyle}
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <div className="flex gap-1.5 overflow-x-auto max-w-full pb-1">
                                            {attachedContext.map((ctx, idx) => (
                                                <div key={ctx.path} className="relative group/thumb flex-shrink-0">
                                                    <img
                                                        src={ctx.preview}
                                                        alt={`Screenshot ${idx + 1}`}
                                                        className={`h-10 w-auto rounded border ${isLightTheme ? 'border-black/15' : 'border-white/20'}`}
                                                    />
                                                    <button
                                                        onClick={() => setAttachedContext(prev => prev.filter((_, i) => i !== idx))}
                                                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                                                        title="Remove"
                                                    >
                                                        <X className="w-2.5 h-2.5 text-white" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <span className="text-[10px] overlay-text-muted">Ask a question or click Answer</span>
                                    </div>
                                )}

                                <div className="relative group">
                                    <input
                                        ref={textInputRef}
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}

                                        className={`w-full border focus:ring-1 rounded-xl pl-3 pr-10 py-2.5 focus:outline-none transition-all duration-200 ease-sculpted text-[13px] leading-relaxed ${inputClass}`}
                                        style={appearance.inputStyle}
                                    />

                                    {/* Custom Rich Placeholder */}
                                    {!inputValue && (
                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[12px] overlay-text-muted/90 max-w-[calc(100%-56px)] overflow-hidden whitespace-nowrap text-ellipsis">
                                            <span>Ask anything on screen or conversation, or</span>
                                            <div className="flex items-center gap-1 opacity-80">
                                                {(shortcuts.selectiveScreenshot || ['⌘', 'Shift', 'H']).map((key, i) => (
                                                    <React.Fragment key={i}>
                                                        {i > 0 && <span className="text-[10px]">+</span>}
                                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center overlay-control-surface overlay-text-secondary" style={appearance.controlStyle}>{key}</kbd>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                            <span>for selective screenshot</span>
                                        </div>
                                    )}

                                    {!inputValue && (
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none opacity-20">
                                            <span className="text-[10px]">↵</span>
                                        </div>
                                    )}
                                </div>

                                {/* Bottom Row */}
                                <div className="flex items-center justify-between mt-3 px-0.5">
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={(e) => {
                                                // Calculate position for detached window
                                                if (!contentRef.current) return;
                                                const contentRect = contentRef.current.getBoundingClientRect();
                                                const buttonRect = e.currentTarget.getBoundingClientRect();
                                                const GAP = 8;

                                                const x = window.screenX + buttonRect.left;
                                                const y = window.screenY + contentRect.bottom + GAP;

                                                window.electronAPI.toggleModelSelector({ x, y });
                                            }}
                                            className={`
                                                flex items-center gap-2 px-3 py-1.5
                                                border border-border-subtle/60 rounded-lg transition-colors
                                                text-xs font-medium w-[140px]
                                                interaction-base interaction-press
                                                ${controlSurfaceClass}
                                            `}
                                            style={appearance.controlStyle}
                                        >
                                            <span className="truncate min-w-0 flex-1">
                                                {(() => {
                                                    const m = currentModel;
                                                    if (m.startsWith('ollama-')) return m.replace('ollama-', '');
                                                    if (m === 'gemini-3.1-flash-lite-preview') return 'Gemini 3.1 Flash';
                                                    if (m === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
                                                    if (m === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
                                                    if (m === 'gpt-5.4') return 'GPT 5.4';
                                                    if (m === 'claude-sonnet-4-6') return 'Sonnet 4.6';
                                                    return m;
                                                })()}
                                            </span>
                                            <ChevronDown size={14} className="shrink-0 transition-transform" />
                                        </button>

                                        <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />

                                        <div className="relative">
                                            <button
                                                onClick={(e) => {
                                                    if (isSettingsOpen) {
                                                        // If open, just close it (toggle will handle logic but we can be explicit or just toggle)
                                                        // Actually toggle-settings-window handles hiding if visible, so logic is same.
                                                        window.electronAPI.toggleSettingsWindow();
                                                        return;
                                                    }

                                                    if (!contentRef.current) return;

                                                    const contentRect = contentRef.current.getBoundingClientRect();
                                                    const buttonRect = e.currentTarget.getBoundingClientRect();
                                                    const POPUP_WIDTH = 270; // Matches SettingsWindowHelper actual width
                                                    const GAP = 8; // Same gap as between TopPill and main body (gap-2 = 8px)

                                                    // X: Left-aligned relative to the Settings Button
                                                    const x = window.screenX + buttonRect.left;

                                                    // Y: Below the main content + gap
                                                    const y = window.screenY + contentRect.bottom + GAP;

                                                    window.electronAPI.toggleSettingsWindow({ x, y });
                                                }}
                                                className={`
                                            w-7 h-7 flex items-center justify-center rounded-lg
                                            interaction-base interaction-press
                                            ${isSettingsOpen
                                                    ? 'overlay-icon-surface overlay-icon-surface-hover overlay-text-primary'
                                                    : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                                        `}

                                                style={appearance.iconStyle}
                                            >
                                                <SlidersHorizontal className="w-3.5 h-3.5" />
                                            </button>
                                        </div>

                                        <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />

                                        {/* Mouse Passthrough Toggle */}
                                        <div className="relative">
                                            <button
                                                onClick={() => {
                                                    const newState = !isMousePassthrough;
                                                    setIsMousePassthrough(newState);
                                                    window.electronAPI?.setOverlayMousePassthrough?.(newState);
                                                }}
                                                className={`
                                                    w-7 h-7 flex items-center justify-center rounded-lg
                                                    interaction-base interaction-press
                                                    ${isMousePassthrough
                                                        ? 'overlay-icon-surface overlay-icon-surface-hover text-sky-400 opacity-100'
                                                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                                                `}

                                                style={appearance.iconStyle}
                                            >
                                                <PointerOff className="w-3.5 h-3.5" />
                                            </button>
                                        </div>

                                    </div>

                                    <button
                                        onClick={handleManualSubmit}
                                        disabled={!inputValue.trim()}
                                    className={`
                                    w-7 h-7 rounded-full flex items-center justify-center
                                    interaction-base interaction-press
                                    ${inputValue.trim()
                                                ? 'bg-[#007AFF] text-white shadow-lg shadow-blue-500/20 hover:bg-[#0071E3]'
                                                : 'overlay-icon-surface overlay-text-muted cursor-not-allowed'
                                            }
                                `}
                                    style={inputValue.trim() ? undefined : appearance.iconStyle}
                                    >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
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
