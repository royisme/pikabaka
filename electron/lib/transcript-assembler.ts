import { classifyTranslationError } from "../transcript/translationError";
import { formatTranslationTiming } from "../transcript/translationStream";
import { splitAtLastSentence } from "../transcript/sentences";
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
  /** When the speech provider last reported words that are not final yet: the speaker is still talking. */
  lastActivityAt?: number;
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
    maxTurnDurationMs: 0,
    reopenWindowMs: 6500,
  },
  low_latency: {
    maxSilenceBeforeNewTurnMs: 2200,
    sentenceFlushDelayMs: 700,
    fragmentFlushDelayMs: 1450,
    speechEndedSentenceFlushMs: 120,
    speechEndedFragmentFlushMs: 500,
    maxTurnDurationMs: 0,
    reopenWindowMs: 4000,
  },
  coherent: {
    maxSilenceBeforeNewTurnMs: 6000,
    sentenceFlushDelayMs: 2500,
    fragmentFlushDelayMs: 5000,
    speechEndedSentenceFlushMs: 400,
    speechEndedFragmentFlushMs: 1500,
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
  buffer.flushTimer = setTimeout(() => flushWhenQuiet(appState, speaker), delayMs);
}

/** The turn holds a finished sentence: it cannot grow any more, so it is shown soon. */
function hasFinishedSentence(text: string): boolean {
  return splitAtLastSentence(text).finished !== '';
}

/** While the speaker is still talking, a turn that stops mid-sentence is held rather than flushed. */
const SPEAKING_HOLD_MS = 1500;
const SPEAKING_RECHECK_MS = 500;
/** A turn is never held longer than this, for speech that has no punctuation. */
const MAX_HOLD_MS = 20000;

function flushWhenQuiet(appState: AppState, speaker: TranscriptSpeaker): void {
  const buffer = (appState as any).transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
  if (!buffer) return;
  const now = Date.now();
  const speaking = now - (buffer.lastActivityAt ?? 0) < SPEAKING_HOLD_MS;
  // Only a turn with no finished sentence yet is held: with one, the flush shows it and carries the rest on.
  if (speaking && !splitAtLastSentence(buffer.text).finished && now - buffer.startedAt < MAX_HOLD_MS) {
    scheduleBufferedTranscriptFlush(appState, speaker, SPEAKING_RECHECK_MS);
    return;
  }
  void flushBufferedTranscriptTurn(appState, speaker);
}

/** Words that are not final yet were heard: the turn being assembled is still going on. */
export function noteTranscriptActivity(appState: AppState, speaker: TranscriptSpeaker, timestamp: number): void {
  const buffer = (appState as any).transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
  if (!buffer) return;
  buffer.lastActivityAt = timestamp;
  // The silence that ends a turn is counted from the last words heard, not from the last final.
  buffer.lastUpdatedAt = Math.max(buffer.lastUpdatedAt, timestamp);
}

