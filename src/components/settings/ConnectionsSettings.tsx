import React, { useContext, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import type { AiConnectionType, AiConnectionView } from '../../types/electron';
import { connectionNeedsKey } from '../../../electron/services/aiConnections';
import { configuredProvider, interfaceLabel, ProviderNavigation } from './ConnectionModelPicker';

const TYPE_HINT: Record<AiConnectionType, string> = {
    openai: 'OpenAI, Groq, OpenRouter, DeepSeek, a gateway of your own, Ollama and LM Studio speak this interface.',
    anthropic: 'Claude and compatible services speak this interface.',
    gemini: 'Gemini speaks this interface.',
};
const DEFAULT_HOST: Record<AiConnectionType, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    gemini: 'https://generativelanguage.googleapis.com',
};
const field = 'w-full h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary';
const smallButton = 'min-h-9 px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-bg-component text-text-secondary hover:text-text-primary disabled:opacity-50';
type TestResult = { success: boolean; message: string };
type Uses = Array<{ name: string; connectionId: string }>;

export function ProviderList({ connections, uses, results, busyId, confirmId, canDelete = true, onEdit, onRemove, onConfirm }: {
    connections: AiConnectionView[]; uses: Uses; results: Record<string, TestResult>;
    busyId?: string; confirmId?: string; canDelete?: boolean;
    onEdit: (c: AiConnectionView) => void; onRemove: (c: AiConnectionView) => void; onConfirm: (id?: string) => void;
}) {
    const visible = connections.filter(configuredProvider);
    return <div>
        {!visible.length && <p className="p-4 text-xs text-text-secondary">No providers yet. Add one to use a model.</p>}
        {visible.map(c => {
            const usedBy = uses.filter(use => use.connectionId === c.id).map(use => use.name);
            const result = results[c.id];
            return <div key={c.id} className="p-4 border-t border-border-subtle flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => onEdit(c)} disabled={!!busyId} className="min-w-0 flex-1 basis-full sm:basis-0 text-left space-y-1">
                    <span className="block text-sm font-medium text-text-primary break-words [overflow-wrap:anywhere]">{c.name}</span>
                    <span className="block text-xs text-text-secondary break-words [overflow-wrap:anywhere]">{interfaceLabel[c.type]} · {c.baseUrl.replace(/^https?:\/\//i, '')}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                        <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${c.hasApiKey ? 'bg-state-success' : 'border border-text-tertiary'}`} />
                        {c.hasApiKey ? 'Key saved' : connectionNeedsKey(c.baseUrl) ? 'No key' : 'No key needed'}
                    </span>
                    {result && <span className="block text-xs text-text-primary break-words [overflow-wrap:anywhere]">{result.success ? '●' : '✕ Test failed:'} {result.message}</span>}
                    {!c.builtin && usedBy.length > 0 && <span className="block text-[11px] text-text-secondary">Used by {usedBy.join(', ')}</span>}
                </button>
                {c.builtin ? <button type="button" disabled={!!busyId} onClick={() => onRemove(c)} className={smallButton}>{busyId === c.id ? 'Saving…' : 'Remove key and reset host'}</button>
                    : confirmId === c.id ? <div className="flex flex-wrap items-center gap-2 text-xs text-text-primary min-w-0">
                        <span className="break-words [overflow-wrap:anywhere]">Delete {c.name}?</span>
                        <button type="button" disabled={!!busyId || !canDelete || !!usedBy.length} onClick={() => onRemove(c)} className={smallButton}>{busyId === c.id ? 'Deleting…' : 'Delete'}</button>
                        <button type="button" disabled={!!busyId} onClick={() => onConfirm()} className={smallButton}>Keep</button>
                    </div> : <button type="button" aria-label={`Delete ${c.name}`} disabled={!!busyId || !canDelete || !!usedBy.length} onClick={() => onConfirm(c.id)} className={smallButton}>Delete</button>}
            </div>;
        })}
    </div>;
}

export function ProviderEditor({ connection, onClose, onSaved, onTest, onBusy, disabled = false }: {
    connection?: AiConnectionView; disabled?: boolean; onClose: () => void; onSaved: () => void;
    onTest: (result: TestResult) => void; onBusy: (busy: boolean) => void;
}) {
    const [draft, setDraft] = useState({
        id: connection?.id, type: connection?.type ?? 'openai' as AiConnectionType,
        name: connection?.name ?? '', baseUrl: connection?.baseUrl ?? DEFAULT_HOST.openai, apiKey: '',
    });
    const save = useMutation(async () => {
        const result = await window.electronAPI.aiConnectionSave({ ...draft, apiKey: draft.apiKey || undefined });
        if (!result.success) throw new Error(result.error || 'Could not save provider');
    });
    const test = useMutation(async () => {
        const result = await window.electronAPI.aiConnectionModels({ id: draft.id, type: draft.type, baseUrl: draft.baseUrl, apiKey: draft.apiKey || undefined });
        if (!result.success) throw new Error(result.error || 'Could not fetch models');
        return `The host lists ${result.models?.length ?? 0} models.`;
    });
    const busy = disabled || save.isLoading || test.isLoading;
    const change = (next: Partial<typeof draft>) => { setDraft({ ...draft, ...next }); save.reset(); test.reset(); };
    return <section className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3">
        <h4 className="text-sm font-bold text-text-primary">{connection ? `Edit ${connection.name}` : 'Add provider'}</h4>
        <fieldset disabled={busy} className="space-y-3 min-w-0">
            <label className="block text-xs text-text-secondary space-y-1">Interface
                {connection ? <input readOnly value={interfaceLabel[draft.type]} className={field} /> : <select value={draft.type} onChange={e => {
                    const type = e.target.value as AiConnectionType;
                    change({ type, baseUrl: DEFAULT_HOST[type] });
                }} className={field}>{(Object.keys(interfaceLabel) as AiConnectionType[]).map(type => <option key={type} value={type}>{interfaceLabel[type]}</option>)}</select>}
            </label>
            <p className="text-[11px] text-text-tertiary">{TYPE_HINT[draft.type]}</p>
            <label className="block text-xs text-text-secondary space-y-1">Name<input value={draft.name} readOnly={connection?.builtin} onChange={e => change({ name: e.target.value })} className={field} /></label>
            <label className="block text-xs text-text-secondary space-y-1">Base URL<input value={draft.baseUrl} onChange={e => change({ baseUrl: e.target.value })} className={field} /></label>
            <label className="block text-xs text-text-secondary space-y-1">API key<input type="password" autoComplete="off" value={draft.apiKey} onChange={e => change({ apiKey: e.target.value })} placeholder={connection?.hasApiKey ? 'Saved. Leave empty to keep it.' : 'Optional for a local address'} className={field} /></label>
        </fieldset>
        <p className="text-[11px] text-text-secondary">Asks the host for its model list. It does not check a model, images or tools.</p>
        <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={smallButton} onClick={() => test.mutate(undefined, {
                onSuccess: message => onTest({ success: true, message }),
                onError: error => onTest({ success: false, message: (error as Error).message }),
            })}>{test.isLoading ? 'Testing…' : 'Test'}</button>
            <button type="button" disabled={busy} className="min-h-9 px-4 py-2 rounded-lg text-xs bg-primary text-on-primary disabled:opacity-50" onClick={() => {
                onBusy(true);
                save.mutate(undefined, { onSuccess: onSaved, onSettled: () => onBusy(false) });
            }}>{save.isLoading ? 'Saving…' : 'Save'}</button>
            <button type="button" disabled={disabled || save.isLoading} onClick={onClose} className={smallButton}>Cancel</button>
        </div>
        <div aria-live="polite" className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">
            {test.isError ? <p>✕ Test failed: {(test.error as Error).message}</p> : test.data ? <p>● {test.data}</p> : null}
            {save.isError && <p role="alert">✕ {(save.error as Error).message}</p>}
        </div>
    </section>;
}

const ConnectionsSettings: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
    const queryClient = useQueryClient();
    const navigation = useContext(ProviderNavigation);
    const connections = useQuery(['ai-connections'], () => window.electronAPI.aiConnectionsList());
    const uses = useQuery(['connection-uses'], async () => {
        const [chat, summary, agent, embedding, translation] = await Promise.all([
            window.electronAPI.chatModelGet(), window.electronAPI.summaryModelGet(), window.electronAPI.agentModelGet(),
            window.electronAPI.embeddingUseGet(), window.electronAPI.getTranscriptTranslationSettings(),
        ]);
        return [
            { name: 'Quick answers', connectionId: chat.connectionId }, { name: 'Summaries', connectionId: summary.connectionId },
            { name: 'Agent', connectionId: agent.connectionId }, { name: 'Search index', connectionId: embedding.connectionId },
            { name: 'Translation', connectionId: translation.provider },
        ];
    });
    const [editor, setEditor] = useState<AiConnectionView | string | null>(navigation?.editorId ?? null);
    const [saving, setSaving] = useState(false);
    const [confirmId, setConfirmId] = useState<string>();
    const [results, setResults] = useState<Record<string, TestResult>>({});
    const changed = () => {
        void queryClient.invalidateQueries(['ai-connections']);
        void queryClient.invalidateQueries(['connection-models']);
        onChanged?.();
    };
    const remove = useMutation(async (c: AiConnectionView) => {
        const result = c.builtin
            ? await window.electronAPI.aiConnectionSave({ id: c.id, baseUrl: '', apiKey: '' })
            : await window.electronAPI.aiConnectionDelete(c.id);
        if (!result.success) throw new Error(result.error || 'Could not remove provider');
    }, { onSuccess: (_, c) => {
        setConfirmId(undefined);
        if (editor === c.id || (typeof editor === 'object' && editor?.id === c.id)) setEditor(null);
        setResults(previous => { const next = { ...previous }; delete next[c.id]; return next; });
        changed();
    } });
    const selected = typeof editor === 'object' ? editor ?? undefined : connections.data?.find(c => c.id === editor);
    const busy = saving || remove.isLoading;
    return <div className="space-y-5">
        <section className="bg-bg-item-surface rounded-xl border border-border-subtle">
            <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-text-primary">Language model providers</h3>
                <button type="button" disabled={busy} onClick={() => { remove.reset(); setEditor('add'); }} className={smallButton}>Add provider</button>
            </div>
            {connections.isLoading ? <p className="p-4 text-xs text-text-secondary">Loading providers…</p> : connections.isError ? <p role="alert" className="p-4 text-xs text-text-primary">✕ {(connections.error as Error).message}</p> : <ProviderList
                connections={connections.data ?? []} uses={uses.data ?? []} results={results} busyId={busy ? remove.variables?.id ?? 'saving' : undefined}
                confirmId={confirmId} canDelete={uses.isSuccess && !uses.isFetching}
                onEdit={c => { remove.reset(); setEditor(c); }} onRemove={c => remove.mutate(c)} onConfirm={setConfirmId}
            />}
            {uses.isError && <p role="alert" className="p-4 text-xs text-text-primary">✕ Could not check provider uses: {(uses.error as Error).message}</p>}
            {remove.isError && <p role="alert" className="p-4 text-xs text-text-primary">✕ {(remove.error as Error).message}</p>}
        </section>
        {(editor === 'add' || selected) && <ProviderEditor key={selected?.id ?? 'add'} connection={selected} disabled={remove.isLoading}
            onClose={() => setEditor(null)} onBusy={setSaving} onSaved={() => { setEditor(null); changed(); }}
            onTest={result => { if (selected) setResults(previous => ({ ...previous, [selected.id]: result })); }}
        />}
    </div>;
};
export default ConnectionsSettings;
