import axios from 'axios';
import { normalizeBaseUrl, openAiRoot, type ConnectionType } from '../services/aiConnections';

export interface ConnectionModel { id: string; label: string }

// "Fetch models" for any connection: ask the host what it serves. Nothing is filtered or ranked:
// the list is for choosing from, and a model can also be typed by id. Errors carry a short reason
// only, never the response body or the key.

const TIMEOUT_MS = 15_000;

export async function fetchConnectionModels(input: { type: ConnectionType; baseUrl: string; apiKey: string }): Promise<ConnectionModel[]> {
    const base = normalizeBaseUrl(input.baseUrl);
    if (!base) throw new Error('The host is not a valid http or https address');
    const key = input.apiKey.trim();
    try {
        let ids: string[];
        if (input.type === 'openai') {
            const response = await axios.get(`${openAiRoot(base)}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, timeout: TIMEOUT_MS });
            ids = (response.data?.data ?? []).map((m: { id?: string }) => m.id);
        } else if (input.type === 'anthropic') {
            const root = base.endsWith('/v1') ? base : `${base}/v1`;
            const response = await axios.get(`${root}/models`, {
                params: { limit: 1000 },
                headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
                timeout: TIMEOUT_MS,
            });
            ids = (response.data?.data ?? []).map((m: { id?: string }) => m.id);
        } else if (input.type === 'gemini') {
            const root = /\/v1(beta|alpha)?$/.test(base) ? base : `${base}/v1beta`;
            const response = await axios.get(`${root}/models`, { params: { pageSize: 1000 }, headers: { 'x-goog-api-key': key }, timeout: TIMEOUT_MS });
            ids = (response.data?.models ?? []).map((m: { name?: string }) => (m.name ?? '').replace(/^models\//, ''));
        } else {
            const response = await axios.get(`${base}/api/tags`, { timeout: TIMEOUT_MS });
            ids = (response.data?.models ?? []).map((m: { name?: string }) => m.name);
        }
        return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))].sort().map(id => ({ id, label: id }));
    } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 401 || status === 403) throw new Error('The host refused the key');
        if (status === 404) throw new Error('The host does not list models here; type the model id instead');
        if (status) throw new Error(`The host answered with an error (${status})`);
        throw new Error('The host could not be reached');
    }
}
