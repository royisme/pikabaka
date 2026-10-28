import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';

type Credentials = Awaited<ReturnType<typeof window.electronAPI.getStoredCredentials>>;
type Service = Credentials['sttProvider'];
export const speechServices: Array<{ id: Service; name: string; configured: (credentials: Credentials) => boolean }> = [
    { id: 'google', name: 'Google Cloud', configured: c => !!c.googleServiceAccountPath },
    { id: 'groq', name: 'Groq Whisper', configured: c => c.hasSttGroqKey },
    { id: 'openai', name: 'OpenAI', configured: c => c.hasSttOpenaiKey },
    { id: 'deepgram', name: 'Deepgram', configured: c => c.hasDeepgramKey },
    { id: 'elevenlabs', name: 'ElevenLabs Scribe', configured: c => c.hasElevenLabsKey },
    { id: 'azure', name: 'Azure Speech', configured: c => c.hasAzureKey },
    { id: 'ibmwatson', name: 'IBM Watson', configured: c => c.hasIbmWatsonKey },
    { id: 'soniox', name: 'Soniox', configured: c => !!c.hasSonioxKey },
];

const keyUrls: Partial<Record<Service, string>> = {
    groq: 'https://console.groq.com/keys', openai: 'https://platform.openai.com/api-keys',
    deepgram: 'https://console.deepgram.com', elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
    azure: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeech', ibmwatson: 'https://cloud.ibm.com/catalog/services/speech-to-text',
};
const field = 'w-full min-w-0 h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary';
const smallButton = 'min-h-9 px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-bg-component text-text-secondary hover:text-text-primary disabled:opacity-50';

function setSpeechKey(provider: Exclude<Service, 'google'>, key: string) {
    const api = window.electronAPI;
    const setters = {
        groq: api.setGroqSttApiKey, openai: api.setOpenAiSttApiKey, deepgram: api.setDeepgramApiKey,
        elevenlabs: api.setElevenLabsApiKey, azure: api.setAzureApiKey, ibmwatson: api.setIbmWatsonApiKey, soniox: api.setSonioxApiKey,
    };
    return setters[provider](key);
}

