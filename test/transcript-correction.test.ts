import t from 'tap';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildCorrectionUser,
  correctLine,
  correctTurn,
  resolveCorrectionTarget,
  CORRECTION_SYSTEM_PROMPT,
  type CorrectionComplete,
} from '../electron/lib/transcript-correction';
import { upsertTranscriptSegment, type TranscriptSegment } from '../src/lib/transcriptSegments';
import TranscriptNotes from '../src/components/ui/RollingTranscript';

const quiet = () => {
  const warn = console.warn;
  console.warn = () => {};
  return () => { console.warn = warn; };
};
const line = { speaker: 'them' as const, text: 'Nous avons un 突然 pour demain matin' };
const earlier = [{ speaker: 'user' as const, text: 'Invented earlier question about the schedule.' }];
const answer = (text: string): CorrectionComplete => async () => JSON.stringify({ text });
const fixed = 'Nous avons un rendez-vous pour demain matin';

t.test('correctLine keeps unchanged text and returns a changed line', async (t) => {
  t.equal(await correctLine({ line, earlier, complete: answer(line.text) }), line.text);
  t.equal(await correctLine({ line, earlier, complete: answer(fixed) }), fixed);
  t.equal(await correctLine({ line, earlier, complete: async () => '```json\n{"text": "' + fixed + '"}\n```' }), fixed);
});

t.test('correctLine keeps the original on bad JSON, a missing field, or a runaway answer', async (t) => {
  t.teardown(quiet());
  t.equal(await correctLine({ line, earlier, complete: async () => 'not json at all' }), line.text);
  t.equal(await correctLine({ line, earlier, complete: async () => '{"text": ' }), line.text);
  t.equal(await correctLine({ line, earlier, complete: async () => '{"other": "x"}' }), line.text);
  t.equal(await correctLine({ line, earlier, complete: answer('') }), line.text);
  t.equal(await correctLine({ line, earlier, complete: answer('x'.repeat(line.text.length * 2 + 21)) }), line.text, 'more than 2x plus 20 is invalid');
  t.not(await correctLine({ line, earlier, complete: answer('x'.repeat(line.text.length * 2 + 20)) }), line.text, 'the limit itself is allowed');
  t.equal(await correctLine({ line, earlier, complete: answer('x'.repeat(Math.floor(line.text.length * 0.7) - 1)) }), line.text, 'an answer much shorter than the line dropped words');
});

t.test('correctLine keeps the original on a failed request or a timeout, and logs only a class', async (t) => {
  const logged: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { logged.push(args); };
  t.teardown(() => { console.warn = warn; });
  t.equal(await correctLine({ line, earlier, complete: async () => { throw Object.assign(new Error(`Invented provider echo: ${line.text}`), { status: 401 }); } }), line.text);
  t.equal(await correctLine({ line, earlier, timeoutMs: 20, complete: () => new Promise<string>(() => {}) }), line.text, 'a request that never answers');
  t.equal(await correctLine({ line, earlier, timeoutMs: 20, complete: (_s, _u, signal) => new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) }), line.text);
  t.same(logged.map((args) => args[1]), ['auth', 'timeout', 'timeout']);
  t.notOk(JSON.stringify(logged).includes('Nous avons'), 'the text is never logged');
});

t.test('correctLine skips lines shorter than two characters without a request', async (t) => {
  let calls = 0;
  const complete: CorrectionComplete = async () => { calls += 1; return '{"text": "ab"}'; };
  t.equal(await correctLine({ line: { speaker: 'user', text: ' a ' }, earlier: [], complete }), ' a ');
  t.equal(calls, 0);
});

t.test('the request carries the system prompt, the scenario, at most 6 earlier lines and the line', async (t) => {
  const seen: Array<[string, string]> = [];
  const many = Array.from({ length: 9 }, (_, i) => ({ speaker: i % 2 ? 'user' as const : 'them' as const, text: `Invented line ${i}` }));
  await correctLine({ line, earlier: many, scenario: ' Invented sales call in French ', complete: async (system, user) => { seen.push([system, user]); return '{"text": "x"}'; } });
  t.equal(seen[0][0], CORRECTION_SYSTEM_PROMPT);
  t.match(seen[0][1], /^Scenario: Invented sales call in French\n\nEarlier lines:\n/);
  t.notMatch(seen[0][1], /Invented line 2\b/);
  t.match(seen[0][1], /You: Invented line 3\nThem: Invented line 4/);
  t.match(seen[0][1], /\n\nLINE \(Them\): Nous avons un 突然 pour demain matin$/);
  t.match(buildCorrectionUser(undefined, [], { speaker: 'user', text: 'Hello' }), /^Scenario: none\n\nEarlier lines:\n\n\nLINE \(You\): Hello$/);
});

