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

  const sttStatus = useMemo(() => {
    if (!nativeAudioHealth.meetingActive) {
      return { label: 'STT idle', toneClass: 'text-text-tertiary', dotClass: 'bg-slate-500/50' };
    }
    if (!isConnected) {
      return { label: 'STT disconnected', toneClass: 'text-red-400', dotClass: 'bg-red-400' };
    }
    if (nativeAudioHealth.hasRecentInterviewerTranscript) {
      return { label: 'STT receiving transcript', toneClass: 'text-emerald-400', dotClass: 'bg-emerald-400 animate-pulse' };
    }
    if (nativeAudioHealth.hasRecentSystemAudioChunk) {
      return { label: 'STT listening (no transcript yet)', toneClass: 'text-amber-300', dotClass: 'bg-amber-300' };
    }
    return { label: 'No system audio signal', toneClass: 'text-red-300', dotClass: 'bg-red-300' };
  }, [isConnected, nativeAudioHealth]);

  const sttNeedsTroubleshooting = useMemo(() => {
    if (!nativeAudioHealth.meetingActive || !isConnected) return false;
    if (nativeAudioHealth.hasRecentSystemAudioChunk || nativeAudioHealth.hasRecentInterviewerTranscript) return false;
    if (nativeAudioHealth.lastError) return true;
    if (!noSystemAudioSince) return false;
    return Date.now() - noSystemAudioSince >= 8000;
  }, [isConnected, nativeAudioHealth, noSystemAudioSince]);

  const showSttErrorDetail = !!nativeAudioHealth.lastError && !nativeAudioHealth.hasRecentInterviewerTranscript;

  return {
    isManualRecording,
    setIsManualRecording,
    manualTranscript,
    voiceInput,
    nativeAudioHealth,
    isConnected,
    sttStatus,
    sttNeedsTroubleshooting,
    showSttErrorDetail,
  };
}
