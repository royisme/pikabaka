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
import { getScenario } from "../services/SettingsManager"
import { startSpeculativeTranslation, emitTranscriptWithTranslation, noteParagraphRow, resetTranslationState } from "./transcript-translation"
import { correctTurn, resolveCorrectionTarget, CORRECTION_MAX_EARLIER_LINES, type CorrectionLine } from "./transcript-correction"

export type TranscriptSpeaker = 'them' | 'user';

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

/** Text a model corrected, as the recognizer heard it, by segment. Shown on hover, never stored. */
const correctedOriginals = new Map<string, { revision: number; text: string }>();

/** What the renderer receives as 'native-audio-transcript'; a live line has no segmentId. */
export interface NativeAudioTranscriptPayload {
  speaker: TranscriptSpeaker;
  text: string;
  sourceText: string;
  translatedText?: string;
  segmentId?: string;
  replaces?: string[];
  timestamp: number;
  final: boolean;
  confidence?: number;
  displayMode: 'original' | 'translated' | 'both';
  translationState: 'pending' | 'skipped' | 'streaming' | 'complete' | 'error';
  translationError?: string;
  speakerLabel?: string;
  detectedLanguage?: string;
  revision?: number;
  originalText?: string;
}

export function emitNativeAudioTranscript(appState: AppState, payload: NativeAudioTranscriptPayload): void {
  const original = payload.segmentId ? correctedOriginals.get(payload.segmentId) : undefined;
  if (original && payload.revision === original.revision) payload = { ...payload, originalText: original.text };
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
  const state = appState;
  const flushed = state.lastFlushedTranscriptTurns[speaker] as FlushedTranscriptTurn | null;
  if (!flushed) return;
  if (flushed.sealTimer) {
    clearTimeout(flushed.sealTimer);
    flushed.sealTimer = null;
  }
  if (!flushed.ragFed) {
    flushed.ragFed = true;
    const ragManager = appState.getRAGManager();
    if (ragManager) {
      ragManager.feedLiveTranscript([{
        speaker,
        text: flushed.text,
        timestamp: flushed.startedAt,
      }]);
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
  const state = appState;
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
  const buffer = appState.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
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
  const buffer = appState.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
  if (!buffer) return;
  buffer.lastActivityAt = timestamp;
  // The silence that ends a turn is counted from the last words heard, not from the last final.
  buffer.lastUpdatedAt = Math.max(buffer.lastUpdatedAt, timestamp);
}

/** The words of the turn being assembled, which are final but not yet in a row. */
export function getBufferedTranscriptText(appState: AppState, speaker: TranscriptSpeaker): string {
  const buffer = appState.transcriptTurnBuffers[speaker] as BufferedTranscriptTurn | null;
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
  const state = appState;
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
  const state = appState;
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
  if (speaker === 'them') startSpeculativeTranslation(appState, buffer);
}

/** Writes one assembled turn to the meeting record. The write is synchronous, before any translation is awaited. */
function recordTranscriptTurn(appState: AppState, speaker: TranscriptSpeaker, turn: Pick<BufferedTranscriptTurn, 'segmentId' | 'revision' | 'startedAt'>, text: string): void {
  appState.recordTranscriptSegment({ segmentId: turn.segmentId, revision: turn.revision, speaker, text, timestampMs: turn.startedAt });
}

export function resetBufferedTranscriptTurns(appState: AppState): void {
  const state = appState;
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
  correctedOriginals.clear();
  correctionLines.length = 0;
  correctionTried.clear();
  resetTranslationState();
}

/**
 * Writes and shows the turn up to its last finished sentence. The unfinished sentence after it is
 * carried into a new turn, so a row never ends in the middle of a sentence; `all` flushes everything.
 */
export async function flushBufferedTranscriptTurn(appState: AppState, speaker: TranscriptSpeaker, options?: { all?: boolean }): Promise<void> {
  const state = appState;
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
    const ragManager = appState.getRAGManager();
    if (ragManager) {
      ragManager.feedLiveTranscript([{
        speaker,
        text,
        timestamp,
      }]);
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

  // Beside the translation and the proactive gate, never in front of them.
  startCorrection(appState, speaker, { segmentId: buffer.segmentId, revision: buffer.revision, text, timestamp, confidence, detectedLanguage: buffer.detectedLanguage });

  if (speaker === 'them') {
    noteParagraphRow(appState, buffer.segmentId, buffer.revision, text);
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

  emitOwnTurn(appState, { text, timestamp, confidence, segmentId: buffer.segmentId, revision: buffer.revision });
}

/** The user's own speech is shown as it was heard; it is never translated. */
function emitOwnTurn(appState: AppState, turn: { text: string; timestamp: number; confidence: number; segmentId: string; revision: number }): void {
  const displayMode = CredentialsManager.getInstance().getTranscriptTranslationDisplayMode();
  emitNativeAudioTranscript(appState, {
    speaker: 'user' as const,
    text: turn.text,
    sourceText: turn.text,
    translatedText: undefined,
    segmentId: turn.segmentId,
    timestamp: turn.timestamp,
    final: true,
    confidence: turn.confidence,
    displayMode,
    translationState: 'skipped' as const,
    speakerLabel: 'Me',
    revision: turn.revision,
  });
}

type CorrectionTurn = { segmentId: string; revision: number; text: string; timestamp: number; confidence: number; detectedLanguage?: string };

/** The final lines so far (both speakers), the context a correction gets. */
const correctionLines: Array<CorrectionLine & { segmentId: string }> = [];
/** Turns (segment and revision) that were already sent for correction: a turn gets at most one. */
const correctionTried = new Set<string>();

function noteCorrectionLine(segmentId: string, speaker: TranscriptSpeaker, text: string): void {
  const existing = correctionLines.find((line) => line.segmentId === segmentId);
  if (existing) existing.text = text;
  else correctionLines.push({ segmentId, speaker, text });
  while (correctionLines.length > 2 * CORRECTION_MAX_EARLIER_LINES) correctionLines.shift();
}

/**
 * When the setting is on, asks a model to fix clearly misheard words in a flushed turn. The turn is
 * already shown and recorded; a fix arrives later as the next revision of the same segment.
 */
function startCorrection(appState: AppState, speaker: TranscriptSpeaker, turn: CorrectionTurn): void {
  const earlier = correctionLines.filter((line) => line.segmentId !== turn.segmentId).slice(-CORRECTION_MAX_EARLIER_LINES);
  noteCorrectionLine(turn.segmentId, speaker, turn.text);
  const key = `${turn.segmentId}:${turn.revision}`;
  const target = resolveCorrectionTarget(CredentialsManager.getInstance());
  if (!target || correctionTried.has(key)) return;
  correctionTried.add(key);
  if (correctionTried.size > 64) correctionTried.delete(correctionTried.values().next().value as string);
  void correctTurn({
    line: { speaker, text: turn.text },
    earlier,
    scenario: getScenario()?.brief,
    complete: (system, user, signal) => appState.processingHelper.getLLMHelper().completeViaConnection(target.connection, target.model, system, user, signal),
    isLatest: () => !isSupersededRevision(appState.transcriptSegmentRevisions, turn.segmentId, turn.revision),
  })
    .then((corrected) => { if (corrected) applyCorrection(appState, speaker, turn, corrected); })
    .catch(() => console.warn('[Main] Transcript correction could not be applied'));
}

/** Shows and records the corrected text as the next revision of the segment, and asks for its translation again. */
function applyCorrection(appState: AppState, speaker: TranscriptSpeaker, turn: CorrectionTurn, corrected: string): void {
  const state = appState;
  const { segmentId, timestamp, confidence } = turn;
  const revision = turn.revision + 1;
  correctionTried.add(`${segmentId}:${revision}`);
  correctedOriginals.set(segmentId, { revision, text: turn.text });
  if (correctedOriginals.size > 64) correctedOriginals.delete(correctedOriginals.keys().next().value as string);
  // From here the old revision is superseded: its translation must not be shown, and a reopen builds on the fixed text.
  state.transcriptSegmentRevisions.set(segmentId, revision);
  const flushed = state.lastFlushedTranscriptTurns[speaker] as FlushedTranscriptTurn | null;
  if (flushed?.segmentId === segmentId) {
    flushed.text = corrected;
    flushed.revision = revision;
  }
  noteCorrectionLine(segmentId, speaker, corrected);
  recordTranscriptTurn(appState, speaker, { segmentId, revision, startedAt: timestamp }, corrected);
  if (speaker === 'them') {
    noteParagraphRow(appState, segmentId, revision, corrected);
    void emitTranscriptWithTranslation(appState, { speaker, text: corrected, timestamp, confidence, segmentId, detectedLanguage: turn.detectedLanguage, revision });
    return;
  }
  emitOwnTurn(appState, { text: corrected, timestamp, confidence, segmentId, revision });
}