t.test('correctTurn drops a result whose revision is no longer the latest, and an unchanged one', async (t) => {
  t.equal(await correctTurn({ line, earlier, complete: answer(fixed), isLatest: () => true }), fixed);
  t.equal(await correctTurn({ line, earlier, complete: answer(fixed), isLatest: () => false }), null, 'stale');
  t.equal(await correctTurn({ line, earlier, complete: answer(line.text), isLatest: () => true }), null, 'unchanged');
  let latest = 1;
  const reopened = await correctTurn({ line, earlier, complete: async () => { latest = 2; return JSON.stringify({ text: fixed }); }, isLatest: () => latest === 1 });
  t.equal(reopened, null, 'the segment was reopened while the model worked');
});

t.test('resolveCorrectionTarget does nothing when the setting is off, has no model, or the connection is not ready', async (t) => {
  const cm = (over: Partial<{ enabled: boolean; model: string; connection: object | undefined; ready: boolean }> = {}) => {
    const o = { enabled: true, model: 'invented-model', connection: { type: 'openai' }, ready: true, ...over };
    return {
      getTranscriptCorrectionEnabled: () => o.enabled,
      getTranscriptCorrectionProvider: () => 'invented-gateway',
      getTranscriptCorrectionModel: () => o.model,
      resolveConnection: () => o.connection,
      isConnectionReady: () => o.ready,
    };
  };
  t.same(resolveCorrectionTarget(cm()), { connection: { type: 'openai' }, model: 'invented-model' });
  t.equal(resolveCorrectionTarget(cm({ enabled: false })), undefined);
  t.equal(resolveCorrectionTarget(cm({ model: '  ' })), undefined);
  t.equal(resolveCorrectionTarget(cm({ connection: undefined })), undefined);
  t.equal(resolveCorrectionTarget(cm({ ready: false })), undefined);
});

t.test('a corrected revision replaces the row and carries the original; a later revision without one clears it', async (t) => {
  const first = upsertTranscriptSegment([], { final: true, text: line.text, segmentId: 'seg_a', speaker: 'them', revision: 1, translationState: 'pending' });
  t.equal(first[0].originalText, undefined);
  const corrected = upsertTranscriptSegment(first, { final: true, text: 'Fixed text', segmentId: 'seg_a', speaker: 'them', revision: 2, translationState: 'pending', originalText: line.text });
  t.equal(corrected.length, 1);
  t.same([corrected[0].sourceText, corrected[0].originalText, corrected[0].revision], ['Fixed text', line.text, 2]);
  const translated = upsertTranscriptSegment(corrected, { final: true, text: 'Fixed text', segmentId: 'seg_a', speaker: 'them', revision: 2, translationState: 'complete', translatedText: 'Texte', originalText: line.text });
  t.equal(translated[0].originalText, line.text);
  const reopened = upsertTranscriptSegment(translated, { final: true, text: 'Fixed text and more', segmentId: 'seg_a', speaker: 'them', revision: 3, translationState: 'pending' });
  t.equal(reopened[0].originalText, undefined);
});

t.test('the marker shows only on corrected rows, with the original as its tooltip', async (t) => {
  t.teardown(quiet());
  const row = (segmentId: string, originalText?: string): TranscriptSegment => ({
    segmentId, sourceText: `Invented ${segmentId}`, timestamp: 1, speakerLabel: 'Them', translationState: 'skipped', speaker: 'them', revision: 2, originalText,
  });
  const html = renderToStaticMarkup(React.createElement(TranscriptNotes, { segments: [row('plain'), row('fixed', 'Invented heard text')], displayMode: 'original' }));
  t.equal(html.split('data-corrected').length - 1, 1, 'exactly one marker');
  t.match(html, /title="Heard as: Invented heard text"/);
  t.ok(html.indexOf('Invented fixed') < html.indexOf('data-corrected'), 'the marker follows the text');
  t.ok(html.indexOf('Invented plain') < html.indexOf('Invented fixed'));
});
