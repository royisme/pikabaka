// A connection is where a model is reached: a type (the wire protocol), a host and a key. What the
// model is used for (the agent, translation, chat) is chosen separately and names a connection.
// Pika is not tied to any provider: OpenAI, Groq, OpenRouter, a gateway of your own and the like
// are all the `openai` type with their own host; Claude and compatible services are `anthropic`.

import type { HeaderState } from './connectionHeaders';

export type ConnectionType = 'openai' | 'anthropic' | 'gemini';

export const CONNECTION_TYPES: ConnectionType[] = ['openai', 'anthropic', 'gemini'];

/** The built-in connections: where each type is reached by default. Their host can be overridden. */
export const BUILTIN_CONNECTIONS = [
    { id: 'gemini', name: 'Google Gemini', type: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com' },
    { id: 'openai', name: 'OpenAI', type: 'openai', defaultBaseUrl: 'https://api.openai.com/v1' },
    { id: 'claude', name: 'Anthropic Claude', type: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com' },
    { id: 'groq', name: 'Groq', type: 'openai', defaultBaseUrl: 'https://api.groq.com/openai/v1' },
] as const satisfies ReadonlyArray<{ id: string; name: string; type: ConnectionType; defaultBaseUrl: string }>;

export type BuiltinConnectionId = (typeof BUILTIN_CONNECTIONS)[number]['id'];

export const isBuiltinConnection = (id: string): id is BuiltinConnectionId => BUILTIN_CONNECTIONS.some(c => c.id === id);

/** A connection with its key, for the main process only. */
export interface Connection {
    id: string;
    name: string;
    type: ConnectionType;
    /** The host in use: the override, or the type's default. */
    baseUrl: string;
    apiKey: string;
    headers?: Record<string, string>;
    builtin: boolean;
}

/** A connection as the settings screen sees it: never the key itself. */
export interface ConnectionView {
    id: string;
    name: string;
    type: ConnectionType;
    baseUrl: string;
    /** True when the host is not the default one. */
    customBaseUrl: boolean;
    hasApiKey: boolean;
    headers?: HeaderState[];
    builtin: boolean;
}

const MAX_BASE_URL = 2048;

/**
 * The trimmed `http(s)` host without a trailing slash, or undefined when it is empty or unusable.
 * Paths are joined by string, so credentials, a query or a fragment would be sent to the host or
 * silently dropped: they are refused.
 */
export function normalizeBaseUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_BASE_URL) return undefined;
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return undefined;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return trimmed.replace(/\/+$/, '');
}

/** The root an OpenAI-type host is called at: a bare host gets `/v1`, a host with a path (OpenRouter, Groq) is used as typed. */
export function openAiRoot(baseUrl: string): string {
    try {
        const url = new URL(baseUrl);
        return url.pathname === '/' || url.pathname === '' ? `${baseUrl.replace(/\/+$/, '')}/v1` : baseUrl.replace(/\/+$/, '');
    } catch {
        return baseUrl;
    }
}

/** A local server may run without a key. */
export function isLoopbackUrl(baseUrl: string): boolean {
    try {
        const host = new URL(baseUrl).hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    } catch {
        return false;
    }
}

export const connectionNeedsKey = (baseUrl: string): boolean => !isLoopbackUrl(baseUrl);
