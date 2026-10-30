import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const field = 'w-full min-w-0 h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary';
const smallButton = 'min-h-9 px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-bg-component text-text-secondary hover:text-text-primary disabled:opacity-50';

const DecisionServiceSettings = () => {
    const queryClient = useQueryClient();
    const settings = useQuery({ queryKey: ['agent-gate-settings'], queryFn: () => window.electronAPI.agentGateGetSettings() });
    const [draft, setDraft] = useState<{ baseUrl?: string; apiKey?: string }>({});
    const baseUrl = draft.baseUrl ?? settings.data?.baseUrl ?? '';
    const apiKey = draft.apiKey ?? '';
    const [confirmRemove, setConfirmRemove] = useState(false);
    const refresh = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agent-gate-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-gate-status'] }),
    ]);
    const save = useMutation({ mutationFn: async () => {
        const result = await window.electronAPI.agentGateSetSettings({ baseUrl, ...(apiKey ? { apiKey } : {}) });
        if (!result.success) throw new Error(result.error || 'Could not save');
    }, onSuccess: async () => {
        await refresh();
        setDraft({});
    } });
    const test = useMutation({ mutationFn: async () => {
        const result = await window.electronAPI.agentGateTest({ baseUrl, ...(apiKey ? { apiKey } : {}) });
        if (!result.success) throw new Error(result.error || 'Test failed');
        return result;
    } });
    const remove = useMutation({ mutationFn: async () => {
        const result = await window.electronAPI.agentGateSetSettings({ apiKey: '' });
        if (!result.success) throw new Error(result.error || 'Could not remove the key');
    }, onSuccess: async () => {
        await refresh();
        setConfirmRemove(false);
        setDraft(previous => ({ ...previous, apiKey: undefined }));
    } });
    const busy = settings.isPending || !settings.data || save.isPending || test.isPending || remove.isPending;
    const showSaved = save.isSuccess && Object.keys(draft).length === 0;
    return <section className="bg-bg-item-surface rounded-xl border border-border-subtle min-w-0">
        <div className="p-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-text-primary">Decision service</h3>
            <p className="text-xs text-text-secondary">{settings.isLoading ? 'Loading…' : settings.data?.hasApiKey ? '● Key saved' : settings.data ? '○ No key' : '✕ Could not load settings'}</p>
        </div>
        <div className="p-5 border-t border-border-subtle space-y-3 min-w-0">
            <p className="text-xs text-text-secondary">For proactive help. A separate kind of service, not a language model provider.</p>
            <fieldset disabled={busy} className="space-y-3 min-w-0">
                <label className="block text-xs text-text-secondary space-y-1">Base URL<input aria-label="Base URL" type="text" value={baseUrl} onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} className={field} /></label>
                <p className="text-[11px] text-text-tertiary">Requests go to the base URL followed by /systemone.</p>
                <label className="block text-xs text-text-secondary space-y-1">API key<input aria-label="API key" type="password" autoComplete="off" value={apiKey} onChange={e => setDraft({ ...draft, apiKey: e.target.value })} placeholder={settings.data?.hasApiKey ? 'Saved. Leave empty to keep it.' : 'Optional for a local address'} className={field} /></label>
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => save.mutate()} className={smallButton}>{save.isPending ? 'Saving…' : 'Save'}</button>
                <button type="button" disabled={busy} onClick={() => test.mutate()} className={smallButton}>{test.isPending ? 'Testing…' : 'Test'}</button>
                {settings.data?.hasApiKey && (confirmRemove ? <div className="flex flex-wrap items-center gap-2 text-xs text-text-primary min-w-0">
                    <span>Remove decision service key?</span>
                    <button type="button" disabled={busy} onClick={() => remove.mutate()} className={smallButton}>{remove.isPending ? 'Removing…' : 'Remove'}</button>
                    <button type="button" disabled={busy} onClick={() => setConfirmRemove(false)} className={smallButton}>Keep</button>
                </div> : <button type="button" disabled={busy} onClick={() => { remove.reset(); setConfirmRemove(true); }} className={smallButton}>Remove key</button>)}
                <span aria-live="polite" className="text-xs text-text-secondary">{showSaved ? '● Saved' : ''}</span>
            </div>
            <p className="text-[11px] text-text-tertiary">Uses the saved decision model from Proactive help and an invented question, not an endpoint-only check.</p>
            <div aria-live="polite" className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">
                {test.isSuccess && <p>● Test passed{test.data.latencyMs === undefined ? '' : ` in ${test.data.latencyMs} ms. Live use allows 2 s: ${test.data.latencyMs > 2000 ? 'this reply would have been too slow live.' : 'this reply is fast enough live.'}`}</p>}
                {test.isError && <p role="alert">✕ Test failed: {(test.error as Error).message}</p>}
            </div>
            {settings.isError && <p role="alert" className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">✕ {(settings.error as Error).message}</p>}
            {save.isError && <p role="alert" className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">✕ {(save.error as Error).message}</p>}
            {remove.isError && <p role="alert" className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">✕ {(remove.error as Error).message}</p>}
        </div>
    </section>;
};

export default DecisionServiceSettings;
