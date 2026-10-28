import SttModelPicker, { STT_MODEL_DEFAULTS } from './settings/SttModelPicker';
import ConnectionModelPicker, { ProviderNavigation } from './settings/ConnectionModelPicker';
import TranslationTest from './settings/TranslationTest';
import KnowledgeSettings from './settings/KnowledgeSettings';
import ProviderSetupSettings from './settings/ProviderSetupSettings';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useWindowEvent } from '../hooks/useWindowEvent';
import { useMainEvent } from '../hooks/useMainEvent';
import { useLocalStorageValue } from '../hooks/useLocalStorageValue';
import {
    X, Mic, Speaker, Monitor, Keyboard, BookOpen, Upload,
    RotateCcw, Eye, Layout, MessageSquare,
    ChevronDown, ChevronRight, Check, Power, Palette, Ghost, Sun, Moon, Info, Globe, FlaskConical, Terminal, Settings, Activity, ExternalLink, Trash2,
    MapPin, PointerOff,
    AlertCircle, Shield
} from 'lucide-react';
import { AboutSection } from './AboutSection';
import { AIProvidersSettings } from './settings/AIProvidersSettings';
import { motion, AnimatePresence } from 'framer-motion';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import {
    clampOverlayOpacity,
    OVERLAY_OPACITY_MIN,
    getDefaultOverlayOpacity,
} from '../lib/overlayAppearance';
import { KeyRecorder } from './ui/KeyRecorder';
import { isMac } from '../utils/platformUtils';

const DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT =
    'You are a realtime subtitle translator. Preserve meaning, tone, technical terms, product names, numbers, and code tokens exactly when appropriate. Do not summarize, do not add explanations, and do not omit information. Return only the translated sentence(s), with no prefix/suffix and no markdown.';

type TranscriptAssemblerProfile = 'sentence_bias' | 'low_latency' | 'coherent';

const TRANSCRIPT_ASSEMBLER_PROFILE_OPTIONS: Array<{ value: TranscriptAssemblerProfile; label: string; desc: string }> = [
    { value: 'sentence_bias', label: 'Sentence-biased', desc: 'Balanced sentence completeness with moderate delay.' },
    { value: 'low_latency', label: 'Low-latency', desc: 'Fastest transcript updates, but long sentences may split earlier.' },
    { value: 'coherent', label: 'Coherent', desc: 'Most complete segments for translation; final subtitles may arrive 5-30s later.' },
];

