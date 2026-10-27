import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';

/**
 * Facts about the user that a resume does not hold: one per line. They are searched like the resume
 * when a question is about the user; a question they do not cover is answered with brackets to fill in,
 * never with invented experience.
 */
const NotesSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: saved } = useQuery(['profile-notes'], () => window.electronAPI.profileGetNotes());
    const [draft, setDraft] = useState<string | null>(null);
    const value = draft ?? saved ?? '';

    const save = useMutation(
        async (text: string) => {
            const result = await window.electronAPI.profileSetNotes(text);
            if (!result.success) throw new Error(result.error || 'Could not save');
        },
        {
            onSuccess: async () => {
                await queryClient.invalidateQueries(['profile-notes']);
                setDraft(null);
            },
        }
    );

    return (
        <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3">
            <div>
                <h4 className="text-sm font-bold text-text-primary mb-1">Notes about you</h4>
                <p className="text-xs text-text-secondary">
                    Facts your resume does not say, one per line: a project and what you did, a number, a decision, why you left a job. When a question is about you, these are searched like your resume. When nothing matches, the answer leaves [brackets] and ends with "Not in your notes: …" instead of inventing something.
                </p>
            </div>
            <textarea
                value={value}
                onChange={(e) => { save.reset(); setDraft(e.target.value); }}
                rows={8}
                maxLength={20000}
                placeholder={'Led the billing migration at the last company: moved 40 services, no downtime.\nCut the monthly close from 5 days to 2 by automating reconciliation.'}
                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors resize-y"
            />
            <div className="flex flex-wrap items-center gap-2">
                <button
                    onClick={() => save.mutate(value)}
                    disabled={save.isLoading || draft === null}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${save.isSuccess && draft === null ? 'bg-state-success-soft text-state-success' : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary'}`}
                >
                    {save.isLoading ? 'Saving…' : save.isSuccess && draft === null ? 'Saved!' : 'Save notes'}
                </button>
                {save.error ? <p className="text-[11px] text-state-danger">{(save.error as Error).message}</p> : null}
            </div>
        </div>
    );
};

export default NotesSettings;
