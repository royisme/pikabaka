import { classifyTranslationError } from '../transcript/translationError';

export interface ModelTestResult {
  success: boolean;
  reply?: string;
  firstTokenMs?: number;
  totalMs?: number;
  error?: string;
}

/** Collects an invented-question stream, never a meeting request or its error message. */
export async function runModelTest(stream: AsyncIterable<string>, apiKey: string): Promise<ModelTestResult> {
  const startedAt = Date.now();
  let reply = '';
  let firstTokenMs: number | undefined;
  try {
    for await (const part of stream) {
      if (part && firstTokenMs === undefined) firstTokenMs = Date.now() - startedAt;
      reply += part;
    }
    if (!reply.trim()) throw new Error('The model returned no text');
    return { success: true, reply: reply.trim(), firstTokenMs, totalMs: Date.now() - startedAt };
  } catch (error) {
    const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
    const status = Number(record.status ?? record.statusCode ?? (record.response as { status?: unknown } | undefined)?.status);
    const rawMessage = typeof record.message === 'string' ? record.message : String(error);
    // Authentication errors can echo the key even though the question itself is invented.
    const message = (apiKey ? rawMessage.replaceAll(apiKey, '[redacted]') : rawMessage).replace(/\s+/g, ' ').slice(0, 300);
    return {
      success: false,
      firstTokenMs,
      totalMs: Date.now() - startedAt,
      error: `${classifyTranslationError(error)}${Number.isFinite(status) && status > 0 ? ` (HTTP ${status})` : ''}: ${message}`,
    };
  }
}
