import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const quietButton = 'px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-component text-xs font-medium text-text-secondary hover:bg-bg-input hover:text-text-primary disabled:opacity-50';

type AnswerSources = { meetings: boolean; materials: boolean };

const ROWS: Array<{ key: keyof AnswerSources; label: string; sentence: string }> = [
    { key: 'meetings', label: 'Past meetings', sentence: 'Pika may search your recorded meetings when you ask a question.' },
    { key: 'materials', label: 'Materials (notes and documents)', sentence: 'Pika may search your notes and imported documents when you ask a question. Off until you turn it on.' },
];

/**
 * The two "Use when answering" switches on the Sources page. Their defaults are whatever the main
 * process reports; nothing is turned on here before that reply arrives.
 */
const AnswerSourcesSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const sources = useQuery({ queryKey: ['answer-sources'], queryFn: () => window.electronAPI.getAnswerSources() });
    const save = useMutation({ mutationFn: async ({ key, value }: { key: keyof AnswerSources; value: boolean }) => {
            const result = await window.electronAPI.setAnswerSources({ [key]: value });
            if (!result.success) throw new Error(result.error || 'Could not save');
        }, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['answer-sources'] }) });
    const queryError = sources.error instanceof Error ? sources.error.message : sources.error ? String(sources.error) : '';
    const saveError = save.error instanceof Error ? save.error.message : save.error ? String(save.error) : '';
    // Nothing is assumed before the reply: an unreported state is neither On nor Off.
    const stateText = sources.isLoading ? '○ Loading…' : '○ Unknown';
    return (
        <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-3">
            <h4 className="text-sm font-semibold text-text-primary">Use when answering</h4>
            {ROWS.map(({ key, label, sentence }) => {
                const on = sources.data?.[key] === true;
                return (
                    <div key={key} className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-xs font-medium text-text-primary">{label}</p>
                            <p className="text-xs text-text-secondary">{sentence}</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-label={`Use ${label} when answering`}
                            aria-checked={on}
                            disabled={sources.data === undefined || save.isPending}
                            onClick={() => {
                                save.reset();
                                save.mutate({ key, value: !on });
                            }}
                            className={quietButton}
                        >
                            {sources.data === undefined ? stateText : on ? '● On' : '○ Off'}
                        </button>
                    </div>
                );
            })}
            {queryError ? <p role="alert" className="text-xs text-text-primary">✕ {queryError}</p> : null}
            {saveError ? <p role="alert" className="text-xs text-text-primary">✕ {saveError}</p> : null}
        </div>
    );
};

export default AnswerSourcesSettings;
