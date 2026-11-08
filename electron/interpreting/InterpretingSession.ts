/**
 * Interpreting session: while a talk window is open, what the user says is collected; when it
 * closes, the text is translated once into the other party's language, voiced once, and sent to
 * the overlay window, which plays it into the virtual microphone. No Electron import: everything
 * outside this file arrives through `SessionDeps`, so the flow is testable with fakes.
 *
 * Logs carry only provider and model ids, counts, durations and error classes (spec §6): never
 * the text, the translation, audio, a voice id, a key or a provider's error body.
 */
import { classifyTranslationError } from '../transcript/translationError';
import { GRACE_MS, TalkWindows, type OwnTurn } from './talkWindow';
import { ELEVENLABS_MODEL, FISH_MODEL, VoiceProviderError, type VoiceProvider } from './voiceProviders';
import type { InterpretingSettings, VoiceProviderId } from '../services/interpretingSettings';

export type InterpretingPhase = 'off' | 'idle' | 'listening' | 'translating' | 'voicing' | 'speaking' | 'error';
export interface InterpretingState { phase: InterpretingPhase; error?: string }
export interface AudioMessage { id: string; bytes: Uint8Array; sink: 'virtual' | 'default' }
export interface PlayedAck { id: string; ok: boolean; error?: string }

/** How long to wait for the overlay to report that a clip has played. */
const ACK_TIMEOUT_MS = 60_000;
const TEST_SENTENCE = 'This is a test of the interpreting voice.';
const PROVIDER_LABEL: Record<VoiceProviderId, string> = { fishaudio: 'Fish Audio', elevenlabs: 'ElevenLabs' };
const PROVIDER_MODEL: Record<VoiceProviderId, string> = { fishaudio: FISH_MODEL, elevenlabs: ELEVENLABS_MODEL };

export interface SessionDeps {
    now(): number;
    sleep(ms: number): Promise<void>;
    settings(): InterpretingSettings;
    /** The saved key of a provider, if any. */
    apiKey(provider: VoiceProviderId): string | undefined;
    isMeetingActive(): boolean;
    isMuted(): boolean;
    /** Name of the microphone Pika listens to; null when it is the system default. */
    micDeviceName(): string | null;
    /** RECOGNITION_LANGUAGES key of the other party's language: the translation target and the voice language. */
    targetLanguage(): string;
    translationReady(): boolean;
    /** Final own-speech turns held in the assembler are flushed and sealed. */
    flushOwn(): Promise<void>;
    sealOwn(): void;
    finalizeMic(): void;
    translate(text: string): Promise<string>;
    provider(id: VoiceProviderId, apiKey: string): VoiceProvider;
    /** To the overlay window only. False when there is no window to play it. */
    /** The text about to be spoken, for the echo guard on the other party's stream. */
    noteSpoken(text: string): void;
    sendAudio(message: AudioMessage): boolean;
    sendStop(): void;
    broadcastState(state: InterpretingState): void;
    /** Shows the spoken translation on the Me row. */
    showTranslation(turn: OwnTurn, translatedText: string): void;
    log(line: string): void;
}

