import { isTranslationStale, type TranscriptDisplayMode, type TranscriptSegment } from './transcriptSegments';

export type TranscriptRowKind =
  /** The lead line is the translation. */
  | 'translation'
  /** The lead line is the source text, final and not waiting for anything. */
  | 'source'
  /** The lead line is the source text and a translation is still expected or failed. */
  | 'awaiting';

export type TranscriptRowParts = {
  kind: TranscriptRowKind;
  lead: string;
  /** Source text shown under a translation, or null when it is hidden. */
  sourceBelow: string | null;
  /** The translation shown under the source text (mode `both`), or null when the translation leads or is absent. */
  translationBelow: string | null;
  hasTranslation: boolean;
  /** The translation belongs to an earlier revision of the text and is being redone. */
  updating: boolean;
};

type TranslationFields = Pick<
  TranscriptSegment,
  'sourceText' | 'translatedText' | 'translationState' | 'revision' | 'translatedRevision'
>;

/**
 * A translation worth showing: it differs from the source, and either belongs to the current
 * revision or is an earlier one that a pending request is replacing. A stale translation with no
 * request behind it is hidden rather than shown as if it were current.
 */
export function hasUsableTranslation(segment: TranslationFields): boolean {
  const translated = segment.translatedText?.trim();
  if (!translated || translated === segment.sourceText.trim()) return false;
  return !isTranslationStale(segment) || segment.translationState === 'pending';
}

/**
 * What a transcript row shows for a display mode. In `both` the source text leads, larger, and the
 * translation sits under it, smaller, so switching translation off never changes how the words
 * that were said are shown (owner, 2026-10-26). `translated` shows the translation alone, with the
 * source behind an expand; `original` never shows the translation.
 */
export function transcriptRowParts(
  segment: TranslationFields,
  mode: TranscriptDisplayMode,
  expanded: boolean
): TranscriptRowParts {
  const hasTranslation = hasUsableTranslation(segment);
  if (mode === 'original' || !hasTranslation) {
    const waiting =
      mode !== 'original' &&
      (segment.translationState === 'pending' || segment.translationState === 'streaming' || segment.translationState === 'error');
    return {
      kind: waiting ? 'awaiting' : 'source',
      lead: segment.sourceText,
      sourceBelow: null,
      translationBelow: null,
      hasTranslation,
      updating: false,
    };
  }
  if (mode === 'both') {
    return {
      kind: 'source',
      lead: segment.sourceText,
      sourceBelow: null,
      translationBelow: segment.translatedText!.trim(),
      hasTranslation,
      updating: isTranslationStale(segment),
    };
  }
  return {
    kind: 'translation',
    lead: segment.translatedText!.trim(),
    sourceBelow: expanded ? segment.sourceText : null,
    translationBelow: null,
    hasTranslation,
    updating: isTranslationStale(segment),
  };
}

export type RowSlot =
  /** The row is still being spoken. */
  | { kind: 'live' }
  /** A translation is on its way; elapsedSeconds is set only once it has been slow for a while. */
  | { kind: 'translating'; elapsedSeconds: number | null }
  | { kind: 'failed'; reason: TranscriptSegment['translationError'] }
  /** The translation itself fills the slot. */
  | { kind: 'translation' }
  | null;

/** A translation is called slow, and its elapsed time shown, after this long. */
export const SLOW_TRANSLATION_MS = 3000;

const FAILURE_REASON_TEXT: Record<NonNullable<TranscriptSegment['translationError']>, string> = {
  timeout: 'timed out',
  auth: 'check the API key',
  'rate-limit': 'rate limited',
  network: 'no connection',
  other: '',
};

/** The short words after "Translation failed", or an empty string when the reason is unknown. */
export function failureReasonText(reason: TranscriptSegment['translationError']): string {
  return reason ? FAILURE_REASON_TEXT[reason] : '';
}

/**
 * The slot is the line above the source text that holds "Live", then "Translating", then the
 * translation. It exists from the first live words, so a translation that arrives late fills a
 * line that is already there and moves nothing above it. No slot means translation is off, the
 * display mode is `original`, the row is own speech, or the row was skipped or is the same language.
 */
export function rowSlot(
  row:
    | 'live'
    | (TranslationFields & Pick<TranscriptSegment, 'receivedAt' | 'speaker' | 'translationError'>),
  context: { mode: TranscriptDisplayMode; translationOn: boolean; now: number }
): RowSlot {
  if (context.mode === 'original') return null;
  if (row === 'live') return context.translationOn ? { kind: 'live' } : null;
  if (row.speaker === 'user') return null;
  if (hasUsableTranslation(row)) return { kind: 'translation' };
  if (!context.translationOn) return null;
  if (row.translationState === 'error') return { kind: 'failed', reason: row.translationError };
  if (row.translationState !== 'pending' && row.translationState !== 'streaming') return null;
  const waitedMs = row.receivedAt === undefined ? 0 : context.now - row.receivedAt;
  return { kind: 'translating', elapsedSeconds: waitedMs >= SLOW_TRANSLATION_MS ? Math.floor(waitedMs / 1000) : null };
}
