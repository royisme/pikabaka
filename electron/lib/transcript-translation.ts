import { redactConnectionError } from '../services/connectionSecrets';
import type { Connection } from '../services/aiConnections';
import { classifyTranslationError } from "../transcript/translationError";
import { formatTranslationTiming } from "../transcript/translationStream";
import { splitAtLastSentence } from "../transcript/sentences";
import { ParagraphQueue } from "../transcript/paragraphs";
import { SpeculativeTranslations } from "../transcript/speculativeTranslation";
import type { AppState } from "../main"
import { CredentialsManager } from "../services/CredentialsManager"
import { isTranscriptTranslationConfigured, isSameLanguage } from "../transcript/translationExecutor"
import {
  emitNativeAudioTranscript,
  normalizeTranscriptText,
  countTranscriptWords,
  isSupersededRevision,
  type BufferedTranscriptTurn,
  type TranscriptSpeaker,
} from "./transcript-assembler"

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
  /** The connection chosen for translation (any type and host), when it exists and can be used. */
  connection?: Pick<Connection, 'type' | 'baseUrl' | 'apiKey' | 'headers'>;
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
  const model: string = (override?.model ?? cm.getTranscriptTranslationModel()).trim();
  const prompt: string = override?.prompt ?? cm.getTranscriptTranslationPrompt();
  const resolved = cm.resolveConnection(provider);
  const connection = resolved && cm.isConnectionReady(provider) ? { type: resolved.type, baseUrl: resolved.baseUrl, apiKey: resolved.apiKey, headers: resolved.headers } : undefined;
  const shouldTranslate = forceTranslate ? true : cm.getTranscriptTranslationEnabled();
  return {
    displayMode: cm.getTranscriptTranslationDisplayMode(),
    provider,
    model,
    prompt,
    sourceLanguageKey: cm.getTranscriptTranslationSourceLanguage(),
    targetLanguageKey: override?.targetLanguage ?? cm.getTranscriptTranslationTargetLanguage(),
    connection,
    isConfigured: isTranscriptTranslationConfigured(shouldTranslate, model, prompt) && !!connection,
  };
}

/** Interpreting translates the user's speech the other way: into the other party's language. */
function interpretingConfig(): TranslationConfig {
  const cm = CredentialsManager.getInstance();
  return { ...resolveTranslationConfig(true, { targetLanguage: cm.getSttLanguage() }), sourceLanguageKey: cm.getSttLanguageUser() };
}

export function isInterpretingTranslationReady(): boolean {
  return interpretingConfig().isConfigured;
}

/** One translation of what the user said, with no context: the recent turns run the other way. */
export function translateForInterpreting(appState: AppState, text: string): Promise<string> {
  const config = interpretingConfig();
  if (!config.isConfigured) return Promise.reject(new Error('Choose a translation model in Audio & Translation first.'));
  return runTranslationRequest(appState, config, { text, segmentId: 'interpreting', noContext: true }, () => {});
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
  turn: { text: string; segmentId: string; detectedLanguage?: string; noContext?: boolean },
  onProgress: (textSoFar: string) => void
): Promise<string> {
  const state = appState;
  const recentTurns = turn.noContext ? [] : ((state.recentTranslatedTurns ?? []) as Array<{ segmentId: string; source: string; translation: string }>);
  const context = recentTurns
    .filter((t) => t.segmentId !== turn.segmentId)
    .slice(-2)
    .map((t) => ({ source: t.source, translation: t.translation }));
  const baseReq = {
    model: config.model,
    prompt: config.prompt,
    sourceText: turn.text,
    sourceLanguageKey: config.sourceLanguageKey,
    targetLanguageKey: config.targetLanguageKey,
    detectedLanguageKey: turn.detectedLanguage,
    context: context.length > 0 ? context : undefined,
  };
  const llm = state.processingHelper.getLLMHelper();
  return llm.translateTranscriptText({ ...baseReq, provider: 'connection', connection: config.connection }, onProgress);
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
export function startSpeculativeTranslation(appState: AppState, buffer: BufferedTranscriptTurn): void {
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
  const state = appState;
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
    const message = redactConnectionError(error, config.connection).message;
    const status = Number((error as { status?: unknown } | null)?.status);
    return {
      success: false,
      sample,
      totalMs: Date.now() - startedAt,
      error: `${classifyTranslationError(error)}${Number.isFinite(status) ? ` (HTTP ${status})` : ''}: ${message.replace(/\s+/g, ' ').slice(0, 240)}`,
    };
  }
}

const paragraphQueue = new ParagraphQueue();
let paragraphTimer: NodeJS.Timeout | null = null;
const PARAGRAPH_CHECK_MS = 15_000;

export function noteParagraphRow(appState: AppState, segmentId: string, revision: number, text: string): void {
  paragraphQueue.note(segmentId, revision, text, Date.now());
  if (paragraphTimer) return;
  paragraphTimer = setTimeout(() => {
    paragraphTimer = null;
    void joinParagraph(appState);
  }, PARAGRAPH_CHECK_MS);
}

/**
 * The second pass. Sentences translated one by one miss what came before them, so the rows of the
 * last minute are joined into one paragraph and translated again as a whole. The paragraph then
 * replaces those rows on screen; the meeting record keeps the sentences as they were said.
 */
async function joinParagraph(appState: AppState): Promise<void> {
  const state = appState;
  const rows = paragraphQueue.takeDue(Date.now());
  if (paragraphQueue.size() > 0) {
    paragraphTimer = setTimeout(() => {
      paragraphTimer = null;
      void joinParagraph(appState);
    }, PARAGRAPH_CHECK_MS);
  }
  if (!rows) return;
  const config = resolveTranslationConfig(false);
  if (!config.isConfigured || isSameAsTarget(config)) return;
  const sourceText = rows.map((row) => row.text).join(' ');
  const segmentId = `para_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  try {
    const translatedText = (await runTranslationRequest(appState, config, { text: sourceText, segmentId, noContext: true }, () => undefined)).trim();
    console.log(formatTranslationTiming({
      provider: config.provider, model: config.model, flushGapMs: null, firstTokenMs: null, totalMs: Date.now() - startedAt,
      sourceChars: sourceText.length, outputChars: translatedText.length, streamed: false, speculative: false, outcome: 'complete',
    }));
    // A row that was reopened while this ran now says something else: leave the sentences as they are.
    if (!translatedText || rows.some((row) => isSupersededRevision(state.transcriptSegmentRevisions, row.segmentId, row.revision))) return;
    const displayMode = CredentialsManager.getInstance().getTranscriptTranslationDisplayMode();
    emitNativeAudioTranscript(appState, {
      speaker: 'them',
      text: displayMode === 'translated' ? translatedText : sourceText,
      sourceText,
      translatedText,
      segmentId,
      replaces: rows.map((row) => row.segmentId),
      timestamp: Date.now(),
      final: true,
      confidence: 1,
      displayMode,
      translationState: 'complete' as const,
      revision: 1,
    });
  } catch (error: unknown) {
    // The sentences stay as they are, each with its own translation.
    console.warn('[Main] Paragraph translation failed:', classifyTranslationError(error));
  }
}

/** Clears the translation stage's own state; the assembler calls it when a meeting's turns are reset. */
export function resetTranslationState(): void {
  speculativeTranslations.clear();
  speculatedTurns.clear();
  paragraphQueue.clear();
  if (paragraphTimer) {
    clearTimeout(paragraphTimer);
    paragraphTimer = null;
  }
}
