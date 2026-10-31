import { EchoFilter, wordsOf } from './echo-filter';
import { audioStats } from './audio-stats';
import { sendLag } from './send-lag';
import { BrowserWindow, systemPreferences } from "electron"
import type { AppState } from "../main"
import { SystemAudioCapture } from "../audio/SystemAudioCapture"
import { MicrophoneCapture } from "../audio/MicrophoneCapture"
import { GoogleSTT } from "../audio/GoogleSTT"
import { RestSTT } from "../audio/RestSTT"
import { DeepgramStreamingSTT } from "../audio/DeepgramStreamingSTT"
import { SonioxStreamingSTT } from "../audio/SonioxStreamingSTT"
import { GeminiLiveSTT } from "../audio/GeminiLiveSTT"
import { ElevenLabsStreamingSTT } from "../audio/ElevenLabsStreamingSTT"
import { OpenAIStreamingSTT } from "../audio/OpenAIStreamingSTT"
import {
  TranscriptSpeaker,
  bufferFinalTranscriptChunk,
  emitNativeAudioTranscript,
  emitTranscriptWithTranslation,
  getBufferedTranscriptText,
  handleSpeakerSpeechEnded,
  mergeTranscriptText,
  noteTranscriptActivity,
  normalizeTranscriptText,
} from "./transcript-assembler"

export type STTProvider = (GoogleSTT | RestSTT | DeepgramStreamingSTT | SonioxStreamingSTT | GeminiLiveSTT | ElevenLabsStreamingSTT | OpenAIStreamingSTT) & {
  finalize?: () => void;
  setAudioChannelCount?: (count: number) => void;
  notifySpeechEnded?: () => void;
};

