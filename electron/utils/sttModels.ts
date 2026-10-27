import axios from 'axios';

export interface SttModel { id: string; label: string }

export type SttModelProvider = 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'soniox';

export const STT_MODEL_PROVIDERS: SttModelProvider[] = ['deepgram', 'groq', 'openai', 'elevenlabs', 'soniox'];

// "Fetch models" for speech recognition: what the service itself says it offers. Lists are for
// choosing from; a model can also be typed. Errors carry a short reason only, never a body or key.

const TIMEOUT_MS = 15_000;

const only = (ids: unknown[], keep: (id: string) => boolean): SttModel[] =>
    [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== '' && keep(id)))].sort().map(id => ({ id, label: id }));

export async function fetchSttModels(provider: SttModelProvider, apiKey: string): Promise<SttModel[]> {
    const key = apiKey.trim();
    if (!key) throw new Error('Save or type the API key first');
    try {
        if (provider === 'deepgram') {
            const response = await axios.get('https://api.deepgram.com/v1/models', { headers: { Authorization: `Token ${key}` }, timeout: TIMEOUT_MS });
            // `stt` entries carry a canonical name such as "nova-3"; keep it, not every dated build.
            return only((response.data?.stt ?? []).map((m: { canonical_name?: string; name?: string }) => m.canonical_name ?? m.name), () => true);
        }
        if (provider === 'groq' || provider === 'openai') {
            const url = provider === 'groq' ? 'https://api.groq.com/openai/v1/models' : 'https://api.openai.com/v1/models';
            const response = await axios.get(url, { headers: { Authorization: `Bearer ${key}` }, timeout: TIMEOUT_MS });
            return only((response.data?.data ?? []).map((m: { id?: string }) => m.id), id => /whisper|transcribe/i.test(id));
        }
        if (provider === 'elevenlabs') {
            const response = await axios.get('https://api.elevenlabs.io/v1/models', { headers: { 'xi-api-key': key }, timeout: TIMEOUT_MS });
            return only((Array.isArray(response.data) ? response.data : []).map((m: { model_id?: string }) => m.model_id), id => /scribe|stt|speech_to_text/i.test(id));
        }
        const response = await axios.get('https://api.soniox.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, timeout: TIMEOUT_MS });
        const list = Array.isArray(response.data) ? response.data : response.data?.models ?? response.data?.data ?? [];
        return only(list.map((m: { id?: string; name?: string }) => m.id ?? m.name), id => /stt|rt|transcri/i.test(id));
    } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 401 || status === 403) throw new Error('The service refused the key');
        if (status === 404) throw new Error('The service does not list models here; type the model id instead');
        if (status) throw new Error(`The service answered with an error (${status})`);
        throw new Error('The service could not be reached');
    }
}