/** The words of the turn being assembled, which are final but not yet in a row. */
export function getBufferedTranscriptText(appState: AppState, speaker: TranscriptSpeaker): string {
  const buffer = (appState as any).transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
  return buffer ? normalizeTranscriptText(appState, buffer.text) : '';
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
    void flushBufferedTranscriptTurn(appState, speaker, { all: true });
    buffer = null;
  }

  if (buffer && thresholds.maxTurnDurationMs > 0 && timestamp - buffer.startedAt > thresholds.maxTurnDurationMs) {
    void flushBufferedTranscriptTurn(appState, speaker);
    // The unfinished sentence at the end stays behind as the turn that goes on.
    buffer = state.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
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

  const isSentenceComplete = hasFinishedSentence(buffer.text);
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
  const isSentenceComplete = hasFinishedSentence(buffer.text);
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

/** Writes one assembled turn to the meeting record. The write is synchronous, before any translation is awaited. */
function recordTranscriptTurn(appState: AppState, speaker: TranscriptSpeaker, turn: Pick<BufferedTranscriptTurn, 'segmentId' | 'revision' | 'startedAt'>, text: string): void {
  appState.recordTranscriptSegment({ segmentId: turn.segmentId, revision: turn.revision, speaker, text, timestampMs: turn.startedAt });
}

export function resetBufferedTranscriptTurns(appState: AppState): void {
  const state = appState as any;
  for (const speaker of Object.keys(state.transcriptTurnBuffers) as TranscriptSpeaker[]) {
    const buffer = state.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
    // A turn still being assembled is written as it stands, so stopping or reconfiguring audio loses nothing.
    const pendingText = buffer ? normalizeTranscriptText(appState, buffer.text) : '';
    if (buffer && pendingText) recordTranscriptTurn(appState, speaker, buffer, pendingText);
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

/**
 * Writes and shows the turn up to its last finished sentence. The unfinished sentence after it is
 * carried into a new turn, so a row never ends in the middle of a sentence; `all` flushes everything.
 */
export async function flushBufferedTranscriptTurn(appState: AppState, speaker: TranscriptSpeaker, options?: { all?: boolean }): Promise<void> {
  const state = appState as any;
  const buffer = state.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
  if (!buffer) return;

  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer);
  }
  state.transcriptTurnBuffers[speaker] = null;

  let text = normalizeTranscriptText(appState, buffer.text);
  if (!text) return;

  const thresholds = getTranscriptAssemblerThresholds(appState);
  if (!options?.all) {
    const { finished, rest } = splitAtLastSentence(text);
    if (finished && rest) {
      text = finished;
      state.transcriptTurnBuffers[speaker] = {
        segmentId: createTranscriptSegmentId(appState, speaker, buffer.lastUpdatedAt),
        startedAt: buffer.lastUpdatedAt,
        lastUpdatedAt: buffer.lastUpdatedAt,
        confidence: buffer.confidence,
        text: rest,
        flushTimer: null,
        detectedLanguage: buffer.detectedLanguage,
        revision: 1,
        lastActivityAt: buffer.lastActivityAt,
      } satisfies BufferedTranscriptTurn;
      scheduleBufferedTranscriptFlush(appState, speaker, thresholds.fragmentFlushDelayMs);
    }
  }

  const timestamp = buffer.startedAt || Date.now();
  const confidence = buffer.confidence || 0;
  const endedSentence = endsSentence(appState, text);

  state.transcriptSegmentRevisions.set(buffer.segmentId, buffer.revision);
  recordTranscriptTurn(appState, speaker, buffer, text);

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
  /** The connection chosen for translation (any type and host), when it exists and can be used. */
  connection?: { type: 'openai' | 'anthropic' | 'gemini' | 'ollama'; baseUrl: string; apiKey: string };
  standardProviders: Set<string>;
  isConfigured: boolean;
};

/** `override` is a setting that is shown but not saved yet: the translation test runs on it. */
function resolveTranslationConfig(
  forceTranslate: boolean,
  override?: { provider?: string; model?: string; prompt?: string; targetLanguage?: string }
): TranslationConfig {
  const { CredentialsManager } = require('../services/CredentialsManager');
  const cm = CredentialsManager.getInstance();
  const provider: string = override?.provider ?? cm.getTranscriptTranslationProvider();
  const standardProviders = new Set(['ollama', 'gemini', 'groq', 'openai', 'claude']);
  const oaiCompat = cm.getOpenAICompatibleProviders().find((p: { id: string }) => p.id === provider);
  const model: string = (override?.model ?? cm.getTranscriptTranslationModel()).trim() || (oaiCompat?.preferredModel?.trim() ?? '');
  const prompt: string = override?.prompt ?? cm.getTranscriptTranslationPrompt();
  const resolved = cm.resolveConnection(provider);
  const connection = resolved && cm.isConnectionReady(provider) ? { type: resolved.type, baseUrl: resolved.baseUrl, apiKey: resolved.apiKey } : undefined;
  const shouldTranslate = forceTranslate ? true : cm.getTranscriptTranslationEnabled();
  return {
    displayMode: cm.getTranscriptTranslationDisplayMode(),
    provider,
    model,
    prompt,
    sourceLanguageKey: cm.getTranscriptTranslationSourceLanguage(),
    targetLanguageKey: override?.targetLanguage ?? cm.getTranscriptTranslationTargetLanguage(),
    oaiCompat,
    connection,
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
  if (config.connection) {
    return llm.translateTranscriptText({ ...baseReq, provider: 'connection', connection: config.connection }, onProgress);
  }
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
  const whole = normalizeTranscriptText(appState, buffer.text);
  // Only up to the last finished sentence: that is what the flush will show, and the rest is carried on.
  const text = splitAtLastSentence(whole).finished || whole;
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
    // Only the reason and the HTTP status are logged: a provider's message can echo the transcript.
    const status = Number((error as { status?: unknown } | null)?.status);
    console.warn('[Main] Transcript translation failed:', reason, Number.isFinite(status) ? `(HTTP ${status})` : '');
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

/** The two sentences the translation test sends: invented, and in a language other than the target. */
const TEST_SENTENCES = {
  english: 'Could you walk me through how the billing service handles a failed payment? I want to be sure we never charge a customer twice.',
  chinese: '我们下周把新的价格方案发给您，您看这样安排可以吗？如果需要调整，请直接告诉我。',
};

/**
 * Translates a fixed sample with the settings as they are shown (saved or not), through the same
 * request path a meeting uses, and reports the speed. Nothing is stored or shown in a meeting.
 */
export async function testTranslation(
  appState: AppState,
  draft: { provider: string; model: string; prompt?: string; targetLanguage: string }
): Promise<{ success: boolean; sample: string; translatedText?: string; firstTokenMs?: number; totalMs?: number; error?: string }> {
  const config = resolveTranslationConfig(true, draft);
  const sample = isSameLanguage('english', config.targetLanguageKey) ? TEST_SENTENCES.chinese : TEST_SENTENCES.english;
  if (!config.model) return { success: false, sample, error: 'Choose a translation model first.' };
  if (!config.prompt.trim()) return { success: false, sample, error: 'The translation prompt is empty.' };
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  try {
    const translatedText = await runTranslationRequest(appState, config, { text: sample, segmentId: 'translation-test' }, () => {
      firstTokenAt ??= Date.now();
    });
    const endedAt = Date.now();
    if (!translatedText.trim()) return { success: false, sample, totalMs: endedAt - startedAt, error: 'The model answered with no text.' };
    return { success: true, sample, translatedText, firstTokenMs: firstTokenAt === null ? undefined : firstTokenAt - startedAt, totalMs: endedAt - startedAt };
  } catch (error: unknown) {
    // The sample is invented, so a provider's message is safe to show; it says why the model cannot be used.
    const message = error instanceof Error ? error.message : String(error);
    const status = Number((error as { status?: unknown } | null)?.status);
    return {
      success: false,
      sample,
      totalMs: Date.now() - startedAt,
      error: `${classifyTranslationError(error)}${Number.isFinite(status) ? ` (HTTP ${status})` : ''}: ${message.replace(/\s+/g, ' ').slice(0, 240)}`,
    };
  }
}
