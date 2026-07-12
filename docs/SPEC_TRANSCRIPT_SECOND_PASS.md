# SPEC: Transcript Second-Pass Correction (Reopen & Merge)

> Status: approved design, implementation in progress (multi-agent).
> Created: 2026-07-12. Owner: Roy.
> This document is the single source of truth for Tasks A–D below. Interface
> contracts here are binding; if an implementation must deviate, stop and flag
> it in your final report instead of improvising.

## Problem

Transcript segments are flushed by silence timers and sealed forever
(`flushBufferedTranscriptTurn` clears the buffer; the next provider final gets
a new `segmentId`). When a speaker pauses mid-sentence, the flush timer always
wins the race against the provider's next final (which lags real speech by
1–4s), so sentences get split into fragments. Per-segment translation then
locks in the fragmentation. Provider utterance-boundary signals (Deepgram
`speech_final`, Soniox `<end>`, OpenAI `done`) are currently discarded.

## Design overview

1. **Reopenable turns**: a flushed turn whose text does NOT end with
   sentence-final punctuation stays reopenable for `reopenWindowMs`. If the
   next final chunk for that speaker arrives inside the window, the turn is
   reopened: text merged, re-flushed later under the **same `segmentId`** with
   `revision + 1`, and re-translated. Renderer already upserts by `segmentId`.
2. **Revision guard**: monotonically increasing `revision` per segment kills
   stale async translation results (main side) and stale IPC events (renderer
   side).
3. **Provider boundary signals** accelerate flushing (reuse
   `handleSpeakerSpeechEnded` semantics) but do NOT seal; sealing is decided
   by sentence-final punctuation only.
4. **RAG/knowledge feeding moves from flush-time to seal-time** so healed
   turns are fed exactly once, with full text.
5. **Translation gains context** (last 2 translated interviewer turns) and CJK
   fixes land in word counting / merging.

Non-goals (v1): no new user-facing settings; no native VAD changes; no
debounce/cancel of in-flight translations (revision guard is sufficient); no
Google/REST boundary signals; no ElevenLabs boundary (its commits are not
reliable endpoint signals).

---

## Shared contracts (all tasks)

### IPC payload (`native-audio-transcript`) — new optional field

```ts
revision?: number   // present on final segment emissions; increments per re-flush of same segmentId
```

All other fields unchanged. Interim emissions never carry `revision`.

### Internal STT event (provider → audio-pipeline) — new optional field

```ts
{ text: string; isFinal: boolean; confidence: number; detectedLanguage?: string; boundary?: boolean }
```

`boundary: true` means "provider signals the utterance ended at/after this
final". A boundary-only signal is `{ text: '', isFinal: true, confidence: 1, boundary: true }`.

### New assembler exports (Task A) — used by tests (Task D)

```ts
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

// Pure decision function (no appState, no timers) — unit-testable:
export function shouldReopenFlushedTurn(
  flushed: Pick<FlushedTranscriptTurn, 'endedSentence' | 'lastUpdatedAt' | 'startedAt'>,
  timestamp: number,
  thresholds: TranscriptAssemblerThresholds
): boolean;
// Rules, in order:
//   endedSentence → false
//   thresholds.reopenWindowMs <= 0 → false
//   timestamp - lastUpdatedAt > reopenWindowMs → false
//   maxTurnDurationMs > 0 && timestamp - startedAt > maxTurnDurationMs → false
//   otherwise true

export function countTranscriptWords(appState: AppState, text: string): number;
// CJK chars (Han, Hiragana, Katakana, Hangul, CJK-ext, compat) count 1 each;
// remaining text counts space-separated words. Regex:
// /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g

export function sealFlushedTranscriptTurn(appState: AppState, speaker: TranscriptSpeaker): void;
// Idempotent. Clears sealTimer; if !ragFed feeds ragManager.feedLiveTranscript
// ([{speaker, text, timestamp: startedAt}]) and, for interviewer,
// knowledgeOrchestrator.feedInterviewerUtterance(text); then sets
// lastFlushedTranscriptTurns[speaker] = null.
```

### New AppState fields (Task A, `electron/main.ts`, next to `transcriptTurnBuffers`)

