export type HeaderEdit = { op: 'keep' | 'remove'; name: string } | { op: 'set'; name: string; value: string };
export interface HeaderState { name: string; set: true }

const RESERVED = new Set([
    'host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'expect', 'trailer', 'te',
    'authorization', 'proxy-authorization', 'x-api-key', 'x-goog-api-key', 'anthropic-version', 'anthropic-beta',
    'openai-organization', 'openai-project',
    'content-type', 'accept', 'accept-encoding', 'user-agent', 'x-goog-api-client',
    'anthropic-dangerous-direct-browser-access',
]);

/** The single validation boundary for stored maps and write-only IPC edits. Auth stays SDK-owned. */
export function editConnectionHeaders(stored: unknown, edits?: unknown): { headers?: Record<string, string> } | { error: string } {
    const headers: Record<string, string> = Object.create(null);
    const validate = (name: unknown, value?: unknown): string | undefined => {
        const label = typeof name === 'string' ? JSON.stringify(name).slice(0, 100) : '(unnamed)';
        if (typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return `Header ${label}: use an HTTP token name`;
        if (RESERVED.has(name.toLowerCase()) || name.toLowerCase().startsWith('x-stainless-')) return `Header ${label} is reserved for the HTTP client`;
        if (value !== undefined && (typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(value))) return `Header ${label}: values must be text without control characters`;
        return undefined;
    };
    if (stored !== undefined) {
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { error: 'Invalid stored headers' };
        const seen = new Set<string>();
        for (const [name, value] of Object.entries(stored)) {
            const error = validate(name, value);
            if (error) return { error };
            if (seen.has(name.toLowerCase())) return { error: `Duplicate header ${JSON.stringify(name)}` };
            seen.add(name.toLowerCase());
            headers[name] = value as string;
        }
    }
    if (edits !== undefined) {
        if (!Array.isArray(edits) || edits.length > 64) return { error: 'Invalid header edits (at most 64 per save)' };
        const seen = new Set<string>();
        for (const edit of edits) {
            if (!edit || typeof edit !== 'object') return { error: 'Invalid header edit' };
            const error = validate(edit.name, edit.op === 'set' ? edit.value : undefined);
            if (error) return { error };
            const lower = edit.name.toLowerCase();
            if (seen.has(lower)) return { error: `Duplicate header ${JSON.stringify(edit.name)}` };
            seen.add(lower);
            if (!['keep', 'set', 'remove'].includes(edit.op) || (edit.op === 'set' && typeof edit.value !== 'string')) return { error: `Invalid edit for header ${JSON.stringify(edit.name)}` };
            const previous = Object.keys(headers).find(name => name.toLowerCase() === lower);
            if (edit.op === 'remove' || (edit.op === 'set' && edit.value.trim())) {
                if (previous !== undefined) delete headers[previous];
                if (edit.op === 'set') headers[edit.name] = edit.value;
            }
        }
    }
    let bytes = 0;
    for (const [index, [name, value]] of Object.entries(headers).entries()) {
        bytes += Buffer.byteLength(name) + Buffer.byteLength(value);
        if (index >= 32 || bytes > 8192) return { error: `Header ${JSON.stringify(name)} exceeds the limit (32 headers, 8192 total bytes)` };
    }
    return { headers: Object.keys(headers).length ? { ...headers } : undefined };
}
