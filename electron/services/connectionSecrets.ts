export interface ConnectionSecrets { apiKey?: string; headers?: Record<string, string> }

/** Drop SDK request/response objects and redact secrets before formatting, truncating or logging. */
export function redactConnectionError(error: unknown, secrets?: ConnectionSecrets): Error & { status?: number; code?: string } {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    let message = typeof record.message === 'string' ? record.message : String(error);
    const values = [secrets?.apiKey, ...Object.values(secrets?.headers ?? {})].filter((value): value is string => !!value);
    const variants = values.flatMap(value => [value, value.trim()]).filter(Boolean)
        .flatMap(value => [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value.toWellFormed())]);
    for (const value of [...new Set(variants)].sort((a, b) => b.length - a.length)) message = message.replaceAll(value, '[redacted]');
    const safe: Error & { status?: number; code?: string } = new Error(message);
    const status = Number(record.status ?? record.statusCode ?? (record.response as { status?: unknown } | undefined)?.status);
    if (Number.isFinite(status) && status > 0) safe.status = status;
    if (record.name === 'AbortError' || record.name === 'TimeoutError') safe.name = record.name;
    if (typeof record.code === 'string' && /^(ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH)$/.test(record.code)) safe.code = record.code;
    return safe;
}
