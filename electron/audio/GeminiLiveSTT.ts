/**
 * GeminiLiveSTT - streaming speech-to-text through the Gemini Live API (Gemini API key, no Google Cloud project).
 *
 * Same EventEmitter interface as DeepgramStreamingSTT / ElevenLabsStreamingSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence, boundary? }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount(), setModel(), setRecognitionLanguage()
 *
 * The server splits turns itself. `interimInputTranscription` carries the whole turn so far, `inputTranscription`
 * is the final text of the turn. Nothing is sent back to the model: only the transcript is used.
 */

import { EventEmitter } from 'events';
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { RECOGNITION_LANGUAGES } from '../config/languages';

const DEFAULT_MODEL = 'gemini-3.5-transcribe-live';
const TARGET_RATE = 16000;
const SEND_SAMPLES = 1600; // 100 ms
const MAX_FILL_MS = 1000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const MAX_BUFFERED_CHUNKS = 200;

export class GeminiLiveSTT extends EventEmitter {
    private readonly ai: GoogleGenAI;
    private session: Session | null = null;
    private model = DEFAULT_MODEL;
    private languageCode?: string;

    private inputSampleRate = 16000;
    private isActive = false;
    private isConnecting = false;
    private shouldReconnect = false;
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    /** Audio written while the session is not open yet. */
    private pending: Buffer[] = [];

    private acc: Int16Array[] = [];
    private accLen = 0;
    /** When the last audio reached the server; silence chunks are stretched to the time that really passed. */
    private lastSentAt = 0;
    /** Speech was sent since the turn was last closed, and when its last piece was. */
    private speechPending = false;
    private lastSpeechAt = 0;

    constructor(apiKey: string) {
        super();
        this.ai = new GoogleGenAI({ apiKey });
    }

    public setSampleRate(rate: number): void {
        this.inputSampleRate = rate;
        console.log(`[GeminiLive] Input sample rate set to ${rate}Hz`);
    }

    /** The native module sends mono; nothing to do. */
    public setAudioChannelCount(_count: number): void { }

    public setModel(model: string): void {
        if (model.trim()) this.model = model.trim();
    }

    public setRecognitionLanguage(key: string): void {
        const config = RECOGNITION_LANGUAGES[key];
        const next = config ? config.iso639 : key === 'auto' ? undefined : this.languageCode;
        if (next === this.languageCode) return;
        this.languageCode = next;
        if (this.isActive) {
            this.stop();
            this.start();
        }
    }

    public setCredentials(_path: string): void { }
    public setKeywords(_keywords: string[]): void { }

    public start(): void {
        if (this.isActive || this.isConnecting) return;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        void this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const session = this.session;
        this.session = null;
        try { session?.close(); } catch { /* closing a dead session */ }
        this.isActive = false;
        this.isConnecting = false;
        this.pending = [];
        this.acc = [];
        this.accLen = 0;
        this.speechPending = false;
        console.log('[GeminiLive] Stopped');
    }

    /** Int16LE mono at the input rate. */
    public write(chunk: Buffer): void {
        if (!this.shouldReconnect) return;
        if (!this.session) {
            this.pending.push(chunk);
            if (this.pending.length > MAX_BUFFERED_CHUNKS) this.pending.shift();
            if (!this.isConnecting && !this.reconnectTimer) void this.connect();
            return;
        }
        this.send(chunk);
    }

    private send(chunk: Buffer): void {
        const samples = new Int16Array(chunk.buffer, chunk.byteOffset, Math.floor(chunk.byteLength / 2));
        // The native gate replaces a pause with one short silent chunk now and then. The server decides that a turn is
        // over from the length of the silence it hears, so a pause is stretched back to the time that really passed.
        const silent = samples.every(sample => sample === 0);
        const now = Date.now();
        const out = silent && this.lastSentAt ? this.silenceFor(Math.min(now - this.lastSentAt, MAX_FILL_MS)) : this.toTargetRate(samples);
        this.lastSentAt = now;
        if (!silent) { this.speechPending = true; this.lastSpeechAt = now; }
        this.acc.push(out);
        this.accLen += out.length;
        if (this.accLen >= SEND_SAMPLES) this.flush();
    }

