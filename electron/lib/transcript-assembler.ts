import type { AppState } from "../main"
import { CredentialsManager } from "../services/CredentialsManager"
import { isTranscriptTranslationConfigured } from "../transcript/translationExecutor"

export type TranscriptSpeaker = 'interviewer' | 'user';

export interface BufferedTranscriptTurn {
  segmentId: string;
  startedAt: number;
  lastUpdatedAt: number;
  confidence: number;
  text: string;
  flushTimer: NodeJS.Timeout | null;
}

export type TranscriptAssemblerProfile = 'sentence_bias' | 'low_latency';

export interface TranscriptAssemblerThresholds {
  maxSilenceBeforeNewTurnMs: number;
  sentenceFlushDelayMs: number;
  fragmentFlushDelayMs: number;
  speechEndedSentenceFlushMs: number;
  speechEndedFragmentFlushMs: number;
  /** Minimum word count before a sentence-ending can trigger the shorter flush delay.
   *  Segments with fewer words use fragmentFlushDelayMs even if they end with punctuation. */
  minWordsBeforeSentenceFlush: number;
}

const TRANSCRIPT_ASSEMBLER_PROFILE: TranscriptAssemblerProfile = 'sentence_bias';

const TRANSCRIPT_ASSEMBLER_THRESHOLDS: Record<TranscriptAssemblerProfile, TranscriptAssemblerThresholds> = {
  sentence_bias: {
    maxSilenceBeforeNewTurnMs: 3200,
    sentenceFlushDelayMs: 1350,
    fragmentFlushDelayMs: 2600,
    speechEndedSentenceFlushMs: 260,
    speechEndedFragmentFlushMs: 1100,
    minWordsBeforeSentenceFlush: 18,
  },
  low_latency: {
    maxSilenceBeforeNewTurnMs: 2200,
    sentenceFlushDelayMs: 700,
    fragmentFlushDelayMs: 1450,
    speechEndedSentenceFlushMs: 120,
    speechEndedFragmentFlushMs: 500,
    minWordsBeforeSentenceFlush: 8,
  },
};

export function getTranscriptAssemblerThresholds(appState: AppState): TranscriptAssemblerThresholds {
  void appState;
  return TRANSCRIPT_ASSEMBLER_THRESHOLDS[TRANSCRIPT_ASSEMBLER_PROFILE];
}

export function emitNativeAudioTranscript(appState: AppState, payload: any): void {
  const helper = appState.getWindowHelper();
  helper.getLauncherWindow()?.webContents.send('native-audio-transcript', payload);
  helper.getOverlayWindow()?.webContents.send('native-audio-transcript', payload);
}

