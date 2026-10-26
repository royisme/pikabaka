import t from 'tap';
import { failureReasonText, hasUsableTranslation, rowSlot, transcriptRowParts } from '../src/lib/transcriptRow';
import { toggleOriginal } from '../src/lib/transcriptDisplay';

const translated = { sourceText: 'Can we move the call to Friday?', translatedText: '我们能把电话改到周五吗？', translationState: 'complete' as const };
const pending = { sourceText: 'Can we move the call to Friday?', translatedText: undefined, translationState: 'pending' as const };

t.test('both: translation leads, source beneath', async (t) => {
  t.same(transcriptRowParts(translated, 'both', false), {
    kind: 'translation',
    lead: '我们能把电话改到周五吗？',
    sourceBelow: 'Can we move the call to Friday?',
    hasTranslation: true,
    updating: false,
  });
});

t.test('translated: source stays hidden until the row is expanded', async (t) => {
  t.equal(transcriptRowParts(translated, 'translated', false).sourceBelow, null);
  t.equal(transcriptRowParts(translated, 'translated', true).sourceBelow, 'Can we move the call to Friday?');
  t.equal(transcriptRowParts(translated, 'translated', false).lead, '我们能把电话改到周五吗？');
});

t.test('original: never shows the translation', async (t) => {
  const parts = transcriptRowParts(translated, 'original', true);
  t.equal(parts.kind, 'source');
  t.equal(parts.lead, 'Can we move the call to Friday?');
  t.equal(parts.sourceBelow, null);
});

t.test('while a translation is pending or failed the source leads and the row is awaiting', async (t) => {
  for (const mode of ['both', 'translated'] as const) {
    t.equal(transcriptRowParts(pending, mode, false).kind, 'awaiting', `pending in ${mode}`);
    t.equal(transcriptRowParts({ ...pending, translationState: 'error' }, mode, false).kind, 'awaiting', `error in ${mode}`);
    t.equal(transcriptRowParts(pending, mode, false).lead, 'Can we move the call to Friday?');
  }
  t.equal(transcriptRowParts(pending, 'original', false).kind, 'source', 'original mode waits for nothing');
});

t.test('skipped and same-language rows show the source as the lead', async (t) => {
  t.equal(transcriptRowParts({ ...pending, translationState: 'skipped' }, 'both', false).kind, 'source');
  const same = { sourceText: 'Sounds good', translatedText: 'Sounds good', translationState: 'complete' as const };
  t.equal(hasUsableTranslation(same), false);
  t.equal(transcriptRowParts(same, 'both', false).kind, 'source');
  t.equal(transcriptRowParts({ ...same, translatedText: '   ' }, 'both', false).hasTranslation, false, 'blank translation');
});

const ctx = { mode: 'both' as const, translationOn: true, now: 100_000 };
const other = { speaker: 'interviewer' as const, receivedAt: 100_000 - 1000 };

t.test('the slot exists from the first live words to the finished translation', async (t) => {
  t.same(rowSlot('live', ctx), { kind: 'live' });
  t.same(rowSlot({ ...pending, ...other }, ctx), { kind: 'translating', elapsedSeconds: null });
  t.same(rowSlot({ ...translated, ...other }, ctx), { kind: 'translation' });
  t.same(rowSlot({ ...pending, ...other, translationState: 'error' }, ctx), { kind: 'failed', reason: undefined });
  for (const slot of [rowSlot('live', ctx), rowSlot({ ...pending, ...other }, ctx), rowSlot({ ...translated, ...other }, ctx)]) {
    t.not(slot, null, 'live, pending and complete all have a slot, so a late translation shifts nothing');
  }
});

t.test('elapsed time appears only after the translation has been slow for 3 seconds', async (t) => {
  const at = (ms: number) => rowSlot({ ...pending, speaker: 'interviewer', receivedAt: ctx.now - ms }, ctx);
  t.same(at(2999), { kind: 'translating', elapsedSeconds: null });
  t.same(at(3000), { kind: 'translating', elapsedSeconds: 3 });
  t.same(at(4900), { kind: 'translating', elapsedSeconds: 4 });
  t.same(rowSlot({ ...pending, speaker: 'interviewer' }, ctx), { kind: 'translating', elapsedSeconds: null }, 'no arrival time yet');
});

t.test('no slot when translation is off, the mode is original, or the row is own speech or skipped', async (t) => {
  t.equal(rowSlot('live', { ...ctx, translationOn: false }), null);
  t.equal(rowSlot({ ...pending, ...other }, { ...ctx, translationOn: false }), null);
  t.equal(rowSlot('live', { ...ctx, mode: 'original' }), null);
  t.equal(rowSlot({ ...translated, ...other }, { ...ctx, mode: 'original' }), null);
  t.equal(rowSlot({ ...pending, speaker: 'user' }, ctx), null, 'own speech');
  t.equal(rowSlot({ ...pending, ...other, translationState: 'skipped' }, ctx), null);
  const same = { sourceText: 'Sounds good', translatedText: 'Sounds good', translationState: 'complete' as const, ...other };
  t.equal(rowSlot(same, ctx), null, 'same language collapses the slot');
});

const stale = { sourceText: 'See you Monday morning', translatedText: 'À lundi', translatedRevision: 1, revision: 2 };

t.test('a stale translation is shown as updating only while a new one is pending', async (t) => {
  const parts = transcriptRowParts({ ...stale, translationState: 'pending' }, 'both', false);
  t.equal(parts.kind, 'translation');
  t.equal(parts.lead, 'À lundi');
  t.equal(parts.updating, true);
  t.same(rowSlot({ ...stale, translationState: 'pending', speaker: 'interviewer' }, ctx), { kind: 'translation' });
});

t.test('a stale translation with no request behind it is hidden, never shown as current', async (t) => {
  for (const translationState of ['complete', 'skipped'] as const) {
    const parts = transcriptRowParts({ ...stale, translationState }, 'both', false);
    t.equal(parts.hasTranslation, false, translationState);
    t.equal(parts.lead, 'See you Monday morning');
  }
  const failed = { ...stale, translationState: 'error' as const, speaker: 'interviewer' as const };
  t.same(rowSlot(failed, ctx), { kind: 'failed', reason: undefined }, 'a failed redo shows the failure, not the old translation');
  t.equal(transcriptRowParts(failed, 'both', false).kind, 'awaiting');
});

t.test('a current translation is not updating', async (t) => {
  const current = { ...stale, translatedRevision: 2, translationState: 'complete' as const };
  t.equal(transcriptRowParts(current, 'both', false).updating, false);
});

t.test('the header Original toggle flips both and translated, and never writes original', async (t) => {
  t.equal(toggleOriginal('both'), 'translated');
  t.equal(toggleOriginal('translated'), 'both');
  t.equal(toggleOriginal('original'), 'both');
});

t.test('a failure names its reason in a few words', async (t) => {
  t.equal(rowSlot({ ...pending, ...other, translationState: 'error', translationError: 'timeout' }, ctx)?.kind, 'failed');
  t.equal(failureReasonText('timeout'), 'timed out');
  t.equal(failureReasonText('auth'), 'check the API key');
  t.equal(failureReasonText('rate-limit'), 'rate limited');
  t.equal(failureReasonText('network'), 'no connection');
  t.equal(failureReasonText('other'), '');
  t.equal(failureReasonText(undefined), '');
});
