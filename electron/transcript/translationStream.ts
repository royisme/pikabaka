// Turns each provider's streaming wire format into plain text deltas. Kept separate from LLMHelper
// so the formats can be tested without a network or an SDK.

export async function* openAIDeltas(
  stream: AsyncIterable<{ choices?: Array<{ delta?: { content?: string | null } }> }>
): AsyncGenerator<string> {
  for await (const chunk of stream) {
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

export async function* anthropicDeltas(stream: AsyncIterable<{ type: string }>): AsyncGenerator<string> {
  for await (const event of stream) {
    // Only content_block_delta events carry text; the SDK's other events have other `delta` shapes.
    if (event.type !== 'content_block_delta') continue;
    const delta = (event as { delta?: { type?: string; text?: string } }).delta;
    if (delta?.type === 'text_delta' && delta.text) yield delta.text;
  }
}

export async function* geminiDeltas(stream: AsyncIterable<{ text?: string }>): AsyncGenerator<string> {
  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}

/** Ollama streams one JSON object per line; a line can be split across network chunks. */
export async function* ollamaDeltas(body: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = '';

  function* readLine(line: string): Generator<string> {
    const trimmed = line.trim();
    if (!trimmed) return;
    const message = JSON.parse(trimmed) as { response?: string; error?: string };
    if (message.error) throw new Error('Ollama stream error');
    if (message.response) yield message.response;
  }

  for await (const chunk of body) {
    pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) yield* readLine(line);
  }
  pending += decoder.decode();
  yield* readLine(pending);
}

/**
 * Accumulates deltas and reports the text so far, at most once per `minIntervalMs` (the first delta
 * is always reported, so the time to the first token can be measured). Returns the full text; the
 * caller reports that itself.
 */
export async function streamText(
  deltas: AsyncIterable<string>,
  onUpdate: (textSoFar: string) => void,
  options: { minIntervalMs?: number; now?: () => number } = {}
): Promise<string> {
  const minIntervalMs = options.minIntervalMs ?? 80;
  const now = options.now ?? Date.now;
  let text = '';
  let lastReportAt = Number.NEGATIVE_INFINITY;
  for await (const delta of deltas) {
    text += delta;
    const at = now();
    if (at - lastReportAt >= minIntervalMs) {
      lastReportAt = at;
      onUpdate(text);
    }
  }
  return text;
}

export type TranslationTiming = {
  provider: string;
  model: string;
  /** From the end of the speech in the turn to the request starting: the assembler's flush delay. */
  flushGapMs: number | null;
  /** From the request starting to the first text; null if none arrived before the end. */
  firstTokenMs: number | null;
  totalMs: number;
  sourceChars: number;
  outputChars: number;
  streamed: boolean;
  outcome: 'complete' | 'error';
};

/** One log line of ids, numbers and names. Never the text. */
export function formatTranslationTiming(timing: TranslationTiming): string {
  const field = (name: string, value: string | number | boolean | null) => `${name}=${value === null ? 'n/a' : value}`;
  return [
    '[Translation] timing',
    field('provider', timing.provider),
    field('model', timing.model),
    field('flushGapMs', timing.flushGapMs),
    field('firstTokenMs', timing.firstTokenMs),
    field('totalMs', timing.totalMs),
    field('sourceChars', timing.sourceChars),
    field('outputChars', timing.outputChars),
    field('streamed', timing.streamed),
    field('outcome', timing.outcome),
  ].join(' ');
}
