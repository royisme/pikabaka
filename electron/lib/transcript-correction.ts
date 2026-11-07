import { classifyTranslationError } from '../transcript/translationError';

/** Kept in one place so the owner can tune it. */
export const CORRECTION_SYSTEM_PROMPT =
  "You fix speech-to-text errors in one line of a live transcript. You get the scenario, up to 6 earlier lines, and the LINE to fix.\n" +
  "Fix a word when it is a mishearing of a word that sounds alike, and the scenario or the earlier lines point to the right word: a word the speaker used a moment ago, a word of the lesson topic, a foreign word written as unrelated characters, or a word spelled wrongly. Prefer a word that already appears in the earlier lines over a new one.\n" +
  "Never delete words, never add words, keep repeated words and filler (a stutter stays), never translate, never fix grammar, style or punctuation, never rewrite a sentence. Replace words one for one. A foreign word stays foreign: never replace it with its translation (\"cabinet\" must not become \"cupboard\").\n" +
  "If nothing in the line is a clear mishearing, return it exactly as given. Do not invent a word that has no support in the scenario or the earlier lines. When the scenario is \"none\", change a word only if an earlier line shows the right form; otherwise return the line unchanged.\n" +
  "Examples (invented). Earlier lines are about the pronoun y replacing a place: line \"这里的 爱 代替了地点\" -> \"这里的 y 代替了地点\". Earlier lines are about the verb aller: line \"jus qua la gare\" -> \"jusqu'à la gare\". Line \"Je Je vais Je vais en\" -> unchanged (repeats are speech). Line \"cabinet 就是是吗\" -> unchanged (no support).\n" +
  "Reply with JSON only: {\"text\": \"...\"}.";

export const CORRECTION_TIMEOUT_MS = 10_000;
export const CORRECTION_MAX_EARLIER_LINES = 6;
const MIN_CORRECTABLE_CHARS = 2;

export type CorrectionSpeaker = 'them' | 'user';
export interface CorrectionLine { speaker: CorrectionSpeaker; text: string }

/** One model call: a system prompt and a user message in, the model's text out. */
export type CorrectionComplete = (system: string, user: string, signal: AbortSignal) => Promise<string>;

const label = (speaker: CorrectionSpeaker): string => (speaker === 'user' ? 'You' : 'Them');

export function buildCorrectionUser(scenario: string | undefined, earlier: CorrectionLine[], line: CorrectionLine): string {
  const lines = earlier.slice(-CORRECTION_MAX_EARLIER_LINES).map((item) => `${label(item.speaker)}: ${item.text}`).join('\n');
  return `Scenario: ${scenario?.trim() || 'none'}\n\nEarlier lines:\n${lines}\n\nLINE (${label(line.speaker)}): ${line.text}`;
}

function parseCorrection(raw: string): string | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { text?: unknown };
  return typeof parsed.text === 'string' ? parsed.text.trim() : undefined;
}

/**
 * The line with clearly misheard words fixed, or the line itself on any doubt: bad JSON, an empty
 * or runaway answer, a timeout or a failed request. Failures are logged by class only, never the text.
 */
export async function correctLine(params: {
  line: CorrectionLine;
  earlier: CorrectionLine[];
  scenario?: string;
  complete: CorrectionComplete;
  timeoutMs?: number;
}): Promise<string> {
  const { line, earlier, scenario, complete, timeoutMs = CORRECTION_TIMEOUT_MS } = params;
  const original = line.text.trim();
  if (original.length < MIN_CORRECTABLE_CHARS) return line.text;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), { once: true });
    });
    const raw = await Promise.race([complete(CORRECTION_SYSTEM_PROMPT, buildCorrectionUser(scenario, earlier, line), controller.signal), aborted]);
    const text = parseCorrection(raw);
    if (!text || text.length > original.length * 2 + 20 || text.length < original.length * 0.7) return line.text;
    return text;
  } catch (error) {
    console.warn('[Main] Transcript correction failed:', error instanceof SyntaxError ? 'bad-json' : classifyTranslationError(error));
    return line.text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Corrects one flushed turn. Resolves to the corrected text, or null when nothing changed or the
 * turn was reopened or corrected again while the model worked (a stale result is dropped).
 */
export async function correctTurn(params: {
  line: CorrectionLine;
  earlier: CorrectionLine[];
  scenario?: string;
  complete: CorrectionComplete;
  isLatest: () => boolean;
}): Promise<string | null> {
  const corrected = await correctLine(params);
  if (corrected.trim() === params.line.text.trim()) return null;
  return params.isLatest() ? corrected : null;
}

/** The connection and model for correction, or undefined when it is off or not usable. */
export function resolveCorrectionTarget<C>(cm: {
  getTranscriptCorrectionEnabled(): boolean;
  getTranscriptCorrectionProvider(): string;
  getTranscriptCorrectionModel(): string;
  resolveConnection(id: string): C | undefined;
  isConnectionReady(id: string): boolean;
}): { connection: C; model: string } | undefined {
  if (!cm.getTranscriptCorrectionEnabled()) return undefined;
  const model = cm.getTranscriptCorrectionModel().trim();
  const provider = cm.getTranscriptCorrectionProvider();
  const connection = cm.resolveConnection(provider);
  if (!model || !connection || !cm.isConnectionReady(provider)) return undefined;
  return { connection, model };
}
