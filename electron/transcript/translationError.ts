export type TranslationErrorReason = 'timeout' | 'auth' | 'rate-limit' | 'network' | 'other';

/**
 * Reduces a failed translation request to a reason the reader can act on. Only the reason leaves
 * this function: provider messages can echo the request, so they are never sent to the renderer
 * or logged.
 */
export function classifyTranslationError(error: unknown): TranslationErrorReason {
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const status = Number(record.status ?? record.statusCode ?? (record.response as { status?: unknown } | undefined)?.status);
  const code = typeof record.code === 'string' ? record.code : '';
  const name = typeof record.name === 'string' ? record.name : '';
  const message = typeof record.message === 'string' ? record.message : typeof error === 'string' ? error : '';

  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|invalid[^a-z]*(api[ _-]?)?key|api[ _-]?key|permission denied/i.test(message)) return 'auth';
  if (status === 429 || /rate[ _-]?limit|quota|too many requests|resource[_ ]exhausted/i.test(message)) return 'rate-limit';
  if (code === 'ETIMEDOUT' || name === 'AbortError' || name === 'TimeoutError' || /time(d)?[ _-]?out|deadline exceeded/i.test(message)) return 'timeout';
  if (/^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH)$/.test(code) || /fetch failed|network|socket hang up|getaddrinfo|ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(message)) return 'network';
  return 'other';
}
