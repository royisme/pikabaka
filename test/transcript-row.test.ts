import t from 'tap';
import { hasUsableTranslation, transcriptRowParts } from '../src/lib/transcriptRow';

const translated = { sourceText: 'Can we move the call to Friday?', translatedText: '我们能把电话改到周五吗？', translationState: 'complete' as const };
const pending = { sourceText: 'Can we move the call to Friday?', translatedText: undefined, translationState: 'pending' as const };

t.test('both: translation leads, source beneath', async (t) => {
  t.same(transcriptRowParts(translated, 'both', false), {
    kind: 'translation',
    lead: '我们能把电话改到周五吗？',
    sourceBelow: 'Can we move the call to Friday?',
    hasTranslation: true,
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
