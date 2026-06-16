import { useEffect, useMemo, useRef, useState } from 'react';

type NativeAudioHealth = {
  connected: boolean;
  meetingActive: boolean;
  hasRecentSystemAudioChunk: boolean;
  hasRecentSystemAudioSignal?: boolean;
  hasRecentInterviewerTranscript: boolean;
  hasRecentUserTranscript: boolean;
  lastSystemAudioChunkAt: number | null;
  lastInterviewerTranscriptAt: number | null;
  lastUserTranscriptAt: number | null;
  lastError: string | null;
};

const fallbackStatus: NativeAudioHealth = {
  connected: false,
  meetingActive: false,
  hasRecentSystemAudioChunk: false,
  hasRecentInterviewerTranscript: false,
  hasRecentUserTranscript: false,
  lastSystemAudioChunkAt: null,
  lastInterviewerTranscriptAt: null,
  lastUserTranscriptAt: null,
  lastError: null,
};

export function useMeetingAudio() {
  const [isManualRecording, setIsManualRecording] = useState(false);
  const [manualTranscript, setManualTranscript] = useState('');
  const [voiceInput, setVoiceInput] = useState('');
  const [nativeAudioHealth, setNativeAudioHealth] = useState<NativeAudioHealth>(fallbackStatus);
  const [isConnected, setIsConnected] = useState(false);
  const [noSystemAudioSince, setNoSystemAudioSince] = useState<number | null>(null);
  const hasSystemAudioThisMeeting = nativeAudioHealth.lastSystemAudioChunkAt != null || nativeAudioHealth.lastInterviewerTranscriptAt != null;
  const hasMicTranscriptThisMeeting = nativeAudioHealth.lastUserTranscriptAt != null;
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
      !nativeAudioHealth.hasRecentInterviewerTranscript &&
      !hasSystemAudioThisMeeting;

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
    hasSystemAudioThisMeeting,
  ]);

  const sttStatus = useMemo(() => {
    if (!nativeAudioHealth.meetingActive) {
      return { label: 'STT idle', toneClass: 'text-text-tertiary', dotClass: 'bg-slate-500/50' };
    }
    if (!isConnected) {
      return { label: 'STT disconnected', toneClass: 'text-red-400', dotClass: 'bg-red-400' };
    }
    if (nativeAudioHealth.hasRecentInterviewerTranscript) {
      return { label: 'Meeting audio transcribing', toneClass: 'text-emerald-400', dotClass: 'bg-emerald-400 animate-pulse' };
    }
    if (nativeAudioHealth.hasRecentSystemAudioChunk) {
      return { label: 'Meeting audio signal detected', toneClass: 'text-emerald-300', dotClass: 'bg-emerald-300' };
    }
    if (nativeAudioHealth.hasRecentUserTranscript || hasMicTranscriptThisMeeting) {
      return { label: 'Mic STT ready · no meeting audio', toneClass: 'text-amber-300', dotClass: 'bg-amber-300' };
    }
    if (hasSystemAudioThisMeeting) {
      return { label: 'STT ready', toneClass: 'text-emerald-300', dotClass: 'bg-emerald-300' };
    }
    return { label: 'No meeting audio signal', toneClass: 'text-red-300', dotClass: 'bg-red-300' };
  }, [isConnected, nativeAudioHealth, hasMicTranscriptThisMeeting, hasSystemAudioThisMeeting]);

  const systemAudioTroubleshootingMessage =
    'No meeting/video audio detected. Mic can still show it as Me; choose the output playing the video or Default, then restart the meeting.';

  const sttTroubleshootingMessage = useMemo(() => {
    if (!nativeAudioHealth.meetingActive || !isConnected) return null;
    if (nativeAudioHealth.lastError) return nativeAudioHealth.lastError;
    if (hasSystemAudioThisMeeting || nativeAudioHealth.hasRecentSystemAudioChunk || nativeAudioHealth.hasRecentInterviewerTranscript) return null;
    if (!noSystemAudioSince) return null;
    return Date.now() - noSystemAudioSince >= 8000 ? systemAudioTroubleshootingMessage : null;
  }, [isConnected, nativeAudioHealth, noSystemAudioSince, hasSystemAudioThisMeeting, systemAudioTroubleshootingMessage]);

  const sttNeedsTroubleshooting = !!sttTroubleshootingMessage;
  const showSttErrorDetail = !!sttTroubleshootingMessage;

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
    sttStatus,
    sttNeedsTroubleshooting,
    showSttErrorDetail,
    sttTroubleshootingMessage,
  };
}
