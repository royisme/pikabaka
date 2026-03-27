export type TranscriptDisplayMode = 'original' | 'translated' | 'both';

export interface TranscriptSegment {
  segmentId: string;
  sourceText: string;
  translatedText?: string;
  timestamp: number;
  speakerLabel: string;
  translationState: 'pending' | 'complete' | 'error' | 'skipped';
}

export interface TranscriptEventForSegment {
  final: boolean;
  text: string;
  sourceText?: string;
  translatedText?: string;
  segmentId?: string;
  /** When `speakerLabel` is omitted, defaults: interviewer -> Interviewer, user -> Me, unknown -> User 1 */
  speaker?: 'interviewer' | 'user';
  speakerLabel?: string;
  timestamp?: number;
  translationState?: 'pending' | 'complete' | 'error' | 'skipped';
}

function defaultSpeakerLabelForEvent(event: TranscriptEventForSegment): string {
  if (event.speaker === 'user') return 'Me';
  if (event.speaker === 'interviewer') return 'Interviewer';
  return 'User 1';
}

export function upsertTranscriptSegment(
  segments: TranscriptSegment[],
  event: TranscriptEventForSegment
): TranscriptSegment[] {
  if (!event.final || !event.segmentId) {
    return segments;
  }

  const sourceText = (event.sourceText || event.text || '').trim();
  if (!sourceText) {
    return segments;
  }

  const speakerLabel = (event.speakerLabel?.trim() || defaultSpeakerLabelForEvent(event)).slice(0, 32);
  const translationState = event.translationState || 'skipped';

  const index = segments.findIndex((item) => item.segmentId === event.segmentId);
  if (index === -1) {
    return [
      ...segments,
      {
        segmentId: event.segmentId,
        sourceText,
        translatedText: event.translatedText?.trim() || undefined,
        timestamp: event.timestamp ?? Date.now(),
        speakerLabel,
        translationState,
      },
    ];
  }

  const updated = [...segments];
  const existing = updated[index];
  updated[index] = {
    ...existing,
    sourceText,
    translatedText: event.translatedText?.trim() || existing.translatedText,
    timestamp: event.timestamp ?? existing.timestamp,
    speakerLabel: event.speakerLabel?.trim()
      ? event.speakerLabel.trim().slice(0, 32)
      : existing.speakerLabel,
    translationState: event.translationState || existing.translationState,
  };
  return updated;
}
