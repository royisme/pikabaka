import { useCallback, useEffect, useRef, useState } from 'react';
import { translationEnabledAfterEvent, upsertTranscriptSegment, type TranscriptDisplayMode, type TranscriptSegment } from '../lib/transcriptSegments';

export function useMeetingTranscript() {
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
  const [currentInterviewerPartial, setCurrentInterviewerPartial] = useState('');
  const [transcriptDisplayMode, setTranscriptDisplayMode] = useState<TranscriptDisplayMode>('original');
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [translationConfigured, setTranslationConfigured] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('chinese');
  const [languageOptions, setLanguageOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [showTranscript, setShowTranscript] = useState(() => {
    const stored = localStorage.getItem('pika_interviewer_transcript');
    return stored !== 'false';
  });
  const speakingTimeoutRef = useRef<number | null>(null);

  const loadTranslationSettings = useCallback(() => {
    window.electronAPI?.getTranscriptTranslationSettings?.()
      .then((settings) => {
        if (settings?.displayMode) {
          setTranscriptDisplayMode(settings.displayMode);
        }
        const configured = !!settings?.model?.trim();
        setTranslationConfigured(configured);
        setTranslationEnabled(!!settings?.enabled && configured);
        if (settings?.targetLanguage) setTargetLanguage(settings.targetLanguage);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTranslationSettings();
    window.electronAPI?.getRecognitionLanguages?.()
      .then((languages) =>
        setLanguageOptions(
          Object.entries(languages ?? {})
            .map(([value, language]) => ({ value, label: (language as { label?: string }).label || value }))
            .sort((a, b) => a.label.localeCompare(b.label))
        )
      )
      .catch(() => {});
  }, [loadTranslationSettings]);

  /** Saves a header change; on failure the saved settings win and are read back. */
  const saveTranslationSettings = useCallback(
    (patch: { enabled?: boolean; targetLanguage?: string; displayMode?: TranscriptDisplayMode }) => {
      if (patch.enabled !== undefined) setTranslationEnabled(patch.enabled);
      if (patch.targetLanguage !== undefined) setTargetLanguage(patch.targetLanguage);
      if (patch.displayMode !== undefined) setTranscriptDisplayMode(patch.displayMode);
      window.electronAPI?.setTranscriptTranslationSettings?.(patch).catch(loadTranslationSettings);
    },
    [loadTranslationSettings]
  );

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
              translationError: transcript.translationError,
              detectedLanguage: transcript.detectedLanguage,
              revision: transcript.revision,
            })
          );

          if (transcript.displayMode) {
            setTranscriptDisplayMode(transcript.displayMode);
          }
          setTranslationEnabled((current) => translationEnabledAfterEvent(current, transcript.translationState));
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
            translationError: transcript.translationError,
            detectedLanguage: transcript.detectedLanguage,
            revision: transcript.revision,
          })
        );

        if (transcript.displayMode) {
          setTranscriptDisplayMode(transcript.displayMode);
        }
        setTranslationEnabled((current) => translationEnabledAfterEvent(current, transcript.translationState));

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
    translationEnabled,
    translationConfigured,
    targetLanguage,
    languageOptions,
    saveTranslationSettings,
    setTranscriptDisplayMode,
    showTranscript,
    setShowTranscript,
    handleTranslateTranscriptSegment,
  };
}
