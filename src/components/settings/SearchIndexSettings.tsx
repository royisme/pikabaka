import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import ConnectionModelPicker from './ConnectionModelPicker';

type EmbeddingUse = { connectionId: string; model: string };

const SearchIndexSettings: React.FC = () => {
    const queryClient = useQueryClient();
    const { data: saved, error } = useQuery(['embedding-use'], () => window.electronAPI.embeddingUseGet());
    const status = useQuery(['embedding-status'], () => window.electronAPI.embeddingStatus(), { refetchInterval: 2000 });
    const queue = useQuery(['embedding-queue'], () => window.electronAPI.ragGetQueueStatus(), { refetchInterval: 2000 });
    const [confirmCount, setConfirmCount] = useState<number | null>(null);
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
                retry.reset();
                reindex.reset();
                setConfirmCount(null);
            },
            onSettled: () => Promise.all([
                queryClient.invalidateQueries(['embedding-status']),
                queryClient.invalidateQueries(['profile', 'status']),
                queryClient.invalidateQueries(['knowledge-documents']),
            ]),
        }
    );
    const rebuild = useMutation(
        async () => {
            const result = await window.electronAPI.reindexIncompatibleMeetings();
            if (!result.success) throw new Error(result.error || 'Could not rebuild the index');
        },
        { onSettled: () => queryClient.invalidateQueries(['embedding-status']) }
    );
    const refresh = () => Promise.all([
        queryClient.invalidateQueries(['embedding-status']),
        queryClient.invalidateQueries(['embedding-queue']),
        queryClient.invalidateQueries(['profile', 'status']),
    ]);
    const retry = useMutation(
        async () => {
            const result = await window.electronAPI.ragRetryEmbeddings();
            if (!result.success) throw new Error(result.error || 'Could not retry failed meetings');
        },
        { onSettled: refresh }
    );
    const reindex = useMutation(
        async () => {
            const result = await window.electronAPI.reindexAllMeetings();
            if (!result.success) throw new Error(result.error || 'Could not re-index all meetings');
        },
        { onSettled: refresh }
    );
    const current = status.data;
    const busy = save.isLoading || rebuild.isLoading || retry.isLoading || reindex.isLoading;
    const failure = save.error || rebuild.error || retry.error || reindex.error || error || status.error || queue.error;

    return (
        <section className="space-y-3">
            <h3 className="text-sm font-bold text-text-primary">Search index</h3>
            <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3">
                <p className="text-xs text-text-secondary">The embedding model makes meetings (transcript passages and summaries), your notes, imported documents, resume and target roles searchable. One model serves both meetings and materials.</p>
                <fieldset disabled={busy} className="space-y-3 min-w-0">
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
                <div className="space-y-2 text-xs text-text-secondary min-w-0 break-words" aria-live="polite">
                    <p>{current?.providerName ? `● In use: ${current.providerName} (${current.dimensions} dimensions)` : status.isLoading ? '● Loading index status…' : '○ Search index unavailable: no embedding model is in use.'}</p>
                    {current?.selectedLabel && !current.usingSelected && current.providerName && (
                        <p className="text-state-warning-strong">▲ The chosen model did not answer; {current.providerName} is used instead.</p>
                    )}
                    {!!current?.incompatible && (
                        <div className="space-y-2">
                            <p>▲ {current.incompatible} past meetings are indexed with another model and are not searched until the index is rebuilt.</p>
                            <button
                                onClick={() => rebuild.mutate()}
                                disabled={busy}
                                className="px-4 py-2 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-40 transition-colors"
                            >
                                {rebuild.isLoading ? 'Rebuilding…' : 'Rebuild index'}
                            </button>
                        </div>
                    )}
                    {queue.data && <p>● Jobs: {queue.data.pending} pending · {queue.data.processing} processing · {queue.data.completed} completed · {queue.data.failed} failed</p>}
                    {!!current?.failedMeetings && (
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="min-w-0 flex-1 basis-full min-[560px]:basis-auto">
                                <p>✕ {current.failedMeetings} meetings failed</p>
                                {current.firstError && <p>{current.firstError}</p>}
                            </div>
                            <button
                                onClick={() => { reindex.reset(); retry.mutate(); }}
                                disabled={busy}
                                className="px-4 py-2 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-40 transition-colors"
                            >
                                {retry.isLoading ? 'Retrying…' : 'Retry failed'}
                            </button>
                        </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={() => {
                                if (confirmCount === null) setConfirmCount(current!.meetingCount);
                                else { setConfirmCount(null); retry.reset(); reindex.mutate(); }
                            }}
                            disabled={busy || !current}
                            className="px-4 py-2 rounded-lg text-xs font-medium bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-40 transition-colors"
                        >
                            {reindex.isLoading ? 'Re-indexing…' : confirmCount === null ? 'Re-index all' : `Re-index ${confirmCount} meetings?`}
                        </button>
                        <p className="min-w-0">Re-embeds saved meetings and notes with the model in use.</p>
                    </div>
                    {rebuild.isSuccess && <p>● Index rebuild queued. Meetings become searchable as indexing finishes.</p>}
                    {retry.isSuccess && <p>● Retry requested. Check the job counts above.</p>}
                    {reindex.isSuccess && <p>● Re-index requested. Queued work is not indexed until completed.</p>}
                    {failure ? <p className="text-[11px] text-state-danger-strong">✕ {(failure as Error).message}</p> : null}
                </div>
            </div>
        </section>
    );
};

export default SearchIndexSettings;