async function ensureMacMicrophoneAccess(context: string): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  try {
    const currentStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[Main] macOS microphone permission before ${context}: ${currentStatus}`);

    if (currentStatus === 'granted') {
      return true;
    }

    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `[Main] macOS microphone permission request during ${context}: ${granted ? 'granted' : 'denied'}`
    );
    return granted;
  } catch (error) {
    console.error(`[Main] Failed to check macOS microphone permission during ${context}:`, error);
    return false;
  }
}

export function createSTTProvider(appState: AppState, speaker: 'them' | 'user'): STTProvider {
  const state = appState;
  const { CredentialsManager } = require('../services/CredentialsManager');
  const sttProvider = CredentialsManager.getInstance().getSttProvider();
  const sttLanguage = speaker === 'user'
    ? CredentialsManager.getInstance().getSttLanguageUser()
    : CredentialsManager.getInstance().getSttLanguage();

  let stt: STTProvider;

  if (sttProvider === 'deepgram') {
    const apiKey = CredentialsManager.getInstance().getDeepgramApiKey();
    if (apiKey?.trim()) {
      console.log(`[Main] Using DeepgramStreamingSTT for ${speaker}`);
      stt = new DeepgramStreamingSTT(apiKey);
    } else {
      throw new Error('Deepgram is not configured: add its key in Provider setup.');
    }
  } else if (sttProvider === 'gemini') {
    const apiKey = CredentialsManager.getInstance().getGeminiApiKey();
    if (apiKey?.trim()) {
      console.log(`[Main] Using GeminiLiveSTT for ${speaker}`);
      stt = new GeminiLiveSTT(apiKey);
    } else {
      throw new Error('Gemini is not configured: add its key in AI providers.');
    }
  } else if (sttProvider === 'soniox') {
    const apiKey = CredentialsManager.getInstance().getSonioxApiKey();
    if (apiKey?.trim()) {
      console.log(`[Main] Using SonioxStreamingSTT for ${speaker}`);
      stt = new SonioxStreamingSTT(apiKey);
    } else {
      throw new Error('Soniox is not configured: add its key in Provider setup.');
    }
  } else if (sttProvider === 'elevenlabs') {
    const apiKey = CredentialsManager.getInstance().getElevenLabsApiKey();
    if (apiKey?.trim()) {
      console.log(`[Main] Using ElevenLabsStreamingSTT for ${speaker}`);
      stt = new ElevenLabsStreamingSTT(apiKey);
    } else {
      throw new Error('ElevenLabs is not configured: add its key in Provider setup.');
    }
  } else if (sttProvider === 'openai') {
    const apiKey = CredentialsManager.getInstance().getOpenAiSttApiKey();
    if (apiKey?.trim()) {
      console.log(`[Main] Using OpenAIStreamingSTT (WebSocket+REST fallback) for ${speaker}`);
      stt = new OpenAIStreamingSTT(apiKey);
    } else {
      throw new Error('OpenAI is not configured: add its key in Provider setup.');
    }
  } else if (sttProvider === 'groq' || sttProvider === 'azure' || sttProvider === 'ibmwatson') {
    let apiKey: string | undefined;
    let region: string | undefined;
    let modelOverride: string | undefined;

    if (sttProvider === 'groq') {
      apiKey = CredentialsManager.getInstance().getGroqSttApiKey();
      modelOverride = CredentialsManager.getInstance().getGroqSttModel();
    } else if (sttProvider === 'azure') {
      apiKey = CredentialsManager.getInstance().getAzureApiKey();
      region = CredentialsManager.getInstance().getAzureRegion();
    } else if (sttProvider === 'ibmwatson') {
      apiKey = CredentialsManager.getInstance().getIbmWatsonApiKey();
      region = CredentialsManager.getInstance().getIbmWatsonRegion();
    }

    if (apiKey?.trim()) {
      console.log(`[Main] Using RestSTT (${sttProvider}) for ${speaker}`);
      stt = new RestSTT(sttProvider, apiKey, modelOverride, region);
    } else {
      const name = sttProvider === 'groq' ? 'Groq' : sttProvider === 'azure' ? 'Azure' : 'IBM Watson';
      throw new Error(`${name} is not configured: add its key in Provider setup.`);
    }
  } else {
    if (!CredentialsManager.getInstance().getGoogleServiceAccountPath()) {
      throw new Error('Google Cloud is not configured: choose its service-account file in Provider setup.');
    }
    stt = new GoogleSTT();
  }

  const sttModel = CredentialsManager.getInstance().getSttModel(sttProvider);
  if (sttModel && 'setModel' in stt) stt.setModel(sttModel);

  stt.setRecognitionLanguage(sttLanguage);

  stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number, detectedLanguage?: string, boundary?: boolean }) => {
    if (!appState.getIsMeetingActive()) {
      return;
    }

    const timestamp = Date.now();
    const trimmed = segment.text?.trim();

    // The speakers can be heard by the microphone: a line of "Me" that repeats what the other party's stream
    // just produced is that audio again, not the user speaking.
    if (trimmed) {
      state.echoFilter ??= new EchoFilter();
      const echoFilter = state.echoFilter;
      if (speaker === 'them') {
        echoFilter.noteOther(trimmed, timestamp);
      } else if (echoFilter.isEcho(trimmed, timestamp)) {
        audioStats.noteEchoDropped(segment.isFinal, wordsOf(trimmed).length);
        return;
      }
      if (segment.isFinal) audioStats.noteFinal(speaker, wordsOf(trimmed).length);
    }

    // Boundary-only events (empty text) must not reach intelligence handling
    if (trimmed) {
      appState.getIntelligenceManager().handleTranscript({
        speaker: speaker,
        text: segment.text,
        timestamp,
        final: segment.isFinal,
        confidence: segment.confidence
      });
    }

    const { CredentialsManager } = require('../services/CredentialsManager');
    const displayMode = CredentialsManager.getInstance().getTranscriptTranslationDisplayMode();

    if (segment.isFinal) {
      // Order matters: buffer the text first, then accelerate flushing on boundary
      if (trimmed) {
        bufferFinalTranscriptChunk(appState, speaker, segment.text, timestamp, segment.confidence, segment.detectedLanguage);
      }
      if (segment.boundary) {
        handleSpeakerSpeechEnded(appState, speaker);
      }
    } else if (trimmed) {
      noteTranscriptActivity(appState, speaker, timestamp);
      // Final words that are not in a row yet come first, so none of what was said disappears from the live line.
      const liveText = mergeTranscriptText(appState, getBufferedTranscriptText(appState, speaker), segment.text);
      emitNativeAudioTranscript(appState, {
        speaker,
        text: liveText,
        sourceText: liveText,
        translatedText: undefined,
        timestamp,
        final: segment.isFinal,
        confidence: segment.confidence,
        displayMode,
        translationState: 'skipped' as const,
        detectedLanguage: segment.detectedLanguage,
      });
    }

    if (speaker === 'them') {
      if (trimmed) {
        state.lastThemTranscriptAt = Date.now();
      }
      state.lastAudioPipelineError = null;
    }
  });

  stt.on('error', (err: Error) => {
    console.error(`[Main] STT (${speaker}) Error:`, err);
    state.lastAudioPipelineError = `[${speaker}] ${err.message || 'STT error'}`;
  });

  return stt;
}

/** The one place the system audio capture is connected to the speech service. */
export function wireSystemAudio(appState: AppState): void {
  const state = appState;
  state.systemAudioCapture.on('data', (chunk: Buffer) => {
    state.lastSystemAudioChunkAt = Date.now();
    sendLag.timed('them', () => state.googleSTT?.write(chunk));
  });
  state.systemAudioCapture.on('speech_ended', () => {
    state.googleSTT?.notifySpeechEnded?.();
    handleSpeakerSpeechEnded(appState, 'them');
  });
  state.systemAudioCapture.on('error', (err: Error) => {
    console.error('[Main] SystemAudioCapture Error:', err);
    state.lastAudioPipelineError = err.message || 'System audio capture error';
  });
}

/** The one place the microphone capture is connected to the speech service. */
export function wireMicrophone(appState: AppState): void {
  const state = appState;
  state.microphoneCapture.on('data', (chunk: Buffer) => {
    // Muted: silence of the same length goes on, so the speech service keeps its connection.
    sendLag.timed('user', () => state.googleSTT_User?.write(state.microphoneMuted ? Buffer.alloc(chunk.length) : chunk));
  });
  state.microphoneCapture.on('speech_ended', () => {
    state.googleSTT_User?.notifySpeechEnded?.();
    handleSpeakerSpeechEnded(appState, 'user');
  });
  state.microphoneCapture.on('error', (err: Error) => {
    console.error('[Main] MicrophoneCapture Error:', err);
  });
}

export function setupSystemAudioPipeline(appState: AppState): void {
  const state = appState;
  try {
    if (!state.systemAudioCapture) {
      state.systemAudioCapture = new SystemAudioCapture();
      wireSystemAudio(appState);
    }

    if (!state.microphoneCapture) {
      state.microphoneCapture = new MicrophoneCapture();
      wireMicrophone(appState);
    }

    if (!state.googleSTT) {
      state.googleSTT = createSTTProvider(appState, 'them');
    }

    if (!state.googleSTT_User) {
      state.googleSTT_User = createSTTProvider(appState, 'user');
    }

    const sysRate = state.systemAudioCapture?.getSampleRate() || 48000;
    if (state._verboseLogging) console.log(`[Main] Configuring Them STT to ${sysRate}Hz`);
    state.googleSTT?.setSampleRate(sysRate);
    state.googleSTT?.setAudioChannelCount?.(1);

    const micRate = state.microphoneCapture?.getSampleRate() || 48000;
    if (state._verboseLogging) console.log(`[Main] Configuring User STT to ${micRate}Hz`);
    state.googleSTT_User?.setSampleRate(micRate);
    state.googleSTT_User?.setAudioChannelCount?.(1);

    if (state._verboseLogging) console.log('[Main] Full Audio Pipeline (System + Mic) Initialized (Ready)');

  } catch (err) {
    console.error('[Main] Failed to setup System Audio Pipeline:', err);
    throw err;
  }
}

export async function startAudioTest(appState: AppState, deviceId?: string): Promise<{ fallbackUsed: boolean }> {
  const state = appState;
  if (state._audioTestStarting) return { fallbackUsed: false };
  state._audioTestStarting = true;
  try {
    return await _startAudioTestImpl(appState, deviceId);
  } finally {
    state._audioTestStarting = false;
  }
}

export function attachAudioTestListeners(appState: AppState, capture: MicrophoneCapture): void {
  capture.on('data', (chunk: Buffer) => {
    const targets = [
      appState.settingsWindowHelper.getSettingsWindow(),
      appState.getWindowHelper().getLauncherWindow(),
      appState.getWindowHelper().getOverlayWindow(),
    ].filter((win): win is BrowserWindow => !!win && !win.isDestroyed());

    if (targets.length === 0) return;

    let sum = 0;
    const step = 10;
    const len = chunk.length;

    for (let i = 0; i < len; i += 2 * step) {
      const val = chunk.readInt16LE(i);
      sum += val * val;
    }

    const count = len / (2 * step);
    if (count > 0) {
      const rms = Math.sqrt(sum / count);
      const level = Math.min(rms / 10000, 1.0);
      for (const target of targets) {
        target.webContents.send('audio-test-level', level);
      }
    }
  });

  capture.on('error', (err: Error) => {
    console.error('[Main] AudioTest Error:', err);
  });
}

export async function _startAudioTestImpl(appState: AppState, deviceId?: string): Promise<{ fallbackUsed: boolean }> {
  const state = appState;
  console.log(`[Main] Starting Audio Test on device: ${deviceId || 'default'}`);
  stopAudioTest(appState);

  if (!(await ensureMacMicrophoneAccess('audio test'))) {
    throw new Error('Microphone access denied. Please allow microphone access in System Settings and try again.');
  }

  try {
    state.audioTestCapture = new MicrophoneCapture(deviceId || undefined);
    attachAudioTestListeners(appState, state.audioTestCapture);
    state.audioTestCapture.start();
    return { fallbackUsed: false };
  } catch (err) {
    console.warn('[Main] Failed to start audio test on preferred device. Falling back to default.', err);
    try { state.audioTestCapture?.stop(); } catch { }
    state.audioTestCapture = null;
    try {
      state.audioTestCapture = new MicrophoneCapture();
      attachAudioTestListeners(appState, state.audioTestCapture);
      state.audioTestCapture.start();
      return { fallbackUsed: true };
    } catch (fallbackErr) {
      console.error('[Main] Failed to start audio test:', fallbackErr);
      throw fallbackErr;
    }
  }
}

export function stopAudioTest(appState: AppState): void {
  const state = appState;
  if (state.audioTestCapture) {
    console.log('[Main] Stopping Audio Test');
    state.audioTestCapture.stop();
    state.audioTestCapture = null;
  }
}

export function finalizeMicSTT(appState: AppState): void {
  const state = appState;
  if (state.googleSTT_User?.finalize) {
    console.log('[Main] Finalizing STT');
    state.googleSTT_User.finalize();
  }
  handleSpeakerSpeechEnded(appState, 'user');
}

export async function translateTranscriptSegment(appState: AppState, segment: {
  segmentId: string;
  text: string;
  speaker?: TranscriptSpeaker;
  speakerLabel?: string;
  timestamp?: number;
}): Promise<{ success: boolean; error?: string; translatedText?: string }> {
  const text = normalizeTranscriptText(appState, segment.text);
  if (!segment.segmentId || !text) {
    return { success: false, error: 'Missing transcript segment data' };
  }

  return emitTranscriptWithTranslation(appState, {
    speaker: segment.speaker || 'them',
    text,
    timestamp: segment.timestamp ?? Date.now(),
    confidence: 1,
    segmentId: segment.segmentId,
    speakerLabel: segment.speakerLabel,
    forceTranslate: true,
    // The turn's current revision: without it a later reopen could not supersede this request.
    revision: appState.transcriptSegmentRevisions.get(segment.segmentId),
  });
}

export function getNativeAudioStatus(appState: AppState): {
  connected: boolean;
  meetingActive: boolean;
  hasRecentSystemAudioChunk: boolean;
  hasRecentThemTranscript: boolean;
  lastSystemAudioChunkAt: number | null;
  lastThemTranscriptAt: number | null;
  lastError: string | null;
} {
  const state = appState;
  const now = Date.now();
  const hasRecentSystemAudioChunk =
    state.lastSystemAudioChunkAt != null && now - state.lastSystemAudioChunkAt < 3000;
  const hasRecentThemTranscript =
    state.lastThemTranscriptAt != null && now - state.lastThemTranscriptAt < 6000;

  return {
    connected: appState.getIsMeetingActive() && !!state.systemAudioCapture && !!state.googleSTT,
    meetingActive: appState.getIsMeetingActive(),
    hasRecentSystemAudioChunk,
    hasRecentThemTranscript,
    lastSystemAudioChunkAt: state.lastSystemAudioChunkAt,
    lastThemTranscriptAt: state.lastThemTranscriptAt,
    lastError: state.lastAudioPipelineError,
  };
}