const SpeechProvidersSettings = () => {
    const queryClient = useQueryClient();
    const credentials = useQuery(['speech-credentials'], () => window.electronAPI.getStoredCredentials());
    const visible = speechServices.filter(service => credentials.data && service.configured(credentials.data));
    const [editor, setEditor] = useState<Service | 'add' | null>(null);
    const [service, setService] = useState<Service>('google');
    const [sttKey, setSttKey] = useState('');
    const [region, setRegion] = useState('eastus');
    const [confirmService, setConfirmService] = useState<Service>();
    const [results, setResults] = useState<Partial<Record<Service, { success: boolean; message: string }>>>({});
    const sttProvider = editor === 'add' ? service : editor ?? 'google';
    const selected = speechServices.find(s => s.id === sttProvider)!;
    const configured = !!credentials.data && selected.configured(credentials.data);
    const checkKey = async () => {
        if (sttProvider === 'google') return;
        if (!sttKey.trim() && !configured) throw new Error('Please enter an API key first');
        const result = await window.electronAPI.testSttConnection(sttProvider, sttKey.trim(), sttProvider === 'azure' ? region : undefined);
        if (!result.success) throw new Error(result.error || 'Connection failed');
    };
    const save = useMutation(async () => {
        if (sttProvider === 'google') return;
        if (sttKey.trim()) {
            await checkKey();
            const result = await setSpeechKey(sttProvider, sttKey.trim());
            if (!result.success) throw new Error(result.error || 'Could not save key');
        }
        if (sttProvider === 'azure') {
            const result = await window.electronAPI.setAzureRegion(region.trim());
            if (!result.success) throw new Error(result.error || 'Could not save region');
        }
    }, { onSuccess: () => { setEditor(null); void queryClient.invalidateQueries(['speech-credentials']); } });
    const test = useMutation(checkKey, {
        onSuccess: () => setResults(previous => ({ ...previous, [sttProvider]: { success: true, message: 'The key is accepted' } })),
        onError: (error: Error) => setResults(previous => ({ ...previous, [sttProvider]: { success: false, message: error.message } })),
    });
    const remove = useMutation(async (service: Exclude<Service, 'google'>) => {
        const result = await setSpeechKey(service, '');
        if (!result.success) throw new Error(result.error || 'Could not remove key');
    }, { onSuccess: (_, service) => {
        setConfirmService(undefined);
        if (editor === service) setEditor(null);
        setResults(previous => { const next = { ...previous }; delete next[service]; return next; });
        void queryClient.invalidateQueries(['speech-credentials']);
    } });
    const chooseFile = useMutation(async () => {
        const result = await window.electronAPI.selectServiceAccount();
        if (result.cancelled) return;
        if (!result.success) throw new Error(result.error || 'Could not select service account');
        return result.path;
    }, { onSuccess: path => {
        if (path) { setEditor(null); void queryClient.invalidateQueries(['speech-credentials']); }
    } });
    const busy = save.isLoading || test.isLoading || remove.isLoading || chooseFile.isLoading;
    const testResult = results[sttProvider];
    const open = (next: Service | 'add') => {
        save.reset();
        test.reset();
        remove.reset();
        chooseFile.reset();
        setConfirmService(undefined);
        setEditor(next);
        setService('google');
        setSttKey('');
        setRegion(credentials.data?.azureRegion || 'eastus');
    };
    return <div className="space-y-5 min-w-0">
    <section className="bg-bg-item-surface rounded-xl border border-border-subtle min-w-0">
        <div className="p-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-text-primary">Speech-to-text providers</h3>
            <button type="button" disabled={busy} onClick={() => open('add')} className={smallButton}>Add provider</button>
        </div>
        {credentials.isLoading ? <p className="p-4 text-xs text-text-secondary">Loading speech providers…</p>
            : credentials.isError ? <p role="alert" className="p-4 text-xs text-text-primary">✕ {(credentials.error as Error).message}</p>
            : !visible.length ? <p className="p-4 text-xs text-text-secondary">No speech providers yet. Add one to set up its key or account.</p>
            : visible.map(service => <div key={service.id} className="p-4 border-t border-border-subtle flex flex-wrap items-center gap-3 min-w-0">
                <button type="button" aria-label={`Edit ${service.name}`} disabled={busy} onClick={() => open(service.id)} className="min-w-0 flex-1 basis-full min-[560px]:basis-0 text-left space-y-1">
                    <span className="block text-sm font-medium text-text-primary break-words [overflow-wrap:anywhere]">{service.name}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                        <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full bg-state-success" />
                        {service.id === 'google' ? 'File chosen' : 'Key saved'}
                    </span>
                    {results[service.id] && <span className="block text-xs text-text-primary break-words [overflow-wrap:anywhere]">{results[service.id]!.success ? '●' : '✕ Test failed:'} {results[service.id]!.message}</span>}
                </button>
                {service.id === 'google' ? <p className="text-[11px] text-text-secondary">Account removal is not available.</p>
                    : confirmService === service.id ? <div className="flex flex-wrap items-center gap-2 text-xs text-text-primary min-w-0">
                        <span className="break-words [overflow-wrap:anywhere]">Remove {service.name}?</span>
                        <button type="button" disabled={busy} onClick={() => { if (service.id !== 'google') remove.mutate(service.id); }} className={smallButton}>{remove.isLoading ? 'Removing…' : 'Remove'}</button>
                        <button type="button" disabled={busy} onClick={() => setConfirmService(undefined)} className={smallButton}>Keep</button>
                    </div> : <button type="button" aria-label={`Remove ${service.name}`} disabled={busy} onClick={() => { remove.reset(); setConfirmService(service.id); }} className={smallButton}>Remove</button>}
            </div>)}
        {remove.isError && <p role="alert" className="p-4 text-xs text-text-primary break-words [overflow-wrap:anywhere]">✕ {(remove.error as Error).message}</p>}
    </section>
    {editor && <section className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3 min-w-0">
        <h4 className="text-sm font-bold text-text-primary">{editor === 'add' ? 'Add speech provider' : `Edit ${selected.name}`}</h4>
        <fieldset disabled={busy} className="space-y-3 min-w-0">
        <label className="block text-xs text-text-secondary space-y-1">Service{editor === 'add'
            ? <select aria-label="Service" value={service} onChange={e => { setService(e.target.value as Service); setSttKey(''); save.reset(); test.reset(); chooseFile.reset(); }} className={field}>
                {speechServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            : <input readOnly value={selected.name} className={field} />}
        </label>
        {sttProvider === 'google' ? <div className="space-y-2">
            <p className="text-xs text-text-secondary">Service account file</p>
            <p className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">{credentials.data?.googleServiceAccountPath?.split(/[\\/]/).pop() || 'No file selected'}</p>
            <button type="button" disabled={busy} onClick={() => chooseFile.mutate()} className={smallButton}>{chooseFile.isLoading ? 'Choosing file…' : 'Choose file'}</button>
            <p className="text-[11px] text-text-secondary">Choosing a file saves it immediately. Account Test and removal are not available.</p>
        </div> : <div className="space-y-3">
            <p className="text-xs text-text-secondary">{configured ? '● Key saved' : '○ No key'}</p>
            <label className="block text-xs text-text-secondary space-y-1">API key<input aria-label="API key" type="password" autoComplete="off" value={sttKey} onChange={e => setSttKey(e.target.value)} className={field} /></label>
            {sttProvider === 'openai' && <p className="text-[11px] text-text-tertiary">This key is separate from the OpenAI connection key.</p>}
            {sttProvider === 'ibmwatson' && <p className="text-[11px] text-text-secondary">Region: {credentials.data?.ibmWatsonRegion || 'us-south'}. Region editing is not available.</p>}
            {sttProvider === 'azure' && <label className="block text-xs text-text-secondary space-y-1">Region<input aria-label="Region" value={region} onChange={e => setRegion(e.target.value)} className={field} /></label>}
        </div>}
        </fieldset>
        <div className="flex flex-wrap gap-2">
            {sttProvider !== 'google' && <button type="button" disabled={busy} onClick={() => test.mutate()} className={smallButton}>{test.isLoading ? 'Testing…' : 'Test'}</button>}
            {sttProvider !== 'google' && <button type="button" disabled={busy || (!sttKey.trim() && !(sttProvider === 'azure' && configured)) || (sttProvider === 'azure' && !region.trim())} onClick={() => save.mutate()} className={smallButton}>{save.isLoading ? 'Saving…' : 'Save'}</button>}
            <button type="button" disabled={busy} onClick={() => setEditor(null)} className={smallButton}>Cancel</button>
            {keyUrls[sttProvider] && <button type="button" disabled={busy} onClick={() => void window.electronAPI.openExternal(keyUrls[sttProvider]!)} className={smallButton}>Get API key</button>}
        </div>
        {sttProvider !== 'google' && <p className="text-[11px] text-text-tertiary">Checks the key, not the selected model or languages.</p>}
        <div aria-live="polite" className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">
            {testResult && <p>{testResult.success ? '●' : '✕ Test failed:'} {testResult.message}</p>}
        </div>
        {chooseFile.isError && <p role="alert" className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">✕ {(chooseFile.error as Error).message}</p>}
        {save.isError && <p role="alert" className="text-xs text-text-primary break-words [overflow-wrap:anywhere]">✕ {(save.error as Error).message}</p>}
    </section>}
    </div>;
};
export default SpeechProvidersSettings;
