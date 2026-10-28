import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Check } from 'lucide-react';
import ConnectionModelPicker from './ConnectionModelPicker';
import TranslationTest from './TranslationTest';

const DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT =
    'You are a realtime subtitle translator. Preserve meaning, tone, technical terms, product names, numbers, and code tokens exactly when appropriate. Do not summarize, do not add explanations, and do not omit information. Return only the translated sentence(s), with no prefix/suffix and no markdown.';

type TranscriptAssemblerProfile = 'sentence_bias' | 'low_latency' | 'coherent';

const TRANSCRIPT_ASSEMBLER_PROFILE_OPTIONS: Array<{ value: TranscriptAssemblerProfile; label: string; desc: string }> = [
    { value: 'sentence_bias', label: 'Sentence-biased', desc: 'Balanced sentence completeness with moderate delay.' },
    { value: 'low_latency', label: 'Low-latency', desc: 'Fastest transcript updates, but long sentences may split earlier.' },
    { value: 'coherent', label: 'Coherent', desc: 'Most complete segments for translation; final subtitles may arrive 5-30s later.' },
];

type DisplayMode = 'original' | 'translated' | 'both';

type TranslationValues = {
    enabled: boolean;
    provider: string;
    model: string;
    prompt: string;
    displayMode: DisplayMode;
    sourceLanguage: string;
    targetLanguage: string;
};

const fieldLabel = 'text-xs font-medium text-text-secondary block';
const field = 'w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors';
const quietButton = 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary transition-colors';
const disclosureButton = 'bg-bg-component hover:bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-xs font-medium text-text-primary transition-colors';

/**
 * Recorded speech is translated after the fact. What is shown is a draft over the saved settings; Save
 * sends all seven fields at once, as the transcript assembler reads them. Segmentation applies on press.
 */
