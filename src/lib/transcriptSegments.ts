export type TranscriptDisplayMode = 'original' | 'translated' | 'both';

export interface TranscriptSegment {
  segmentId: string;
  sourceText: string;
  translatedText?: string;
  timestamp: number;
  speakerLabel: string;
  translationState: 'pending' | 'complete' | 'error' | 'skipped';
  detectedLanguage?: string;
  revision?: number;
  speaker?: 'interviewer' | 'user';
  /** Renderer clock time at which the latest `pending` event arrived; drives the elapsed time of a slow translation. */
  receivedAt?: number;
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
  detectedLanguage?: string;
  revision?: number;
}

function defaultSpeakerLabelForEvent(event: TranscriptEventForSegment): string {
  if (event.speaker === 'user') return 'Me';
  if (event.speaker === 'interviewer') return 'Interviewer';
  return 'User 1';
}

/** A `skipped` final means translation is off or not configured; any other state means it is on. */
export function translationEnabledAfterEvent(
  current: boolean,
  state: TranscriptSegment['translationState'] | undefined
): boolean {
  return state === undefined ? current : state !== 'skipped';
}

export function upsertTranscriptSegment(
  segments: TranscriptSegment[],
  event: TranscriptEventForSegment,
  now: number = Date.now()
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
        detectedLanguage: event.detectedLanguage || undefined,
        revision: event.revision,
        speaker: event.speaker,
        receivedAt: translationState === 'pending' ? now : undefined,
      },
    ];
  }

  const updated = [...segments];
  const existing = updated[index];
  if (
    typeof event.revision === 'number' &&
    typeof existing.revision === 'number' &&
    event.revision < existing.revision
  ) {
    return segments;
  }
  updated[index] = {
    ...existing,
    sourceText,
    translatedText: event.translatedText?.trim() || existing.translatedText,
    timestamp: existing.timestamp,
    speakerLabel: event.speakerLabel?.trim()
      ? event.speakerLabel.trim().slice(0, 32)
      : existing.speakerLabel,
    translationState: event.translationState || existing.translationState,
    detectedLanguage: event.detectedLanguage || existing.detectedLanguage,
    revision: event.revision ?? existing.revision,
    speaker: event.speaker ?? existing.speaker,
    receivedAt: event.translationState === 'pending' ? now : existing.receivedAt,
  };
  return updated;
}
