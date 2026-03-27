import t from 'tap';
import { upsertTranscriptSegment } from '../src/lib/transcriptSegments';
import { buildTranscriptTranslationPrompt, isTranscriptTranslationConfigured } from '../electron/transcript/translationExecutor';

t.test('upsertTranscriptSegment appends and patches by segmentId', (t) => {
  const initial = upsertTranscriptSegment([], {
    final: true,
    text: 'hello world',
    sourceText: 'hello world',
    segmentId: 'seg_1',
  });

  t.equal(initial.length, 1, 'creates one segment');
  t.equal(initial[0].sourceText, 'hello world', 'stores source text');
  t.equal(initial[0].speakerLabel, 'User 1', 'defaults speaker label');

  const patched = upsertTranscriptSegment(initial, {
    final: true,
    text: 'hello world',
    sourceText: 'hello world',
    translatedText: '你好，世界',
    segmentId: 'seg_1',
  });

  t.equal(patched.length, 1, 'does not duplicate segment');
  t.equal(patched[0].translatedText, '你好，世界', 'patches translated text');
  t.equal(patched[0].speakerLabel, 'User 1', 'preserves speaker label when not sent again');
  t.end();
});

t.test('upsertTranscriptSegment accepts custom speakerLabel', (t) => {
  const rows = upsertTranscriptSegment([], {
    final: true,
    text: 'hi',
    segmentId: 'seg_x',
    speakerLabel: 'User 2',
  });
  t.equal(rows[0].speakerLabel, 'User 2');
  t.end();
});

t.test('upsertTranscriptSegment defaults interviewer label when speaker is interviewer', (t) => {
  const rows = upsertTranscriptSegment([], {
    final: true,
    text: 'hello',
    segmentId: 'seg_int',
    speaker: 'interviewer',
  });
  t.equal(rows[0].speakerLabel, 'Interviewer');
  t.end();
});

t.test('upsertTranscriptSegment defaults user label when speaker is user', (t) => {
  const rows = upsertTranscriptSegment([], {
    final: true,
    text: 'hello',
    segmentId: 'seg_u',
    speaker: 'user',
  });
  t.equal(rows[0].speakerLabel, 'Me');
  t.end();
});

t.test('translation executor helpers validate config and build prompt', (t) => {
  t.equal(isTranscriptTranslationConfigured(true, 'qwen2.5:7b', 'Translate to Chinese'), true, 'valid config passes');
  t.equal(isTranscriptTranslationConfigured(true, '', 'Translate to Chinese'), false, 'missing model fails');
  t.equal(isTranscriptTranslationConfigured(false, 'qwen2.5:7b', 'Translate to Chinese'), false, 'disabled translation fails');

  const prompt = buildTranscriptTranslationPrompt('Translate to Chinese', 'hello world');
  t.match(prompt, /Source text:/, 'prompt includes source text header');
  t.match(prompt, /hello world/, 'prompt includes source text body');
  t.match(prompt, /Return translated text only/, 'prompt enforces clean output');
  t.end();
});
