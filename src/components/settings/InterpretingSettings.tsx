import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InterpretingSettings as Settings, VoiceChoice, VoiceProviderId } from '../../../electron/services/interpretingSettings';
import { KeyBadge } from '../ui/KeyBadge';
import { useShortcuts } from '../../hooks/useShortcuts';
import { useInterpretingPlayback } from '../../hooks/useInterpretingPlayback';
import { isKnownVirtualName, listOutputDevices } from '../../lib/virtualOutput';
import { NO_VIRTUAL_DEVICE, PERSISTENT_NOTICE, noticeNeeded, outputNames, preselectOutput } from '../../lib/interpretingSettingsUi';
import { primaryButton, secondaryButton } from './buttonStyles';
import InterpretingNoticeDialog from './InterpretingNoticeDialog';
import VoiceCloneDialog from './VoiceCloneDialog';

const fieldLabel = 'text-xs font-medium text-text-secondary block';
const field = 'w-full min-w-0 h-11 bg-bg-input border border-border-subtle rounded-lg px-3 text-sm text-text-primary placeholder-text-tertiary';
const providers: Array<{ id: VoiceProviderId; name: string }> = [{ id: 'fishaudio', name: 'Fish Audio' }, { id: 'elevenlabs', name: 'ElevenLabs' }];

