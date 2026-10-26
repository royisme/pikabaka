import { classifyTranslationError } from "../transcript/translationError";
import { formatTranslationTiming } from "../transcript/translationStream";
import { SpeculativeTranslations } from "../transcript/speculativeTranslation";
import type { AppState } from "../main"
import { CredentialsManager } from "../services/CredentialsManager"
import { isTranscriptTranslationConfigured, isSameLanguage } from "../transcript/translationExecutor"

export type TranscriptSpeaker = 'interviewer' | 'user';

export interface BufferedTranscriptTurn {
  segmentId: string;
  startedAt: number;
  lastUpdatedAt: number;
  confidence: number;
  text: string;
  flushTimer: NodeJS.Timeout | null;
  detectedLanguage?: string;
  revision: number;
}

export interface FlushedTranscriptTurn {
  segmentId: string;
  text: string;
  startedAt: number;
  lastUpdatedAt: number;   // timestamp of last merged chunk
  flushedAt: number;       // Date.now() at flush
  confidence: number;
  detectedLanguage?: string;
  revision: number;        // revision already emitted
  endedSentence: boolean;
  ragFed: boolean;
  sealTimer: NodeJS.Timeout | null;
}

export type TranscriptAssemblerProfile = 'sentence_bias' | 'low_latency' | 'coherent';

export interface TranscriptAssemblerThresholds {
  maxSilenceBeforeNewTurnMs: number;
  sentenceFlushDelayMs: number;
  fragmentFlushDelayMs: number;
  speechEndedSentenceFlushMs: number;
  speechEndedFragmentFlushMs: number;
  /** Minimum word count before a sentence-ending can trigger the shorter flush delay.
   *  Segments with fewer words use fragmentFlushDelayMs even if they end with punctuation. */
  minWordsBeforeSentenceFlush: number;
  maxTurnDurationMs: number;
  /** How long (from lastUpdatedAt) a flushed non-sentence-final turn stays reopenable. */
  reopenWindowMs: number;
}

export const DEFAULT_TRANSCRIPT_ASSEMBLER_PROFILE: TranscriptAssemblerProfile = 'sentence_bias';

const TRANSCRIPT_ASSEMBLER_THRESHOLDS: Record<TranscriptAssemblerProfile, TranscriptAssemblerThresholds> = {
  sentence_bias: {
    maxSilenceBeforeNewTurnMs: 3200,
    sentenceFlushDelayMs: 1350,
    fragmentFlushDelayMs: 2600,
    speechEndedSentenceFlushMs: 260,
    speechEndedFragmentFlushMs: 1100,
    minWordsBeforeSentenceFlush: 18,
    maxTurnDurationMs: 0,
    reopenWindowMs: 6500,
  },
  low_latency: {
    maxSilenceBeforeNewTurnMs: 2200,
    sentenceFlushDelayMs: 700,
    fragmentFlushDelayMs: 1450,
    speechEndedSentenceFlushMs: 120,
    speechEndedFragmentFlushMs: 500,
    minWordsBeforeSentenceFlush: 8,
    maxTurnDurationMs: 0,
    reopenWindowMs: 4000,
  },
  coherent: {
    maxSilenceBeforeNewTurnMs: 6000,
    sentenceFlushDelayMs: 2500,
    fragmentFlushDelayMs: 5000,
    speechEndedSentenceFlushMs: 400,
    speechEndedFragmentFlushMs: 1500,
    minWordsBeforeSentenceFlush: 10,
    maxTurnDurationMs: 30000,
    reopenWindowMs: 9500,
  },
};

export function isTranscriptAssemblerProfile(value: unknown): value is TranscriptAssemblerProfile {
  return value === 'sentence_bias' || value === 'low_latency' || value === 'coherent';
}

export function getTranscriptAssemblerThresholds(appState: AppState): TranscriptAssemblerThresholds {
  const profile = isTranscriptAssemblerProfile(appState.transcriptAssemblerProfile)
    ? appState.transcriptAssemblerProfile
    : DEFAULT_TRANSCRIPT_ASSEMBLER_PROFILE;
  return TRANSCRIPT_ASSEMBLER_THRESHOLDS[profile];
}

