import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import ConnectionModelPicker from './ConnectionModelPicker';

type EmbeddingUse = { connectionId: string; model: string };

const SearchIndexSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: saved, error } = useQuery(['embedding-use'], () => window.electronAPI.embeddingUseGet());
    const status = useQuery(['embedding-status'], () => window.electronAPI.embeddingStatus());
    const [draft, setDraft] = useState<EmbeddingUse | null>(null);
    const value = draft ?? saved ?? { connectionId: '', model: '' };

    const save = useMutation(
        async (use: EmbeddingUse) => {
            const result = await window.electronAPI.embeddingUseSet(use);
            if (!result.success) throw new Error(result.error || 'Could not save');
        },
        {
            onSuccess: async () => {
                await queryClient.invalidateQueries(['embedding-use']);
                setDraft(null);
                rebuild.reset();
            },
            onSettled: () => queryClient.invalidateQueries(['embedding-status']),
        }
    );
    const rebuild = useMutation(
        async () => {
            const result = await window.electronAPI.reindexIncompatibleMeetings();
            if (!result.success) throw new Error(result.error || 'Could not rebuild the index');
        },
        { onSettled: () => queryClient.invalidateQueries(['embedding-status']) }
    );
    const current = status.data;
    const failure = save.error || rebuild.error || error || status.error;

    return (
        <section className="space-y-3">
            <h3 className="text-sm font-bold text-text-primary">Search index</h3>
            <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3">
                <p className="text-xs text-text-secondary">The embedding model makes meetings (transcript passages and summaries), your notes, resume and target roles searchable. One model serves both meetings and materials.</p>
                <fieldset disabled={save.isLoading || rebuild.isLoading} className="space-y-3 min-w-0">
                    <ConnectionModelPicker
                        id="embedding"
                        connectionId={value.connectionId}
                        model={value.model}
                        types={['openai', 'gemini']}
                        emptyLabel="Automatic"
                        onChange={(next) => { save.reset(); setDraft(next); }}
                    />
                    <p className="text-[11px] text-text-secondary">Automatic tries OpenAI, then Gemini, then Ollama nomic-embed-text, then the bundled on-device model.</p>
                    <button
                        onClick={() => save.mutate(value)}
                        disabled={!saved}
                        className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${save.isSuccess && !draft ? 'bg-state-success-soft text-state-success' : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary'}`}
                    >
                        {save.isLoading ? 'Saving…' : save.isSuccess && !draft ? 'Saved!' : 'Save'}
                    </button>
                </fieldset>
                <div className="space-y-2 text-xs text-text-secondary" aria-live="polite">
                    <p>{current?.providerName ? `● In use: ${current.providerName} (${current.dimensions} dimensions)` : status.isLoading ? '● Loading index status…' : '○ Search index unavailable: no embedding model is in use.'}</p>
                    {current?.selectedLabel && !current.usingSelected && current.providerName && (
                        <p className="text-state-warning-strong">▲ The chosen model did not answer; {current.providerName} is used instead.</p>
                    )}
                    {!!current?.incompatible && (
                        <div className="space-y-2">
                            <p>▲ {current.incompatible} past meetings are indexed with another model and are not searched until the index is rebuilt.</p>
                            <button
                                onClick={() => rebuild.mutate()}
                                disabled={save.isLoading || rebuild.isLoading}
                                className="px-4 py-2 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-40 transition-colors"
                            >
                                {rebuild.isLoading ? 'Rebuilding…' : 'Rebuild index'}
                            </button>
                        </div>
                    )}
                    {rebuild.isSuccess && <p>● Index rebuild queued. Meetings become searchable as indexing finishes.</p>}
                    {failure ? <p className="text-[11px] text-state-danger-strong">✕ {(failure as Error).message}</p> : null}
                </div>
            </div>
        </section>
    );
};

export default SearchIndexSettings;
