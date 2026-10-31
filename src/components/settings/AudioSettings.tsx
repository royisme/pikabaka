import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe, Info, MapPin, Mic, Speaker } from 'lucide-react';
import { useWindowEvent } from '../../hooks/useWindowEvent';
import { useLocalStorageValue } from '../../hooks/useLocalStorageValue';
import { isMac } from '../../utils/platformUtils';
import SttModelPicker, { STT_MODEL_DEFAULTS } from './SttModelPicker';
import { speechServices } from './SpeechProvidersSettings';
import TranslationSettings from './TranslationSettings';
import { CustomSelect, ProviderSelect } from './AudioSelects';
import { primaryButton, secondaryButton } from './buttonStyles';

// Providers that don't support multi-language / auto-detect in a single request.
const STT_PROVIDERS_WITHOUT_AUTO = new Set(['azure', 'ibmwatson']);

/**
 * The "Audio & Translation" tab: its state, effects and handlers run in the settings overlay's own
 * render (the shell calls the hook unconditionally, in the same order every time); below only draws them.
 */

export function useAudioSettings({ isOpen, isActive }: { isOpen: boolean; isActive: boolean }) {
    // Recognition Language
    const [recognitionLanguage, setRecognitionLanguage] = useState('');
    const [userRecognitionLanguage, setUserRecognitionLanguage] = useState('');
    const [selectedSttGroup, setSelectedSttGroup] = useState('');
    const [availableLanguages, setAvailableLanguages] = useState<Record<string, any>>({});

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
    // Audio Settings
    const { data: devices } = useQuery({ queryKey: ['settings', 'devices'], queryFn: async () => {
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
        }, enabled: isOpen && !!window.electronAPI?.getInputDevices });
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
    const [sttProvider, setSttProvider] = useState<'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'gemini'>('google');
    const { data: speechCredentials, error: speechCredentialsError } = useQuery({ queryKey: ['speech-credentials'], queryFn: () => window.electronAPI.getStoredCredentials(), enabled: isOpen && !!window.electronAPI?.getStoredCredentials });
    const configuredSpeechServices = speechServices.filter(service => speechCredentials && service.configured(speechCredentials));
    const speechServiceConfigured = configuredSpeechServices.some(service => service.id === sttProvider);
    const selectedSpeechService = speechServices.find(service => service.id === sttProvider);
    const [isSttDropdownOpen, setIsSttDropdownOpen] = useState(false);
    const sttDropdownRef = React.useRef<HTMLDivElement>(null);

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
            // Switch first: saving a model rebuilds the pipeline, and the old service may have no key.
            // @ts-ignore
            const providerResult = await api.setSttProvider?.(sttProvider);
            if (providerResult && !providerResult.success) throw new Error(providerResult.error || 'The service was not saved');
            const wantModel = (sttModelDraft[sttProvider] ?? '').trim();
            if (sttProvider in STT_MODEL_DEFAULTS) {
                const modelResult = await api.setSttModel(sttProvider, wantModel);
                if (!modelResult.success) throw new Error(modelResult.error || 'The model was not saved');
            }
            await api.setRecognitionLanguage(recognitionLanguage, 'them');
            await api.setRecognitionLanguage(userRecognitionLanguage || recognitionLanguage, 'user');

            // Read back what the app holds now.
            const [creds, theirs, yours, running] = await Promise.all([
                api.getStoredCredentials(),
                api.getSttLanguage('them'),
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

    const handleSttProviderChange = async (provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'gemini') => {
        setSttProvider(provider);
        setIsSttDropdownOpen(false);
        setSpeechResult(null);
        // Nothing is sent here: the provider is applied when Save is pressed.
        // If switching to a provider that doesn't support multi-language detection
        // and the current STT language is "auto", fall back to a sensible default.
        if (STT_PROVIDERS_WITHOUT_AUTO.has(provider) && recognitionLanguage === 'auto') {
            await handleLanguageChange('english-us');
        }
    };

    // Load stored credentials on mount




    // Use the native mic test path so device IDs stay consistent with the meeting runtime.
    useEffect(() => {
        if (isOpen && isActive) {
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
    }, [isOpen, isActive, selectedInput, setPreferredInputId]);

    return {
        sttProvider,
        handleSttProviderChange,
        speechCredentials,
        speechCredentialsError,
        configuredSpeechServices,
        speechServiceConfigured,
        selectedSpeechService,
        sttModelDraft,
        setSttModelDraft,
        setSpeechResult,
        speechSaving,
        speechResult,
        handleSaveSpeechSettings,
        recognitionLanguage,
        userRecognitionLanguage,
        handleUserLanguageChange,
        selectedSttGroup,
        handleGroupChange,
        handleLanguageChange,
        baseLanguageGroups,
        translationLanguageOptions,
        currentGroupVariants,
        inputDevices,
        outputDevices,
        selectedInput,
        selectedOutput,
        setPreferredInputId,
        setPreferredOutputId,
        inputDeviceNotFound,
        setInputDeviceNotFound,
        micLevel,
        useExperimentalSck,
        setStoredSck,
    };
}

export function renderAudioSettings(
    state: ReturnType<typeof useAudioSettings>,
    onOpenProviders: () => void
) {
    const {
        sttProvider,
        handleSttProviderChange,
        speechCredentials,
        speechCredentialsError,
        configuredSpeechServices,
        speechServiceConfigured,
        selectedSpeechService,
        sttModelDraft,
        setSttModelDraft,
        setSpeechResult,
        speechSaving,
        speechResult,
        handleSaveSpeechSettings,
        recognitionLanguage,
        userRecognitionLanguage,
        handleUserLanguageChange,
        selectedSttGroup,
        handleGroupChange,
        handleLanguageChange,
        baseLanguageGroups,
        translationLanguageOptions,
        currentGroupVariants,
        inputDevices,
        outputDevices,
        selectedInput,
        selectedOutput,
        setPreferredInputId,
        setPreferredOutputId,
        inputDeviceNotFound,
        setInputDeviceNotFound,
        micLevel,
        useExperimentalSck,
        setStoredSck,
    } = state;

    return (
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
                            className={`${secondaryButton} flex items-center gap-2`}
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
                            {configuredSpeechServices.length > 0 && <ProviderSelect
                                value={sttProvider}
                                onChange={(val) => handleSttProviderChange(val as any)}
                                options={[
                                    { id: 'google', label: 'Google Cloud', badge: speechCredentials?.googleServiceAccountPath ? 'Saved' : null, recommended: true, desc: 'gRPC streaming via Service Account', icon: <Mic size={14} /> },
                                    { id: 'groq', label: 'Groq Whisper', badge: speechCredentials?.hasSttGroqKey ? 'Saved' : null, recommended: true, desc: 'Ultra-fast REST transcription', icon: <Mic size={14} /> },
                                    { id: 'openai', label: 'OpenAI', badge: speechCredentials?.hasSttOpenaiKey ? 'Saved' : null, desc: 'Streaming transcription with REST fallback', icon: <Mic size={14} /> },
                                    { id: 'deepgram', label: 'Deepgram', badge: speechCredentials?.hasDeepgramKey ? 'Saved' : null, recommended: true, desc: 'Streaming transcription with a configurable model', icon: <Mic size={14} /> },
                                    { id: 'elevenlabs', label: 'ElevenLabs Scribe', badge: speechCredentials?.hasElevenLabsKey ? 'Saved' : null, desc: 'Scribe v2 Realtime API', icon: <Mic size={14} /> },
                                    { id: 'azure', label: 'Azure Speech', badge: speechCredentials?.hasAzureKey ? 'Saved' : null, desc: 'Microsoft Cognitive Services STT', icon: <Mic size={14} /> },
                                    { id: 'ibmwatson', label: 'IBM Watson', badge: speechCredentials?.hasIbmWatsonKey ? 'Saved' : null, desc: 'IBM Watson cloud STT service', icon: <Mic size={14} /> },
                                    { id: 'soniox', label: 'Soniox', badge: speechCredentials?.hasSonioxKey ? 'Saved' : null, recommended: true, desc: '60+ languages, multilingual, domain context', icon: <Mic size={14} /> },
                                    { id: 'gemini', label: 'Gemini Live', badge: speechCredentials?.hasGeminiKey ? 'Saved' : null, recommended: true, desc: 'Streaming transcription with your Gemini API key', icon: <Mic size={14} /> },
                                ].filter(option => configuredSpeechServices.some(service => service.id === option.id))}
                            />}
                            {!!speechCredentialsError ? <p role="alert" className="text-xs text-text-primary break-words">✕ {(speechCredentialsError as Error).message}</p>
                                : !speechCredentials ? <p className="text-xs text-text-secondary">Loading speech providers…</p>
                                : <>
                                    {!speechServiceConfigured && <p className="text-xs text-text-primary">✕ {selectedSpeechService?.name}: not configured</p>}
                                    {!configuredSpeechServices.length && <p className="text-xs text-text-secondary">No speech services configured.</p>}
                                </>}
                        </div>
                    </div>

                    {/* Model (services that let you choose one) */}
                    {speechServiceConfigured && sttProvider in STT_MODEL_DEFAULTS && (
                        <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-2">
                            <label className="text-xs font-medium text-text-secondary block">Model</label>
                            <SttModelPicker
                                provider={sttProvider}
                                model={sttModelDraft[sttProvider] ?? ''}
                                apiKey=""
                                onChange={(model) => { setSttModelDraft({ ...sttModelDraft, [sttProvider]: model }); setSpeechResult(null); }}
                            />
                            <p className="text-[11px] text-text-tertiary">Leave empty for the default. The saved speech key is used to fetch the list.</p>
                        </div>
                    )}

                    <p className="text-xs text-text-secondary">
                        Keys and accounts are in <button type="button" onClick={onOpenProviders} className="text-primary hover:underline">Provider setup</button>.
                    </p>

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
                                disabled={speechSaving || !speechServiceConfigured}
                                className={primaryButton}
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

            <TranslationSettings languages={translationLanguageOptions} />

        </div>
    );
}