```ts
public lastFlushedTranscriptTurns: Record<TranscriptSpeaker, FlushedTranscriptTurn | null> = { interviewer: null, user: null };
public transcriptSegmentRevisions: Map<string, number> = new Map();
public recentTranslatedTurns: Array<{ segmentId: string; source: string; translation: string }> = [];
```

### Thresholds — new field `reopenWindowMs` (Task A)

Measured from `lastUpdatedAt` (arrival of the last merged final chunk), NOT
from `flushedAt`. Values:

| profile | reopenWindowMs |
|---|---|
| sentence_bias | 6500 |
| low_latency | 4000 |
| coherent | 9500 |

---

## Task A (model: Sonnet) — assembler state machine + translation context + CJK

**Files owned (do not touch anything else):**
- `electron/lib/transcript-assembler.ts` (major rework)
- `electron/main.ts` (add the three AppState fields above + type import)
- `electron/core/LLMHelper.ts` (extend `TranscriptTranslationRequest`, pass context through)
- `electron/transcript/translationExecutor.ts` (context in prompt builder)

### A1. Types & thresholds
- Add `reopenWindowMs: number` to `TranscriptAssemblerThresholds` and the three
  profile entries (values above).
- Add `revision: number` to `BufferedTranscriptTurn` (fresh buffer = 1).
- Add `FlushedTranscriptTurn`, `shouldReopenFlushedTurn`,
  `countTranscriptWords`, `sealFlushedTranscriptTurn` exactly as in Shared
  contracts. Keep the file's `void appState;` idiom for pure helpers.

### A2. `bufferFinalTranscriptChunk` — reopen path
Keep the two existing active-buffer guards (silence gap, maxTurnDuration)
byte-for-byte. After them, when `buffer` is null:

```ts
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
} else if (lf) {
  sealFlushedTranscriptTurn(appState, speaker); // superseded: feed RAG now, clear slot
}
```

Then fall through to the existing create-or-merge logic (merge branch handles
text/lastUpdatedAt/confidence/detectedLanguage as today). Replace both
word-count sites (`bufferFinalTranscriptChunk`, `handleSpeakerSpeechEnded`)
with `countTranscriptWords`.

### A3. `flushBufferedTranscriptTurn` — seal-or-arm
- Compute `endedSentence = endsSentence(appState, text)` (no word-count gate).
- `state.transcriptSegmentRevisions.set(buffer.segmentId, buffer.revision)`
  before emitting.
- **RAG/knowledge feeding**: only when `endedSentence` (feed inline exactly as
  the current code does, then `lastFlushedTranscriptTurns[speaker] = null`).
  Otherwise arm reopen: store `FlushedTranscriptTurn` (`ragFed: false`,
  `flushedAt: Date.now()`, `endedSentence: false`) with
  `sealTimer = setTimeout(() => sealFlushedTranscriptTurn(appState, speaker), delay)`
  where `delay = Math.max(500, thresholds.reopenWindowMs - (Date.now() - buffer.lastUpdatedAt))`.
- Pass `revision: buffer.revision` into both emit paths (interviewer
  `emitTranscriptWithTranslation`, user direct emit payload).

### A4. `emitTranscriptWithTranslation` — revision + context
- Params gain `revision?: number`. Include `revision` in every payload it
  emits (pending / complete / error / same-language / not-configured).
- **Stale guard**: after the awaited translation resolves (and in the catch
  path), before emitting:
  `if (revision !== undefined && state.transcriptSegmentRevisions.get(segmentId) !== revision) return { success: false, error: 'superseded by newer revision' };`
- **Context**: build `context = state.recentTranslatedTurns.filter(t => t.segmentId !== segmentId).slice(-2)`
  and pass it via the request (below). On translation success (and not stale):
  replace-in-place by segmentId or push `{segmentId, source: text, translation: translatedText}`;
  cap the array at 4 (shift oldest).
- Manual retranslate (`forceTranslate`, revision undefined) bypasses the guard
  by design.

### A5. `mergeTranscriptText` — CJK separator
Before the final concatenation, compute:
```ts
const CJK_EDGE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯　-〿！-～]/;
```
If `left`'s last char and `right`'s first char both match → separator `''`.
Otherwise keep existing separator logic. Overlap-dedup loop unchanged.

