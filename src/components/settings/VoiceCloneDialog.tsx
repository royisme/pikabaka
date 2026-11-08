import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceChoice, VoiceProviderId } from '../../../electron/services/interpretingSettings';
import { MAX_SECONDS, MIN_SECONDS, preferredInputName, startRecording, type MicRecording } from '../../lib/micRecorder';
import { primaryButton, secondaryButton } from './buttonStyles';

export const CONSENT_TEXT = 'This is my own voice. Use it only to translate for me when I speak.';
export const VERIFY_TEXT = 'ElevenLabs asks you to verify this voice on its site before it can be used.';

const PASSAGES = {
    english: 'The harbor was quiet before the first ferry. A cold wind came across the water, and the gulls waited on the rail. Two people carried boxes along the pier, counting each one aloud. Later the sun rose over the roofs, and the market began to fill with the smell of bread, oranges and warm coffee.',
    chinese: '清晨的港口很安静，第一班渡轮还没有出发。冷风从水面吹过来，海鸥站在栏杆上等着。两个人沿着码头搬箱子，一边搬一边大声数数。后来太阳升到屋顶上方，市场里渐渐充满了面包、橘子和热咖啡的香味。',
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

type Phase = 'idle' | 'recording' | 'uploading' | 'review';

interface Props {
    provider: VoiceProviderId;
    providerName: string;
    /** The saved virtual microphone name: the recording refuses it as input. */
    outputLabel: string;
    /** The user kept the clone: the record to save and select. */
    onKeep: (choice: VoiceChoice) => void;
    onClose: () => void;
}

/** Clone the user's own voice: consent, a 15 to 30 s recording, a listen, then Keep or Discard. */
const VoiceCloneDialog = ({ provider, providerName, outputLabel, onKeep, onClose }: Props) => {
    const [consent, setConsent] = useState(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const [seconds, setSeconds] = useState(0);
    const [level, setLevel] = useState(0);
    const [passage, setPassage] = useState(PASSAGES.english);
    const [clone, setClone] = useState<{ voiceId: string; needsVerification: boolean } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const recording = useRef<MicRecording | null>(null);
    const consentAt = useRef('');

    useEffect(() => {
        void window.electronAPI.getSttLanguage('user').then((key) => setPassage(key.startsWith('chinese') ? PASSAGES.chinese : PASSAGES.english)).catch(() => undefined);
        return () => recording.current?.cancel(); // closing mid-recording drops the sample
    }, []);

    const fail = (e: unknown) => setError(errorText(e));

    const start = async () => {
        setError(null);
        try {
            const inputs = await window.electronAPI.getInputDevices();
            const name = preferredInputName(inputs, localStorage.getItem('preferredInputDeviceId'));
            recording.current = await startRecording(name, outputLabel, setLevel);
            consentAt.current = new Date().toISOString();
            setSeconds(0);
            setPhase('recording');
        } catch (e) {
            fail(e);
        }
    };

    const finish = useCallback(async () => {
        const active = recording.current;
        if (!active) return;
        recording.current = null;
        const sample = active.stop();
        setPhase('uploading');
        try {
            setClone(await window.electronAPI.interpretingCloneVoice(provider, sample));
            setPhase('review');
        } catch (e) {
            setError(errorText(e));
            setPhase('idle');
        }
    }, [provider]);

    useEffect(() => {
        if (phase !== 'recording') return;
        const startedAt = Date.now();
        const timer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startedAt) / 1000);
            setSeconds(Math.min(MAX_SECONDS, elapsed));
            if (elapsed >= MAX_SECONDS) void finish();
        }, 250);
        return () => clearInterval(timer);
    }, [phase, finish]);

    const act = async (run: () => Promise<unknown>, then: () => void) => {
        setBusy(true);
        setError(null);
        try { await run(); then(); } catch (e) { fail(e); } finally { setBusy(false); }
    };
    const keep = () => { if (clone) onKeep({ voiceId: clone.voiceId, cloned: true, consentAt: consentAt.current }); };
    const discard = () => void act(() => window.electronAPI.interpretingDeleteVoice(provider), onClose);
    const listen = () => void act(() => window.electronAPI.interpretingPreviewVoice(provider), () => undefined);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="voice-clone-title" className="w-full max-w-md rounded-xl border border-border-subtle bg-bg-elevated p-5">
                <h3 id="voice-clone-title" className="mb-3 text-lg font-bold text-text-primary">Clone my voice</h3>
                {phase !== 'review' ? (
                    <>
                        <label className="mb-2 flex items-start gap-2 text-sm text-text-primary">
                            <input type="checkbox" checked={consent} disabled={phase !== 'idle'} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" />
                            {CONSENT_TEXT}
                        </label>
                        <p className="mb-4 text-xs text-text-secondary">
                            Clone only your own voice. Do not record anyone else, and never anyone under 18. The recording is sent once to {providerName} to create a private voice; Pika does not keep it. You can delete the voice here at any time.
                        </p>
                        <p className="mb-1 text-xs font-medium text-text-secondary">Read this aloud for {MIN_SECONDS} to {MAX_SECONDS} seconds:</p>
                        <p className="mb-3 rounded-lg bg-bg-input p-3 text-sm text-text-primary">{passage}</p>
                        {phase === 'recording' ? (
                            <div className="mb-3 flex items-center gap-3 text-xs text-text-secondary" aria-live="off">
                                <span>{seconds} s</span>
                                <div className="h-1.5 flex-1 rounded-full bg-bg-input"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(level * 100)}%` }} /></div>
                            </div>
                        ) : null}
                        {phase === 'uploading' ? <p className="mb-3 text-xs text-text-secondary">Creating your voice at {providerName}...</p> : null}
                    </>
                ) : (
                    <p className="mb-3 text-sm text-text-secondary">{clone?.needsVerification ? VERIFY_TEXT : 'Your voice is ready. Listen to it, then keep or discard it.'}</p>
                )}
                {error ? <p role="alert" className="mb-3 break-words text-xs text-state-danger [overflow-wrap:anywhere]">{error}</p> : null}
                <div className="flex justify-end gap-2">
                    {phase === 'idle' ? <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button> : null}
                    {phase === 'idle' ? <button type="button" disabled={!consent} onClick={() => void start()} className={primaryButton}>Start recording</button> : null}
                    {phase === 'recording' ? <button type="button" disabled={seconds < MIN_SECONDS} onClick={() => void finish()} className={primaryButton}>Done</button> : null}
                    {phase === 'review' ? (
                        <>
                            {!clone?.needsVerification ? <button type="button" disabled={busy} onClick={listen} className={secondaryButton}>Listen</button> : null}
                            <button type="button" disabled={busy} onClick={discard} className={secondaryButton}>{error ? 'Retry discard' : 'Discard'}</button>
                            <button type="button" disabled={busy} onClick={keep} className={primaryButton}>Keep</button>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default VoiceCloneDialog;
