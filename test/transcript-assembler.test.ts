import t from 'tap';
import {
  shouldReopenFlushedTurn,
  countTranscriptWords,
  mergeTranscriptText,
  endsSentence,
  type TranscriptAssemblerThresholds,
} from '../electron/lib/transcript-assembler';
import { buildTranscriptTranslationPrompt } from '../electron/transcript/translationExecutor';
import { upsertTranscriptSegment, type TranscriptSegment } from '../src/lib/transcriptSegments';

// ---------------------------------------------------------------------------
// 1. shouldReopenFlushedTurn
// ---------------------------------------------------------------------------
t.test('shouldReopenFlushedTurn decides reopen eligibility', (t) => {
  const thresholds: TranscriptAssemblerThresholds = {
    maxSilenceBeforeNewTurnMs: 3200,
    sentenceFlushDelayMs: 1350,
    fragmentFlushDelayMs: 2600,
    speechEndedSentenceFlushMs: 260,
    speechEndedFragmentFlushMs: 1100,
    minWordsBeforeSentenceFlush: 18,
    maxTurnDurationMs: 10000,
    reopenWindowMs: 5000,
  };

  // Fragment arriving within the reopen window → true.
  t.equal(
    shouldReopenFlushedTurn(
      { endedSentence: false, lastUpdatedAt: 1000, startedAt: 500 },
      3000,
      thresholds,
    ),
    true,
    'fragment within window reopens',
  );

  // Sentence-final turn is never reopenable.
  t.equal(
    shouldReopenFlushedTurn(
      { endedSentence: true, lastUpdatedAt: 1000, startedAt: 500 },
      3000,
      thresholds,
    ),
    false,
    'endedSentence prevents reopen',
  );

  // Window exceeded → false.
  t.equal(
    shouldReopenFlushedTurn(
      { endedSentence: false, lastUpdatedAt: 1000, startedAt: 500 },
      7000,
      thresholds,
    ),
    false,
    'window exceeded prevents reopen',
  );

  // maxTurnDurationMs exceeded → false.
  t.equal(
    shouldReopenFlushedTurn(
      { endedSentence: false, lastUpdatedAt: 1000, startedAt: 0 },
      12000,
      thresholds,
    ),
    false,
    'maxTurnDurationMs exceeded prevents reopen',
  );

  // maxTurnDurationMs: 0 → duration check ignored → true (even though
  // timestamp - startedAt would exceed a non-zero limit).
  const noMaxTurn: TranscriptAssemblerThresholds = { ...thresholds, maxTurnDurationMs: 0 };
  t.equal(
    shouldReopenFlushedTurn(
      { endedSentence: false, lastUpdatedAt: 1000, startedAt: 0 },
      4000,
      noMaxTurn,
    ),
    true,
    'maxTurnDurationMs 0 ignores duration check',
  );

  t.end();
});

// ---------------------------------------------------------------------------
// 2. countTranscriptWords
// ---------------------------------------------------------------------------
t.test('countTranscriptWords counts CJK chars and space-separated words', (t) => {
  t.equal(countTranscriptWords(null as any, 'hello world'), 2, 'pure English');
  t.equal(countTranscriptWords(null as any, '今天天气很好'), 6, 'pure Chinese — 6 CJK chars');
  t.equal(
    countTranscriptWords(null as any, '我用 TypeScript 写代码'),
    6,
    'mixed — 5 CJK chars + 1 Latin word',
  );
  t.equal(countTranscriptWords(null as any, ''), 0, 'empty string');
  t.equal(countTranscriptWords(null as any, '   '), 0, 'whitespace only');
  t.end();
});

// ---------------------------------------------------------------------------
// 3. mergeTranscriptText
// ---------------------------------------------------------------------------
t.test('mergeTranscriptText joins CJK without space and English with space', (t) => {
  // CJK + CJK → no separator.
  t.equal(
    mergeTranscriptText(null as any, '你好', '世界'),
    '你好世界',
    'CJK+CJK joins with no space',
  );

  // English + English → single space separator.
  t.equal(
    mergeTranscriptText(null as any, 'hello', 'world'),
    'hello world',
    'English+English keeps single space',
  );

  t.end();
});

t.test('mergeTranscriptText dedups overlapping word tails (>= 3 word overlap)', (t) => {
  // The implementation requires a minimum 3-word overlap for deduplication.
  t.equal(
    mergeTranscriptText(null as any, 'the quick brown fox jumps', 'brown fox jumps over'),
    'the quick brown fox jumps over',
    '3-word overlap is deduped',
  );
  t.end();
});

t.test('mergeTranscriptText preserves prefix/suffix without duplication', (t) => {
  // right starts with left → return right.
  t.equal(
    mergeTranscriptText(null as any, 'hello', 'hello world'),
    'hello world',
    'right startsWith left → returns right',
  );
  // left ends with right → return left.
  t.equal(
    mergeTranscriptText(null as any, 'hello world', 'world'),
    'hello world',
    'left endsWith right → returns left',
  );
  t.end();
});

