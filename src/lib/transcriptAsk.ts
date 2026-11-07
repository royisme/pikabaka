import type { TranscriptSegment } from './transcriptSegments';

/**
 * The text put in the chat input when the user asks the agent about a transcript line. The line is
 * quoted as the other party's words (after any correction). The input is one line and the agent can
 * read the earlier transcript itself, so only the line is quoted; the user finishes the sentence.
 */
export function askAboutLineText(segment: Pick<TranscriptSegment, 'sourceText'>): string {
  return `About what they said "${segment.sourceText.trim()}": `;
}
