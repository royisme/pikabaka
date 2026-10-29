import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from 'react-query';
import { isTranscriptArrival, translationEnabledAfterEvent, upsertTranscriptSegment, type TranscriptDisplayMode, type TranscriptSegment } from '../lib/transcriptSegments';
import { useLocalStorageValue } from './useLocalStorageValue';
import { useMainEvent } from './useMainEvent';

export function useMeetingTranscript() {
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isThemSpeaking, setIsThemSpeaking] = useState(false);
  const [currentThemPartial, setCurrentThemPartial] = useState('');
  const [transcriptDisplayMode, setTranscriptDisplayMode] = useState<TranscriptDisplayMode>('original');
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [translationConfigured, setTranslationConfigured] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('chinese');
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [theirLanguage, setTheirLanguage] = useState('english-us');
  const [myLanguage, setMyLanguage] = useState('english-us');
  const [storedShowTranscript, setStoredShowTranscript] = useLocalStorageValue('pika_them_transcript');
  const showTranscript = storedShowTranscript !== 'false';
  const setShowTranscript = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof action === 'function' ? action(storedShowTranscript !== 'false') : action;
      setStoredShowTranscript(String(next));
    },
    [storedShowTranscript, setStoredShowTranscript]
  );
  const speakingTimeoutRef = useRef<number | null>(null);

  const { data: languageOptions = [] } = useQuery(
    ['recognition-languages'],
    async () => {
      const languages = await window.electronAPI?.getRecognitionLanguages?.();
      return Object.entries(languages ?? {})
        .map(([value, language]) => ({ value, label: (language as { label?: string }).label || value }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    { staleTime: Infinity }
  );

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
    window.electronAPI?.getSttLanguage?.('them')
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
      const [theirs, mine] = await Promise.all([
        window.electronAPI?.getSttLanguage?.('them'),
        window.electronAPI?.getSttLanguage?.('user'),
      ]);
      if (theirs) setTheirLanguage(theirs);
      if (mine) setMyLanguage(mine);
    } catch {}
  }, []);

  const changeSpokenLanguage = useCallback(
    async (speaker: 'them' | 'user', key: string) => {
      if (speaker === 'them') {
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

  useMainEvent(window.electronAPI?.onNativeAudioTranscript, (transcript) => {
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

    if (transcript.speaker !== 'them') {
      return;
    }

    const arrival = transcript.final && isTranscriptArrival(transcript.translationState);
    // A translation report (streaming, complete, error) is a final event too, but the speaker may already be on the next sentence.
    if (!transcript.final || arrival) setIsThemSpeaking(!transcript.final);

    if (transcript.final) {
      if (arrival) setCurrentThemPartial('');
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
          speaker: 'them',
          speakerLabel: speakerFromPayload || undefined,
          timestamp: transcript.timestamp,
          translationState: transcript.translationState,
          translationError: transcript.translationError,
          detectedLanguage: transcript.detectedLanguage,
          revision: transcript.revision,
          replaces: transcript.replaces,
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
          setIsThemSpeaking(false);
          speakingTimeoutRef.current = null;
        }, 3000);
      }
    } else {
      setCurrentThemPartial(transcript.text);
    }
  });

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
        speaker: segment.speakerLabel === 'Me' ? 'user' : 'them',
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
    isThemSpeaking,
    currentThemPartial,
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
