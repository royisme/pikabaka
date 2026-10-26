/** The reader counts as following the stream while the list bottom is closer than this. */
export const FOLLOW_THRESHOLD_PX = 32;

export type ScrollMetrics = { scrollHeight: number; scrollTop: number; clientHeight: number };

export type ScrollAction = 'show-start' | 'follow' | 'none';

export function isNearBottom(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < FOLLOW_THRESHOLD_PX;
}

/**
 * A message that has not been shown yet scrolls its start into view once, so the first
 * sentence of a streaming answer stays readable. Later growth of that same message only
 * follows the bottom while the reader is already there.
 */
export function nextScrollAction(
  lastMessageId: string | undefined,
  shownMessageId: string | undefined,
  following: boolean
): ScrollAction {
  if (!lastMessageId) return 'none';
  if (lastMessageId !== shownMessageId) return 'show-start';
  return following ? 'follow' : 'none';
}

/**
 * The transcript is a log: the newest line is the news, so while the reader is at the bottom
 * every content change (a row, a live partial, a translation, a revision) keeps the bottom
 * in view. Once the reader has scrolled up, nothing moves.
 */
export function nextTranscriptScroll(args: { following: boolean; contentChanged: boolean }): 'pin' | 'hold' {
  return args.following && args.contentChanged ? 'pin' : 'hold';
}

/** Rows added since following stopped; live partials and translation updates add none. */
export function countNewRows(totalRows: number, rowsWhenFollowStopped: number | null): number {
  return rowsWhenFollowStopped === null ? 0 : Math.max(0, totalRows - rowsWhenFollowStopped);
}
