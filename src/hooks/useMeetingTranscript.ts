import { useCallback, useEffect, useRef, useState } from 'react';
import { upsertTranscriptSegment, type TranscriptDisplayMode, type TranscriptSegment } from '../lib/transcriptSegments';

export function useMeetingTranscript() {
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
  const [currentInterviewerPartial, setCurrentInterviewerPartial] = useState('');
  const [transcriptDisplayMode, setTranscriptDisplayMode] = useState<TranscriptDisplayMode>('original');
  const [showTranscript, setShowTranscript] = useState(() => {
    const stored = localStorage.getItem('pika_interviewer_transcript');
    return stored !== 'false';
  });
  const speakingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    window.electronAPI?.getTranscriptTranslationSettings?.()
      .then((settings) => {
        if (settings?.displayMode) {
          setTranscriptDisplayMode(settings.displayMode);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem('pika_interviewer_transcript', String(showTranscript));
  }, [showTranscript]);

  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('pika_interviewer_transcript');
      setShowTranscript(stored !== 'false');
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onNativeAudioTranscript) return;

    return window.electronAPI.onNativeAudioTranscript((transcript) => {
      if (transcript.speaker === 'user') {
        if (transcript.final) {
          const normalizedSegmentId =
            transcript.segmentId ||
            `user_${transcript.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

          setTranscriptSegments((prev) =>
            upsertTranscriptSegment(prev, {
              final: true,
              text: transcript.text,
              sourceText: transcript.sourceText,
              translatedText: transcript.translatedText,
              segmentId: normalizedSegmentId,
              speaker: 'user',
              speakerLabel: 'Me',
              timestamp: transcript.timestamp,
              translationState: transcript.translationState,
            })
          );

          if (transcript.displayMode) {
            setTranscriptDisplayMode(transcript.displayMode);
          }
        }
        return;
      }

      if (transcript.speaker !== 'interviewer') {
        return;
      }

      setIsInterviewerSpeaking(!transcript.final);

      if (transcript.final) {
        setCurrentInterviewerPartial('');
        const normalizedSegmentId =
          transcript.segmentId || `legacy_${transcript.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const speakerFromPayload = transcript.speakerLabel?.trim();

        setTranscriptSegments((prev) =>
          upsertTranscriptSegment(prev, {
            final: true,
            text: transcript.text,
            sourceText: transcript.sourceText,
            translatedText: transcript.translatedText,
            segmentId: normalizedSegmentId,
            speaker: 'interviewer',
            speakerLabel: speakerFromPayload || undefined,
            timestamp: transcript.timestamp,
            translationState: transcript.translationState,
          })
        );

        if (transcript.displayMode) {
          setTranscriptDisplayMode(transcript.displayMode);
        }

        if (speakingTimeoutRef.current) {
          window.clearTimeout(speakingTimeoutRef.current);
        }
        speakingTimeoutRef.current = window.setTimeout(() => {
          setIsInterviewerSpeaking(false);
          speakingTimeoutRef.current = null;
        }, 3000);
      } else {
        setCurrentInterviewerPartial(transcript.text);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (speakingTimeoutRef.current) {
        window.clearTimeout(speakingTimeoutRef.current);
      }
    };
  }, []);

  const handleTranslateTranscriptSegment = useCallback(async (segment: TranscriptSegment) => {
    try {
      const result = await window.electronAPI.translateTranscriptSegment({
        segmentId: segment.segmentId,
        text: segment.sourceText,
        speaker: segment.speakerLabel === 'Me' ? 'user' : 'interviewer',
        speakerLabel: segment.speakerLabel,
        timestamp: segment.timestamp,
      });

      if (!result?.success) {
        setTranscriptSegments((prev) =>
          upsertTranscriptSegment(prev, {
            final: true,
            text: segment.sourceText,
            sourceText: segment.sourceText,
            segmentId: segment.segmentId,
            speakerLabel: segment.speakerLabel,
            timestamp: segment.timestamp,
            translationState: 'error',
          })
        );
      }
    } catch {
      setTranscriptSegments((prev) =>
        upsertTranscriptSegment(prev, {
          final: true,
          text: segment.sourceText,
          sourceText: segment.sourceText,
          segmentId: segment.segmentId,
          speakerLabel: segment.speakerLabel,
          timestamp: segment.timestamp,
          translationState: 'error',
        })
      );
    }
  }, []);

  return {
    transcriptSegments,
    isInterviewerSpeaking,
    currentInterviewerPartial,
    transcriptDisplayMode,
    setTranscriptDisplayMode,
    showTranscript,
    setShowTranscript,
    handleTranslateTranscriptSegment,
  };
}
