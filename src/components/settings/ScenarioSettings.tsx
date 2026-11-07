import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { primaryButton, secondaryButton } from './buttonStyles';

const fieldClass = 'w-full min-w-0 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors';

/**
 * The one scenario: a short brief of what the conversation is, and optionally the language answers are
 * written in. Saved text applies to the next answer and the next card; Clear removes the scenario.
 */
const ScenarioSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: saved, error } = useQuery({ queryKey: ['scenario'], queryFn: () => window.electronAPI.getScenario() });
    const [brief, setBrief] = useState<string | null>(null);
    const [language, setLanguage] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const briefValue = brief ?? saved?.brief ?? '';
    const languageValue = language ?? saved?.answerLanguage ?? '';
    const maxLength = saved?.maxLength ?? 600;
    const overLimit = briefValue.length > maxLength;
    const dirty = brief !== null || language !== null;

    const save = useMutation({ mutationFn: async (next: { brief: string; answerLanguage: string }) => {
            const result = await window.electronAPI.setScenario(next);
            if (!result.success) throw new Error(result.error || 'Could not save');
        }, onSuccess: async () => {
                await queryClient.invalidateQueries({ queryKey: ['scenario'] });
                setBrief(null);
                setLanguage(null);
            } });

    return (
        <div className="min-w-0 space-y-2">
            <button
                type="button"
                aria-expanded={expanded}
                aria-controls="scenario-settings"
                onClick={() => setExpanded(!expanded)}
                className={secondaryButton}
            >
                Scenario
            </button>
            <div id="scenario-settings" hidden={!expanded} className="space-y-2">
                <p className="text-xs text-text-secondary">
                    Tell Pika what this conversation is, in a sentence or two. The answer language is the language you will say aloud; Pika adds a line in your reading language. Empty means follow the conversation.
                </p>
                <label htmlFor="scenario-brief" className="text-xs font-medium text-text-primary">What this conversation is</label>
                <textarea
                    id="scenario-brief"
                    value={briefValue}
                    rows={4}
                    spellCheck={false}
                    onChange={(e) => { save.reset(); setBrief(e.target.value); }}
                    placeholder="An online French class taught in Chinese; I answer the teacher's questions in French."
                    className={`${fieldClass} max-h-48 resize-y`}
                />
                <span className={`block text-[11px] ${overLimit ? 'text-state-danger' : 'text-text-tertiary'}`}>{briefValue.length} / {maxLength}</span>
                <label htmlFor="scenario-language" className="text-xs font-medium text-text-primary">Answer language</label>
                <input
                    id="scenario-language"
                    type="text"
                    value={languageValue}
                    onChange={(e) => { save.reset(); setLanguage(e.target.value); }}
                    placeholder="French"
                    className={`${fieldClass} h-11`}
                />
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => save.mutate({ brief: '', answerLanguage: '' })}
                        disabled={save.isPending || (!saved?.brief && !saved?.answerLanguage)}
                        className={secondaryButton}
                    >
                        Clear
                    </button>
                    <button
                        type="button"
                        onClick={() => save.mutate({ brief: briefValue, answerLanguage: languageValue })}
                        disabled={save.isPending || !dirty || overLimit}
                        className={primaryButton}
                    >
                        {save.isPending ? 'Saving…' : save.isSuccess && !dirty ? 'Saved!' : 'Save'}
                    </button>
                </div>
                {save.error || error ? <p role="alert" className="text-[11px] text-state-danger">✕ {((save.error || error) as Error).message}</p> : null}
            </div>
        </div>
    );
};

export default ScenarioSettings;