function sameDeviceName(a: string, b: string): boolean {
    const x = a.trim().toLowerCase();
    const y = b.trim().toLowerCase();
    return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

function errorClass(error: unknown): string {
    return error instanceof Error ? error.name : 'unknown';
}

function errorStatus(error: unknown): string {
    const status = error instanceof VoiceProviderError ? error.status : (error as { status?: unknown } | null)?.status;
    return typeof status === 'number' ? String(status) : 'none';
}

export class InterpretingSession {
    private readonly windows: TalkWindows;
    private listening = false;
    private busy: 'translating' | 'voicing' | 'speaking' | null = null;
    private error: string | undefined;
    private draining = false;
    private epoch = 0;
    private seq = 0;
    private readonly latest = new Map<string, OwnTurn>();
    private readonly acks = new Map<string, (ack: PlayedAck) => void>();
    private readonly pending = new Set<Promise<void>>();

    constructor(private readonly deps: SessionDeps) {
        this.windows = new TalkWindows(() => deps.now());
    }

    getState(): InterpretingState {
        if (!this.deps.settings().enabled) return { phase: 'off' };
        if (this.listening) return { phase: 'listening' };
        if (this.busy) return { phase: this.busy };
        return this.error ? { phase: 'error', error: this.error } : { phase: 'idle' };
    }

    /** Called by the assembler for every own-speech turn it emits. */
    noteOwnTurn(turn: OwnTurn): void {
        this.windows.noteOwnTurn(turn);
        if (!this.listening && !this.draining && this.pending.size === 0) return;
        this.latest.set(turn.segmentId, turn);
        if (this.latest.size > 64) this.latest.delete(this.latest.keys().next().value as string);
    }

    /** Resolves when every closing window has been spoken (or has failed). */
    async settled(): Promise<void> {
        while (this.pending.size > 0) await Promise.all([...this.pending]);
    }

    async toggleTalk(): Promise<InterpretingState> {
        if (this.listening) {
            this.listening = false;
            const done: Promise<void> = this.closeWindow().catch(() => undefined).finally(() => this.pending.delete(done));
            this.pending.add(done);
        } else {
            const refusal = this.refusal();
            if (refusal) {
                this.error = refusal;
            } else {
                this.error = undefined;
                this.windows.open();
                this.listening = true;
                this.emit();
                // Earlier own speech is closed off so that it cannot be merged into this window.
                await this.deps.flushOwn();
                this.deps.sealOwn();
                return this.getState();
            }
        }
        this.emit();
        return this.getState();
    }

    /** Meeting start and end: no window survives, nothing more is spoken, playback stops. */
    reset(): void {
        this.epoch++;
        this.windows.reset();
        this.latest.clear();
        this.listening = false;
        this.busy = null;
        this.draining = false;
        this.error = undefined;
        for (const resolve of this.acks.values()) resolve({ id: '', ok: false, error: 'Interpreting was reset.' });
        this.acks.clear();
        this.deps.sendStop();
        this.emit();
    }

    played(ack: PlayedAck): void {
        const resolve = this.acks.get(ack.id);
        if (resolve) resolve(ack);
    }

    /** Speaks a fixed sentence through the saved provider and voice, to the caller's window. */
    async testVoice(send: (message: AudioMessage) => void): Promise<void> {
        const s = this.deps.settings();
        const voiceId = s.voices[s.provider]?.voiceId;
        const key = this.deps.apiKey(s.provider);
        if (!voiceId) throw new Error(`Choose or clone a voice for ${PROVIDER_LABEL[s.provider]} first.`);
        if (!key) throw new Error(`Add your ${PROVIDER_LABEL[s.provider]} key first.`);
        const bytes = await this.deps.provider(s.provider, key).synthesize(TEST_SENTENCE, voiceId, this.deps.targetLanguage());
        send({ id: String(++this.seq), bytes, sink: 'virtual' });
    }

    private refusal(): string | null {
        const d = this.deps;
        const s = d.settings();
        const label = PROVIDER_LABEL[s.provider];
        if (!s.enabled) return 'Interpreting is turned off. Turn it on in Audio & Translation first.';
        if (!d.isMeetingActive()) return 'Start a meeting to use Interpreting.';
        if (d.isMuted()) return 'Unmute the microphone to talk.';
        if (!d.translationReady()) return 'Choose a translation model in Audio & Translation first.';
        if (!s.voices[s.provider]?.voiceId) return `Choose or clone a voice for ${label} in Audio & Translation first.`;
        if (!d.apiKey(s.provider)) return `Add your ${label} key in Audio & Translation first.`;
        if (!s.outputLabel) return 'Choose the virtual microphone in Audio & Translation first.';
        const mic = d.micDeviceName();
        if (mic && sameDeviceName(mic, s.outputLabel)) {
            return "Pika's microphone is the virtual microphone. Choose your real microphone in Audio & Translation.";
        }
        return null;
    }

    private emit(): void {
        this.deps.broadcastState(this.getState());
    }

    /** The second press: let the last finals arrive, close the window, then speak whatever is ready. */
    private async closeWindow(): Promise<void> {
        const epoch = this.epoch;
        this.deps.finalizeMic();
        await this.deps.sleep(GRACE_MS);
        await this.deps.flushOwn();
        if (epoch !== this.epoch) return;
        this.windows.close();
        await this.drain();
    }

    private async drain(): Promise<void> {
        if (this.draining) return;
        this.draining = true;
        const epoch = this.epoch;
        try {
            for (let turns = this.windows.collectTurns(); turns; turns = this.windows.collectTurns()) {
                const text = turns.map((t) => t.text.trim()).filter((t) => t.length > 0).join(' ');
                const last = turns[turns.length - 1];
                if (text) await this.speak(text, last, epoch);
                if (epoch !== this.epoch) return;
            }
        } finally {
            if (epoch === this.epoch) {
                this.draining = false;
                this.busy = null;
                this.emit();
            }
        }
    }

    private setBusy(phase: 'translating' | 'voicing' | 'speaking'): void {
        this.busy = phase;
        this.emit();
    }

    private async speak(text: string, last: OwnTurn, epoch: number): Promise<void> {
        const d = this.deps;
        const s = d.settings();
        const provider = s.provider;
        let stage = 'translate';
        try {
            const t0 = d.now();
            this.setBusy('translating');
            const translated = (await d.translate(text)).trim();
            if (epoch !== this.epoch) return;
            if (!translated) throw new Error('The translation came back empty.');
            const t1 = d.now();
            stage = 'synthesize';
            this.setBusy('voicing');
            const voiceId = s.voices[provider]?.voiceId;
            const key = d.apiKey(provider);
            if (!voiceId || !key) throw new Error(`The ${PROVIDER_LABEL[provider]} voice or key is no longer set.`);
            const bytes = await d.provider(provider, key).synthesize(translated, voiceId, d.targetLanguage());
            if (epoch !== this.epoch) return;
            const t2 = d.now();
            stage = 'play';
            const id = String(++this.seq);
            const ack = new Promise<PlayedAck>((resolve) => this.acks.set(id, resolve));
            d.noteSpoken(translated);
            if (!d.sendAudio({ id, bytes, sink: 'virtual' })) throw new Error('The overlay is not open, so nothing can be played.');
            this.setBusy('speaking');
            const result = await Promise.race([
                ack,
                d.sleep(ACK_TIMEOUT_MS).then((): PlayedAck => ({ id, ok: false, error: 'Playback did not report back.' })),
            ]);
            this.acks.delete(id);
            if (epoch !== this.epoch) return;
            d.log(`[Interpreting] voiced provider=${provider} model=${PROVIDER_MODEL[provider]} chars=${translated.length} bytes=${bytes.length} translateMs=${t1 - t0} synthMs=${t2 - t1} playMs=${d.now() - t2} status=200`);
            if (!result.ok) throw new Error(result.error || 'Playback failed.');
            this.error = undefined;
            // The row shows what they heard, under the source text. The latest revision keeps it visible.
            d.showTranslation(this.latest.get(last.segmentId) ?? last, translated);
        } catch (e: unknown) {
            if (epoch !== this.epoch) return;
            d.log(`[Interpreting] failed stage=${stage} provider=${provider} status=${errorStatus(e)} class=${errorClass(e)}`);
            this.error = stage === 'translate' ? `Translation failed (${classifyTranslationError(e)}).` : (e instanceof Error ? e.message : 'Interpreting failed.');
        }
    }
}
