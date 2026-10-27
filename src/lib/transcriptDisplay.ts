import type { TranscriptDisplayMode } from './transcriptSegments';

/**
 * The header's "Original" toggle flips between showing the source under each translation
 * (`both`) and hiding it (`translated`). From `original` it goes to `both`. The header never
 * writes `original`: that option stays in Settings.
 */
export function toggleOriginal(mode: TranscriptDisplayMode): TranscriptDisplayMode {
  return mode === 'both' ? 'translated' : 'both';
}