/** A result for a revision that is no longer the segment's latest must be dropped. Results without a revision are never superseded. */
export function isSupersededRevision(
  latest: ReadonlyMap<string, number>,
  segmentId: string,
  revision: number | undefined
): boolean {
  return revision !== undefined && latest.get(segmentId) !== revision;
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

export function shouldReopenFlushedTurn(
  flushed: Pick<FlushedTranscriptTurn, 'endedSentence' | 'lastUpdatedAt' | 'startedAt'>,
  timestamp: number,
  thresholds: TranscriptAssemblerThresholds
): boolean {
  if (flushed.endedSentence) return false;
  if (thresholds.reopenWindowMs <= 0) return false;
  if (timestamp - flushed.lastUpdatedAt > thresholds.reopenWindowMs) return false;
  if (thresholds.maxTurnDurationMs > 0 && timestamp - flushed.startedAt > thresholds.maxTurnDurationMs) return false;
  return true;
}

export function countTranscriptWords(appState: AppState, text: string): number {
  void appState;
  const cjkMatches = text.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const remaining = text.replace(/[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g, ' ').trim();
  const wordCount = remaining ? remaining.split(/\s+/).length : 0;
  return cjkCount + wordCount;
}

export function sealFlushedTranscriptTurn(appState: AppState, speaker: TranscriptSpeaker): void {
  const state = appState as any;
  const flushed = state.lastFlushedTranscriptTurns[speaker] as FlushedTranscriptTurn | null;
  if (!flushed) return;
  if (flushed.sealTimer) {
    clearTimeout(flushed.sealTimer);
    flushed.sealTimer = null;
  }
  if (!flushed.ragFed) {
    flushed.ragFed = true;
    if (state.ragManager) {
      state.ragManager.feedLiveTranscript([{
        speaker,
        text: flushed.text,
        timestamp: flushed.startedAt,
      }]);
    }
    if (speaker === 'interviewer') {
      state.knowledgeOrchestrator?.feedInterviewerUtterance?.(flushed.text);
    }
  }
  state.lastFlushedTranscriptTurns[speaker] = null;
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

  const CJK_EDGE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯　-〿！-～]/;
  if (CJK_EDGE.test(left.slice(-1)) && CJK_EDGE.test(right.charAt(0))) {
    return `${left}${right}`.trim();
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
  confidence: number,
  detectedLanguage?: string
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

  if (buffer && thresholds.maxTurnDurationMs > 0 && timestamp - buffer.startedAt > thresholds.maxTurnDurationMs) {
    void flushBufferedTranscriptTurn(appState, speaker);
    buffer = null;
  }

  if (!buffer) {
    const lf = state.lastFlushedTranscriptTurns[speaker] as FlushedTranscriptTurn | null;
    if (lf && shouldReopenFlushedTurn(lf, timestamp, thresholds)) {
      if (lf.sealTimer) clearTimeout(lf.sealTimer);
      buffer = {
        segmentId: lf.segmentId, startedAt: lf.startedAt, lastUpdatedAt: lf.lastUpdatedAt,
        confidence: lf.confidence, text: lf.text, flushTimer: null,
        detectedLanguage: lf.detectedLanguage, revision: lf.revision + 1,
      };
      state.transcriptTurnBuffers[speaker] = buffer;
      state.lastFlushedTranscriptTurns[speaker] = null;
      // From here the old revision is superseded: a translation still running for it must not be shown.
      state.transcriptSegmentRevisions.set(buffer.segmentId, buffer.revision);
    } else if (lf) {
      sealFlushedTranscriptTurn(appState, speaker); // superseded: feed RAG now, clear slot
    }
  }

  if (!buffer) {
    buffer = {
      segmentId: createTranscriptSegmentId(appState, speaker, timestamp),
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
      confidence,
      text: normalizedText,
      flushTimer: null,
      detectedLanguage,
      revision: 1,
    };
    state.transcriptTurnBuffers[speaker] = buffer;
  } else {
    buffer.text = mergeTranscriptText(appState, buffer.text, normalizedText);
    buffer.lastUpdatedAt = timestamp;
    buffer.confidence = Math.max(buffer.confidence, confidence);
    if (detectedLanguage) buffer.detectedLanguage = detectedLanguage;
  }

  const wordCount = countTranscriptWords(appState, buffer.text);
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
  const wordCount = countTranscriptWords(appState, buffer.text);
  const isSentenceComplete = endsSentence(appState, buffer.text) && wordCount >= thresholds.minWordsBeforeSentenceFlush;
  scheduleBufferedTranscriptFlush(
    appState,
    speaker,
    isSentenceComplete
      ? thresholds.speechEndedSentenceFlushMs
      : thresholds.speechEndedFragmentFlushMs
  );
  // Only the other party is translated. Start the request now, ahead of the flush that is scheduled above.
  if (speaker === 'interviewer') startSpeculativeTranslation(appState, buffer);
}

export function resetBufferedTranscriptTurns(appState: AppState): void {
  const state = appState as any;
  for (const speaker of Object.keys(state.transcriptTurnBuffers) as TranscriptSpeaker[]) {
    const buffer = state.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
    if (buffer?.flushTimer) {
      clearTimeout(buffer.flushTimer);
    }
    state.transcriptTurnBuffers[speaker] = null;
    sealFlushedTranscriptTurn(appState, speaker);
  }
  state.transcriptSegmentRevisions.clear();
  state.recentTranslatedTurns.length = 0;
  speculativeTranslations.clear();
  speculatedTurns.clear();
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
  const thresholds = getTranscriptAssemblerThresholds(appState);
  const endedSentence = endsSentence(appState, text);

  state.transcriptSegmentRevisions.set(buffer.segmentId, buffer.revision);

  if (endedSentence) {
    if (state.ragManager) {
      state.ragManager.feedLiveTranscript([{
        speaker,
        text,
        timestamp,
      }]);
    }
    if (speaker === 'interviewer') {
      state.knowledgeOrchestrator?.feedInterviewerUtterance?.(text);
    }
    state.lastFlushedTranscriptTurns[speaker] = null;
  } else {
    const flushed: FlushedTranscriptTurn = {
      segmentId: buffer.segmentId,
      text,
      startedAt: buffer.startedAt,
      lastUpdatedAt: buffer.lastUpdatedAt,
      flushedAt: Date.now(),
      confidence,
      detectedLanguage: buffer.detectedLanguage,
      revision: buffer.revision,
      endedSentence: false,
      ragFed: false,
      sealTimer: null,
    };
    const delay = Math.max(500, thresholds.reopenWindowMs - (Date.now() - buffer.lastUpdatedAt));
    flushed.sealTimer = setTimeout(() => sealFlushedTranscriptTurn(appState, speaker), delay);
    state.lastFlushedTranscriptTurns[speaker] = flushed;
  }

  if (speaker === 'interviewer') {
    await emitTranscriptWithTranslation(appState, {
      speaker,
      text,
      timestamp,
      confidence,
      segmentId: buffer.segmentId,
      detectedLanguage: buffer.detectedLanguage,
      revision: buffer.revision,
      lastSpeechAt: buffer.lastUpdatedAt,
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
    revision: buffer.revision,
  });
}

/**
 * Translations started at the speech provider's end-of-utterance signal, before the turn flushes, so
 * the request is already running when the flush asks for it. See `startSpeculativeTranslation`.
 */
const speculativeTranslations = new SpeculativeTranslations();

type TranslationConfig = {
  displayMode: 'original' | 'translated' | 'both';
  provider: string;
  model: string;
  prompt: string;
  sourceLanguageKey: string;
  targetLanguageKey: string;
  oaiCompat?: { id: string; baseUrl: string; apiKey: string; preferredModel?: string };
  standardProviders: Set<string>;
  isConfigured: boolean;
};

function resolveTranslationConfig(forceTranslate: boolean): TranslationConfig {
  const { CredentialsManager } = require('../services/CredentialsManager');
  const cm = CredentialsManager.getInstance();
  const provider: string = cm.getTranscriptTranslationProvider();
  const standardProviders = new Set(['ollama', 'gemini', 'groq', 'openai', 'claude']);
  const oaiCompat = cm.getOpenAICompatibleProviders().find((p: { id: string }) => p.id === provider);
  const model: string = cm.getTranscriptTranslationModel().trim() || (oaiCompat?.preferredModel?.trim() ?? '');
  const prompt: string = cm.getTranscriptTranslationPrompt();
  const shouldTranslate = forceTranslate ? true : cm.getTranscriptTranslationEnabled();
  return {
    displayMode: cm.getTranscriptTranslationDisplayMode(),
    provider,
    model,
    prompt,
    sourceLanguageKey: cm.getTranscriptTranslationSourceLanguage(),
    targetLanguageKey: cm.getTranscriptTranslationTargetLanguage(),
    oaiCompat,
    standardProviders,
    isConfigured:
      isTranscriptTranslationConfigured(shouldTranslate, model, prompt) &&
      (standardProviders.has(provider) ? true : !!oaiCompat),
  };
}

/** The text is already in the language it would be translated into. */
function isSameAsTarget(config: TranslationConfig, detectedLanguage?: string): boolean {
  const effectiveSource =
    detectedLanguage || (config.sourceLanguageKey && config.sourceLanguageKey !== 'auto' ? config.sourceLanguageKey : undefined);
  return !!effectiveSource && isSameLanguage(effectiveSource, config.targetLanguageKey);
}

/** One translation request for a turn, with the two previous translated turns as context. */
function runTranslationRequest(
  appState: AppState,
  config: TranslationConfig,
  turn: { text: string; segmentId: string; detectedLanguage?: string },
  onProgress: (textSoFar: string) => void
): Promise<string> {
  const state = appState as any;
  const recentTurns = (state.recentTranslatedTurns ?? []) as Array<{ segmentId: string; source: string; translation: string }>;
  const context = recentTurns
    .filter((t) => t.segmentId !== turn.segmentId)
    .slice(-2)
    .map((t) => ({ source: t.source, translation: t.translation }));
  const baseReq = {
    model: config.model,
    prompt: config.prompt,
    sourceText: turn.text,
    ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    sourceLanguageKey: config.sourceLanguageKey,
    targetLanguageKey: config.targetLanguageKey,
    detectedLanguageKey: turn.detectedLanguage,
    context: context.length > 0 ? context : undefined,
  };
  const llm = state.processingHelper.getLLMHelper();
  if (config.oaiCompat && !config.standardProviders.has(config.provider)) {
    return llm.translateTranscriptText({
      ...baseReq,
      provider: 'openai-compatible',
      openAICompatible: { baseUrl: config.oaiCompat.baseUrl, apiKey: config.oaiCompat.apiKey },
    }, onProgress);
  }
  return llm.translateTranscriptText({
    ...baseReq,
    provider: config.provider as 'ollama' | 'gemini' | 'groq' | 'openai' | 'claude',
  }, onProgress);
}

/** A turn this short is not worth a request that may be thrown away. */
const MIN_WORDS_TO_SPECULATE = 3;

/** Turns (segment and revision) that already had a speculative request: a turn gets at most one. */
const speculatedTurns = new Set<string>();

/**
 * Called when the speech provider says the utterance ended. The turn flushes a moment later; the
 * translation is started now so that, when the text has not changed by then, the flush finds it
 * already running. If more words arrive or the turn is merged, the flush makes its own request
 * and this one is discarded (the revision guard also drops anything for a superseded revision).
 */
function startSpeculativeTranslation(appState: AppState, buffer: BufferedTranscriptTurn): void {
  const text = normalizeTranscriptText(appState, buffer.text);
  if (countTranscriptWords(appState, text) < MIN_WORDS_TO_SPECULATE) return;
  const config = resolveTranslationConfig(false);
  if (!config.isConfigured || isSameAsTarget(config, buffer.detectedLanguage)) return;
  const turnKey = `${buffer.segmentId}:${buffer.revision}`;
  if (speculatedTurns.has(turnKey)) return;
  speculatedTurns.add(turnKey);
  if (speculatedTurns.size > 64) speculatedTurns.delete(speculatedTurns.values().next().value as string);
  speculativeTranslations.start(buffer.segmentId, text, (onProgress) =>
    runTranslationRequest(appState, config, { text, segmentId: buffer.segmentId, detectedLanguage: buffer.detectedLanguage }, onProgress)
  );
}

export async function emitTranscriptWithTranslation(appState: AppState, params: {
  speaker: TranscriptSpeaker;
  text: string;
  timestamp: number;
  confidence: number;
  segmentId: string;
  speakerLabel?: string;
  forceTranslate?: boolean;
  detectedLanguage?: string;
  revision?: number;
  /** When the last words of this turn were heard; only used to log how long the flush delay was. */
  lastSpeechAt?: number;
}): Promise<{ success: boolean; error?: string; translatedText?: string }> {
  const state = appState as any;
  const { speaker, text, timestamp, confidence, segmentId, speakerLabel, forceTranslate = false, detectedLanguage, revision, lastSpeechAt } = params;
  const config = resolveTranslationConfig(forceTranslate);
  const { displayMode, provider: translationProvider, model: effectiveTranslationModel } = config;
  const isTranslationConfigured = config.isConfigured;

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
    revision?: number;
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
    revision,
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

  if (isSameAsTarget(config, detectedLanguage)) {
    const translatedPayloadText = displayMode === 'translated' ? text : text;
    emitNativeAudioTranscript(appState, {
      speaker,
      text: translatedPayloadText,
      sourceText: text,
      translatedText: text,
      segmentId,
      timestamp,
      final: true,
      confidence,
      displayMode,
      translationState: 'complete' as const,
      speakerLabel,
      detectedLanguage,
      revision,
    });
    return { success: true, translatedText: text };
  }

  emitNativeAudioTranscript(appState, pendingPayload);

  // Timing is logged as numbers only, never text. firstTokenAt stays null until text arrives.
  let requestStartedAt = Date.now();
  let firstTokenAt: number | null = null;
  let speculative = false;
  const logTiming = (outcome: 'complete' | 'error', outputChars: number) => {
    const endedAt = Date.now();
    console.log(formatTranslationTiming({
      provider: translationProvider,
      model: effectiveTranslationModel,
      flushGapMs: lastSpeechAt === undefined ? null : requestStartedAt - lastSpeechAt,
      firstTokenMs: firstTokenAt === null ? null : firstTokenAt - requestStartedAt,
      totalMs: endedAt - requestStartedAt,
      sourceChars: text.length,
      outputChars,
      streamed: firstTokenAt !== null,
      speculative,
      outcome,
    }));
  };

  // Each report is the whole translation so far; it only ever grows, so the row can show it as final text.
  const onProgress = (textSoFar: string) => {
    firstTokenAt ??= Date.now();
    if (isSupersededRevision(state.transcriptSegmentRevisions, segmentId, revision)) return;
    emitNativeAudioTranscript(appState, {
      speaker,
      text,
      sourceText: text,
      translatedText: textSoFar,
      segmentId,
      timestamp,
      final: true,
      confidence,
      displayMode,
      translationState: 'streaming' as const,
      speakerLabel,
      detectedLanguage,
      revision,
    });
  };

  try {
    const recentTurns = (state.recentTranslatedTurns ?? []) as Array<{ segmentId: string; source: string; translation: string }>;
    // A request started at the provider's end-of-utterance signal may already be running for exactly this text.
    const claimed = forceTranslate ? null : speculativeTranslations.claim(segmentId, text);
    if (claimed) {
      speculative = true;
      requestStartedAt = claimed.startedAt;
      firstTokenAt = claimed.firstTextAt;
    }
    const translatedText = claimed
      ? await claimed.follow(onProgress)
      : await runTranslationRequest(appState, config, { text, segmentId, detectedLanguage }, onProgress);

    logTiming('complete', translatedText.length);

    if (isSupersededRevision(state.transcriptSegmentRevisions, segmentId, revision)) {
      return { success: false, error: 'superseded by newer revision' };
    }

    if (translatedText) {
      const existingIndex = recentTurns.findIndex((t) => t.segmentId === segmentId);
      if (existingIndex >= 0) {
        recentTurns[existingIndex] = { segmentId, source: text, translation: translatedText };
      } else {
        recentTurns.push({ segmentId, source: text, translation: translatedText });
      }
      while (recentTurns.length > 4) {
        recentTurns.shift();
      }
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
      detectedLanguage,
      revision,
    });
    return { success: true, translatedText: translatedText || undefined };
  } catch (error: unknown) {
    const reason = classifyTranslationError(error);
    // Only the reason is logged: a provider's message can echo the transcript.
    console.warn('[Main] Transcript translation failed:', reason);
    logTiming('error', 0);
    if (isSupersededRevision(state.transcriptSegmentRevisions, segmentId, revision)) {
      return { success: false, error: 'superseded by newer revision' };
    }
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
      translationError: reason,
      speakerLabel,
      detectedLanguage,
      revision,
    });
    return { success: false, error: reason };
  }
}