### A6. `resetBufferedTranscriptTurns`
Additionally: `sealFlushedTranscriptTurn` for both speakers (feeds unfed RAG),
`transcriptSegmentRevisions.clear()`, `recentTranslatedTurns.length = 0`.

### A7. Translation request context
`electron/core/LLMHelper.ts`:
```ts
export interface TranscriptTranslationRequest {
  // ...existing...
  /** Previous translated turns, oldest first, for terminology/pronoun consistency. */
  context?: Array<{ source: string; translation: string }>;
}
```
`translateTranscriptText` passes `request.context` into
`buildTranscriptTranslationPrompt` opts.

`electron/transcript/translationExecutor.ts` — `buildTranscriptTranslationPrompt`
opts gain `context?: Array<{ source: string; translation: string }>`. When
non-empty, insert between the direction block and the base prompt:

```
Recent conversation (context for terminology and pronoun consistency ONLY — do not translate or repeat it in your output):
[1] Source: <source>
    Translation: <translation>
[2] ...
```

### A verification
```
pnpm exec tsc -p electron/tsconfig.json --noEmit
pnpm exec tsc --noEmit --pretty false
pnpm run lint
pnpm run test
```
All must pass. Do not run git commands. Do not edit files outside your list.

---

## Task B (model: Sonnet) — provider boundary signals

**Files owned:**
- `electron/audio/DeepgramStreamingSTT.ts`
- `electron/audio/SonioxStreamingSTT.ts`
- `electron/audio/OpenAIStreamingSTT.ts`
- `electron/lib/audio-pipeline.ts`

### B1. Deepgram
- URL params: add `&endpointing=800` and `&utterance_end_ms=1500` (valid
  because `interim_results=true` is already set).
- Results handler: read `msg.speech_final === true` → include
  `boundary: true` on the final `transcript` emit for that message.
- Handle `msg.type === 'UtteranceEnd'` (before the existing
  `if (msg.type !== 'Results') return;`): emit boundary-only
  `{ text: '', isFinal: true, confidence: 1, boundary: true }`.

### B2. Soniox
In the token loop, `<end>` tokens are currently skipped. Track
`let sawEndpoint = false;` → set true when a `<end>` token is seen (still do
not append its text). After the loop:
- if final text was emitted, add `boundary: sawEndpoint || undefined` to that
  final emit;
- if `sawEndpoint` and no final text, emit boundary-only event (shape above).
`<fin>` handling unchanged.

### B3. OpenAI realtime (WS path)
`transcript.text.done` → add `boundary: true` to the final emit. REST fallback
unchanged. VAD event handling unchanged.

### B4. audio-pipeline consumer
Update the `stt.on('transcript', ...)` handler:
- Type the event with `boundary?: boolean`.
- `const trimmed = segment.text?.trim();`
- Feed `intelligenceManager.handleTranscript` ONLY when `trimmed` is
  non-empty (guard against boundary-only events).
- Final path: `if (trimmed) bufferFinalTranscriptChunk(...);` then
  `if (segment.boundary) handleSpeakerSpeechEnded(appState, speaker);`
  (order matters: buffer first, then accelerate).
- Interim path: only emit when `trimmed` non-empty.
- `lastInterviewerTranscriptAt` update: only when `trimmed` non-empty.
- Everything else (displayMode read, error handling) unchanged.

### B verification
Same commands as Task A. Do not run git commands. Do not edit files outside
your list. Note: `electron/lib/transcript-assembler.ts` is being modified in
parallel by another task — do NOT read-modify-write it; you only import
existing functions (`handleSpeakerSpeechEnded` already exists).

---

## Task C (model: Haiku) — renderer + type plumbing

**Files owned:**
- `src/lib/transcriptSegments.ts`
- `src/hooks/useMeetingTranscript.ts`
- `src/components/ui/RollingTranscript.tsx`
- `src/types/electron.d.ts`
- `electron/preload/audio-stt.ts`

### C1. `transcriptSegments.ts`
- `TranscriptSegment` gains `revision?: number`; `TranscriptEventForSegment`
  gains `revision?: number`.
- In `upsertTranscriptSegment`, patch branch (existing segment found):
  - Stale guard FIRST:
    `if (typeof event.revision === 'number' && typeof existing.revision === 'number' && event.revision < existing.revision) return segments;`
  - `revision: event.revision ?? existing.revision`
  - **Timestamp: keep `existing.timestamp`** (never overwrite once created).
