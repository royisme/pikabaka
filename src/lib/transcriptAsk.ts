import type { TranscriptSegment } from './transcriptSegments';

/**
 * The text put in the chat input when the user asks the agent about a transcript line. The line is
 * quoted as the other party's words (after any correction). The input is one line and the agent can
 * read the earlier transcript itself, so only the line is quoted; the user finishes the sentence.
 */
export function askAboutLineText(segment: Pick<TranscriptSegment, 'sourceText'>): string {
  return `About what they said "${segment.sourceText.trim()}": `;
}

/**
 * The text put in the chat input when the user says a proactive card is wrong. It carries the card
 * and the line that triggered it (found by the card's segment id; the card alone when that line is
 * gone), so the user only adds why, and the agent answers again with the same context.
 */
export function challengeCardText(card: { text: string; segmentId: string }, segments: ReadonlyArray<Pick<TranscriptSegment, 'segmentId' | 'sourceText'>>): string {
  const line = segments.find((segment) => segment.segmentId === card.segmentId);
  const about = line ? ` for what they said "${line.sourceText.trim()}"` : '';
  return `Pika suggested "${card.text}"${about}, but that is not right: `;
}

/** What a Reply to one transcript line sends: the prompt, and the line the answer card shows as "Re:". */
export interface ReplyRequest {
  userText: string;
  replyTo: string;
}

/** Reply to this line, not to the latest words: the line is quoted in the prompt and becomes the card's context. */
export function replyToLineRequest(segment: Pick<TranscriptSegment, 'sourceText'>): ReplyRequest {
  const line = segment.sourceText.trim();
  return { userText: `What should I say in response to: "${line}"?`, replyTo: line };
}
