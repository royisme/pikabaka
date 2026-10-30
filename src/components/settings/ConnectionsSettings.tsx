import React, { useContext, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiConnectionType, AiConnectionView, HeaderEdit } from '../../types/electron';
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
// One row of the custom-header draft: a saved row keeps its name and only sends a value the user typed.
type HeaderRow = { name: string; value: string; saved: boolean; removed: boolean };

const HTTP_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Only the rules the user can fix here and the backend also enforces; reserved names, limits and
 * control characters stay with the backend, whose real message is shown. */
function headerRowError(rows: HeaderRow[], index: number): string | undefined {
    const row = rows[index];
    if (!row.saved) {
        if (!row.name) return 'Give the header a name.';
        if (!HTTP_TOKEN.test(row.name)) return "A header name uses letters, digits and !#$%&'*+-.^_`|~ only.";
        if (!row.value.trim()) return 'A new header needs a value.';
    }
    return rows.some((other, i) => i !== index && other.name.toLowerCase() === row.name.toLowerCase())
        ? 'Two headers cannot share a name; header names ignore case.' : undefined;
}

function headerEditsOf(rows: HeaderRow[]): HeaderEdit[] {
    return rows.flatMap((row): HeaderEdit[] => {
        if (row.saved) {
            if (row.removed) return [{ op: 'remove', name: row.name }];
            return [row.value.trim() ? { op: 'set', name: row.name, value: row.value } : { op: 'keep', name: row.name }];
        }
        return row.name && row.value.trim() ? [{ op: 'set', name: row.name, value: row.value }] : [];
    });
}

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
    const [headers, setHeaders] = useState<HeaderRow[]>((connection?.headers ?? []).map(header => ({ name: header.name, value: '', saved: true, removed: false })));
    const headerErrors = headers.map((_, index) => headerRowError(headers, index));
    const headerEdits = headerEditsOf(headers);
    const save = useMutation({ mutationFn: async () => {
        const result = await window.electronAPI.aiConnectionSave({ ...draft, apiKey: draft.apiKey || undefined, ...(headerEdits.length ? { headerEdits } : {}) });
        if (!result.success) throw new Error(result.error || 'Could not save provider');
    } });
    const test = useMutation({ mutationFn: async () => {
        const result = await window.electronAPI.aiConnectionModels({ id: draft.id, type: draft.type, baseUrl: draft.baseUrl, apiKey: draft.apiKey || undefined, ...(headerEdits.length ? { headerEdits } : {}) });
        if (!result.success) throw new Error(result.error || 'Could not fetch models');
        return `The host lists ${result.models?.length ?? 0} models.`;
    } });
    const busy = disabled || save.isPending || test.isPending;
    const change = (next: Partial<typeof draft>) => { setDraft({ ...draft, ...next }); save.reset(); test.reset(); };
    const changeHeaders = (next: HeaderRow[]) => { setHeaders(next); save.reset(); test.reset(); };
    const changeHeader = (index: number, next: Partial<HeaderRow>) => changeHeaders(headers.map((row, i) => i === index ? { ...row, ...next } : row));
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
            {!connection?.builtin && <div className="space-y-2 min-w-0">
                <p className="text-xs text-text-secondary">Custom headers (optional)</p>
                {!headers.length && <p className="text-xs text-text-secondary">No custom headers.</p>}
                {headers.map((row, index) => <div key={index} className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-end gap-2 min-w-0">
                        {row.saved
                            ? <div className="min-w-0 flex-1 basis-full min-[560px]:basis-0 space-y-1">
                                <p className="text-xs text-text-secondary">Name</p>
                                <p className="flex h-11 min-w-0 items-center gap-1.5 text-sm text-text-primary">
                                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{row.name}</span>
                                    {!row.removed && <><span aria-hidden="true" className="inline-block w-2 h-2 shrink-0 rounded-full bg-state-success" /><span className="text-[11px] text-text-secondary">set</span></>}
                                </p>
                            </div>
                            : <label className="min-w-0 flex-1 basis-full min-[560px]:basis-0 block text-xs text-text-secondary space-y-1">Name
                                <input aria-label={`Header ${index + 1} name`} value={row.name} onChange={e => changeHeader(index, { name: e.target.value })} className={field} />
                            </label>}
                        {row.removed
                            ? <p className="min-w-0 flex-1 basis-full min-[560px]:basis-0 text-xs text-text-primary">Removing on Save.</p>
                            : <label className="min-w-0 flex-1 basis-full min-[560px]:basis-0 block text-xs text-text-secondary space-y-1">Value
                                <input type="password" aria-label={`Header ${index + 1} value`} autoComplete="off" value={row.value} onChange={e => changeHeader(index, { value: e.target.value })} placeholder={row.saved ? 'Saved. Type to replace.' : undefined} className={field} />
                            </label>}
                        {row.removed
                            ? <button type="button" aria-label={`Keep ${row.name}`} onClick={() => changeHeader(index, { removed: false })} className={smallButton}>Keep</button>
                            : <button type="button" aria-label={row.saved ? `Remove ${row.name}` : 'Remove header'} onClick={() => row.saved ? changeHeader(index, { removed: true, value: '' }) : changeHeaders(headers.filter((_, i) => i !== index))} className={smallButton}>Remove</button>}
                    </div>
                    {headerErrors[index] && <p className="text-[11px] text-state-danger">{headerErrors[index]}</p>}
                </div>)}
                <button type="button" onClick={() => changeHeaders([...headers, { name: '', value: '', saved: false, removed: false }])} className={smallButton}>Add header</button>
            </div>}
        </fieldset>
        <p className="text-[11px] text-text-secondary">Asks the host for its model list. It does not check a model, images or tools.</p>
        <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || headerErrors.some(Boolean)} className={smallButton} onClick={() => test.mutate(undefined, {
                onSuccess: message => onTest({ success: true, message }),
                onError: error => onTest({ success: false, message: (error as Error).message }),
            })}>{test.isPending ? 'Testing…' : 'Test'}</button>
            <button type="button" disabled={busy || headerErrors.some(Boolean)} className="min-h-9 px-4 py-2 rounded-lg text-xs bg-primary text-on-primary disabled:opacity-50" onClick={() => {
                onBusy(true);
                save.mutate(undefined, { onSuccess: onSaved, onSettled: () => onBusy(false) });
            }}>{save.isPending ? 'Saving…' : 'Save'}</button>
            <button type="button" disabled={disabled || save.isPending} onClick={onClose} className={smallButton}>Cancel</button>
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
    const connections = useQuery({ queryKey: ['ai-connections'], queryFn: () => window.electronAPI.aiConnectionsList() });
    const uses = useQuery({ queryKey: ['connection-uses'], queryFn: async () => {
        const [chat, summary, agent, embedding, translation] = await Promise.all([
            window.electronAPI.chatModelGet(), window.electronAPI.summaryModelGet(), window.electronAPI.agentModelGet(),
            window.electronAPI.embeddingUseGet(), window.electronAPI.getTranscriptTranslationSettings(),
        ]);
        return [
            { name: 'Quick answers', connectionId: chat.connectionId }, { name: 'Summaries', connectionId: summary.connectionId },
            { name: 'Agent', connectionId: agent.connectionId }, { name: 'Search index', connectionId: embedding.connectionId },
            { name: 'Translation', connectionId: translation.provider },
        ];
    } });
    const [editor, setEditor] = useState<AiConnectionView | string | null>(navigation?.editorId ?? null);
    const [saving, setSaving] = useState(false);
    const [confirmId, setConfirmId] = useState<string>();
    const [results, setResults] = useState<Record<string, TestResult>>({});
    const changed = () => {
        void queryClient.invalidateQueries({ queryKey: ['ai-connections'] });
        void queryClient.invalidateQueries({ queryKey: ['connection-models'] });
        onChanged?.();
    };
    const remove = useMutation({ mutationFn: async (c: AiConnectionView) => {
        const result = c.builtin
            ? await window.electronAPI.aiConnectionSave({ id: c.id, baseUrl: '', apiKey: '' })
            : await window.electronAPI.aiConnectionDelete(c.id);
        if (!result.success) throw new Error(result.error || 'Could not remove provider');
    }, onSuccess: (_, c) => {
        setConfirmId(undefined);
        if (editor === c.id || (typeof editor === 'object' && editor?.id === c.id)) setEditor(null);
        setResults(previous => { const next = { ...previous }; delete next[c.id]; return next; });
        changed();
    } });
    const selected = typeof editor === 'object' ? editor ?? undefined : connections.data?.find(c => c.id === editor);
    const busy = saving || remove.isPending;
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
        {(editor === 'add' || selected) && <ProviderEditor key={selected?.id ?? 'add'} connection={selected} disabled={remove.isPending}
            onClose={() => setEditor(null)} onBusy={setSaving} onSaved={() => { setEditor(null); changed(); }}
            onTest={result => { if (selected) setResults(previous => ({ ...previous, [selected.id]: result })); }}
        />}
    </div>;
};
export default ConnectionsSettings;
