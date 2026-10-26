import { useEffect, useMemo, useRef, useState } from 'react';

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
  const [noSystemAudioSince, setNoSystemAudioSince] = useState<number | null>(null);
  const [activeSince, setActiveSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const isRecordingRef = useRef(false);
  const voiceInputRef = useRef('');
  const manualTranscriptRef = useRef('');

  const refreshNativeAudioStatus = () => {
    window.electronAPI.getNativeAudioStatus()
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

    const cleanups: Array<() => void> = [];
    const statusTimer = window.setInterval(refreshNativeAudioStatus, 1500);
    cleanups.push(() => window.clearInterval(statusTimer));

    cleanups.push(window.electronAPI.onNativeAudioConnected(() => {
      setIsConnected(true);
      refreshNativeAudioStatus();
    }));

    cleanups.push(window.electronAPI.onNativeAudioDisconnected(() => {
      setIsConnected(false);
      refreshNativeAudioStatus();
    }));

    cleanups.push(window.electronAPI.onNativeAudioTranscript((transcript) => {
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
    }));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    isRecordingRef.current = isManualRecording;
  }, [isManualRecording]);

  useEffect(() => {
    const shouldTrackMissingSystemAudio =
      nativeAudioHealth.meetingActive &&
      isConnected &&
      !nativeAudioHealth.hasRecentSystemAudioChunk &&
      !nativeAudioHealth.hasRecentInterviewerTranscript;

    if (!shouldTrackMissingSystemAudio) {
      setNoSystemAudioSince(null);
      return;
    }

    setNoSystemAudioSince((prev) => prev ?? Date.now());
  }, [
    isConnected,
    nativeAudioHealth.meetingActive,
    nativeAudioHealth.hasRecentSystemAudioChunk,
    nativeAudioHealth.hasRecentInterviewerTranscript,
  ]);

  useEffect(() => {
    setActiveSince((prev) => (nativeAudioHealth.meetingActive ? prev ?? Date.now() : null));
  }, [nativeAudioHealth.meetingActive]);

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