export function createTranscriptSegmentId(appState: AppState, speaker: TranscriptSpeaker, timestamp: number): string {
  void appState;
  const prefix = speaker === 'user' ? 'user' : 'seg';
  return `${prefix}_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTranscriptText(appState: AppState, text: string): string {
  void appState;
  return text.replace(/\s+/g, ' ').trim();
}

export function endsSentence(appState: AppState, text: string): boolean {
  void appState;
  return /[.!?。！？…]["')\]]?\s*$/.test(text.trim());
}

export function mergeTranscriptText(appState: AppState, existing: string, incoming: string): string {
  const left = normalizeTranscriptText(appState, existing);
  const right = normalizeTranscriptText(appState, incoming);

  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  if (right.startsWith(left)) return right;
  if (left.endsWith(right)) return left;

  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);
  const maxOverlap = Math.min(12, leftWords.length, rightWords.length);

  for (let overlap = maxOverlap; overlap >= 3; overlap -= 1) {
    const leftTail = leftWords.slice(-overlap).join(' ').toLowerCase();
    const rightHead = rightWords.slice(0, overlap).join(' ').toLowerCase();
    if (leftTail === rightHead) {
      return `${leftWords.join(' ')} ${rightWords.slice(overlap).join(' ')}`.trim();
    }
  }

  const separator = /[\s([{"'-]$/.test(left) ? '' : ' ';
  return `${left}${separator}${right}`.trim();
}

export function scheduleBufferedTranscriptFlush(appState: AppState, speaker: TranscriptSpeaker, delayMs: number): void {
  const state = appState as any;
  const buffer = state.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
  if (!buffer) return;
  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer);
  }
  buffer.flushTimer = setTimeout(() => {
    void flushBufferedTranscriptTurn(appState, speaker);
  }, delayMs);
}

export function bufferFinalTranscriptChunk(
  appState: AppState,
  speaker: TranscriptSpeaker,
  text: string,
  timestamp: number,
  confidence: number
): void {
  const state = appState as any;
  const thresholds = getTranscriptAssemblerThresholds(appState);
  const normalizedText = normalizeTranscriptText(appState, text);
  if (!normalizedText) return;

  let buffer = state.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
  if (buffer && timestamp - buffer.lastUpdatedAt > thresholds.maxSilenceBeforeNewTurnMs) {
    void flushBufferedTranscriptTurn(appState, speaker);
    buffer = null;
  }

  if (!buffer) {
    buffer = {
      segmentId: createTranscriptSegmentId(appState, speaker, timestamp),
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
      confidence,
      text: normalizedText,
      flushTimer: null,
    };
    state.transcriptTurnBuffers[speaker] = buffer;
  } else {
    buffer.text = mergeTranscriptText(appState, buffer.text, normalizedText);
    buffer.lastUpdatedAt = timestamp;
    buffer.confidence = Math.max(buffer.confidence, confidence);
  }

  const wordCount = buffer.text.split(/\s+/).length;
  const isSentenceComplete = endsSentence(appState, buffer.text) && wordCount >= thresholds.minWordsBeforeSentenceFlush;
  const flushDelayMs = isSentenceComplete
    ? thresholds.sentenceFlushDelayMs
    : thresholds.fragmentFlushDelayMs;
  scheduleBufferedTranscriptFlush(appState, speaker, flushDelayMs);
}

export function handleSpeakerSpeechEnded(appState: AppState, speaker: TranscriptSpeaker): void {
  const state = appState as any;
  const buffer = state.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
  if (!buffer) return;
  const thresholds = getTranscriptAssemblerThresholds(appState);
  const wordCount = buffer.text.split(/\s+/).length;
  const isSentenceComplete = endsSentence(appState, buffer.text) && wordCount >= thresholds.minWordsBeforeSentenceFlush;
  scheduleBufferedTranscriptFlush(
    appState,
    speaker,
    isSentenceComplete
      ? thresholds.speechEndedSentenceFlushMs
      : thresholds.speechEndedFragmentFlushMs
  );
}

export function resetBufferedTranscriptTurns(appState: AppState): void {
  const state = appState as any;
  for (const speaker of Object.keys(state.transcriptTurnBuffers) as TranscriptSpeaker[]) {
    const buffer = state.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
    if (buffer?.flushTimer) {
      clearTimeout(buffer.flushTimer);
    }
    state.transcriptTurnBuffers[speaker] = null;
  }
}

export async function flushBufferedTranscriptTurn(appState: AppState, speaker: TranscriptSpeaker): Promise<void> {
  const state = appState as any;
  const buffer = state.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
  if (!buffer) return;

  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer);
  }
  state.transcriptTurnBuffers[speaker] = null;

  const text = normalizeTranscriptText(appState, buffer.text);
  if (!text) return;

  const timestamp = buffer.startedAt || Date.now();
  const confidence = buffer.confidence || 0;

  if (state.ragManager) {
    state.ragManager.feedLiveTranscript([{
      speaker,
      text,
      timestamp,
    }]);
  }

  if (speaker === 'interviewer') {
    state.knowledgeOrchestrator?.feedInterviewerUtterance?.(text);
    await emitTranscriptWithTranslation(appState, {
      speaker,
      text,
      timestamp,
      confidence,
      segmentId: buffer.segmentId,
    });
    return;
  }

  const displayMode = CredentialsManager.getInstance().getTranscriptTranslationDisplayMode();
  emitNativeAudioTranscript(appState, {
    speaker,
    text,
    sourceText: text,
    translatedText: undefined,
    segmentId: buffer.segmentId,
    timestamp,
    final: true,
    confidence,
    displayMode,
    translationState: 'skipped' as const,
    speakerLabel: 'Me',
  });
}

export async function emitTranscriptWithTranslation(appState: AppState, params: {
  speaker: TranscriptSpeaker;
  text: string;
  timestamp: number;
  confidence: number;
  segmentId: string;
  speakerLabel?: string;
  forceTranslate?: boolean;
}): Promise<{ success: boolean; error?: string; translatedText?: string }> {
  const state = appState as any;
  const { speaker, text, timestamp, confidence, segmentId, speakerLabel, forceTranslate = false } = params;
  const { CredentialsManager } = require('../services/CredentialsManager');
  const cm = CredentialsManager.getInstance();
  const displayMode = cm.getTranscriptTranslationDisplayMode();
  const translationEnabled = cm.getTranscriptTranslationEnabled();
  const translationModelRaw = cm.getTranscriptTranslationModel();
  const translationProvider = cm.getTranscriptTranslationProvider();
  const translationPrompt = cm.getTranscriptTranslationPrompt();
  const standardProviders = new Set(['ollama', 'gemini', 'groq', 'openai', 'claude']);
  const oaiCompat = cm.getOpenAICompatibleProviders().find(
    (p: { id: string }) => p.id === translationProvider
  );
  const effectiveTranslationModel =
    translationModelRaw.trim() || (oaiCompat?.preferredModel?.trim() ?? '');
  const shouldTranslate = forceTranslate ? true : translationEnabled;
  const isTranslationConfigured =
    isTranscriptTranslationConfigured(shouldTranslate, effectiveTranslationModel, translationPrompt) &&
    (standardProviders.has(translationProvider) ? true : !!oaiCompat);

  const pendingPayload: {
    speaker: TranscriptSpeaker;
    text: string;
    sourceText: string;
    translatedText?: string;
    segmentId: string;
    timestamp: number;
    final: true;
    confidence: number;
    displayMode: 'original' | 'translated' | 'both';
    translationState: 'pending' | 'skipped';
    speakerLabel?: string;
  } = {
    speaker,
    text,
    sourceText: text,
    translatedText: undefined,
    segmentId,
    timestamp,
    final: true,
    confidence,
    displayMode,
    translationState: isTranslationConfigured ? 'pending' as const : 'skipped' as const,
    speakerLabel,
  };

  if (!isTranslationConfigured) {
    emitNativeAudioTranscript(
      appState,
      forceTranslate
        ? { ...pendingPayload, translationState: 'error' as const }
        : pendingPayload
    );
    return forceTranslate
      ? { success: false, error: 'Transcript translation is not configured. Set a provider and model first.' }
      : { success: true };
  }

  emitNativeAudioTranscript(appState, pendingPayload);

  try {
    const baseReq = {
      model: effectiveTranslationModel,
      prompt: translationPrompt,
      sourceText: text,
      ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
      sourceLanguageKey: cm.getTranscriptTranslationSourceLanguage(),
      targetLanguageKey: cm.getTranscriptTranslationTargetLanguage(),
    };
    let translatedText: string;
    if (oaiCompat && !standardProviders.has(translationProvider)) {
      translatedText = await state.processingHelper.getLLMHelper().translateTranscriptText({
        ...baseReq,
        provider: 'openai-compatible',
        openAICompatible: { baseUrl: oaiCompat.baseUrl, apiKey: oaiCompat.apiKey },
      });
    } else {
      translatedText = await state.processingHelper.getLLMHelper().translateTranscriptText({
        ...baseReq,
        provider: translationProvider as 'ollama' | 'gemini' | 'groq' | 'openai' | 'claude',
      });
    }

    const translatedPayloadText =
      displayMode === 'translated' ? (translatedText || text) : text;

    emitNativeAudioTranscript(appState, {
      speaker,
      text: translatedPayloadText,
      sourceText: text,
      translatedText: translatedText || undefined,
      segmentId,
      timestamp,
      final: true,
      confidence,
      displayMode,
      translationState: 'complete' as const,
      speakerLabel,
    });
    return { success: true, translatedText: translatedText || undefined };
  } catch (error: any) {
    console.warn('[Main] Transcript translation failed:', error?.message || error);
    emitNativeAudioTranscript(appState, {
      speaker,
      text,
      sourceText: text,
      translatedText: undefined,
      segmentId,
      timestamp,
      final: true,
      confidence,
      displayMode,
      translationState: 'error' as const,
      speakerLabel,
    });
    return { success: false, error: error?.message || 'Transcript translation failed' };
  }
}
