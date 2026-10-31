import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { primaryButton, secondaryButton } from './buttonStyles';

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
    const { data: saved } = useQuery({ queryKey: ['answer-style'], queryFn: () => window.electronAPI.getAnswerStyle() });
    const [draft, setDraft] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const value = draft ?? saved ?? '';

    const save = useMutation({ mutationFn: async (style: string) => {
            const result = await window.electronAPI.setAnswerStyle(style);
            if (!result.success) throw new Error(result.error || 'Could not save');
        }, onSuccess: async () => {
                await queryClient.invalidateQueries({ queryKey: ['answer-style'] });
                setDraft(null);
            } });

    return (
        <div className="min-w-0 space-y-2">
            <button
                type="button"
                aria-expanded={expanded}
                aria-controls="answer-style-settings"
                onClick={() => setExpanded(!expanded)}
                className={secondaryButton}
            >
                How answers sound
            </button>
            <div id="answer-style-settings" hidden={!expanded} className="space-y-2">
                <p className="text-xs text-text-secondary">
                    Answers are written to be said out loud: short sentences, and a STAR shape for stories. Describe the voice, or name a person whose manner of speaking to borrow (only the manner, never their words or life). Empty means plain and conversational.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="text"
                        aria-label="How answers sound"
                        value={value}
                        maxLength={200}
                        onChange={(e) => { save.reset(); setDraft(e.target.value); }}
                        placeholder="Plain, direct and conversational"
                        className="min-w-0 flex-1 basis-48 h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                    />
                    <button
                        onClick={() => save.mutate(value)}
                        disabled={save.isPending || draft === null}
                        className={`${primaryButton} shrink-0 h-11`}
                    >
                        {save.isPending ? 'Saving…' : save.isSuccess && draft === null ? 'Saved!' : 'Save'}
                    </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => (
                        <button
                            key={preset}
                            onClick={() => { save.reset(); setDraft(preset); }}
                            className="px-2 py-1 rounded-full bg-bg-component border border-border-subtle text-[11px] text-text-secondary hover:text-text-primary transition-colors"
                        >
                            {preset}
                        </button>
                    ))}
                </div>
                {save.error ? <p className="text-[11px] text-state-danger">{(save.error as Error).message}</p> : null}
            </div>
        </div>
    );
};

export default AnswerStyleSettings;
