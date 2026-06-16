/**
 * DeepgramStreamingSTT - WebSocket-based streaming Speech-to-Text using Deepgram Nova-3
 *
 * Implements the same EventEmitter interface as GoogleSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount()
 *
 * Sends raw PCM (linear16, 16-bit LE) over WebSocket — NO WAV header.
 * Receives interim and final transcription results in real time.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES } from '../config/languages';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const KEEPALIVE_INTERVAL_MS = 5000;

const DEEPGRAM_LISTEN_BASE_URL = 'wss://api.deepgram.com/v1/listen';

export function buildDeepgramListenUrl(options: {
    sampleRate: number;
    channels: number;
    languageCode?: string;
}): string {
    const params = new URLSearchParams({
        model: 'nova-3',
        encoding: 'linear16',
        sample_rate: String(options.sampleRate),
        channels: String(options.channels),
        smart_format: 'true',
        interim_results: 'true',
        keepalive: 'true',
    });

    // Deepgram Nova-3 realtime supports multilingual recognition with
    // language=multi. Do not use detect_language=true here: that parameter is
    // still rejected by the WebSocket endpoint on some projects/plans. Explicit
    // language selections send their concrete ISO-639 code.
    params.set('language', options.languageCode || 'multi');

    return `${DEEPGRAM_LISTEN_BASE_URL}?${params.toString()}`;
}

export function describeDeepgramConnectionError(
    error: Error,
    context: { sampleRate: number; channels: number; languageCode?: string }
): string {
    const rawMessage = error.message || 'Deepgram realtime STT connection failed';
    const languageLabel = context.languageCode || 'auto';
    const prefix = `Deepgram STT connection failed (language=${languageLabel}, sample_rate=${context.sampleRate}, channels=${context.channels})`;

    if (/Unexpected server response:\s*400/i.test(rawMessage)) {
        return `${prefix}: Deepgram rejected the realtime WebSocket request with HTTP 400. Check the Deepgram API key/project/plan and selected recognition language. Auto mode uses language=multi and must not send detect_language=true.`;
    }

    if (/Unexpected server response:\s*(401|403)/i.test(rawMessage)) {
        return `${prefix}: Deepgram rejected the API key or account permission (${rawMessage}). Update the Deepgram STT key in Settings.`;
    }

    return `${prefix}: ${rawMessage}`;
}

export class DeepgramStreamingSTT extends EventEmitter {
    private apiKey: string;
    private ws: WebSocket | null = null;
    private isActive = false;
    private shouldReconnect = false;

    private sampleRate = 16000;
    private numChannels = 1;
    private languageCode: string | undefined = 'en'; // Default to English; undefined ⇒ multi/auto-detect

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    private buffer: Buffer[] = [];
    private isConnecting = false;

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }

    // =========================================================================
    // Configuration (match GoogleSTT / RestSTT interface)
    // =========================================================================

    public setSampleRate(rate: number): void {
        this.sampleRate = rate;
        console.log(`[DeepgramStreaming] Sample rate set to ${rate}`);
    }

    public setAudioChannelCount(count: number): void {
        this.numChannels = count;
        console.log(`[DeepgramStreaming] Channel count set to ${count}`);
    }

    /** Set recognition language using ISO-639-1 code */
    public setRecognitionLanguage(key: string): void {
        const config = RECOGNITION_LANGUAGES[key];
        let nextCode: string | undefined;
        if (config) {
            nextCode = config.iso639;
            console.log(`[DeepgramStreaming] Language set to ${nextCode}`);
        } else if (key === 'auto') {
            nextCode = undefined;
            console.log('[DeepgramStreaming] Language set to multi (auto-detect)');
        } else {
            return;
        }

        this.languageCode = nextCode;

        if (this.isActive) {
            console.log('[DeepgramStreaming] Language changed while active. Restarting...');
            // EC-02 fix: save the buffer so in-flight chunks are not discarded
            // when stop() clears this.buffer.
            const savedBuffer = [...this.buffer];
            this.stop();
            this.start();
            // Restore saved chunks so they are sent once reconnected
            if (savedBuffer.length > 0) {
                this.buffer = [...savedBuffer, ...this.buffer];
            }
        }
    }

    /** No-op — no Google credentials needed */
    public setCredentials(_path: string): void { }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    public start(): void {
        if (this.isActive) return;
        // Mark active immediately so write() buffers chunks
        // instead of dropping them during WebSocket handshake (~500ms).
        this.isActive = true;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        this.clearTimers();

        if (this.ws) {
            try {
                // Send Deepgram's graceful close message
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'CloseStream' }));
                }
            } catch {
                // Ignore send errors during shutdown
            }
            this.ws.close();
            this.ws = null;
        }

        this.isActive = false;
        this.isConnecting = false;
        this.buffer = [];
        console.log('[DeepgramStreaming] Stopped');
    }

    // =========================================================================
    // Audio Data
    // =========================================================================

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size
            
            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                console.log('[DeepgramStreaming] WS not ready. Lazy connecting on new audio...');
                this.connect();
            }
            return;
        }

        this.ws.send(chunk);
    }

    // =========================================================================
    // WebSocket Connection
    // =========================================================================

    private connect(): void {
        if (this.isConnecting) return;
        this.isConnecting = true;

        const url = buildDeepgramListenUrl({
            sampleRate: this.sampleRate,
            channels: this.numChannels,
            languageCode: this.languageCode,
        });

        console.log(`[DeepgramStreaming] Connecting (rate=${this.sampleRate}, ch=${this.numChannels})...`);

        this.ws = new WebSocket(url, {
            headers: {
                Authorization: `Token ${this.apiKey}`,
            },
        });

        this.ws.on('open', () => {
            this.isActive = true;
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            console.log('[DeepgramStreaming] Connected');

            // Send buffered audio
            while (this.buffer.length > 0) {
                const chunk = this.buffer.shift();
                if (chunk && this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(chunk);
                }
            }

            // Start keep-alive pings
            this.startKeepAlive();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Deepgram response structure:
                // { type: "Results", channel: { alternatives: [{ transcript, confidence }] }, is_final }
                if (msg.type !== 'Results') return;

                const alt = msg.channel?.alternatives?.[0];
                const transcript = alt?.transcript;
                if (!transcript) return;

                // Extract detected language. Deepgram surfaces it in different
                // shapes depending on model/feature flags:
                //   - alt.languages: string[] (preferred — per-segment dominant)
                //   - alt.language: string
                //   - msg.channel.detected_language / msg.detected_language
                //   - msg.language
                const rawLang: unknown =
                    (Array.isArray(alt?.languages) ? alt.languages[0] : undefined) ??
                    alt?.language ??
                    msg.channel?.detected_language ??
                    msg.detected_language ??
                    msg.language;

                let detectedLanguage: string | undefined;
                if (typeof rawLang === 'string' && rawLang.length > 0) {
                    // Normalize to base ISO 639 code, lowercase (e.g. 'en-US' → 'en').
                    detectedLanguage = rawLang.toLowerCase().split(/[-_]/)[0] || undefined;
                }

                this.emit('transcript', {
                    text: transcript,
                    isFinal: msg.is_final ?? false,
                    confidence: alt?.confidence ?? 1.0,
                    detectedLanguage,
                });
            } catch (err) {
                console.error('[DeepgramStreaming] Parse error:', err);
            }
        });

        this.ws.on('error', (err: Error) => {
            const detailedMessage = describeDeepgramConnectionError(err, {
                sampleRate: this.sampleRate,
                channels: this.numChannels,
                languageCode: this.languageCode,
            });
            console.error('[DeepgramStreaming] WebSocket error:', detailedMessage);
            this.emit('error', new Error(detailedMessage));
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            // Do not force isActive=false; let write() trigger reconnect if isActive is still true
            this.isConnecting = false;
            this.clearKeepAlive();
            console.log(`[DeepgramStreaming] Closed (code=${code}, reason=${reason.toString()})`);

            // Auto-reconnect on unexpected close (excluding silence timeout 1000)
            if (this.shouldReconnect && code !== 1000) {
                this.scheduleReconnect();
            }
        });
    }

    // =========================================================================
    // Reconnection
    // =========================================================================

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        this.reconnectAttempts++;

        console.log(`[DeepgramStreaming] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) {
                this.connect();
            }
        }, delay);
    }

    // =========================================================================
    // Keep-alive
    // =========================================================================

    private startKeepAlive(): void {
        this.clearKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                    // Send KeepAlive JSON instead of raw ping frame for Deepgram API idle prevention
                    this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
                } catch {
                    // Ignore errors
                }
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    private clearKeepAlive(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    private clearTimers(): void {
        this.clearKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