    private flush(): void {
        if (this.accLen === 0) return;
        const all = new Int16Array(this.accLen);
        let offset = 0;
        for (const part of this.acc) { all.set(part, offset); offset += part.length; }
        this.acc = [];
        this.accLen = 0;
        try {
            this.session?.sendRealtimeInput({
                audio: { data: Buffer.from(all.buffer, all.byteOffset, all.byteLength).toString('base64'), mimeType: `audio/pcm;rate=${TARGET_RATE}` },
            });
        } catch (error) {
            console.warn('[GeminiLive] write failed:', (error as Error).message);
        }
    }

    /**
     * The microphone gate heard the speech stop. Telling the server so closes the turn at once; waiting for its own
     * silence detection took between 1.3 and 5 s in the probes, this took about 0.4 s. The session stays open.
     */
    public notifySpeechEnded(): void {
        if (!this.session || !this.speechPending) return;
        this.speechPending = false;
        this.flush();
        try {
            this.session.sendRealtimeInput({ audioStreamEnd: true });
        } catch (error) {
            console.warn('[GeminiLive] audioStreamEnd failed:', (error as Error).message);
        }
    }

    private silenceFor(ms: number): Int16Array {
        return new Int16Array(Math.round(TARGET_RATE * ms / 1000));
    }

    private toTargetRate(input: Int16Array): Int16Array {
        if (this.inputSampleRate === TARGET_RATE) return input;
        const factor = this.inputSampleRate / TARGET_RATE;
        const length = Math.floor(input.length / factor);
        const out = new Int16Array(length);
        for (let i = 0; i < length; i++) {
            // Average the samples that fall into one output sample: a plain pick would alias.
            const from = Math.floor(i * factor);
            const to = Math.max(from + 1, Math.floor((i + 1) * factor));
            let sum = 0;
            for (let j = from; j < to && j < input.length; j++) sum += input[j];
            out[i] = Math.round(sum / (to - from));
        }
        return out;
    }

    private async connect(): Promise<void> {
        this.isConnecting = true;
        const language = this.languageCode;
        try {
            const session = await this.ai.live.connect({
                model: this.model,
                config: {
                    responseModalities: [Modality.TEXT],
                    inputAudioTranscription: { languageCodes: language ? [language] : [] },
                },
                callbacks: {
                    onmessage: (message) => this.handleMessage(message),
                    onerror: (event) => this.emit('error', new Error(event.message || 'Gemini Live error')),
                    onclose: (event) => this.handleClose(session, event.code),
                },
            });
            if (!this.shouldReconnect) {
                session.close();
                return;
            }
            this.session = session;
            this.isActive = true;
            this.reconnectAttempts = 0;
            console.log(`[GeminiLive] Connected (${this.model})`);
            const queued = this.pending;
            this.pending = [];
            for (const chunk of queued) this.send(chunk);
        } catch (error) {
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
            this.scheduleReconnect();
        } finally {
            this.isConnecting = false;
        }
    }

    private handleClose(session: Session | undefined, code: number): void {
        if (session && this.session !== session) return; // an old session closing after stop() or a restart
        this.session = null;
        this.isActive = false;
        console.log(`[GeminiLive] Closed: code=${code}`);
        this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect || this.reconnectTimer) return;
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
        this.reconnectAttempts += 1;
        console.log(`[GeminiLive] Reconnecting in ${delay}ms...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) void this.connect();
        }, delay);
    }

    private handleMessage(message: LiveServerMessage): void {
        const content = message.serverContent;
        if (!content) return;
        const interim = content.interimInputTranscription?.text;
        if (interim?.trim()) {
            this.emit('transcript', { text: interim, isFinal: false, confidence: 1.0 });
        }
        const final = content.inputTranscription?.text;
        if (final?.trim()) {
            if (this.lastSpeechAt) console.log(`[GeminiLive] final line ${Date.now() - this.lastSpeechAt} ms after the last speech audio (${final.length} chars)`);
            this.emit('transcript', { text: final, isFinal: true, confidence: 1.0, boundary: true });
        }
    }
}
