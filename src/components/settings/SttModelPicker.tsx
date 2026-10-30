import React from 'react';
import { useQuery } from '@tanstack/react-query';
import ModelCombobox from './ModelCombobox';

export const STT_MODEL_DEFAULTS: Record<string, string> = {
    deepgram: 'nova-3',
    groq: 'whisper-large-v3-turbo',
    openai: 'gpt-4o-transcribe',
    elevenlabs: 'scribe_v2_realtime',
    soniox: 'stt-rt-v4',
};

interface SttModelPickerProps {
    provider: string;
    model: string;
    /** A key typed but not saved yet; the saved key is used when this is empty. */
    apiKey: string;
    onChange: (model: string) => void;
}

/** A speech service's model: its default unless one is typed or picked from what the service lists. */
const SttModelPicker: React.FC<SttModelPickerProps> = ({ provider, model, apiKey, onChange }) => {
    // On demand (the button), cached per service: another service never shows this one's list.
    const models = useQuery({ queryKey: ['stt-models', provider], queryFn: async () => {
            const result = await window.electronAPI.fetchSttModels(provider, apiKey || undefined);
            if (!result.success) throw new Error(result.error || 'Could not fetch models');
            return (result.models ?? []).map((m) => m.id);
        }, enabled: false, retry: false, gcTime: 5 * 60_000 });

    const note = models.isFetching
        ? { tone: 'info', text: 'Asking the service…' }
        : models.error
          ? { tone: 'error', text: (models.error as Error).message }
          : models.data
            ? { tone: 'info', text: `${models.data.length} models listed. You can also type any model id.` }
            : null;

    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-2">
                <ModelCombobox
                    value={model}
                    options={models.data ?? []}
                    onChange={onChange}
                    placeholder={`Default: ${STT_MODEL_DEFAULTS[provider] ?? ''}`}
                />
                <button
                    onClick={() => void models.refetch()}
                    disabled={models.isFetching}
                    className="h-11 px-3 shrink-0 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-40 transition-colors"
                >
                    Fetch
                </button>
            </div>
            {note && <p className={`text-[11px] ${note.tone === 'error' ? 'text-state-danger' : 'text-text-tertiary'}`}>{note.text}</p>}
        </div>
    );
};

export default SttModelPicker;
