import { useCallback, useEffect, useRef, useState } from 'react';
import { isTranscriptArrival, translationEnabledAfterEvent, upsertTranscriptSegment, type TranscriptDisplayMode, type TranscriptSegment } from '../lib/transcriptSegments';

export function useMeetingTranscript() {
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
  const [currentInterviewerPartial, setCurrentInterviewerPartial] = useState('');
  const [transcriptDisplayMode, setTranscriptDisplayMode] = useState<TranscriptDisplayMode>('original');
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [translationConfigured, setTranslationConfigured] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('chinese');
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [theirLanguage, setTheirLanguage] = useState('english-us');
  const [myLanguage, setMyLanguage] = useState('english-us');
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
        if (settings?.sourceLanguage) setSourceLanguage(settings.sourceLanguage);
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
    window.electronAPI?.getSttLanguage?.('interviewer')
      .then((lang) => {
        if (lang) setTheirLanguage(lang);
      })
      .catch(() => {});
    window.electronAPI?.getSttLanguage?.('user')
      .then((lang) => {
        if (lang) setMyLanguage(lang);
      })
      .catch(() => {});
  }, [loadTranslationSettings]);

  /** Saves a header change; on failure the saved settings win and are read back. */
  const saveTranslationSettings = useCallback(
    (patch: { enabled?: boolean; targetLanguage?: string; displayMode?: TranscriptDisplayMode; sourceLanguage?: string }) => {
      if (patch.enabled !== undefined) setTranslationEnabled(patch.enabled);
      if (patch.targetLanguage !== undefined) setTargetLanguage(patch.targetLanguage);
      if (patch.displayMode !== undefined) setTranscriptDisplayMode(patch.displayMode);
      if (patch.sourceLanguage !== undefined) setSourceLanguage(patch.sourceLanguage);
      window.electronAPI?.setTranscriptTranslationSettings?.(patch).catch(loadTranslationSettings);
    },
    [loadTranslationSettings]
  );

  const refreshLanguages = useCallback(async () => {
    try {
      const [interviewer, user] = await Promise.all([
        window.electronAPI?.getSttLanguage?.('interviewer'),
        window.electronAPI?.getSttLanguage?.('user'),
      ]);
      if (interviewer) setTheirLanguage(interviewer);
      if (user) setMyLanguage(user);
    } catch {}
  }, []);

  const changeSpokenLanguage = useCallback(
    async (speaker: 'interviewer' | 'user', key: string) => {
      if (speaker === 'interviewer') {
        setTheirLanguage(key);
        saveTranslationSettings({ sourceLanguage: key });
      } else {
        setMyLanguage(key);
      }

      try {
        const result = await window.electronAPI?.setRecognitionLanguage?.(key, speaker);
        if (result && !result.success) {
          await refreshLanguages();
        }
      } catch {
        await refreshLanguages();
      }
    },
    [saveTranslationSettings, refreshLanguages]
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

          // Own speech is never translated, so its `skipped` says nothing about whether translation is on.
        }
        return;
      }

      if (transcript.speaker !== 'interviewer') {
        return;
      }

      const arrival = transcript.final && isTranscriptArrival(transcript.translationState);
      // A translation report (streaming, complete, error) is a final event too, but the speaker may already be on the next sentence.
      if (!transcript.final || arrival) setIsInterviewerSpeaking(!transcript.final);

      if (transcript.final) {
        if (arrival) setCurrentInterviewerPartial('');
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

        // The display mode and the on/off state are read when a request starts; later reports of that request carry stale copies.
        if (arrival) {
          if (transcript.displayMode) setTranscriptDisplayMode(transcript.displayMode);
          setTranslationEnabled((current) => translationEnabledAfterEvent(current, transcript.translationState));

          if (speakingTimeoutRef.current) {
            window.clearTimeout(speakingTimeoutRef.current);
          }
          speakingTimeoutRef.current = window.setTimeout(() => {
            setIsInterviewerSpeaking(false);
            speakingTimeoutRef.current = null;
          }, 3000);
        }
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
    sourceLanguage,
    theirLanguage,
    myLanguage,
    changeSpokenLanguage,
    languageOptions,
    saveTranslationSettings,
    setTranscriptDisplayMode,
    showTranscript,
    setShowTranscript,
    handleTranslateTranscriptSegment,
  };
}