interface CustomSelectProps {
    label: string;
    icon: React.ReactNode;
    value: string;
    options: MediaDeviceInfo[];
    onChange: (value: string) => void;
    placeholder?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ label, icon, value, options, onChange, placeholder = "Select device" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useWindowEvent(
        'mousedown',
        (event) => {
            if (isOpen && containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        },
        'document'
    );

    const selectedLabel = options.find(o => o.deviceId === value)?.label || placeholder;

    return (
        <div className="bg-bg-card rounded-xl p-4 border border-border-subtle" ref={containerRef}>
            {label && (
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-text-secondary">{icon}</span>
                    <label className="text-xs font-medium text-text-primary uppercase tracking-wide">{label}</label>
                </div>
            )}

            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-primary flex items-center justify-between hover:bg-bg-elevated transition-colors"
                >
                    <span className="truncate pr-4">{selectedLabel}</span>
                    <ChevronDown size={14} className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute top-full left-0 w-full mt-1 bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto animated fadeIn">
                        <div className="p-1 space-y-0.5">
                            {options.map((device) => (
                                <button
                                    key={device.deviceId}
                                    onClick={() => {
                                        onChange(device.deviceId);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between group transition-colors ${value === device.deviceId ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                >
                                    <span className="truncate">{device.label || `Device ${device.deviceId.slice(0, 5)}...`}</span>
                                    {value === device.deviceId && <Check size={14} className="text-accent-primary" />}
                                </button>
                            ))}
                            {options.length === 0 && (
                                <div className="px-3 py-2 text-sm text-text-tertiary italic">No devices found</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

interface ProviderOption {
    id: string;
    label: string;
    badge?: string | null;
    recommended?: boolean;
    desc: string;
    icon: React.ReactNode;
}

interface ProviderSelectProps {
    value: string;
    options: ProviderOption[];
    onChange: (value: string) => void;
}

const ProviderSelect: React.FC<ProviderSelectProps> = ({ value, options, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useWindowEvent(
        'mousedown',
        (event) => {
            if (isOpen && containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        },
        'document'
    );

    const selected = options.find(o => o.id === value);

    return (
        <div ref={containerRef} className="relative z-20 font-sans">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full group bg-bg-input border border-border-subtle hover:border-border-muted shadow-sm rounded-xl p-2.5 pr-3.5 flex items-center justify-between transition-all duration-200 outline-none focus:ring-2 focus:ring-accent-primary/20 ${isOpen ? 'ring-2 ring-accent-primary/20 border-accent-primary/50' : 'hover:shadow-md'}`}
            >
                {selected ? (
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 bg-bg-item-surface text-text-secondary">
                            {selected.icon}
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-text-primary truncate leading-tight">{selected.label}</span>
                                {selected.badge && <span className="text-[11px] text-text-secondary">✓ {selected.badge}</span>}
                                {selected.recommended && <span className="text-[11px] text-text-tertiary">Recommended</span>}
                            </div>
                            {/* Short description for trigger */}
                            <span className="text-[11px] text-text-tertiary truncate block leading-tight mt-0.5">{selected.desc}</span>
                        </div>
                    </div>
                ) : <span className="text-text-secondary px-2 text-sm">Select Provider</span>}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary transition-transform duration-300 group-hover:bg-bg-input ${isOpen ? 'rotate-180 bg-bg-input text-text-primary' : ''}`}>
                    <ChevronDown size={14} strokeWidth={2.5} />
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="absolute top-full left-0 w-full mt-2 rounded-xl shadow-2xl overflow-hidden bg-bg-elevated border border-border-subtle"
                    >
                        <div className="max-h-[320px] overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
                            {options.map(option => {
                                const isSelected = value === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        onClick={() => { onChange(option.id); setIsOpen(false); }}
                                        className={`w-full rounded-[10px] p-2 flex items-center gap-3 transition-all duration-200 group relative ${isSelected ? 'bg-bg-item-active shadow-inner' : 'hover:bg-bg-item-surface'}`}
                                    >
                                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-bg-input text-text-secondary">
                                            {option.icon}
                                        </div>
                                        <div className="flex-1 min-w-0 text-left">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-sm font-medium text-text-primary">{option.label}</span>
                                                    {option.badge && <span className="text-[11px] text-text-secondary">✓ {option.badge}</span>}
                                                    {option.recommended && <span className="text-[11px] text-text-tertiary">Recommended</span>}
                                                </div>
                                                {isSelected && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><Check size={14} className="text-accent-primary" strokeWidth={3} /></motion.div>}
                                            </div>
                                            <span className="text-[11px] block text-text-tertiary">{option.desc}</span>
                                        </div>
                                        {/* Hover Indicator */}
                                        {!isSelected && <div className="absolute inset-0 rounded-[10px] ring-1 ring-inset ring-transparent group-hover:ring-border-subtle pointer-events-none" />}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

interface SettingsOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: string;
}

const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ isOpen, onClose, initialTab = 'general' }) => {
    const isLight = useResolvedTheme() === 'light';
    const initialProviderId = initialTab.startsWith('providers:') ? initialTab.slice('providers:'.length) : undefined;
    const initialSection = initialProviderId ? 'providers' : initialTab;
    const [activeTab, setActiveTab] = useState(initialSection);
    const [providerEditorId, setProviderEditorId] = useState(initialProviderId);
    const [showMoreShortcuts, setShowMoreShortcuts] = useState<boolean>(false);

    // Sync active tab when modal opens or initialTab prop changes
    const [prevOpenState, setPrevOpenState] = useState({ isOpen, initialTab });
    if (isOpen && (!prevOpenState.isOpen || initialTab !== prevOpenState.initialTab)) {
        setPrevOpenState({ isOpen, initialTab });
        setActiveTab(initialSection);
        setProviderEditorId(initialProviderId);
    } else if (!isOpen && prevOpenState.isOpen) {
        setPrevOpenState({ isOpen, initialTab });
    }

    const { shortcuts, updateShortcut, resetShortcuts } = useShortcuts();

    const queryClient = useQueryClient();

    // General Settings (queries + main event subscriptions)
    const { data: isUndetectable = false } = useQuery<boolean>(
        ['undetectable'],
        () => window.electronAPI?.getUndetectable?.() ?? Promise.resolve(false),
        { enabled: isOpen && !!window.electronAPI?.getUndetectable }
    );
    useMainEvent(window.electronAPI?.onUndetectableChanged, (newState: boolean) => {
        queryClient.setQueryData(['undetectable'], newState);
    });

    const { data: isMousePassthrough = false } = useQuery<boolean>(
        ['overlay-mouse-passthrough'],
        () => window.electronAPI?.getOverlayMousePassthrough?.() ?? Promise.resolve(false),
        { enabled: isOpen && !!window.electronAPI?.getOverlayMousePassthrough }
    );
    useMainEvent(window.electronAPI?.onOverlayMousePassthroughChanged, (enabled: boolean) => {
        queryClient.setQueryData(['overlay-mouse-passthrough'], enabled);
    });

    const { data: disguiseMode = 'none' } = useQuery<'terminal' | 'settings' | 'activity' | 'none'>(
        ['settings', 'disguise'],
        () => window.electronAPI?.getDisguise?.() ?? Promise.resolve('none'),
        { enabled: isOpen && !!window.electronAPI?.getDisguise }
    );
    useMainEvent(window.electronAPI?.onDisguiseChanged, (newMode: any) => {
        queryClient.setQueryData(['settings', 'disguise'], newMode);
    });

    const { data: openOnLogin = false } = useQuery<boolean>(
        ['settings', 'open-at-login'],
        () => window.electronAPI?.getOpenAtLogin?.() ?? Promise.resolve(false),
        { enabled: isOpen && !!window.electronAPI?.getOpenAtLogin }
    );

    const { data: themeMode = 'system' } = useQuery<'system' | 'light' | 'dark'>(
        ['settings', 'theme-mode'],
        async () => {
            const res = await window.electronAPI?.getThemeMode?.();
            return (res?.mode as 'system' | 'light' | 'dark') ?? 'system';
        },
        { enabled: isOpen && !!window.electronAPI?.getThemeMode }
    );

    const { data: verboseLogging = false } = useQuery<boolean>(
        ['settings', 'verbose-logging'],
        () => window.electronAPI?.getVerboseLogging?.() ?? Promise.resolve(false),
        { enabled: isOpen && !!window.electronAPI?.getVerboseLogging }
    );

    const { data: permissionStatus = null } = useQuery<{ microphone: string; screen: string } | null>(
        ['settings', 'permission-status'],
        () => window.electronAPI?.getPermissionStatus?.() ?? Promise.resolve(null),
        { enabled: isOpen && !!window.electronAPI?.getPermissionStatus }
    );

    const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
    const themeDropdownRef = useRef<HTMLDivElement>(null);

    useWindowEvent(
        'mousedown',
        (event) => {
            if (isThemeDropdownOpen && themeDropdownRef.current && !themeDropdownRef.current.contains(event.target as Node)) {
                setIsThemeDropdownOpen(false);
            }
        },
        'document'
    );

    const [storedTranscript, setStoredTranscript] = useLocalStorageValue('pika_interviewer_transcript');
    const showTranscript = storedTranscript !== 'false';

    // Recognition Language
    const [recognitionLanguage, setRecognitionLanguage] = useState('');
    const [userRecognitionLanguage, setUserRecognitionLanguage] = useState('');
    const [selectedSttGroup, setSelectedSttGroup] = useState('');
    const [availableLanguages, setAvailableLanguages] = useState<Record<string, any>>({});

    // Overlay Opacity state
    const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
        const stored = localStorage.getItem('pika_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        // Treat missing value or the old default (0.65) as "not user-set"
        const isUserSet = Number.isFinite(parsed) && parsed !== getDefaultOverlayOpacity();
        return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
    });

    // When the theme changes and the user hasn't saved a custom value, reset to theme-aware default
    const resolvedTheme = useResolvedTheme();
    const [prevTheme, setPrevTheme] = useState(resolvedTheme);
    if (resolvedTheme !== prevTheme) {
        setPrevTheme(resolvedTheme);
        const stored = localStorage.getItem('pika_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        const isUserSet = Number.isFinite(parsed) && parsed !== getDefaultOverlayOpacity();
        if (!isUserSet) {
            const next = getDefaultOverlayOpacity();
            setOverlayOpacity(next);
        }
    }

    const handleOpacityChange = (val: number) => {
        setOverlayOpacity(val);
        // Keep the live meeting overlay in sync while the slider moves.
        window.electronAPI?.setOverlayOpacity?.(val);
    };

    useEffect(() => {
        // Debounce storage writes; handleOpacityChange sends live IPC updates.
        const timeoutId = setTimeout(() => {
            localStorage.setItem('pika_overlay_opacity', String(overlayOpacity));
        }, 150);
        return () => clearTimeout(timeoutId);
    }, [overlayOpacity]);

    useEffect(() => {
        const loadLanguages = async () => {
            if (window.electronAPI?.getRecognitionLanguages) {
                const langs = await window.electronAPI.getRecognitionLanguages();
                setAvailableLanguages(langs);

                // Load stored preference or auto-detect
                const storedStt = await window.electronAPI.getSttLanguage();
                let currentLangKey = storedStt;

                if (!currentLangKey) {
                    const systemLocale = navigator.language;
                    // Try to find exact match or primary match
                    const match = Object.entries(langs).find(([_, config]: [string, any]) =>
                        config.bcp47 === systemLocale ||
                        config.iso639 === systemLocale ||
                        (config.alternates && config.alternates.includes(systemLocale))
                    );

                    currentLangKey = match ? match[0] : 'english-us';

                    // Save the auto-detected default
                    if (window.electronAPI?.setRecognitionLanguage) {
                        window.electronAPI.setRecognitionLanguage(currentLangKey);
                    }
                }

                setRecognitionLanguage(currentLangKey);

                // Initialize Group based on current language
                if (langs[currentLangKey]) {
                    setSelectedSttGroup(langs[currentLangKey].group);
                } else {
                    setSelectedSttGroup('English');
                }

                if (window.electronAPI?.getSttLanguage) {
                    const storedUserStt = await window.electronAPI.getSttLanguage('user');
                    setUserRecognitionLanguage(storedUserStt || currentLangKey || 'english-us');
                }
            }
        };
        loadLanguages();
    }, []);

    // Providers that don't support multi-language / auto-detect in a single request.
    const STT_PROVIDERS_WITHOUT_AUTO = new Set(['azure', 'ibmwatson']);

    const handleLanguageChange = async (key: string) => {
        setRecognitionLanguage(key);
        if (key === 'auto') {
            setSelectedSttGroup('Auto');
        } else if (availableLanguages[key]) {
            setSelectedSttGroup(availableLanguages[key].group);
        }
        // Nothing is sent here: the choice is applied when Save is pressed.
    };

    const handleUserLanguageChange = async (key: string) => {
        setUserRecognitionLanguage(key);
    };

    const handleGroupChange = (group: string) => {
        setSelectedSttGroup(group);
        if (group === 'Auto') {
            handleLanguageChange('auto');
            return;
        }
        // Find default variant for this group (first one)
        const firstVariant = Object.entries(availableLanguages).find(([_, lang]) => lang.group === group);
        if (firstVariant) {
            handleLanguageChange(firstVariant[0]);
        }
    };

    // Base list of unique language groups. The "Auto" group is injected at
    // render time below (only when the current STT provider supports it).
    const baseLanguageGroups = Array.from(new Set(Object.values(availableLanguages).map((l: any) => l.group)))
        .sort((a, b) => {
            if (a === 'English') return -1;
            if (b === 'English') return 1;
            return a.localeCompare(b);
        });

    const translationLanguageOptions = useMemo(() => {
        return Object.entries(availableLanguages)
            .map(([k, v]) => ({ value: k, label: (v as { label?: string }).label || k }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [availableLanguages]);

    // Helper to get variants for current group
    const currentGroupVariants = Object.entries(availableLanguages)

        .filter(([_, lang]) => lang.group === selectedSttGroup)
        .map(([key, lang]) => ({
            deviceId: key,
            label: lang.label,
            kind: 'audioinput' as MediaDeviceKind,
            groupId: '',
            toJSON: () => ({})
        }));

    // Theme Handlers
    const handleSetTheme = async (mode: 'system' | 'light' | 'dark') => {
        queryClient.setQueryData(['settings', 'theme-mode'], mode);
        if (window.electronAPI?.setThemeMode) {
            await window.electronAPI.setThemeMode(mode);
        }
    };

    // Audio Settings
    const { data: devices } = useQuery(
        ['settings', 'devices'],
        async () => {
            const [inputs, outputs] = await Promise.all([
                // @ts-ignore
                window.electronAPI?.getInputDevices() || Promise.resolve([]),
                // @ts-ignore
                window.electronAPI?.getOutputDevices() || Promise.resolve([])
            ]);
            const formatDevices = (devs: any[]) =>
                devs.map((d: any) => ({
                    deviceId: d.id,
                    label: d.name,
                    kind: 'audioinput' as MediaDeviceKind,
                    groupId: '',
                    toJSON: () => d,
                }));
            return {
                inputs: formatDevices(inputs),
                outputs: formatDevices(outputs),
            };
        },
        { enabled: isOpen && !!window.electronAPI?.getInputDevices }
    );
    const inputDevices = devices?.inputs ?? [];
    const outputDevices = devices?.outputs ?? [];
    const [preferredInputId, setPreferredInputId] = useLocalStorageValue('preferredInputDeviceId');
    const [preferredOutputId, setPreferredOutputId] = useLocalStorageValue('preferredOutputDeviceId');
    const selectedInput = (preferredInputId && inputDevices.some((d) => d.deviceId === preferredInputId))
        ? preferredInputId
        : (inputDevices[0]?.deviceId ?? '');
    const selectedOutput = (preferredOutputId && outputDevices.some((d) => d.deviceId === preferredOutputId))
        ? preferredOutputId
        : (outputDevices[0]?.deviceId ?? '');
    const [micLevel, setMicLevel] = useState(0);
    const [inputDeviceNotFound, setInputDeviceNotFound] = useState(false);
    const [storedSck, setStoredSck] = useLocalStorageValue('useExperimentalSckBackend');
    const useExperimentalSck = storedSck === 'true';

    // STT Provider settings
    const [sttProvider, setSttProvider] = useState<'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox'>('google');
    const [transcriptAssemblerProfile, setTranscriptAssemblerProfile] = useState<TranscriptAssemblerProfile>('sentence_bias');
    const [sttGroqKey, setSttGroqKey] = useState('');
    const [sttOpenaiKey, setSttOpenaiKey] = useState('');
    const [sttDeepgramKey, setSttDeepgramKey] = useState('');
    const [sttElevenLabsKey, setSttElevenLabsKey] = useState('');
    const [sttAzureKey, setSttAzureKey] = useState('');
    const [sttAzureRegion, setSttAzureRegion] = useState('eastus');
    const [sttIbmKey, setSttIbmKey] = useState('');
    const [sttTestStatus, setSttTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [sttTestError, setSttTestError] = useState('');
    const [sttSaving, setSttSaving] = useState(false);
    const [sttSaved, setSttSaved] = useState(false);
    const [googleServiceAccountPath, setGoogleServiceAccountPath] = useState<string | null>(null);
    const [hasStoredSttGroqKey, setHasStoredSttGroqKey] = useState(false);
    const [hasStoredSttOpenaiKey, setHasStoredSttOpenaiKey] = useState(false);
    const [hasStoredDeepgramKey, setHasStoredDeepgramKey] = useState(false);
    const [hasStoredElevenLabsKey, setHasStoredElevenLabsKey] = useState(false);
    const [hasStoredAzureKey, setHasStoredAzureKey] = useState(false);
    const [hasStoredIbmWatsonKey, setHasStoredIbmWatsonKey] = useState(false);
    const [sttSonioxKey, setSttSonioxKey] = useState('');
    const [hasStoredSonioxKey, setHasStoredSonioxKey] = useState(false);
    const sttKey = {
        google: '', groq: sttGroqKey, openai: sttOpenaiKey, deepgram: sttDeepgramKey,
        elevenlabs: sttElevenLabsKey, azure: sttAzureKey, ibmwatson: sttIbmKey,
        soniox: sttSonioxKey,
    }[sttProvider];
    const [isSttDropdownOpen, setIsSttDropdownOpen] = useState(false);
    const sttDropdownRef = React.useRef<HTMLDivElement>(null);
    const [transcriptTranslationEnabled, setTranscriptTranslationEnabled] = useState(false);
    const [transcriptTranslationProvider, setTranscriptTranslationProvider] = useState('ollama');
    const [transcriptTranslationModel, setTranscriptTranslationModel] = useState('');
    const [transcriptTranslationPrompt, setTranscriptTranslationPrompt] = useState(DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT);
    const [transcriptTranslationDisplayMode, setTranscriptTranslationDisplayMode] = useState<'original' | 'translated' | 'both'>('original');
    const [transcriptTranslationSourceLanguage, setTranscriptTranslationSourceLanguage] = useState('auto');
    const [transcriptTranslationTargetLanguage, setTranscriptTranslationTargetLanguage] = useState('chinese');
    const [translationSettingsSaved, setTranslationSettingsSaved] = useState(false);
    const [showTranslationAdvanced, setShowTranslationAdvanced] = useState(false);

    // Close STT dropdown when clicking outside
    useWindowEvent(
        'mousedown',
        (event) => {
            if (isSttDropdownOpen && sttDropdownRef.current && !sttDropdownRef.current.contains(event.target as Node)) {
                setIsSttDropdownOpen(false);
            }
        },
        'document'
    );

    // Load STT settings on mount
    useEffect(() => {
        const loadSttSettings = async () => {
            try {
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    setSttProvider(creds.sttProvider || 'google');
                    setSttModelDraft({ ...(creds.sttModels || {}), groq: creds.groqSttModel || '' });
                    setGoogleServiceAccountPath(creds.googleServiceAccountPath);
                    setHasStoredSttGroqKey(creds.hasSttGroqKey);
                    setHasStoredSttOpenaiKey(creds.hasSttOpenaiKey);
                    setHasStoredDeepgramKey(creds.hasDeepgramKey);
                    setHasStoredElevenLabsKey(creds.hasElevenLabsKey);
                    setHasStoredAzureKey(creds.hasAzureKey);
                    if (creds.azureRegion) setSttAzureRegion(creds.azureRegion);
                    setHasStoredIbmWatsonKey(creds.hasIbmWatsonKey);
                    setHasStoredSonioxKey(creds.hasSonioxKey || false);
                    setTranscriptTranslationEnabled(!!creds.transcriptTranslationEnabled);
                    setTranscriptTranslationProvider(creds.transcriptTranslationProvider || 'ollama');
                    setTranscriptTranslationModel(creds.transcriptTranslationModel || '');
                    if (typeof creds.transcriptTranslationPrompt === 'string' && creds.transcriptTranslationPrompt.length > 0) {
                        setTranscriptTranslationPrompt(creds.transcriptTranslationPrompt);
                    } else {
                        setTranscriptTranslationPrompt(DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT);
                    }
                    setTranscriptTranslationDisplayMode(creds.transcriptTranslationDisplayMode || 'original');
                    setTranscriptTranslationSourceLanguage(
                        typeof creds.transcriptTranslationSourceLanguage === 'string'
                            ? creds.transcriptTranslationSourceLanguage
                            : 'auto'
                    );
                    setTranscriptTranslationTargetLanguage(
                        typeof creds.transcriptTranslationTargetLanguage === 'string'
                            ? creds.transcriptTranslationTargetLanguage
                            : 'chinese'
                    );
                }
                const assemblerProfile = await window.electronAPI?.getTranscriptAssemblerProfile?.();
                if (assemblerProfile) {
                    setTranscriptAssemblerProfile(assemblerProfile);
                }
            } catch (e) {
                console.error('Failed to load STT settings:', e);
            }
        };
        if (isOpen) loadSttSettings();
    }, [isOpen]);

    // The speech settings are a draft until Save: provider, model and both languages are applied together
    // and read back, so the screen shows what the app really holds.
    const [sttModelDraft, setSttModelDraft] = useState<Record<string, string>>({});
    const [speechSaving, setSpeechSaving] = useState(false);
    const [speechResult, setSpeechResult] = useState<{ ok: boolean; text: string } | null>(null);

    const handleSaveSpeechSettings = async () => {
        const api = window.electronAPI;
        setSpeechSaving(true);
        setSpeechResult(null);
        try {
            const wantModel = (sttModelDraft[sttProvider] ?? '').trim();
            if (sttProvider in STT_MODEL_DEFAULTS) {
                const modelResult = await api.setSttModel(sttProvider, wantModel);
                if (!modelResult.success) throw new Error(modelResult.error || 'The model was not saved');
            }
            // @ts-ignore
            const providerResult = await api.setSttProvider?.(sttProvider);
            if (providerResult && !providerResult.success) throw new Error(providerResult.error || 'The service was not saved');
            await api.setRecognitionLanguage(recognitionLanguage, 'interviewer');
            await api.setRecognitionLanguage(userRecognitionLanguage || recognitionLanguage, 'user');

            // Read back what the app holds now.
            const [creds, theirs, yours, running] = await Promise.all([
                api.getStoredCredentials(),
                api.getSttLanguage('interviewer'),
                api.getSttLanguage('user'),
                api.getMeetingActive().catch(() => false),
            ]);
            const heldModel = sttProvider === 'groq' ? creds.groqSttModel : creds.sttModels?.[sttProvider];
            const matches =
                creds.sttProvider === sttProvider &&
                theirs === recognitionLanguage &&
                yours === (userRecognitionLanguage || recognitionLanguage) &&
                (!(sttProvider in STT_MODEL_DEFAULTS) || (heldModel || '') === (sttProvider === 'groq' && !wantModel ? 'whisper-large-v3-turbo' : wantModel));
            const label = (key: string) => availableLanguages[key]?.label ?? key;
            setSpeechResult(
                matches
                    ? {
                          ok: true,
                          text: `Saved: ${sttProvider}${sttProvider in STT_MODEL_DEFAULTS ? ` · ${heldModel || 'default model'}` : ''} · their audio ${label(theirs)} · you ${label(yours)}. ${running ? 'The running meeting restarted its recognition with these.' : 'They apply from your next meeting.'}`,
                      }
                    : { ok: false, text: 'Saved, but the app reports different values. Close this window and open it again to see what is in effect.' }
            );
        } catch (e) {
            setSpeechResult({ ok: false, text: (e as Error).message || 'Could not save' });
        } finally {
            setSpeechSaving(false);
        }
    };

    const handleSttProviderChange = async (provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox') => {
        setSttProvider(provider);
        setIsSttDropdownOpen(false);
        setSttTestStatus('idle');
        setSttTestError('');
        setSpeechResult(null);
        // Nothing is sent here: the provider is applied when Save is pressed.
        // If switching to a provider that doesn't support multi-language detection
        // and the current STT language is "auto", fall back to a sensible default.
        if (STT_PROVIDERS_WITHOUT_AUTO.has(provider) && recognitionLanguage === 'auto') {
            await handleLanguageChange('english-us');
        }
    };

    const handleTranscriptAssemblerProfileChange = async (profile: TranscriptAssemblerProfile) => {
        const previousProfile = transcriptAssemblerProfile;
        setTranscriptAssemblerProfile(profile);
        try {
            const result = await window.electronAPI?.setTranscriptAssemblerProfile?.(profile);
            if (result && !result.success) {
                setTranscriptAssemblerProfile(previousProfile);
            }
        } catch (e) {
            console.error('Failed to set transcript segmentation profile:', e);
            setTranscriptAssemblerProfile(previousProfile);
        }
    };

    const handleSttKeySubmit = async (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', key: string) => {
        if (!key.trim()) return;

        // Auto-test before saving
        setSttSaving(true);
        setSttTestStatus('testing');
        setSttTestError('');

        try {
            // @ts-ignore
            const testResult = await window.electronAPI?.testSttConnection?.(
                provider,
                key.trim(),
                provider === 'azure' ? sttAzureRegion : undefined
            );

            if (!testResult?.success) {
                setSttTestStatus('error');
                setSttTestError(testResult?.error || 'Validation failed. Key not saved.');
                setSttSaving(false);
                return; // Stop save
            }

            // If success, proceed to save
            setSttTestStatus('success');
            setTimeout(() => setSttTestStatus('idle'), 3000);

            if (provider === 'groq') {
                // @ts-ignore
                await window.electronAPI?.setGroqSttApiKey?.(key.trim());
            } else if (provider === 'openai') {
                // @ts-ignore
                await window.electronAPI?.setOpenAiSttApiKey?.(key.trim());
            } else if (provider === 'elevenlabs') {
                // @ts-ignore
                await window.electronAPI?.setElevenLabsApiKey?.(key.trim());
            } else if (provider === 'azure') {
                // @ts-ignore
                await window.electronAPI?.setAzureApiKey?.(key.trim());
            } else if (provider === 'ibmwatson') {
                // @ts-ignore
                await window.electronAPI?.setIbmWatsonApiKey?.(key.trim());
            } else if (provider === 'soniox') {
                // @ts-ignore
                await window.electronAPI?.setSonioxApiKey?.(key.trim());
            } else {
                // @ts-ignore
                await window.electronAPI?.setDeepgramApiKey?.(key.trim());
            }
            if (provider === 'groq') setHasStoredSttGroqKey(true);
            else if (provider === 'openai') setHasStoredSttOpenaiKey(true);
            else if (provider === 'elevenlabs') setHasStoredElevenLabsKey(true);
            else if (provider === 'azure') setHasStoredAzureKey(true);
            else if (provider === 'ibmwatson') setHasStoredIbmWatsonKey(true);
            else if (provider === 'soniox') setHasStoredSonioxKey(true);
            else setHasStoredDeepgramKey(true);

            setSttSaved(true);
            setTimeout(() => setSttSaved(false), 2000);
        } catch (e: any) {
            console.error(`Failed to save ${provider} STT key:`, e);
            setSttTestStatus('error');
            setSttTestError(e.message || 'Validation failed');
        } finally {
            setSttSaving(false);
        }
    };

    const handleRemoveSttKey = async (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox') => {
        if (!confirm(`Are you sure you want to remove the ${provider === 'ibmwatson' ? 'IBM Watson' : provider.charAt(0).toUpperCase() + provider.slice(1)} API key?`)) return;

        try {
            if (provider === 'groq') {
                // @ts-ignore
                await window.electronAPI?.setGroqSttApiKey?.('');
                setSttGroqKey('');
                setHasStoredSttGroqKey(false);
            } else if (provider === 'openai') {
                // @ts-ignore
                await window.electronAPI?.setOpenAiSttApiKey?.('');
                setSttOpenaiKey('');
                setHasStoredSttOpenaiKey(false);
            } else if (provider === 'elevenlabs') {
                // @ts-ignore
                await window.electronAPI?.setElevenLabsApiKey?.('');
                setSttElevenLabsKey('');
                setHasStoredElevenLabsKey(false);
            } else if (provider === 'azure') {
                // @ts-ignore
                await window.electronAPI?.setAzureApiKey?.('');
                setSttAzureKey('');
                setHasStoredAzureKey(false);
            } else if (provider === 'ibmwatson') {
                // @ts-ignore
                await window.electronAPI?.setIbmWatsonApiKey?.('');
                setSttIbmKey('');
                setHasStoredIbmWatsonKey(false);
            } else if (provider === 'soniox') {
                // @ts-ignore
                await window.electronAPI?.setSonioxApiKey?.('');
                setSttSonioxKey('');
                setHasStoredSonioxKey(false);
            } else {
                // @ts-ignore
                await window.electronAPI?.setDeepgramApiKey?.('');
                setSttDeepgramKey('');
                setHasStoredDeepgramKey(false);
            }
        } catch (e) {
            console.error(`Failed to remove ${provider} STT key:`, e);
        }
    };


    const handleTestSttConnection = async () => {
        if (sttProvider === 'google') return;
        const hasStoredMap: Record<string, boolean> = {
            groq: hasStoredSttGroqKey, openai: hasStoredSttOpenaiKey, deepgram: hasStoredDeepgramKey,
            elevenlabs: hasStoredElevenLabsKey, azure: hasStoredAzureKey, ibmwatson: hasStoredIbmWatsonKey,
            soniox: hasStoredSonioxKey,
        };
        const keyToTest = sttKey;
        // Allow test with empty local key if a stored key exists (backend will use it)
        if (!keyToTest.trim() && !hasStoredMap[sttProvider]) {
            setSttTestStatus('error');
            setSttTestError('Please enter an API key first');
            return;
        }

        setSttTestStatus('testing');
        setSttTestError('');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.testSttConnection?.(
                sttProvider,
                keyToTest.trim(),
                sttProvider === 'azure' ? sttAzureRegion : undefined
            );
            if (result?.success) {
                setSttTestStatus('success');
                setTimeout(() => setSttTestStatus('idle'), 3000);
            } else {
                setSttTestStatus('error');
                setSttTestError(result?.error || 'Connection failed');
            }
        } catch (e: any) {
            setSttTestStatus('error');
            setSttTestError(e.message || 'Test failed');
        }
    };

    const handleSaveTranscriptTranslationSettings = async () => {
        try {
            await window.electronAPI?.setTranscriptTranslationSettings?.({
                enabled: transcriptTranslationEnabled,
                provider: transcriptTranslationProvider,
                model: transcriptTranslationModel,
                prompt: transcriptTranslationPrompt,
                displayMode: transcriptTranslationDisplayMode,
                sourceLanguage: transcriptTranslationSourceLanguage,
                targetLanguage: transcriptTranslationTargetLanguage,
            });
            setTranslationSettingsSaved(true);
            setTimeout(() => setTranslationSettingsSaved(false), 2000);
        } catch (e) {
            console.error('Failed to save transcript translation settings:', e);
        }
    };

    const handleResetTranscriptTranslationPrompt = () => {
        setTranscriptTranslationPrompt(DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT);
    };


    // Load stored credentials on mount




    // Use the native mic test path so device IDs stay consistent with the meeting runtime.
    useEffect(() => {
        if (isOpen && activeTab === 'audio') {
            const unsubscribe = window.electronAPI?.onAudioTestLevel?.((level) => {
                setMicLevel(Math.max(0, Math.min(100, level * 100)));
            });

            window.electronAPI?.startAudioTest(selectedInput || undefined).then((result) => {
                if (result?.warning) {
                    setInputDeviceNotFound(true);
                    setPreferredInputId(null);
                } else {
                    setInputDeviceNotFound(false);
                }
            }).catch((error) => {
                console.error("Error starting native microphone test:", error);
                setMicLevel(0);
            });

            return () => {
                unsubscribe?.();
                window.electronAPI?.stopAudioTest?.().catch((error) => {
                    console.error("Error stopping native microphone test:", error);
                });
                setMicLevel(0);
            };
        } else {
            setMicLevel(0);
            window.electronAPI?.stopAudioTest?.().catch((error) => {
                console.error("Error stopping native microphone test:", error);
            });
        }
    }, [isOpen, activeTab, selectedInput, setPreferredInputId]);

    return (
        <ProviderNavigation.Provider value={{ editorId: providerEditorId, open: (id) => { setProviderEditorId(id); setActiveTab('providers'); } }}>
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-center justify-center p-8 transition-colors duration-150 bg-black/60 backdrop-blur-sm"
                >
                    <motion.div
                        id="settings-panel-wrapper"
                        initial={{ scale: 0.94, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.94, opacity: 0, y: 20 }}
                        transition={{ 
                            type: "spring", 
                            stiffness: 400, 
                            damping: 32,
                            mass: 1
                        }}
                        className="bg-bg-elevated w-full max-w-4xl h-[80vh] rounded-2xl border border-border-subtle shadow-2xl overflow-hidden relative"
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close settings"
                            className="absolute top-4 right-4 z-10 p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-item-active/60 transition-colors"
                        >
                            <X size={16} strokeWidth={2.25} />
                        </button>
                        <div
                            className="flex w-full h-full"
                        >
                        {/* Sidebar */}
                        <div className="w-64 bg-bg-sidebar flex flex-col border-r border-border-subtle">
                            <div className="p-6">
                                <h2 className="font-semibold text-text-tertiary text-xs uppercase tracking-wider mb-2">Settings</h2>
                                <nav className="space-y-1">
                                    <button
                                        onClick={() => setActiveTab('general')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'general' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Monitor size={16} /> General
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('audio')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'audio' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Mic size={16} className="shrink-0" /> Audio &amp; Translation
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('ai-providers')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'ai-providers' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <FlaskConical size={16} /> Models &amp; Agent
                                    </button>
                                    <button
                                        onClick={() => { setProviderEditorId(undefined); setActiveTab('providers'); }}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'providers' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Settings size={16} /> Provider setup
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('keybinds')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'keybinds' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Keyboard size={16} /> Shortcuts
                                    </button>
                                    <button
                                        onClick={() => {
                                            setActiveTab('profile');
                                        }}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'profile' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <BookOpen size={16} /> Knowledge
                                    </button>

                                    <button
                                        onClick={() => setActiveTab('about')}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'about' ? 'bg-bg-item-active text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'}`}
                                    >
                                        <Info size={16} /> About
                                    </button>
                                </nav>
                            </div>

                            <div className="mt-auto px-6 py-4 border-t border-border-subtle">
                                <button
                                    type="button"
                                    onClick={() => window.electronAPI.quitApp()}
                                    className="text-xs font-medium text-text-tertiary hover:text-state-danger transition-colors"
                                >
                                    Quit Pika
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto bg-bg-main p-8">
                            {activeTab === 'general' && (
                                <div className="space-y-6 animated fadeIn">
                                    <div className="space-y-3.5">
                                        {/* UndetectableToggle */}
                                        <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${isUndetectable ? 'shadow-lg shadow-blue-500/10' : ''}`}>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    {isUndetectable ? (
                                                        <svg
                                                            width="18"
                                                            height="18"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            className="text-text-primary"
                                                        >
                                                            <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" fill="currentColor" stroke="currentColor" />
                                                            <path d="M9 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                                            <path d="M15 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                                        </svg>
                                                    ) : (
                                                        <Ghost size={18} className="text-text-primary" />
                                                    )}
                                                    <h3 className="text-lg font-bold text-text-primary">Undetectable mode: {isUndetectable ? 'on' : 'off'}</h3>
                                                </div>
                                                <p className="text-xs text-text-secondary">
                                                    Requests capture exclusion on Windows and macOS. macOS apps using ScreenCaptureKit can still capture Pika. Not supported on Linux.
                                                </p>
                                            </div>
                                            <div
                                                onClick={() => {
                                                    const newState = !isUndetectable;
                                                    queryClient.setQueryData(['undetectable'], newState);
                                                    window.electronAPI?.setUndetectable(newState);
                                                    // Analytics: Undetectable Mode Toggle
                                                }}
                                                className={`w-11 h-6 rounded-full relative transition-colors ${isUndetectable ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                            >
                                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${isUndetectable ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                        </div>

                                        {/* Mouse Passthrough Toggle — Adapted from public PR #113 */}
                                        <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${isMousePassthrough ? 'shadow-lg shadow-sky-500/10' : ''}`}>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <PointerOff size={18} className={isMousePassthrough ? 'text-state-info' : 'text-text-primary'} />
                                                    <h3 className="text-lg font-bold text-text-primary">Mouse Passthrough</h3>
                                                </div>
                                                <p className="text-xs text-text-secondary">
                                                    Overlay stays visible but lets all mouse clicks pass through to the app beneath.
                                                </p>
                                            </div>
                                            <div
                                                onClick={() => {
                                                    const newState = !isMousePassthrough;
                                                    queryClient.setQueryData(['overlay-mouse-passthrough'], newState);
                                                    window.electronAPI?.setOverlayMousePassthrough(newState);
                                                }}
                                                className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer ${isMousePassthrough ? 'bg-state-info' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                            >
                                                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${isMousePassthrough ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-lg font-bold text-text-primary mb-1">General settings</h3>
                                            <p className="text-xs text-text-secondary mb-2">Customize how Pika works for you</p>

                                            {/* System Permissions Status */}
                                            {permissionStatus && (
                                                <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-4 border border-border-subtle mb-3`}>
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <Shield size={16} className="text-text-secondary" />
                                                        <h4 className="text-sm font-bold text-text-primary">System Permissions</h4>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {([
                                                            { key: 'microphone' as const, label: 'Microphone', icon: <Mic size={15} /> },
                                                            { key: 'screen' as const, label: 'Screen Recording', icon: <Monitor size={15} /> },
                                                        ]).map(({ key, label, icon }) => {
                                                            const granted = permissionStatus[key] === 'granted';
                                                            return (
                                                                <div key={key} className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2.5">
                                                                        <span className="text-text-tertiary">{icon}</span>
                                                                        <span className="text-xs text-text-primary">{label}</span>
                                                                    </div>
                                                                    {granted ? (
                                                                        <div className="flex items-center gap-1.5">
                                                                            <Check size={13} className="text-state-success" />
                                                                            <span className="text-xs text-state-success">Granted</span>
                                                                        </div>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => window.electronAPI?.openPrivacySettings(key)}
                                                                            className="flex items-center gap-1.5 text-xs text-state-warning hover:text-amber-300 transition-colors"
                                                                        >
                                                                            <AlertCircle size={13} />
                                                                            <span>Not granted</span>
                                                                            <ExternalLink size={11} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            <div className={`rounded-xl border ${isLight ? 'bg-bg-card border-border-subtle divide-y divide-border-subtle' : 'bg-transparent border-transparent divide-y divide-border-subtle/20'}`}>
                                            <div className="space-y-0">
                                                {/* Open at Login */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                            <Power size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Open Pika when you log in</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">Pika will open automatically when you log in to your computer</p>
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={() => {
                                                            const newState = !openOnLogin;
                                                            queryClient.setQueryData(['settings', 'open-at-login'], newState);
                                                            window.electronAPI?.setOpenAtLogin(newState);
                                                        }}
                                                        className={`w-11 h-6 rounded-full relative transition-colors ${openOnLogin ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${openOnLogin ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </div>

                                                {/* Debug Logging */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`w-10 h-10 bg-bg-item-surface rounded-lg border flex items-center justify-center transition-colors ${verboseLogging ? 'border-state-warning-border text-state-warning' : 'border-border-subtle text-text-tertiary'}`}>
                                                            <Terminal size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Verbose debug logging</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">Print detailed audio, STT, and pipeline diagnostics to the terminal</p>
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={() => {
                                                            const newState = !verboseLogging;
                                                            queryClient.setQueryData(['settings', 'verbose-logging'], newState);
                                                            window.electronAPI?.setVerboseLogging?.(newState);
                                                        }}
                                                        className={`w-11 h-6 rounded-full relative transition-colors ${verboseLogging ? 'bg-state-warning' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${verboseLogging ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </div>

                                                {/* Live transcript */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                            <MessageSquare size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Live transcript</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">Show the live transcript for both the interviewer and you</p>
                                                        </div>
                                                    </div>
                                                    <div
                                                        onClick={() => {
                                                            setStoredTranscript(showTranscript ? 'false' : 'true');
                                                        }}
                                                        className={`w-11 h-6 rounded-full relative transition-colors ${showTranscript ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${showTranscript ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </div>


                                                {/* Theme */}
                                                <div className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                            <Palette size={20} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-bold text-text-primary">Theme</h3>
                                                            <p className="text-xs text-text-secondary mt-0.5">Customize how Pika looks on your device</p>
                                                        </div>
                                                    </div>

                                                    <div className="relative" ref={themeDropdownRef}>
                                                        <button
                                                            onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                                                            className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 min-w-[110px] justify-between"
                                                        >
                                                            <div className="flex items-center gap-2 overflow-hidden">
                                                                <span className="text-text-secondary shrink-0">
                                                                    {themeMode === 'system' && <Monitor size={14} />}
                                                                    {themeMode === 'light' && <Sun size={14} />}
                                                                    {themeMode === 'dark' && <Moon size={14} />}
                                                                </span>
                                                                <span className="capitalize text-ellipsis overflow-hidden whitespace-nowrap">{themeMode}</span>
                                                            </div>
                                                            <ChevronDown size={12} className={`shrink-0 transition-transform ${isThemeDropdownOpen ? 'rotate-180' : ''}`} />
                                                        </button>

                                                        {/* Dropdown Menu */}
                                                        {isThemeDropdownOpen && (
                                                            <div className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 animated fadeIn select-none">
                                                                {[
                                                                    { mode: 'system', label: 'System', icon: <Monitor size={14} /> },
                                                                    { mode: 'light', label: 'Light', icon: <Sun size={14} /> },
                                                                    { mode: 'dark', label: 'Dark', icon: <Moon size={14} /> }
                                                                ].map((option) => (
                                                                    <button
                                                                        key={option.mode}
                                                                        onClick={() => {
                                                                            handleSetTheme(option.mode as any);
                                                                            setIsThemeDropdownOpen(false);
                                                                        }}
                                                                        className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${themeMode === option.mode ? 'text-text-primary bg-bg-item-active/50' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                                                    >
                                                                        <span className={themeMode === option.mode ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}>{option.icon}</span>
                                                                        <span className="font-medium">{option.label}</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                            </div>
                                            </div>

                                                <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle mt-4`}>
                                                    <div className="flex items-center justify-between mb-3">
                                                        <label htmlFor="overlay-opacity" className="flex items-center gap-2 text-xs font-medium text-text-secondary">
                                                            <Eye size={13} className="text-text-secondary" />
                                                            Overlay opacity
                                                        </label>
                                                        <span className="text-xs font-semibold text-text-primary tabular-nums">
                                                            {Math.round(overlayOpacity * 100)}%
                                                        </span>
                                                    </div>

                                                    <input
                                                        id="overlay-opacity"
                                                        type="range"
                                                        aria-describedby="overlay-opacity-help"
                                                        min={OVERLAY_OPACITY_MIN}
                                                        max={1.0}
                                                        step={0.01}
                                                        value={overlayOpacity}
                                                        onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                                                        className="w-full h-1.5 rounded-full appearance-none bg-border-muted accent-accent-primary"
                                                        style={{ WebkitAppearance: 'none' } as React.CSSProperties}
                                                    />

                                                    <p id="overlay-opacity-help" className="text-xs text-text-tertiary mt-2">
                                                        Lowering this makes the panel only slightly more transparent; an opacity floor keeps text behind it hidden.
                                                    </p>
                                                </div>

                                        </div>

                                    </div>

                                    {/* Process Disguise */}
                                    {/* Process Disguise */}
                                    <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle`}>
                                        <div className="flex flex-col gap-1 mb-3">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-lg font-bold text-text-primary">Process Disguise</h3>
                                            </div>
                                            <p className="text-xs text-text-secondary">
                                                Changes Pika's process name and window titles, with platform-specific icons. This does not exclude it from screen capture.
                                                <span className="block mt-1 text-text-tertiary">
                                                    Your choice applies immediately, even with Undetectable mode off.
                                                </span>
                                            </p>
                                        </div>

                                        <div className={`grid grid-cols-2 gap-3 ${isUndetectable ? 'opacity-50 pointer-events-none' : ''}`}>
                                            {isUndetectable && (
                                                <p className="col-span-2 text-xs text-state-warning -mt-1 mb-1">
                                                    ⚠️ Disable Undetectable mode first to change disguise.
                                                </p>
                                            )}
                                            {[
                                                { id: 'none', label: 'None (Default)', icon: <Layout size={14} /> },
                                                { id: 'terminal', label: 'Terminal', icon: <Terminal size={14} /> },
                                                { id: 'settings', label: 'System Settings', icon: <Settings size={14} /> },
                                                { id: 'activity', label: 'Activity Monitor', icon: <Activity size={14} /> }
                                            ].map((option) => (
                                                <button
                                                    key={option.id}
                                                    disabled={isUndetectable}
                                                    onClick={() => {
                                                        if (isUndetectable) return;
                                                        queryClient.setQueryData(['settings', 'disguise'], option.id);
                                                        // @ts-ignore
                                                        window.electronAPI?.setDisguise(option.id);
                                                        // Analytics
                                                    }}
                                                    className={`p-3 rounded-lg border text-left flex items-center gap-3 transition-all ${disguiseMode === option.id
                                                        ? 'bg-accent-primary border-accent-primary text-on-primary shadow-lg shadow-blue-500/20'
                                                        : 'bg-bg-input border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-subtle-hover'
                                                        } ${isUndetectable ? 'cursor-not-allowed' : ''}`}
                                                >
                                                    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${disguiseMode === option.id ? 'bg-white/20 text-white' : 'bg-bg-item-surface text-text-secondary'
                                                        }`}>
                                                        {option.icon}
                                                    </div>
                                                    <span className="text-xs font-medium">{option.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                </div>
                            )}
                            {activeTab === 'profile' && (
                                <KnowledgeSettings onClose={onClose} />
                            )}
                            {activeTab === 'ai-providers' && (
                                <AIProvidersSettings onOpenProviders={() => { setProviderEditorId(undefined); setActiveTab('providers'); }} />
                            )}
                            {activeTab === 'providers' && (
                                <ProviderSetupSettings key={providerEditorId ?? 'list'} onOpenModels={() => setActiveTab('ai-providers')} />
                            )}
                            {activeTab === 'keybinds' && (
                                <div className="space-y-3 animated fadeIn select-text pb-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="max-w-2xl">
                                            <h3 className="text-lg font-bold text-text-primary mb-1">Shortcuts</h3>
                                            <p className="text-xs text-text-secondary leading-relaxed">Customize how you trigger Pika.</p>
                                        </div>
                                        <button
                                            onClick={resetShortcuts}
                                            className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle hover:border-state-success-border transition-all duration-200 text-xs font-medium text-text-secondary hover:text-state-success active:scale-95 mt-1 whitespace-nowrap"
                                        >
                                            <RotateCcw size={13} strokeWidth={2.5} />
                                            Restore defaults
                                        </button>
                                    </div>

                                    <div className="bg-bg-card border border-border-subtle rounded-2xl p-4 md:p-5">
                                        {([
                                            { id: 'toggleVisibility', label: 'Show or hide Pika' },
                                            { id: 'toggleMousePassthrough', label: 'Toggle click-through' },
                                            { id: 'whatToAnswer', label: 'What to say' },
                                            { id: 'selectiveScreenshot', label: 'Capture Selected Area' },
                                            { id: 'toggleTranslation', label: 'Turn translation on or off' },
                                            { id: 'resetCancel', label: 'Stop generation' },
                                        ] as const).map((item) => (
                                            <div key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2 border-b border-border-subtle last:border-b-0">
                                                <span className="text-sm text-text-secondary">{item.label}</span>
                                                <KeyRecorder
                                                    actionId={item.id}
                                                    label={item.label}
                                                    currentKeys={shortcuts[item.id]}
                                                    onSave={(keys) => updateShortcut(item.id, keys)}
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    <div className="bg-bg-card border border-border-subtle rounded-2xl p-4 md:p-5">
                                        <button
                                            onClick={() => setShowMoreShortcuts(!showMoreShortcuts)}
                                            className="w-full flex items-center justify-between text-left text-sm text-text-secondary hover:text-text-primary transition-colors"
                                        >
                                            <span className="flex items-center gap-2">
                                                <ChevronRight size={15} className={`transition-transform ${showMoreShortcuts ? 'rotate-90' : ''}`} />
                                                More shortcuts
                                            </span>
                                            <span className="px-2 py-0.5 rounded-full bg-bg-subtle text-[11px] text-text-tertiary font-medium">5</span>
                                        </button>

                                        {showMoreShortcuts && (
                                            <div className="mt-4">
                                                {([
                                                    { id: 'toggleOriginal', label: 'Show or hide the original text' },
                                                    { id: 'moveWindowUp', label: 'Move window up' },
                                                    { id: 'moveWindowDown', label: 'Move window down' },
                                                    { id: 'moveWindowLeft', label: 'Move window left' },
                                                    { id: 'moveWindowRight', label: 'Move window right' },
                                                ] as const).map((item) => (
                                                    <div key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2 border-b border-border-subtle last:border-b-0">
                                                        <span className="text-sm text-text-secondary">{item.label}</span>
                                                        <KeyRecorder
                                                            actionId={item.id}
                                                            label={item.label}
                                                            currentKeys={shortcuts[item.id]}
                                                            onSave={(keys) => updateShortcut(item.id, keys)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'audio' && (
                                <div className="space-y-6 animated fadeIn">
                                    <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
                                        <h3 className="text-lg font-bold text-text-primary mb-1">Devices</h3>
                                        <div className="space-y-4 mt-4">
                                            <CustomSelect
                                                label="Input Device"
                                                icon={<Mic size={16} />}
                                                value={selectedInput}
                                                options={inputDevices}
                                                onChange={(id) => {
                                                    setInputDeviceNotFound(false);
                                                    setPreferredInputId(id);
                                                }}
                                                placeholder="Default Microphone"
                                            />
                                            {inputDeviceNotFound && (
                                                <p className="text-xs text-text-primary mt-1 px-1">
                                                    ▲ Previously selected device not found. Using default microphone.
                                                </p>
                                            )}

                                            <div>
                                                <div className="flex justify-between text-xs text-text-secondary mb-2 px-1">
                                                    <span>Input Level</span>
                                                </div>
                                                <div className="h-1.5 bg-bg-input rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-state-success transition-all duration-100 ease-out"
                                                        style={{ width: `${micLevel}%` }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="h-px bg-border-subtle my-2" />

                                            <CustomSelect
                                                label="System audio source (output device)"
                                                icon={<Speaker size={16} />}
                                                value={selectedOutput}
                                                options={outputDevices}
                                                onChange={(id) => {
                                                    setPreferredOutputId(id);
                                                }}
                                                placeholder="Default Speakers"
                                            />
                                            <p className="text-xs text-text-tertiary">Chooses which output device's system audio is captured, starting with the next meeting.</p>

                                            <div className="flex justify-end">
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
                                                            if (!AudioContext) {
                                                                console.error("Web Audio API not supported");
                                                                return;
                                                            }

                                                            const ctx = new AudioContext();

                                                            if (ctx.state === 'suspended') {
                                                                await ctx.resume();
                                                            }

                                                            const oscillator = ctx.createOscillator();
                                                            const gainNode = ctx.createGain();

                                                            oscillator.connect(gainNode);
                                                            gainNode.connect(ctx.destination);

                                                            oscillator.type = 'sine';
                                                            oscillator.frequency.setValueAtTime(523.25, ctx.currentTime);
                                                            gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
                                                            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.0);

                                                            if (selectedOutput && (ctx as any).setSinkId) {
                                                                try {
                                                                    await (ctx as any).setSinkId(selectedOutput);
                                                                } catch (e) {
                                                                    console.warn("Error setting sink for AudioContext", e);
                                                                }
                                                            }

                                                            oscillator.start();
                                                            oscillator.stop(ctx.currentTime + 1.0);
                                                        } catch (e) {
                                                            console.error("Error playing test sound", e);
                                                        }
                                                    }}
                                                    className="text-xs bg-bg-input hover:bg-bg-elevated text-text-primary px-3 py-1.5 rounded-md transition-colors flex items-center gap-2"
                                                >
                                                    <Speaker size={12} /> Test Sound
                                                </button>
                                            </div>

                                            {isMac && (
                                                <div className="rounded-xl border border-border-subtle p-4 flex items-center justify-between gap-3">
                                                    <div>
                                                        <h4 className="text-sm font-bold text-text-primary mb-1">SCK Backend</h4>
                                                        <p className="text-xs text-text-secondary">Use ScreenCaptureKit instead of CoreAudio to capture system audio at the next meeting.</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        aria-label="Use ScreenCaptureKit backend"
                                                        aria-pressed={useExperimentalSck}
                                                        onClick={() => {
                                                            setStoredSck(useExperimentalSck ? 'false' : 'true');
                                                        }}
                                                        className="text-xs bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-md shrink-0"
                                                    >
                                                        {useExperimentalSck ? '● On' : '○ Off'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
                                        <h3 className="text-lg font-bold text-text-primary mb-1">Speech recognition</h3>
                                        <p className="text-xs text-text-secondary mb-5">Choose the engine that transcribes audio to text.</p>

                                        <div className="space-y-4">
                                            <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-3">
                                                <label className="text-xs font-medium text-text-secondary block">Speech Provider</label>
                                                <div className="relative">
                                                    <ProviderSelect
                                                        value={sttProvider}
                                                        onChange={(val) => handleSttProviderChange(val as any)}
                                                        options={[
                                                            { id: 'google', label: 'Google Cloud', badge: googleServiceAccountPath ? 'Saved' : null, recommended: true, desc: 'gRPC streaming via Service Account', icon: <Mic size={14} /> },
                                                            { id: 'groq', label: 'Groq Whisper', badge: hasStoredSttGroqKey ? 'Saved' : null, recommended: true, desc: 'Ultra-fast REST transcription', icon: <Mic size={14} /> },
                                                            { id: 'openai', label: 'OpenAI', badge: hasStoredSttOpenaiKey ? 'Saved' : null, desc: 'Streaming transcription with REST fallback', icon: <Mic size={14} /> },
                                                            { id: 'deepgram', label: 'Deepgram', badge: hasStoredDeepgramKey ? 'Saved' : null, recommended: true, desc: 'Streaming transcription with a configurable model', icon: <Mic size={14} /> },
                                                            { id: 'elevenlabs', label: 'ElevenLabs Scribe', badge: hasStoredElevenLabsKey ? 'Saved' : null, desc: 'Scribe v2 Realtime API', icon: <Mic size={14} /> },
                                                            { id: 'azure', label: 'Azure Speech', badge: hasStoredAzureKey ? 'Saved' : null, desc: 'Microsoft Cognitive Services STT', icon: <Mic size={14} /> },
                                                            { id: 'ibmwatson', label: 'IBM Watson', badge: hasStoredIbmWatsonKey ? 'Saved' : null, desc: 'IBM Watson cloud STT service', icon: <Mic size={14} /> },
                                                            { id: 'soniox', label: 'Soniox', badge: hasStoredSonioxKey ? 'Saved' : null, recommended: true, desc: '60+ languages, multilingual, domain context', icon: <Mic size={14} /> },
                                                        ]}
                                                    />
                                                </div>
                                            </div>

                                            {/* Model (services that let you choose one) */}
                                            {sttProvider in STT_MODEL_DEFAULTS && (
                                                <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-2">
                                                    <label className="text-xs font-medium text-text-secondary block">Model</label>
                                                    <SttModelPicker
                                                        provider={sttProvider}
                                                        model={sttModelDraft[sttProvider] ?? ''}
                                                        apiKey={sttKey}
                                                        onChange={(model) => { setSttModelDraft({ ...sttModelDraft, [sttProvider]: model }); setSpeechResult(null); }}
                                                    />
                                                    <p className="text-[11px] text-text-tertiary">Leave empty for the default. The API key below is used to fetch the list; a saved key works too.</p>
                                                </div>
                                            )}

                                            {/* Google Cloud Service Account */}
                                            {sttProvider === 'google' && (
                                                <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
                                                    <label className="text-xs font-medium text-text-secondary mb-2 block">Service Account JSON</label>
                                                    <div className="flex gap-2">
                                                        <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-secondary font-mono truncate">
                                                            {googleServiceAccountPath
                                                                ? <span className="text-text-primary">{googleServiceAccountPath.split('/').pop()}</span>
                                                                : <span className="text-text-tertiary italic">No file selected</span>}
                                                        </div>
                                                        <button
                                                            onClick={async () => {
                                                                // @ts-ignore
                                                                const result = await window.electronAPI?.selectServiceAccount?.();
                                                                if (result?.success && result.path) {
                                                                    setGoogleServiceAccountPath(result.path);
                                                                }
                                                            }}
                                                            className="px-3 py-2 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors flex items-center gap-2"
                                                        >
                                                            <Upload size={14} /> Select File
                                                        </button>
                                                    </div>
                                                    <p className="text-[11px] text-text-tertiary mt-2">
                                                        Required for Google Cloud Speech-to-Text.
                                                    </p>
                                                </div>
                                            )}

                                            {/* API Key Input (non-Google providers) */}
                                            {sttProvider !== 'google' && (
                                                <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-3">
                                                    <label className="text-xs font-medium text-text-secondary block">
                                                        {sttProvider === 'groq' ? 'Groq' : sttProvider === 'openai' ? 'OpenAI STT' : sttProvider === 'elevenlabs' ? 'ElevenLabs' : sttProvider === 'azure' ? 'Azure' : sttProvider === 'ibmwatson' ? 'IBM Watson' : sttProvider === 'soniox' ? 'Soniox' : 'Deepgram'} API Key
                                                    </label>
                                                    {sttProvider === 'openai' && (
                                                        <p className="text-[11px] text-text-tertiary mb-1.5">
                                                            This key is separate from the OpenAI connection key in Provider setup.
                                                        </p>
                                                    )}
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="password"
                                                            value={sttKey}
                                                            onChange={(e) => {
                                                                if (sttProvider === 'groq') setSttGroqKey(e.target.value);
                                                                else if (sttProvider === 'openai') setSttOpenaiKey(e.target.value);
                                                                else if (sttProvider === 'elevenlabs') setSttElevenLabsKey(e.target.value);
                                                                else if (sttProvider === 'azure') setSttAzureKey(e.target.value);
                                                                else if (sttProvider === 'ibmwatson') setSttIbmKey(e.target.value);
                                                                else if (sttProvider === 'soniox') setSttSonioxKey(e.target.value);
                                                                else setSttDeepgramKey(e.target.value);
                                                            }}
                                                            placeholder={
                                                                sttProvider === 'groq'
                                                                    ? (hasStoredSttGroqKey ? '••••••••••••' : 'Enter Groq API key')
                                                                    : sttProvider === 'openai'
                                                                        ? (hasStoredSttOpenaiKey ? '••••••••••••' : 'Enter OpenAI STT API key')
                                                                        : sttProvider === 'elevenlabs'
                                                                            ? (hasStoredElevenLabsKey ? '••••••••••••' : 'Enter ElevenLabs API key')
                                                                            : sttProvider === 'azure'
                                                                                ? (hasStoredAzureKey ? '••••••••••••' : 'Enter Azure API key')
                                                                                : sttProvider === 'ibmwatson'
                                                                                    ? (hasStoredIbmWatsonKey ? '••••••••••••' : 'Enter IBM Watson API key')
                                                                                    : sttProvider === 'soniox'
                                                                                        ? (hasStoredSonioxKey ? '••••••••••••' : 'Enter Soniox API key')
                                                                                        : (hasStoredDeepgramKey ? '••••••••••••' : 'Enter Deepgram API key')
                                                            }
                                                            className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                                                        />
                                                        <button
                                                            onClick={() => handleSttKeySubmit(sttProvider, sttKey)}
                                                            disabled={sttSaving || !sttKey.trim()}
                                                            className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${sttSaved
                                                                ? 'bg-state-success-soft text-state-success'
                                                                : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-50'
                                                                }`}
                                                        >
                                                            {sttSaving ? '● Saving...' : sttSaved ? '✓ Saved' : 'Save'}
                                                        </button>
                                                        {(() => {
                                                            const hasKeyMap: Record<string, boolean> = {
                                                                groq: hasStoredSttGroqKey,
                                                                openai: hasStoredSttOpenaiKey,
                                                                deepgram: hasStoredDeepgramKey,
                                                                elevenlabs: hasStoredElevenLabsKey,
                                                                azure: hasStoredAzureKey,
                                                                ibmwatson: hasStoredIbmWatsonKey,
                                                                soniox: hasStoredSonioxKey,
                                                            };
                                                            return hasKeyMap[sttProvider] ? (
                                                                <button
                                                                    onClick={() => handleRemoveSttKey(sttProvider as any)}
                                                                    className="px-2.5 py-2.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-state-danger hover:bg-state-danger-soft transition-all"
                                                                    title="Remove API Key"
                                                                >
                                                                    <Trash2 size={16} strokeWidth={1.5} />
                                                                </button>
                                                            ) : null;
                                                        })()}
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-3">
                                                        <button
                                                            onClick={handleTestSttConnection}
                                                            disabled={sttTestStatus === 'testing'}
                                                            className="text-xs bg-bg-input hover:bg-bg-elevated text-text-primary px-3 py-1.5 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50"
                                                        >
                                                            {sttTestStatus === 'testing' ? (
                                                                <><span aria-hidden="true">●</span> Checking key...</>
                                                            ) : sttTestStatus === 'success' ? (
                                                                <><Check size={12} className="text-state-success" /> The key is accepted</>
                                                            ) : (
                                                                <>Test key</>
                                                            )}
                                                        </button>
                                                        {sttProvider !== 'soniox' && (
                                                            <button
                                                                onClick={() => {
                                                                    const urls: Record<string, string> = {
                                                                        groq: 'https://console.groq.com/keys',
                                                                        openai: 'https://platform.openai.com/api-keys',
                                                                        deepgram: 'https://console.deepgram.com',
                                                                        elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
                                                                        azure: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeech',
                                                                        ibmwatson: 'https://cloud.ibm.com/catalog/services/speech-to-text'
                                                                    };
                                                                    if (urls[sttProvider]) {
                                                                        // @ts-ignore
                                                                        window.electronAPI?.openExternal(urls[sttProvider]);
                                                                    }
                                                                }}
                                                                className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors ml-1"
                                                                title="Get API Key"
                                                            >
                                                                <ExternalLink size={12} />
                                                            </button>
                                                        )}
                                                        {sttTestStatus === 'error' && (
                                                            <span className="text-xs text-text-primary">✕ {sttTestError}</span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] text-text-tertiary">Checks the key, not the selected model or languages.</p>

                                                    {/* Azure Region Input */}
                                                    {sttProvider === 'azure' && (
                                                        <div className="space-y-1.5">
                                                            <label className="text-xs font-medium text-text-secondary block">Region</label>
                                                            <div className="flex gap-2">
                                                                <input
                                                                    type="text"
                                                                    value={sttAzureRegion}
                                                                    onChange={(e) => setSttAzureRegion(e.target.value)}
                                                                    placeholder="e.g. eastus"
                                                                    className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                                                                />
                                                                <button
                                                                    onClick={async () => {
                                                                        if (!sttAzureRegion.trim()) return;
                                                                        // @ts-ignore
                                                                        await window.electronAPI?.setAzureRegion?.(sttAzureRegion.trim());
                                                                        setSttSaved(true);
                                                                        setTimeout(() => setSttSaved(false), 2000);
                                                                    }}
                                                                    disabled={!sttAzureRegion.trim()}
                                                                    className="px-5 py-2.5 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-50 transition-colors"
                                                                >
                                                                    Save
                                                                </button>
                                                            </div>
                                                            <p className="text-[11px] text-text-tertiary">e.g. eastus, westeurope, westus2</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Recognition Language Family */}
                                            <CustomSelect
                                                label="Their language"
                                                icon={<Globe size={14} />}
                                                value={selectedSttGroup}
                                                options={(STT_PROVIDERS_WITHOUT_AUTO.has(sttProvider)
                                                    ? baseLanguageGroups
                                                    : ['Auto', ...baseLanguageGroups]
                                                ).map(g => ({
                                                    deviceId: g,
                                                    label: g === 'Auto' ? 'Auto (multi-language)' : g,
                                                    kind: 'audioinput' as MediaDeviceKind,
                                                    groupId: '',
                                                    toJSON: () => ({})
                                                }))}
                                                onChange={handleGroupChange}
                                                placeholder="Select Language"
                                            />

                                            {/* Variant/Accent Selector (Conditional) */}
                                            {currentGroupVariants.length > 1 && (
                                                <div className="mt-3 animated fadeIn">
                                                    <CustomSelect
                                                        label="Accent / Region"
                                                        icon={<MapPin size={14} />}
                                                        value={recognitionLanguage}
                                                        options={currentGroupVariants}
                                                        onChange={handleLanguageChange}
                                                        placeholder="Select Region"
                                                    />
                                                </div>
                                            )}

                                            <div className="flex gap-2 items-center mt-2 px-1">
                                                <Info size={14} className="text-text-secondary shrink-0" />
                                                <p className="text-xs text-text-secondary">
                                                    {selectedSttGroup === 'Auto'
                                                        ? 'Auto: detect language per segment for multilingual meetings. Not available on Azure / IBM Watson.'
                                                        : 'Select the primary language being spoken in the meeting. Choose Auto for multilingual meetings.'}
                                                </p>
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-text-secondary block">You speak</label>
                                                <select
                                                    value={userRecognitionLanguage || 'english-us'}
                                                    onChange={(e) => { void handleUserLanguageChange(e.target.value); }}
                                                    className="w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                                >
                                                    {translationLanguageOptions.map((o) => (
                                                        <option key={o.value} value={o.value}>
                                                            {o.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <button
                                                        onClick={handleSaveSpeechSettings}
                                                        disabled={speechSaving}
                                                        className="px-5 py-2.5 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-50 transition-colors"
                                                    >
                                                        {speechSaving ? '● Saving...' : 'Save speech settings'}
                                                    </button>
                                                    <span className="text-[11px] text-text-tertiary">The service, model and languages above apply when you press Save. A key has its own Save.</span>
                                                </div>
                                                {speechResult && (
                                                    <p className="text-[11px] text-text-primary">{speechResult.ok ? '✓' : '✕'} {speechResult.text}</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
                                        <h3 className="text-lg font-bold text-text-primary mb-1">Translation</h3>
                                        <p className="text-xs text-text-secondary mb-5">STT is realtime. Translation is applied asynchronously to final interviewer segments.</p>

                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <label className="text-xs font-medium text-text-secondary block">Enable Translation</label>
                                                    <p className="text-[11px] text-text-tertiary mt-1">Choose a connection and model below.</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    aria-label="Enable translation"
                                                    aria-pressed={transcriptTranslationEnabled}
                                                    onClick={() => setTranscriptTranslationEnabled((v) => !v)}
                                                    className="text-xs bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-md shrink-0"
                                                >
                                                    {transcriptTranslationEnabled ? '● On' : '○ Off'}
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div className="space-y-1.5">
                                                    <label className="text-xs font-medium text-text-secondary block">Display Mode</label>
                                                    <select
                                                        value={transcriptTranslationDisplayMode}
                                                        onChange={(e) => setTranscriptTranslationDisplayMode(e.target.value as any)}
                                                        className="w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                                    >
                                                        <option value="original">Original Only</option>
                                                        <option value="translated">Translation Only</option>
                                                        <option value="both">Original + Translation</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div className="space-y-1.5">
                                                    <label className="text-xs font-medium text-text-secondary block">Source language hint</label>
                                                    <select
                                                        value={transcriptTranslationSourceLanguage}
                                                        onChange={(e) => setTranscriptTranslationSourceLanguage(e.target.value)}
                                                        className="w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                                    >
                                                        <option value="auto">Auto-detect (recommended)</option>
                                                        {translationLanguageOptions.map((o) => (
                                                            <option key={o.value} value={o.value}>
                                                                {o.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <p className="text-[11px] text-text-tertiary leading-snug">
                                                        Guides the translation model. When no language is detected, this is also used to skip translation if it matches the target language.
                                                    </p>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-xs font-medium text-text-secondary block">Target language</label>
                                                    <select
                                                        value={transcriptTranslationTargetLanguage}
                                                        onChange={(e) => setTranscriptTranslationTargetLanguage(e.target.value)}
                                                        className="w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                                    >
                                                        {translationLanguageOptions.map((o) => (
                                                            <option key={o.value} value={o.value}>
                                                                {o.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-text-secondary block">Translation model</label>
                                                <ConnectionModelPicker
                                                    id="translation"
                                                    connectionId={transcriptTranslationProvider}
                                                    model={transcriptTranslationModel}
                                                    onChange={(next) => { setTranscriptTranslationProvider(next.connectionId); setTranscriptTranslationModel(next.model); }}
                                                />
                                                <p className="text-[11px] text-text-tertiary">
                                                    Add connections and their API keys in Provider setup.
                                                </p>
                                                <TranslationTest
                                                    provider={transcriptTranslationProvider}
                                                    model={transcriptTranslationModel}
                                                    prompt={transcriptTranslationPrompt}
                                                    targetLanguage={transcriptTranslationTargetLanguage}
                                                />
                                            </div>

                                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                                <button
                                                    onClick={handleSaveTranscriptTranslationSettings}
                                                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${translationSettingsSaved ? 'bg-state-success-soft text-state-success' : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary'}`}
                                                >
                                                    {translationSettingsSaved ? '✓ Saved' : 'Save Translation Settings'}
                                                </button>
                                                <p className="text-[11px] text-text-tertiary sm:pl-1">Only final interviewer transcript segments are translated.</p>
                                            </div>

                                            <button
                                                type="button"
                                                aria-expanded={showTranslationAdvanced}
                                                aria-controls="translation-advanced"
                                                onClick={() => setShowTranslationAdvanced(!showTranslationAdvanced)}
                                                className="w-full flex items-center gap-2 text-left text-sm text-text-secondary hover:text-text-primary transition-colors"
                                            >
                                                <ChevronRight size={15} className={showTranslationAdvanced ? 'rotate-90' : ''} />
                                                Advanced
                                            </button>
                                            <div id="translation-advanced" hidden={!showTranslationAdvanced} className="space-y-4">
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <label className="text-xs font-medium text-text-secondary block">Translation Prompt</label>
                                                        <button
                                                            onClick={handleResetTranscriptTranslationPrompt}
                                                            className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
                                                        >
                                                            Reset to Default
                                                        </button>
                                                    </div>
                                                    <textarea
                                                        value={transcriptTranslationPrompt}
                                                        onChange={(e) => setTranscriptTranslationPrompt(e.target.value)}
                                                        rows={4}
                                                        className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors resize-y"
                                                    />
                                                </div>

                                                <div>
                                                    <h4 className="text-sm font-bold text-text-primary mb-1">Transcript Segmentation</h4>
                                                    <p className="text-xs text-text-secondary mb-3">Choose how patiently Pika buffers final speech segments before translation.</p>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                        {TRANSCRIPT_ASSEMBLER_PROFILE_OPTIONS.map((option) => {
                                                            const selected = transcriptAssemblerProfile === option.value;
                                                            return (
                                                                <button
                                                                    key={option.value}
                                                                    type="button"
                                                                    aria-pressed={selected}
                                                                    onClick={() => handleTranscriptAssemblerProfileChange(option.value)}
                                                                    className={`rounded-xl border p-4 text-left transition-colors ${selected
                                                                        ? 'bg-bg-input border-accent-primary text-text-primary'
                                                                        : 'bg-bg-card border-border-subtle text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
                                                                        }`}
                                                                >
                                                                    <div className="flex items-center justify-between gap-3 mb-2">
                                                                        <span className="text-sm font-semibold">{option.label}</span>
                                                                        {selected && <Check size={15} className="text-accent-primary" />}
                                                                    </div>
                                                                    <p className="text-xs leading-relaxed text-text-tertiary">{option.desc}</p>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            )}


                            {activeTab === 'about' && (
                                <AboutSection />
                            )}
                        </div>
                    </div>
                    </motion.div>
                </motion.div>
            )
            }
        </AnimatePresence >
        </ProviderNavigation.Provider>
    );
};

export default SettingsOverlay;
