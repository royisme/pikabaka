import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ConnectionModelPicker from './ConnectionModelPicker';
import { primaryButton } from './buttonStyles';

type CorrectionValues = { enabled: boolean; provider: string; model: string };

const fieldLabel = 'text-xs font-medium text-text-secondary block';

/**
 * A model fixes clearly misheard words in a line once it is final, from the lines before it. What is
 * shown is a draft over the saved settings; Save sends all three fields.
 */
const CorrectionSettings = () => {
    const { data: credentials } = useQuery({ queryKey: ['speech-credentials'], queryFn: () => window.electronAPI.getStoredCredentials(), enabled: !!window.electronAPI?.getStoredCredentials });
    const [draft, setDraft] = useState<Partial<CorrectionValues>>({});
    const [savedShown, setSavedShown] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const value: CorrectionValues = {
        enabled: draft.enabled ?? !!credentials?.transcriptCorrectionEnabled,
        provider: draft.provider ?? credentials?.transcriptCorrectionProvider ?? 'ollama',
        model: draft.model ?? credentials?.transcriptCorrectionModel ?? '',
    };
    const change = (patch: Partial<CorrectionValues>) => setDraft((previous) => ({ ...previous, ...patch }));

    const save = async () => {
        setSaveError(null);
        setSavedShown(false);
        try {
            const result = await window.electronAPI.setTranscriptCorrectionSettings(value);
            if (!result.success) throw new Error(result.error || 'Could not save the correction settings');
            setSavedShown(true);
            setTimeout(() => setSavedShown(false), 2000);
        } catch (error) {
            setSaveError((error as Error).message || 'Could not save the correction settings');
        }
    };

    return (
        <div className="min-w-0 bg-bg-card rounded-xl border border-border-subtle p-4">
            <h3 className="text-lg font-bold text-text-primary mb-1">Fix misheard words</h3>
            <p className="text-xs text-text-secondary mb-5">After a line is final, a model fixes words the recognizer clearly misheard, using the earlier lines as context. The original stays available on hover. A failure keeps the line as heard.</p>

            <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <label className={fieldLabel}>Fix misheard words</label>
                        <p className="text-[11px] text-text-tertiary mt-1">Off by default. Choose a connection and model below.</p>
                    </div>
                    <button
                        type="button"
                        aria-label="Fix misheard words"
                        aria-pressed={value.enabled}
                        onClick={() => change({ enabled: !value.enabled })}
                        className="text-xs bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-md shrink-0"
                    >
                        {value.enabled ? '● On' : '○ Off'}
                    </button>
                </div>

                <div className="space-y-1.5">
                    <label className={fieldLabel}>Correction model</label>
                    <ConnectionModelPicker
                        id="correction"
                        connectionId={value.provider}
                        model={value.model}
                        onChange={(next) => change({ provider: next.connectionId, model: next.model })}
                    />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button onClick={() => void save()} className={primaryButton}>
                        {savedShown ? '✓ Saved' : 'Save Correction Settings'}
                    </button>
                </div>
                {saveError ? <p role="alert" className="text-[11px] text-state-danger break-words [overflow-wrap:anywhere]">{saveError}</p> : null}
            </div>
        </div>
    );
};

export default CorrectionSettings;
