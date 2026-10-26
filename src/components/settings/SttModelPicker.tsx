import React, { useEffect, useState } from 'react';
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
    const [options, setOptions] = useState<string[]>([]);
    const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string }>({ tone: 'info', text: '' });

    useEffect(() => { setOptions([]); setNote({ tone: 'info', text: '' }); }, [provider]);

    const fetchModels = async () => {
        setNote({ tone: 'info', text: 'Asking the service…' });
        const result = await window.electronAPI.fetchSttModels(provider, apiKey || undefined);
        if (result.success) {
            setOptions((result.models ?? []).map((m) => m.id));
            setNote({ tone: 'info', text: `${result.models?.length ?? 0} models listed. You can also type any model id.` });
        } else {
            setNote({ tone: 'error', text: result.error || 'Could not fetch models' });
        }
    };

    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-2">
                <ModelCombobox
                    value={model}
                    options={options}
                    onChange={onChange}
                    placeholder={`Default: ${STT_MODEL_DEFAULTS[provider] ?? ''}`}
                />
                <button
                    onClick={fetchModels}
                    className="h-11 px-3 shrink-0 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
                >
                    Fetch
                </button>
            </div>
            {note.text && <p className={`text-[11px] ${note.tone === 'error' ? 'text-state-danger' : 'text-text-tertiary'}`}>{note.text}</p>}
        </div>
    );
};

export default SttModelPicker;
