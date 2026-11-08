/**
 * Cloning the user's own voice, in main only. The sample arrives once, goes to the provider and is
 * dropped; it is never written to disk and never logged. No Electron import: the credentials,
 * the provider and the clock arrive through `CloneDeps`, so the flow is testable with fakes.
 *
 * A fresh clone is held as `pending` until the user keeps or discards it, so Discard deletes the
 * voice the provider created. After Keep the same id is the saved one, so Delete targets it too.
 */
import { PROVIDER_LABEL, type AudioMessage } from './InterpretingSession';
import { VoiceProviderError, type VoiceProvider } from './voiceProviders';
import { VOICE_PROVIDERS, type InterpretingSettings, type VoiceProviderId } from '../services/interpretingSettings';

export const CLONE_NAME = 'Pika interpreting voice';
const PREVIEW_LINE = 'This is how I will sound when I translate for you.';
/** 30 s at 48 kHz mono 16-bit is 2.9 MB. */
const MAX_SAMPLE_BYTES = 8 * 1024 * 1024;

export interface CloneDeps {
    settings(): InterpretingSettings;
    apiKey(provider: VoiceProviderId): string | undefined;
    provider(id: VoiceProviderId, apiKey: string): VoiceProvider;
    saveVoices(voices: InterpretingSettings['voices']): void;
    /** RECOGNITION_LANGUAGES key of the other party's language. */
    targetLanguage(): string;
    log(line: string): void;
}

export function parseProvider(value: unknown): VoiceProviderId {
    const id = VOICE_PROVIDERS.find((known) => known === value);
    if (!id) throw new Error(`Unknown voice service: ${String(value)}. Use ${VOICE_PROVIDERS.join(' or ')}.`);
    return id;
}

export class VoiceCloner {
    private readonly pending = new Map<VoiceProviderId, string>();
    private seq = 0;

    constructor(private readonly deps: CloneDeps) {}

    private service(id: VoiceProviderId): VoiceProvider {
        const key = this.deps.apiKey(id);
        if (!key) throw new Error(`Add your ${PROVIDER_LABEL[id]} key first.`);
        return this.deps.provider(id, key);
    }

    /** The voice to preview or delete: the fresh clone, else the saved cloned voice. */
    private target(id: VoiceProviderId): string {
        const saved = this.deps.settings().voices[id];
        const voiceId = this.pending.get(id) ?? (saved?.cloned ? saved.voiceId : undefined);
        if (!voiceId) throw new Error('There is no cloned voice.');
        return voiceId;
    }

    async clone(providerInput: unknown, sample: unknown): Promise<{ voiceId: string; needsVerification: boolean }> {
        const id = parseProvider(providerInput);
        if (!(sample instanceof Uint8Array) || sample.length <= 44 || sample.length > MAX_SAMPLE_BYTES) {
            throw new Error('The voice sample is missing or too large. Record it again.');
        }
        const service = this.service(id);
        try {
            const result = await service.cloneVoice(sample, CLONE_NAME);
            this.pending.set(id, result.voiceId);
            this.deps.log(`[Interpreting] cloned provider=${id} bytes=${sample.length} status=200`);
            // A voice that needs verification stays pending so Discard can delete it, but its id is never handed back to be saved.
            return result.needsVerification ? { voiceId: '', needsVerification: true } : result;
        } catch (e: unknown) {
            this.deps.log(`[Interpreting] clone failed provider=${id} status=${e instanceof VoiceProviderError ? (e.status ?? 'none') : 'none'}`);
            throw e;
        }
    }

    /** One invented line in the clone, for the caller's window, on the default speakers. */
    async preview(providerInput: unknown, send: (message: AudioMessage) => void): Promise<void> {
        const id = parseProvider(providerInput);
        const bytes = await this.service(id).synthesize(PREVIEW_LINE, this.target(id), this.deps.targetLanguage());
        send({ id: `preview-${++this.seq}`, bytes, sink: 'default' });
    }

    /** A 404 means the provider no longer holds the voice, which is what was asked. Any other error keeps the record. */
    async delete(providerInput: unknown): Promise<void> {
        const id = parseProvider(providerInput);
        const voiceId = this.target(id);
        try {
            await this.service(id).deleteVoice(voiceId);
        } catch (e: unknown) {
            if (!(e instanceof VoiceProviderError && e.status === 404)) {
                this.deps.log(`[Interpreting] delete failed provider=${id} status=${e instanceof VoiceProviderError ? (e.status ?? 'none') : 'none'}`);
                throw e;
            }
        }
        this.pending.delete(id);
        const voices = { ...this.deps.settings().voices };
        if (voices[id]?.voiceId === voiceId) {
            delete voices[id];
            this.deps.saveVoices(voices);
        }
    }
}
