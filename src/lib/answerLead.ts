import type { TranscriptSegment } from './transcriptSegments';

/**
 * Splits an answer into its first sentence (the thing to say, shown larger) and the rest. A
 * sentence ends at . ! ? or the full-width forms followed by a space, a line break or the end. A
 * very short stretch before a full stop ("e.g.") is not taken for a sentence. While an answer is
 * still streaming and has no sentence end yet, the text so far is all lead.
 */
export function splitLead(text: string): { lead: string; rest: string } {
  const match = /^([\s\S]{12,}?[.!?。！？])(?=\s|$)/.exec(text.trimStart());
  if (!match) return { lead: text.trim(), rest: '' };
  const trimmed = text.trimStart();
  return { lead: match[1].trim(), rest: trimmed.slice(match[1].length).trim() };
}

/**
 * What the other party said last: the text a "what to say" answer replies to. A live partial is
 * newer than any final line (a turn flushes a second or more after its last word), so it wins.
 */
export function latestOtherPartyText(
  segments: ReadonlyArray<Pick<TranscriptSegment, 'sourceText' | 'speaker'>>,
  livePartial?: string
): string | undefined {
  if (livePartial?.trim()) return livePartial.trim();
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].speaker !== 'user') return segments[i].sourceText.trim() || undefined;
  }
  return undefined;
}
