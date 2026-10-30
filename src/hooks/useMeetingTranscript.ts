import { useCallback, useEffect, useReducer, useRef, useState, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isTranscriptArrival, type TranscriptDisplayMode, type TranscriptSegment } from '../lib/transcriptSegments';
import { initialMeetingTranscriptState, meetingTranscriptReducer, type TranscriptSettingsPatch } from './meetingTranscriptReducer';
import { useLocalStorageValue } from './useLocalStorageValue';
import { useMainEvent } from './useMainEvent';

export function useMeetingTranscript() {
  const [state, dispatch] = useReducer(meetingTranscriptReducer, initialMeetingTranscriptState);
  const {
    transcriptSegments,
    isThemSpeaking,
    currentThemPartial,
    transcriptDisplayMode,
    translationEnabled,
    targetLanguage,
    sourceLanguage,
    theirLanguage,
    myLanguage,
  } = state;
  const [translationConfigured, setTranslationConfigured] = useState(false);
  const setTranscriptDisplayMode = useCallback(
    (mode: SetStateAction<TranscriptDisplayMode>) => dispatch({ type: 'displayModeChanged', mode }),
    []
  );
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

  const { data: languageOptions = [] } = useQuery({ queryKey: ['recognition-languages'], queryFn: async () => {
      const languages = await window.electronAPI?.getRecognitionLanguages?.();
      return Object.entries(languages ?? {})
        .map(([value, language]) => ({ value, label: (language as { label?: string }).label || value }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }, staleTime: Infinity });

  const loadTranslationSettings = useCallback(() => {
    window.electronAPI?.getTranscriptTranslationSettings?.()
      .then((settings) => {
        const configured = !!settings?.model?.trim();
        setTranslationConfigured(configured);
        dispatch({
          type: 'settingsChanged',
          patch: {
            displayMode: settings?.displayMode,
            enabled: !!settings?.enabled && configured,
            targetLanguage: settings?.targetLanguage,
            sourceLanguage: settings?.sourceLanguage,
          },
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTranslationSettings();
    window.electronAPI?.getSttLanguage?.('them')
      .then((lang) => {
        if (lang) dispatch({ type: 'sttLanguageLoaded', speaker: 'them', language: lang });
      })
      .catch(() => {});
    window.electronAPI?.getSttLanguage?.('user')
      .then((lang) => {
        if (lang) dispatch({ type: 'sttLanguageLoaded', speaker: 'user', language: lang });
      })
      .catch(() => {});
  }, [loadTranslationSettings]);

  /** Saves a header change; on failure the saved settings win and are read back. */
  const saveTranslationSettings = useCallback(
    (patch: TranscriptSettingsPatch) => {
      dispatch({ type: 'settingsChanged', patch });
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
      if (theirs) dispatch({ type: 'sttLanguageLoaded', speaker: 'them', language: theirs });
      if (mine) dispatch({ type: 'sttLanguageLoaded', speaker: 'user', language: mine });
    } catch {}
  }, []);

  const changeSpokenLanguage = useCallback(
    async (speaker: 'them' | 'user', key: string) => {
      if (speaker === 'them') {
        dispatch({ type: 'sttLanguageLoaded', speaker: 'them', language: key });
        saveTranslationSettings({ sourceLanguage: key });
      } else {
        dispatch({ type: 'sttLanguageLoaded', speaker: 'user', language: key });
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

        dispatch({
          type: 'segmentUpserted',
          now: Date.now(),
          event: {
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
          },
        });

        // Own speech is never translated, so its `skipped` says nothing about whether translation is on.
      }
      return;
    }

    if (transcript.speaker !== 'them') {
      return;
    }

    const arrival = transcript.final && isTranscriptArrival(transcript.translationState);

    if (!transcript.final) {
      dispatch({ type: 'themPartial', text: transcript.text });
      return;
    }

    const normalizedSegmentId =
      transcript.segmentId || `legacy_${transcript.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const speakerFromPayload = transcript.speakerLabel?.trim();
    const event = {
      final: true,
      text: transcript.text,
      sourceText: transcript.sourceText,
      translatedText: transcript.translatedText,
      segmentId: normalizedSegmentId,
      speaker: 'them' as const,
      speakerLabel: speakerFromPayload || undefined,
      timestamp: transcript.timestamp,
      translationState: transcript.translationState,
      translationError: transcript.translationError,
      detectedLanguage: transcript.detectedLanguage,
      revision: transcript.revision,
      replaces: transcript.replaces,
    };

    // A translation report (streaming, complete, error) is a final event too, but the speaker may already be on the next sentence.
    if (!arrival) {
      dispatch({ type: 'segmentUpserted', event, now: Date.now() });
      return;
    }

    // The display mode and the on/off state are read when a request starts; later reports of that request carry stale copies.
    dispatch({ type: 'themArrival', event, now: Date.now(), displayMode: transcript.displayMode });

    if (speakingTimeoutRef.current) {
      window.clearTimeout(speakingTimeoutRef.current);
    }
    speakingTimeoutRef.current = window.setTimeout(() => {
      dispatch({ type: 'themSpeakingEnded' });
      speakingTimeoutRef.current = null;
    }, 3000);
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
        dispatch({
          type: 'segmentUpserted',
          now: Date.now(),
          event: {
            final: true,
            text: segment.sourceText,
            sourceText: segment.sourceText,
            segmentId: segment.segmentId,
            speakerLabel: segment.speakerLabel,
            timestamp: segment.timestamp,
            translationState: 'error',
          },
        });
      }
    } catch {
      dispatch({
        type: 'segmentUpserted',
        now: Date.now(),
        event: {
          final: true,
          text: segment.sourceText,
          sourceText: segment.sourceText,
          segmentId: segment.segmentId,
          speakerLabel: segment.speakerLabel,
          timestamp: segment.timestamp,
          translationState: 'error',
        },
      });
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
