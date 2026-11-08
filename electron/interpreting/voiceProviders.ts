import { RECOGNITION_LANGUAGES } from '../config/languages';

export type VoiceProviderId = 'fishaudio' | 'elevenlabs';

export interface VoiceProvider {
    /** mp3 bytes of `text` spoken in `voiceId`. `language` is a RECOGNITION_LANGUAGES key. */
    synthesize(text: string, voiceId: string, language: string): Promise<Uint8Array>;
    /** Creates a private voice from one WAV sample of the user; returns the provider's voice id. */
    cloneVoice(sample: Uint8Array, name: string): Promise<{ voiceId: string; needsVerification: boolean }>;
    deleteVoice(voiceId: string): Promise<void>;
}

export type FetchFn = typeof fetch;

export const ELEVENLABS_MODEL = 'eleven_flash_v2_5';
export const FISH_MODEL = 's2.1-pro';

const CLONE_DESCRIPTION = "The account owner's own voice, recorded in Pika for interpreting.";
const FISH_STATES = ['created', 'training', 'trained', 'failed'];

/** Carries a fixed message only: never the key, the request text or a response body. */
export class VoiceProviderError extends Error {
    constructor(
        message: string,
        readonly status?: number,
    ) {
        super(message);
        this.name = 'VoiceProviderError';
    }
}

function statusMessage(label: string, status: number): string {
    if (status === 401 || status === 403) {
        return label === 'ElevenLabs'
            ? 'This ElevenLabs key is not allowed to use Text to Speech or Voices. Allow them for the key on elevenlabs.io.'
            : `${label} rejected the API key.`;
    }
    if (status === 402) return `${label} has no credits left for this request.`;
    if (status === 422) return `${label} rejected the input.`;
    if (status === 429) return `${label} rate limit reached. Try again shortly.`;
    if (status >= 500) return `${label} is unavailable right now (HTTP ${status}).`;
    return `${label} rejected the request (HTTP ${status}).`;
}

async function send(label: string, fetchFn: FetchFn, url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
        res = await fetchFn(url, init);
    } catch {
        throw new VoiceProviderError(`Could not reach ${label}. Check the network connection.`);
    }
    if (!res.ok) throw new VoiceProviderError(statusMessage(label, res.status), res.status);
    return res;
}

async function readJson(label: string, res: Response): Promise<Record<string, unknown>> {
    try {
        const body: unknown = await res.json();
        if (body && typeof body === 'object') return body as Record<string, unknown>;
    } catch {
        // fall through to the fixed message
    }
    throw new VoiceProviderError(`${label} returned an unexpected response.`);
}

async function readAudio(label: string, res: Response): Promise<Uint8Array> {
    try {
        return new Uint8Array(await res.arrayBuffer());
    } catch {
        throw new VoiceProviderError(`${label} returned an unexpected response.`);
    }
}

function sampleForm(sample: Uint8Array, fileField: string): FormData {
    const form = new FormData();
    form.append(fileField, new Blob([sample as BlobPart], { type: 'audio/wav' }), 'sample.wav');
    return form;
}

export function elevenLabs(apiKey: string, fetchFn: FetchFn = globalThis.fetch): VoiceProvider {
    const label = 'ElevenLabs';
    const base = 'https://api.elevenlabs.io/v1';
    const auth = { 'xi-api-key': apiKey };
    return {
        async synthesize(text, voiceId, language) {
            const body: Record<string, string> = { text, model_id: ELEVENLABS_MODEL };
            const code = RECOGNITION_LANGUAGES[language]?.iso639;
            if (code) body.language_code = code;
            const res = await send(label, fetchFn, `${base}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
                method: 'POST',
                headers: { ...auth, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            return readAudio(label, res);
        },
        async cloneVoice(sample, name) {
            const form = sampleForm(sample, 'files');
            form.append('name', name);
            form.append('description', CLONE_DESCRIPTION);
            const res = await send(label, fetchFn, `${base}/voices/add`, { method: 'POST', headers: auth, body: form });
            const json = await readJson(label, res);
            if (typeof json.voice_id !== 'string' || !json.voice_id) {
                throw new VoiceProviderError(`${label} returned an unexpected response.`);
            }
            return { voiceId: json.voice_id, needsVerification: json.requires_verification === true };
        },
        async deleteVoice(voiceId) {
            await send(label, fetchFn, `${base}/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE', headers: auth });
        },
    };
}

export function fishAudio(apiKey: string, fetchFn: FetchFn = globalThis.fetch): VoiceProvider {
    const label = 'Fish Audio';
    const base = 'https://api.fish.audio';
    const auth = { Authorization: `Bearer ${apiKey}` };
    return {
        async synthesize(text, voiceId) {
            const res = await send(label, fetchFn, `${base}/v1/tts`, {
                method: 'POST',
                headers: { ...auth, model: FISH_MODEL, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, reference_id: voiceId, format: 'mp3', latency: 'balanced', normalize: true }),
            });
            return readAudio(label, res);
        },
        async cloneVoice(sample, name) {
            const form = sampleForm(sample, 'voices');
            form.append('type', 'tts');
            form.append('title', name);
            form.append('description', CLONE_DESCRIPTION);
            form.append('train_mode', 'fast');
            form.append('visibility', 'private');
            const res = await send(label, fetchFn, `${base}/model`, { method: 'POST', headers: auth, body: form });
            const json = await readJson(label, res);
            if (typeof json._id !== 'string' || !json._id) {
                throw new VoiceProviderError(`${label} returned an unexpected response.`);
            }
            if (json.state !== 'trained') {
                const state = typeof json.state === 'string' && FISH_STATES.includes(json.state) ? json.state : 'unknown';
                throw new VoiceProviderError(`${label} has not finished this voice (state: ${state}).`);
            }
            return { voiceId: json._id, needsVerification: false };
        },
        async deleteVoice(voiceId) {
            await send(label, fetchFn, `${base}/model/${encodeURIComponent(voiceId)}`, { method: 'DELETE', headers: auth });
        },
    };
}
