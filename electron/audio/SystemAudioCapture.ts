import { EventEmitter } from 'events';
import { loadNativeModule } from './nativeModuleLoader';

// RustAudioCapture is the native Rust class (napi-rs) that captures system audio.
// May be null if the .node binary isn't available — constructor logs an error in that case.
const NativeModule: any = loadNativeModule();
const { SystemAudioCapture: RustAudioCapture } = NativeModule || {};

export class SystemAudioCapture extends EventEmitter {
    private isRecording: boolean = false;
    private deviceId: string | null = null;
    private detectedSampleRate: number = 48000;
    private monitor: any = null;

    constructor(deviceId?: string | null) {
        super();
        this.deviceId = deviceId || null;
        if (!RustAudioCapture) {
            console.error('[SystemAudioCapture] Rust class implementation not found.');
        } else {
            // LAZY INIT: Don't create native monitor here - it causes 1-second audio mute + quality drop
            // The monitor will be created in start() when the meeting actually begins
            console.log(`[SystemAudioCapture] Initialized (lazy). Device ID: ${this.deviceId || 'default'}`);
        }
    }

    public getSampleRate(): number {
        if (this.monitor && typeof this.monitor.get_sample_rate === 'function') {
            const nativeRate = this.monitor.get_sample_rate();
            if (nativeRate !== this.detectedSampleRate) {
                console.log(`[SystemAudioCapture] Real native rate: ${nativeRate}`);
                this.detectedSampleRate = nativeRate;
            }
            return nativeRate;
        }
        return this.detectedSampleRate;
    }

    /**
     * Start capturing audio
     */
    public start(): void {
        if (this.isRecording) return;

        if (!RustAudioCapture) {
            console.error('[SystemAudioCapture] Cannot start: Rust module missing');
            return;
        }

        // LAZY INIT: Create monitor here when meeting starts (not in constructor)
        // This prevents the 1-second audio mute + quality drop at app launch
        if (!this.monitor) {
            console.log('[SystemAudioCapture] Creating native monitor (lazy init)...');
            try {
                this.monitor = new RustAudioCapture(this.deviceId);
            } catch (e) {
                console.error('[SystemAudioCapture] Failed to create native monitor:', e);
                this.emit('error', e);
                return;
            }
        }

        try {
            console.log('[SystemAudioCapture] Starting native capture...');

            this.isRecording = true; // Set BEFORE start() to prevent re-entrant calls

            this.monitor.start((err: Error | null, chunk: Buffer) => {
                // napi v3 ThreadsafeFunction passes (err, arg) format
                if (err) {
                    console.error('[SystemAudioCapture] Callback error:', err);
                    this.isRecording = false; // Allow recovery via restart
                    this.emit('error', err);
                    return;
                }
                if (chunk && chunk.length > 0) {
                    const buffer = Buffer.from(chunk);
                    this.emit('data', buffer);
                }
            }, (err: Error | null, _ended: boolean) => {
                // Speech-ended callback from Rust SilenceSuppressor.
                // _ended is always `true` when fired (Rust only invokes on speech→silence transition).
                if (err) {
                    console.error('[SystemAudioCapture] Speech ended callback error:', err);
                    return;
                }
                this.emit('speech_ended');
            });

            // getSampleRate MUST be called AFTER start() — background init updates
            // the atomic once SCK/CoreAudio initialises (~5-7s). Reading before start()
            // always returns the constructor default (48000), not the real hardware rate.
            if (typeof this.monitor.get_sample_rate === 'function') {
                // Poll until the background thread has published a non-default rate,
                // or fall back after a short delay. Use a one-shot timer so we don't
                // block the main thread.
                const pollRate = () => {
                    const rate = this.monitor?.get_sample_rate?.();
                    if (rate && rate !== this.detectedSampleRate) {
                        this.detectedSampleRate = rate;
                        console.log(`[SystemAudioCapture] Detected sample rate: ${rate}Hz`);
                    }
                };
                // Poll at 1s and 8s — covers both fast (CoreAudio) and slow (SCK) init.
                setTimeout(pollRate, 1000);
                setTimeout(pollRate, 8000);
            }

            this.emit('start');
        } catch (error) {
            console.error('[SystemAudioCapture] Failed to start:', error);
            this.isRecording = false;
            this.emit('error', error);
        }
    }

    /**
     * Stop capturing
     */
    public stop(): void {
        if (!this.isRecording) return;

        console.log('[SystemAudioCapture] Stopping capture...');
        try {
            this.monitor?.stop();
        } catch (e) {
            console.error('[SystemAudioCapture] Error stopping:', e);
        }

        // Destroy monitor so it's recreated fresh on next start()
        this.monitor = null;
        this.isRecording = false;
        this.emit('stop');
    }

    /**
     * Permanently dispose this instance.
     * Stops capture, removes all event listeners, and releases the native monitor.
     * After destroy(), do not reuse this instance.
     */
    public destroy(): void {
        this.stop();
        // Clear listeners BEFORE nulling monitor. In-flight Rust callbacks (e.g., data
        // or speech_ended delivered via napi scheduler) must not fire after disposal.
        this.removeAllListeners();
        this.monitor = null;
    }
}
