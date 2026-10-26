import type { TranscriptDisplayMode, TranscriptSegment } from './transcriptSegments';

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
  hasTranslation: boolean;
};

export function hasUsableTranslation(segment: Pick<TranscriptSegment, 'sourceText' | 'translatedText'>): boolean {
  const translated = segment.translatedText?.trim();
  return !!translated && translated !== segment.sourceText.trim();
}

/**
 * What a transcript row shows for a display mode. The translation leads: on a call it is the
 * text to read, and the source is there to check names and numbers. `translated` keeps the
 * source behind an expand; `original` never shows the translation.
 */
export function transcriptRowParts(
  segment: Pick<TranscriptSegment, 'sourceText' | 'translatedText' | 'translationState'>,
  mode: TranscriptDisplayMode,
  expanded: boolean
): TranscriptRowParts {
  const hasTranslation = hasUsableTranslation(segment);
  if (mode === 'original' || !hasTranslation) {
    const waiting =
      mode !== 'original' && (segment.translationState === 'pending' || segment.translationState === 'error');
    return {
      kind: waiting ? 'awaiting' : 'source',
      lead: segment.sourceText,
      sourceBelow: null,
      hasTranslation,
    };
  }
  const showSource = mode === 'both' || expanded;
  return {
    kind: 'translation',
    lead: segment.translatedText!.trim(),
    sourceBelow: showSource ? segment.sourceText : null,
    hasTranslation,
  };
}