/** Voice interpreting: the notice, the switch, the voice service, the voice and the virtual microphone. */
const InterpretingSettings = () => {
    useInterpretingPlayback(); // The test voice is played by the window that asked for it.
    const queryClient = useQueryClient();
    const { data: settings } = useQuery<Settings>({ queryKey: ['interpreting-settings'], queryFn: () => window.electronAPI.interpretingGetSettings() });
    const { data: credentials } = useQuery({ queryKey: ['speech-credentials'], queryFn: () => window.electronAPI.getStoredCredentials() });
    const { shortcuts } = useShortcuts();
    const interpretingTalk = shortcuts.interpretingTalk;
    const [names, setNames] = useState<string[]>([]);
    const [noticeOpen, setNoticeOpen] = useState(false);
    const [cloneOpen, setCloneOpen] = useState(false);
    const [voiceDraft, setVoiceDraft] = useState<string | undefined>();
    const [keyDraft, setKeyDraft] = useState('');
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

    const fail = (error: unknown) => setMessage({ ok: false, text: error instanceof Error ? error.message : 'Something went wrong.' });
    const save = useMutation({
        mutationFn: (patch: Partial<Settings>) => window.electronAPI.interpretingSetSettings(patch),
        onSuccess: () => { setMessage(null); void queryClient.invalidateQueries({ queryKey: ['interpreting-settings'] }); },
        onError: fail,
    });
    const saveKey = useMutation({
        mutationFn: () => window.electronAPI.setFishAudioApiKey(keyDraft.trim()),
        onSuccess: () => { setKeyDraft(''); setMessage({ ok: true, text: 'Fish Audio key saved.' }); void queryClient.invalidateQueries({ queryKey: ['speech-credentials'] }); },
        onError: fail,
    });
    const testVoice = useMutation({
        mutationFn: () => window.electronAPI.interpretingTestVoice(),
        onSuccess: () => setMessage({ ok: true, text: 'Test voice sent.' }),
        onError: fail,
    });

    // A failed delete keeps the record, so the user knows the provider still holds the voice.
    const deleteVoice = useMutation({
        mutationFn: (id: VoiceProviderId) => window.electronAPI.interpretingDeleteVoice(id),
        onSuccess: () => { setMessage({ ok: true, text: 'Your voice was deleted.' }); void queryClient.invalidateQueries({ queryKey: ['interpreting-settings'] }); },
        onError: fail,
    });

    const refreshDevices = () => { void listOutputDevices().then((devices) => setNames(outputNames(devices))).catch(fail); };
    useEffect(refreshDevices, []);

    // A known virtual driver is chosen for the user once, so the saved name is what playback looks up.
    const proposed = settings ? preselectOutput(settings.outputLabel, names) : '';
    const proposedSent = useRef(false);
    useEffect(() => {
        if (!settings || settings.outputLabel || !proposed || proposedSent.current) return;
        proposedSent.current = true;
        save.mutate({ outputLabel: proposed });
    }, [settings, proposed, save]);

    if (!settings) return null;
    const provider = settings.provider;
    const keySaved = provider === 'fishaudio' ? !!credentials?.hasFishAudioKey : !!credentials?.hasElevenLabsKey;
    const voiceId = voiceDraft ?? settings.voices[provider]?.voiceId ?? '';
    const providerName = providers.find((item) => item.id === provider)?.name ?? provider;
    const cloned = settings.voices[provider]?.cloned ? settings.voices[provider] : undefined;
    const keepClone = (choice: VoiceChoice) => { setCloneOpen(false); save.mutate({ voices: { ...settings.voices, [provider]: choice } }); };
    const turnOn = () => { setNoticeOpen(false); save.mutate({ enabled: true, noticeAcceptedAt: new Date().toISOString() }); };
    const onToggle = () => {
        if (settings.enabled) save.mutate({ enabled: false });
        else if (noticeNeeded(settings)) setNoticeOpen(true);
        else save.mutate({ enabled: true });
    };

    return (
        <div id="interpreting-settings" className="min-w-0 bg-bg-card rounded-xl border border-border-subtle p-4">
            <h3 className="text-lg font-bold text-text-primary mb-1">Interpreting</h3>
            <p className="text-xs text-text-secondary mb-5">{PERSISTENT_NOTICE}</p>

            <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                    <label className={fieldLabel}>Interpreting</label>
                    <button type="button" aria-label="Interpreting" aria-pressed={settings.enabled} onClick={onToggle} className="text-xs bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-md shrink-0">
                        {settings.enabled ? '● On' : '○ Off'}
                    </button>
                </div>

                <div className="space-y-1.5">
                    <label className={fieldLabel}>Voice service</label>
                    <div className="flex gap-2">
                        {providers.map((item) => (
                            <button key={item.id} type="button" aria-pressed={provider === item.id} onClick={() => { setVoiceDraft(undefined); save.mutate({ provider: item.id }); }} className={provider === item.id ? primaryButton : secondaryButton}>
                                {item.name}
                            </button>
                        ))}
                    </div>
                    {provider === 'fishaudio' ? (
                        <div className="flex gap-2 pt-1.5">
                            <input type="password" autoComplete="off" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder={keySaved ? 'Key saved. Paste a new key to replace it.' : 'Fish Audio API key'} aria-label="Fish Audio API key" className={field} />
                            <button type="button" disabled={!keyDraft.trim() || saveKey.isPending} onClick={() => saveKey.mutate()} className={primaryButton}>Save</button>
                        </div>
                    ) : keySaved ? (
                        <p className="text-[11px] text-text-tertiary">Uses the ElevenLabs key from Provider setup.</p>
                    ) : (
                        <button type="button" onClick={() => void window.electronAPI.openSettingsSection('providers')} className="text-xs text-primary hover:underline text-left">
                            No ElevenLabs key saved. Add one in Provider setup.
                        </button>
                    )}
                </div>

                {cloned ? (
                    <div className="space-y-1.5">
                        <label className={fieldLabel}>Voice</label>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-text-primary">Your voice, cloned on {cloned.consentAt ? new Date(cloned.consentAt).toLocaleDateString() : 'an unknown date'}</span>
                            <button type="button" disabled={deleteVoice.isPending} onClick={() => deleteVoice.mutate(provider)} className={secondaryButton}>{deleteVoice.isError ? 'Retry delete' : 'Delete my voice'}</button>
                        </div>
                        <p className="text-[11px] text-text-tertiary">Your cloned voice stays at {providerName} until you delete it here.</p>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        <label htmlFor="interpreting-voice-id" className={fieldLabel}>Voice ID</label>
                        <div className="flex gap-2">
                            <input id="interpreting-voice-id" value={voiceId} onChange={(event) => setVoiceDraft(event.target.value)} placeholder="Paste a voice ID" className={field} />
                            <button type="button" disabled={voiceDraft === undefined} onClick={() => { save.mutate({ voices: { ...settings.voices, [provider]: { voiceId: voiceId.trim(), cloned: false } } }); setVoiceDraft(undefined); }} className={primaryButton}>Save</button>
                            <button type="button" onClick={() => setCloneOpen(true)} className={secondaryButton}>Clone my voice</button>
                        </div>
                    </div>
                )}

                <div className="space-y-1.5">
                    <label htmlFor="interpreting-output" className={fieldLabel}>Virtual microphone</label>
                    <div className="flex gap-2">
                        <select id="interpreting-output" value={settings.outputLabel || proposed} onChange={(event) => save.mutate({ outputLabel: event.target.value })} className={field}>
                            {!(settings.outputLabel || proposed) ? <option value="">Choose a device</option> : null}
                            {settings.outputLabel && !names.includes(settings.outputLabel) ? <option value={settings.outputLabel}>{settings.outputLabel}</option> : null}
                            {names.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                        <button type="button" onClick={refreshDevices} className={secondaryButton}>Refresh</button>
                    </div>
                    {!names.some(isKnownVirtualName) ? <p className="text-[11px] text-text-tertiary">{NO_VIRTUAL_DEVICE}</p> : null}
                    <p className="text-[11px] text-text-tertiary">In your meeting app, choose this device as the microphone. They will hear only the translation, not your own voice.</p>
                </div>

                <div className="space-y-1.5">
                    <button type="button" disabled={testVoice.isPending} onClick={() => testVoice.mutate()} className={secondaryButton}>Test voice</button>
                    <p className="text-[11px] text-text-tertiary">The test really goes into the virtual microphone: in a meeting, they will hear it too.</p>
                </div>

                <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <span>Talk:</span>
                    {interpretingTalk.length > 0 ? <KeyBadge keys={interpretingTalk} /> : <span>not set</span>}
                    <span>Press once to start, again to send.</span>
                </div>
                {message ? <p role={message.ok ? 'status' : 'alert'} className={`text-[11px] break-words [overflow-wrap:anywhere] ${message.ok ? 'text-text-secondary' : 'text-state-danger'}`}>{message.text}</p> : null}
            </div>
            {cloneOpen ? <VoiceCloneDialog provider={provider} providerName={providerName} outputLabel={settings.outputLabel} onKeep={keepClone} onClose={() => setCloneOpen(false)} /> : null}
            {noticeOpen ? <InterpretingNoticeDialog onConfirm={turnOn} onCancel={() => setNoticeOpen(false)} /> : null}
        </div>
    );
};

export default InterpretingSettings;