const TranslationSettings = ({ languages }: { languages: Array<{ value: string; label: string }> }) => {
    const { data: credentials } = useQuery(
        ['speech-credentials'],
        () => window.electronAPI.getStoredCredentials(),
        { enabled: !!window.electronAPI?.getStoredCredentials }
    );
    const savedProfile = useQuery<TranscriptAssemblerProfile>(
        ['transcript-assembler-profile'],
        async () => (await window.electronAPI.getTranscriptAssemblerProfile()) || 'sentence_bias',
        { enabled: !!window.electronAPI?.getTranscriptAssemblerProfile }
    );

    const [draft, setDraft] = useState<Partial<TranslationValues>>({});
    const [profileDraft, setProfileDraft] = useState<TranscriptAssemblerProfile | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [savedShown, setSavedShown] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const value: TranslationValues = {
        enabled: draft.enabled ?? !!credentials?.transcriptTranslationEnabled,
        provider: draft.provider ?? credentials?.transcriptTranslationProvider ?? 'ollama',
        model: draft.model ?? credentials?.transcriptTranslationModel ?? '',
        prompt: draft.prompt ?? (credentials?.transcriptTranslationPrompt ? credentials.transcriptTranslationPrompt : DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT),
        displayMode: draft.displayMode ?? credentials?.transcriptTranslationDisplayMode ?? 'original',
        sourceLanguage: draft.sourceLanguage ?? (typeof credentials?.transcriptTranslationSourceLanguage === 'string' ? credentials.transcriptTranslationSourceLanguage : 'auto'),
        targetLanguage: draft.targetLanguage ?? credentials?.transcriptTranslationTargetLanguage ?? 'chinese',
    };
    const profile = profileDraft ?? savedProfile.data ?? 'sentence_bias';
    const change = (patch: Partial<TranslationValues>) => setDraft((previous) => ({ ...previous, ...patch }));

    const save = async () => {
        setSaveError(null);
        try {
            await window.electronAPI.setTranscriptTranslationSettings(value);
            setSavedShown(true);
            setTimeout(() => setSavedShown(false), 2000);
        } catch (error) {
            setSaveError((error as Error).message || 'Could not save the translation settings');
        }
    };

    const chooseProfile = async (next: TranscriptAssemblerProfile) => {
        setProfileDraft(next);
        try {
            const result = await window.electronAPI.setTranscriptAssemblerProfile(next);
            if (!result.success) setProfileDraft(null);
        } catch {
            setProfileDraft(null);
        }
    };

    return (
        <div className="min-w-0 bg-bg-card rounded-xl border border-border-subtle p-4">
            <h3 className="text-lg font-bold text-text-primary mb-1">Translation</h3>
            <p className="text-xs text-text-secondary mb-5">STT is realtime. Translation is applied asynchronously to final interviewer segments.</p>

            <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <label className={fieldLabel}>Enable Translation</label>
                        <p className="text-[11px] text-text-tertiary mt-1">Choose a connection and model below.</p>
                    </div>
                    <button
                        type="button"
                        aria-label="Enable translation"
                        aria-pressed={value.enabled}
                        onClick={() => change({ enabled: !value.enabled })}
                        className="text-xs bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-md shrink-0"
                    >
                        {value.enabled ? '● On' : '○ Off'}
                    </button>
                </div>

                <div className="space-y-1.5">
                    <label htmlFor="translation-target-language" className={fieldLabel}>Target language</label>
                    <select
                        id="translation-target-language"
                        value={value.targetLanguage}
                        onChange={(event) => change({ targetLanguage: event.target.value })}
                        className={field}
                    >
                        {languages.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>

                <div className="space-y-1.5">
                    <label className={fieldLabel}>Translation model</label>
                    <ConnectionModelPicker
                        id="translation"
                        connectionId={value.provider}
                        model={value.model}
                        onChange={(next) => change({ provider: next.connectionId, model: next.model })}
                    />
                    <p className="text-[11px] text-text-tertiary">Add connections and their API keys in Provider setup.</p>
                    <TranslationTest
                        provider={value.provider}
                        model={value.model}
                        prompt={value.prompt}
                        targetLanguage={value.targetLanguage}
                    />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button
                        onClick={() => void save()}
                        className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${savedShown ? 'bg-state-success-soft text-state-success' : quietButton}`}
                    >
                        {savedShown ? '✓ Saved' : 'Save Translation Settings'}
                    </button>
                    <p className="text-[11px] text-text-tertiary sm:pl-1">Only final interviewer transcript segments are translated.</p>
                </div>
                {saveError ? <p role="alert" className="text-[11px] text-state-danger break-words [overflow-wrap:anywhere]">{saveError}</p> : null}

                <div className="space-y-3">
                    <button
                        type="button"
                        aria-expanded={showAdvanced}
                        aria-controls="translation-advanced"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className={disclosureButton}
                    >
                        Advanced
                    </button>
                    <div id="translation-advanced" hidden={!showAdvanced} className="space-y-4">
                        <div className="space-y-1.5">
                            <label htmlFor="translation-source-language" className={fieldLabel}>Source language hint</label>
                            <select
                                id="translation-source-language"
                                value={value.sourceLanguage}
                                onChange={(event) => change({ sourceLanguage: event.target.value })}
                                className={field}
                            >
                                <option value="auto">Auto-detect (recommended)</option>
                                {languages.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <p className="text-[11px] text-text-tertiary leading-snug">
                                Guides the translation model. When no language is detected, this is also used to skip translation if it matches the target language.
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <label htmlFor="translation-display-mode" className={fieldLabel}>Display Mode</label>
                            <select
                                id="translation-display-mode"
                                value={value.displayMode}
                                onChange={(event) => change({ displayMode: event.target.value as DisplayMode })}
                                className={field}
                            >
                                <option value="original">Original Only</option>
                                <option value="translated">Translation Only</option>
                                <option value="both">Original + Translation</option>
                            </select>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <label htmlFor="translation-prompt" className={fieldLabel}>Translation Prompt</label>
                                <button
                                    type="button"
                                    onClick={() => change({ prompt: DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT })}
                                    className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
                                >
                                    Reset to Default
                                </button>
                            </div>
                            <textarea
                                id="translation-prompt"
                                value={value.prompt}
                                onChange={(event) => change({ prompt: event.target.value })}
                                rows={4}
                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors resize-y"
                            />
                        </div>

                        <div>
                            <h4 className="text-sm font-bold text-text-primary mb-1">Transcript Segmentation</h4>
                            <p className="text-xs text-text-secondary mb-3">Choose how patiently Pika buffers final speech segments before translation.</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {TRANSCRIPT_ASSEMBLER_PROFILE_OPTIONS.map((option) => {
                                    const selected = profile === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            id={`translation-segmentation-${option.value}`}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() => void chooseProfile(option.value)}
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
    );
};

export default TranslationSettings;
