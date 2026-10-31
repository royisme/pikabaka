import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { primaryButton } from './buttonStyles';

/**
 * Facts about the user or their work, one per line. They are searched like an imported document when a
 * question relates to them; a question they do not cover is answered without inventing a past.
 */
const NotesSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: saved } = useQuery({ queryKey: ['profile-notes'], queryFn: () => window.electronAPI.profileGetNotes() });
    const [draft, setDraft] = useState<string | null>(null);
    const value = draft ?? saved ?? '';

    const save = useMutation({ mutationFn: async (text: string) => {
            const result = await window.electronAPI.profileSetNotes(text);
            if (!result.success) throw new Error(result.error || 'Could not save');
        }, onSuccess: async () => {
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['profile-notes'] }),
                    queryClient.invalidateQueries({ queryKey: ['profile', 'status'] }),
                ]);
                setDraft(null);
            } });

    return (
        <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3">
            <div>
                <h4 className="text-sm font-bold text-text-primary mb-1">Notes about you</h4>
                <p className="text-xs text-text-secondary">
                    Optional. Facts about you or your work, one per line: a project and what you did, a number, a decision, why you moved on. When a question relates to them, they are searched and used in the answer. When nothing matches, the answer is given the way an expert in the field would answer, without inventing your past.
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
                    disabled={save.isPending || draft === null}
                    className={primaryButton}
                >
                    {save.isPending ? 'Saving…' : save.isSuccess && draft === null ? 'Saved!' : 'Save notes'}
                </button>
                {save.error ? <p className="text-[11px] text-state-danger">{(save.error as Error).message}</p> : null}
            </div>
        </div>
    );
};

export default NotesSettings;
