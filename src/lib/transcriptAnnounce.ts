import { hasUsableTranslation } from './transcriptRow';
import type { TranscriptSegment } from './transcriptSegments';

type Announceable = Pick<
  TranscriptSegment,
  'segmentId' | 'sourceText' | 'translatedText' | 'translationState' | 'revision' | 'translatedRevision' | 'speaker'
>;

export function announcementKey(segment: Pick<TranscriptSegment, 'segmentId' | 'revision'>): string {
  return `${segment.segmentId}:${segment.revision ?? 0}`;
}

/**
 * What a screen reader should hear next: the newest other-party translation that is complete,
 * current and not announced yet. Partial text and translations still in progress are never read,
 * because the transcript list itself is not a live region. Older translations that arrived in
 * the same burst are marked announced without being read, so a reconnect does not read a backlog.
 */
export function nextAnnouncement(
  segments: readonly Announceable[],
  announced: ReadonlySet<string>
): { text: string; keys: string[] } | null {
  const fresh = segments.filter(
    (segment) =>
      segment.speaker !== 'user' &&
      segment.translationState === 'complete' &&
      hasUsableTranslation(segment) &&
      !announced.has(announcementKey(segment))
  );
  const newest = fresh[fresh.length - 1];
  if (!newest) return null;
  return { text: newest.translatedText!.trim(), keys: fresh.map(announcementKey) };
}