// ---------------------------------------------------------------------------
// 4. endsSentence
// ---------------------------------------------------------------------------
t.test('endsSentence detects sentence-final punctuation', (t) => {
  t.equal(endsSentence(null as any, '你好。'), true, 'Chinese period ends sentence');
  t.equal(endsSentence(null as any, '你好'), false, 'no punctuation does not end sentence');
  t.equal(endsSentence(null as any, 'Hello.'), true, 'English period ends sentence');
  t.equal(endsSentence(null as any, 'Hello'), false, 'no punctuation does not end sentence');
  t.equal(endsSentence(null as any, 'Wait!'), true, 'exclamation ends sentence');
  t.equal(endsSentence(null as any, 'Is it?'), true, 'question mark ends sentence');
  t.equal(endsSentence(null as any, 'Trailing…'), true, 'ellipsis ends sentence');
  t.end();
});

// ---------------------------------------------------------------------------
// 5. buildTranscriptTranslationPrompt with context
// ---------------------------------------------------------------------------
t.test('buildTranscriptTranslationPrompt injects context block when provided', (t) => {
  const context = [
    { source: 'Tell me about yourself.', translation: '请介绍一下你自己。' },
    { source: 'What is your experience?', translation: '你有什么经验？' },
  ];
  const prompt = buildTranscriptTranslationPrompt(
    'Translate to Chinese',
    'Why did you leave your last job?',
    {
      sourceLanguageKey: 'english-us',
      targetLanguageKey: 'chinese',
      context,
    },
  );

  t.match(prompt, /Recent conversation/, 'includes context header');
  t.match(prompt, /Tell me about yourself\./, 'includes first source line');
  t.match(prompt, /请介绍一下你自己。/, 'includes first translation line');
  t.match(prompt, /What is your experience\?/, 'includes second source line');
  t.match(prompt, /你有什么经验？/, 'includes second translation line');
  t.match(prompt, /Why did you leave your last job\?/, 'includes the base source text');
  t.end();
});

t.test('buildTranscriptTranslationPrompt omits context block when absent', (t) => {
  const prompt = buildTranscriptTranslationPrompt(
    'Translate to Chinese',
    'hello world',
    {
      sourceLanguageKey: 'english-us',
      targetLanguageKey: 'chinese',
    },
  );

  t.notMatch(prompt, /Recent conversation/, 'no context block when context absent');
  t.match(prompt, /hello world/, 'still includes base source text');
  t.end();
});

// ---------------------------------------------------------------------------
// 6. upsertTranscriptSegment — revision guard + timestamp preservation
// ---------------------------------------------------------------------------
t.test('upsertTranscriptSegment revision guard rejects stale revisions', (t) => {
  // Start with a segment at revision 2.
  const segmentsAtRev2: TranscriptSegment[] = [
    {
      segmentId: 'seg_a',
      sourceText: 'original text',
      timestamp: 1000,
      speakerLabel: 'Interviewer',
      translationState: 'skipped',
      revision: 2,
    },
  ];

  // Stale revision 1 → array unchanged (same identity).
  const stale = upsertTranscriptSegment(segmentsAtRev2, {
    final: true,
    text: 'stale text',
    sourceText: 'stale text',
    segmentId: 'seg_a',
    revision: 1,
  });
  t.equal(stale, segmentsAtRev2, 'stale revision returns same array identity');
  t.equal(stale[0].sourceText, 'original text', 'stale revision does not change content');

  t.end();
});

t.test('upsertTranscriptSegment applies equal and higher revisions', (t) => {
  const segmentsAtRev2: TranscriptSegment[] = [
    {
      segmentId: 'seg_b',
      sourceText: 'original text',
      timestamp: 1000,
      speakerLabel: 'Interviewer',
      translationState: 'skipped',
      revision: 2,
    },
  ];

  // Equal revision (2) → applies.
  const equalRev = upsertTranscriptSegment(segmentsAtRev2, {
    final: true,
    text: 'equal revision text',
    sourceText: 'equal revision text',
    segmentId: 'seg_b',
    revision: 2,
  });
  t.equal(equalRev[0].sourceText, 'equal revision text', 'equal revision applies');
  t.equal(equalRev[0].revision, 2, 'equal revision value preserved');

  // Higher revision (3) → applies.
  const higherRev = upsertTranscriptSegment(equalRev, {
    final: true,
    text: 'higher revision text',
    sourceText: 'higher revision text',
    segmentId: 'seg_b',
    revision: 3,
  });
  t.equal(higherRev[0].sourceText, 'higher revision text', 'higher revision applies');
  t.equal(higherRev[0].revision, 3, 'higher revision value stored');

  t.end();
});

t.test('upsertTranscriptSegment patch keeps original timestamp', (t) => {
  const segments: TranscriptSegment[] = [
    {
      segmentId: 'seg_ts',
      sourceText: 'first',
      timestamp: 11111,
      speakerLabel: 'Interviewer',
      translationState: 'skipped',
    },
  ];

  const patched = upsertTranscriptSegment(segments, {
    final: true,
    text: 'first updated',
    sourceText: 'first updated',
    segmentId: 'seg_ts',
    timestamp: 99999,
  });
  t.equal(patched[0].timestamp, 11111, 'patch keeps original timestamp, ignores event.timestamp');
  t.end();
});
