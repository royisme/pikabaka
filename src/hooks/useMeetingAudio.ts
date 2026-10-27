import { useEffect, useMemo, useRef, useState } from 'react';
import { useMainEvent } from './useMainEvent';

type NativeAudioHealth = {
  connected: boolean;
  meetingActive: boolean;
  hasRecentSystemAudioChunk: boolean;
  hasRecentInterviewerTranscript: boolean;
  lastSystemAudioChunkAt: number | null;
  lastInterviewerTranscriptAt: number | null;
  lastError: string | null;
};

const fallbackStatus: NativeAudioHealth = {
  connected: false,
  meetingActive: false,
  hasRecentSystemAudioChunk: false,
  hasRecentInterviewerTranscript: false,
  lastSystemAudioChunkAt: null,
  lastInterviewerTranscriptAt: null,
  lastError: null,
};

export function useMeetingAudio() {
  const [isManualRecording, setIsManualRecording] = useState(false);
  const [manualTranscript, setManualTranscript] = useState('');
  const [voiceInput, setVoiceInput] = useState('');
  const [nativeAudioHealth, setNativeAudioHealth] = useState<NativeAudioHealth>(fallbackStatus);
  const [isConnected, setIsConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const isRecordingRef = useRef(false);
  const voiceInputRef = useRef('');
  const manualTranscriptRef = useRef('');
  const activeSinceRef = useRef<number | null>(null);
  const noSystemAudioSinceRef = useRef<number | null>(null);

  isRecordingRef.current = isManualRecording;
  voiceInputRef.current = voiceInput;
  manualTranscriptRef.current = manualTranscript;

  const refreshNativeAudioStatus = () => {
    window.electronAPI?.getNativeAudioStatus?.()
      .then((status) => {
        setIsConnected(status.connected);
        setNativeAudioHealth(status);
      })
      .catch(() => {
        setIsConnected(false);
        setNativeAudioHealth(fallbackStatus);
      });
  };

  useEffect(() => {
    refreshNativeAudioStatus();
    const statusTimer = window.setInterval(refreshNativeAudioStatus, 1500);

    const unsubConnected = window.electronAPI?.onNativeAudioConnected?.(() => {
      setIsConnected(true);
      refreshNativeAudioStatus();
    });

    const unsubDisconnected = window.electronAPI?.onNativeAudioDisconnected?.(() => {
      setIsConnected(false);
      refreshNativeAudioStatus();
    });

    return () => {
      window.clearInterval(statusTimer);
      unsubConnected?.();
      unsubDisconnected?.();
    };
  }, []);

  useMainEvent(window.electronAPI?.onNativeAudioTranscript, (transcript) => {
    if (!isRecordingRef.current || transcript.speaker !== 'user') {
      return;
    }

    if (transcript.final) {
      setVoiceInput((prev) => {
        const updated = prev + (prev ? ' ' : '') + transcript.text;
        voiceInputRef.current = updated;
        return updated;
      });
      setManualTranscript('');
      manualTranscriptRef.current = '';
      return;
    }

    setManualTranscript(transcript.text);
    manualTranscriptRef.current = transcript.text;
  });

  if (!nativeAudioHealth.meetingActive) {
    activeSinceRef.current = null;
  } else if (activeSinceRef.current === null) {
    activeSinceRef.current = Date.now();
  }
  const activeSince = activeSinceRef.current;

  const shouldTrackMissingSystemAudio =
    nativeAudioHealth.meetingActive &&
    isConnected &&
    !nativeAudioHealth.hasRecentSystemAudioChunk &&
    !nativeAudioHealth.hasRecentInterviewerTranscript;

  if (!shouldTrackMissingSystemAudio) {
    noSystemAudioSinceRef.current = null;
  } else if (noSystemAudioSinceRef.current === null) {
    noSystemAudioSinceRef.current = Date.now();
  }
  const noSystemAudioSince = noSystemAudioSinceRef.current;

  // The status changes with time (a slow start becomes a failure, silence becomes "no audio"), so it is
  // re-read once a second while a meeting is active.
  useEffect(() => {
    if (!nativeAudioHealth.meetingActive) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nativeAudioHealth.meetingActive]);

  const audioStatusInput = useMemo(
    () => ({
      meetingActive: nativeAudioHealth.meetingActive,
      isConnected,
      hasRecentSystemAudioChunk: nativeAudioHealth.hasRecentSystemAudioChunk,
      hasRecentInterviewerTranscript: nativeAudioHealth.hasRecentInterviewerTranscript,
      lastError: nativeAudioHealth.lastError,
      activeSince,
      noSystemAudioSince,
      now,
    }),
    [activeSince, isConnected, nativeAudioHealth, noSystemAudioSince, now]
  );

  return {
    isManualRecording,
    setIsManualRecording,
    isRecordingRef,
    manualTranscript,
    setManualTranscript,
    manualTranscriptRef,
    voiceInput,
    setVoiceInput,
    voiceInputRef,
    nativeAudioHealth,
    isConnected,
    noSystemAudioSince,
    audioStatusInput,
  };
}