- Insert branch: `revision: event.revision` and timestamp behavior unchanged
  (`event.timestamp ?? Date.now()`).

### C2. `useMeetingTranscript.ts`
Pass `revision: transcript.revision` through to `upsertTranscriptSegment` in
BOTH the user branch and the interviewer branch. No other behavior changes.
(The error paths inside `handleTranslateTranscriptSegment` stay revision-less.)

### C3. `RollingTranscript.tsx`
Auto-scroll currently keys on `segments.length` and misses in-place text
growth. Add:
```ts
const contentSignature = segments.reduce(
  (acc, s) => acc + s.sourceText.length + (s.translatedText?.length ?? 0), 0);
```
and include `contentSignature` in the scroll `useEffect` dependency array
(keep `segments.length`, `partialText`, `userScrolled`).

### C4. Types
- `src/types/electron.d.ts`: add `revision?: number` to the
  `onNativeAudioTranscript` payload type.
- `electron/preload/audio-stt.ts`: add `revision?: number` to the same payload
  type there.

### C verification
```
pnpm exec tsc --noEmit --pretty false
pnpm exec tsc -p electron/tsconfig.json --noEmit
pnpm run lint
pnpm run test
```
Do not run git commands. Do not edit files outside your list.

---

## Task D (model: Haiku, runs AFTER A+C are merged) — tests

**Files owned:** `test/transcript-assembler.test.ts` (new),
`test/transcript-translation.test.ts` (extend; update existing assertions only
if they contradict the new keep-existing-timestamp semantics).

Test only pure/electron-free functions (importing CredentialsManager-dependent
paths under tap may fail; avoid triggering flush/emit code paths):

1. `shouldReopenFlushedTurn`: fragment within window → true; `endedSentence`
   → false; window exceeded → false; `maxTurnDurationMs` exceeded → false;
   `maxTurnDurationMs: 0` → duration ignored → true.
2. `countTranscriptWords(null as any, ...)`: pure English ("hello world" → 2),
   pure Chinese ("今天天气很好" → 6), mixed ("我用 TypeScript 写代码" →
   expect CJK chars + 1).
3. `mergeTranscriptText(null as any, ...)`: CJK+CJK joins with no space;
   English+English keeps single space; word-overlap dedup still works
   ("the quick brown fox" + "brown fox jumps" → "the quick brown fox jumps").
4. `endsSentence(null as any, ...)`: "你好。" true, "你好" false.
5. `buildTranscriptTranslationPrompt` with `context`: output contains
   "Recent conversation" block, both source/translation lines, and the source
   text; without context: block absent.
6. `upsertTranscriptSegment`: revision guard (stale `revision: 1` after
   `revision: 2` → unchanged array identity or equal content; equal revision
   applies; higher revision applies); patch keeps original `timestamp`.

Style: follow the existing tap style (`t.test`, `t.equal`, `t.end`).

### D verification
`pnpm run lint && pnpm run test` — all pass. No git commands.

---

## Reviewer (main session) checklist

- [ ] Diff-review each task against this spec (contracts, file ownership).
- [ ] Race audit: revision guard on both sides; seal timer cleanup on reopen
      and reset; no double RAG feed (flush-sealed vs timer-sealed vs
      superseded-sealed paths are mutually exclusive).
- [ ] `pnpm run lint && pnpm run test && pnpm exec tsc --noEmit --pretty false
      && pnpm exec tsc -p electron/tsconfig.json --noEmit` on the merged tree.
- [ ] Known accepted edge: manual Retranslate racing a reopen may transiently
      show a stale translation until the newer revision's translation lands.
- [ ] Commit on feature branch `feat/transcript-second-pass`.

## Future work (explicitly out of v1)

- Debounce/hold translation of reopenable fragments (~600ms) to save wasted
  LLM calls.
- ElevenLabs commit-as-boundary evaluation; Google final-as-boundary.
- Optional LLM second-pass "repair + translate" combined prompt writing back
  `sourceText`.
- Per-segment re-translation of the *previous* segment when its successor
  proves it was sentence-final after all.
