import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';

const PRESETS = [
    'Direct and first-principles, short blunt sentences, like Elon Musk',
    'Calm and structured, one clear point at a time',
    'Warm and story-driven, plain words',
];

/**
 * How answers sound. Free text: a manner of speaking, or a person whose manner to borrow. Answers
 * are spoken-style short sentences built for the question (STAR for stories); this line sets the voice.
 */
const AnswerStyleSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: saved } = useQuery(['answer-style'], () => window.electronAPI.getAnswerStyle());
    const [draft, setDraft] = useState<string | null>(null);
    const value = draft ?? saved ?? '';

    const save = useMutation(
        async (style: string) => {
            const result = await window.electronAPI.setAnswerStyle(style);
            if (!result.success) throw new Error(result.error || 'Could not save');
        },
        {
            onSuccess: async () => {
                await queryClient.invalidateQueries(['answer-style']);
                setDraft(null);
            },
        }
    );

    return (
        <div className="px-4 py-3 space-y-2">
            <div>
                <h3 className="text-sm font-bold text-text-primary">How answers sound</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                    Answers are written to be said out loud: short sentences, and a STAR shape for stories. Describe the voice, or name a person whose manner of speaking to borrow (only the manner, never their words or life). Empty means plain and conversational.
                </p>
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={value}
                    maxLength={200}
                    onChange={(e) => { save.reset(); setDraft(e.target.value); }}
                    placeholder="Plain, direct and conversational"
                    className="w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                />
                <button
                    onClick={() => save.mutate(value)}
                    disabled={save.isLoading || draft === null}
                    className={`shrink-0 h-11 px-4 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${save.isSuccess && draft === null ? 'bg-state-success-soft text-state-success' : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary'}`}
                >
                    {save.isLoading ? 'Saving…' : save.isSuccess && draft === null ? 'Saved!' : 'Save'}
                </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((preset) => (
                    <button
                        key={preset}
                        onClick={() => { save.reset(); setDraft(preset); }}
                        className="px-2 py-1 rounded-full border border-border-subtle text-[11px] text-text-secondary hover:text-text-primary transition-colors"
                    >
                        {preset}
                    </button>
                ))}
            </div>
            {save.error ? <p className="text-[11px] text-state-danger">{(save.error as Error).message}</p> : null}
        </div>
    );
};

export default AnswerStyleSettings;
