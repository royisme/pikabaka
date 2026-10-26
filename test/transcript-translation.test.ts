import t from 'tap';
import { isTranslationStale, translationEnabledAfterEvent, upsertTranscriptSegment } from '../src/lib/transcriptSegments';
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

t.test('receivedAt is stamped by each pending event and kept by later ones', (t) => {
  const pending = upsertTranscriptSegment([], { final: true, text: 'Hello', segmentId: 's1', speaker: 'interviewer', translationState: 'pending' }, 1000);
  t.equal(pending[0].receivedAt, 1000);
  t.equal(pending[0].speaker, 'interviewer');
  const done = upsertTranscriptSegment(pending, { final: true, text: 'Hello', translatedText: 'Bonjour', segmentId: 's1', translationState: 'complete' }, 2000);
  t.equal(done[0].receivedAt, 1000, 'complete keeps the time the wait began');
  t.equal(done[0].speaker, 'interviewer', 'speaker survives an update that omits it');
  const reopened = upsertTranscriptSegment(done, { final: true, text: 'Hello there', segmentId: 's1', translationState: 'pending' }, 3000);
  t.equal(reopened[0].receivedAt, 3000, 'a reopened turn starts a new wait');
  const skipped = upsertTranscriptSegment([], { final: true, text: 'Hi', segmentId: 's2', translationState: 'skipped' }, 4000);
  t.equal(skipped[0].receivedAt, undefined);
  t.end();
});

t.test('translationEnabledAfterEvent: skipped means off, any other state means on', (t) => {
  t.equal(translationEnabledAfterEvent(false, 'pending'), true);
  t.equal(translationEnabledAfterEvent(false, 'complete'), true);
  t.equal(translationEnabledAfterEvent(false, 'error'), true);
  t.equal(translationEnabledAfterEvent(true, 'skipped'), false);
  t.equal(translationEnabledAfterEvent(true, undefined), true, 'event without a state changes nothing');
  t.equal(translationEnabledAfterEvent(false, undefined), false);
  t.end();
});

t.test('a reopened turn keeps its old translation only as stale, until the new one lands', (t) => {
  const first = upsertTranscriptSegment([], { final: true, text: 'See you Monday', translatedText: 'À lundi', segmentId: 's1', translationState: 'complete', revision: 1 }, 1000);
  t.equal(first[0].translatedRevision, 1);
  t.equal(isTranslationStale(first[0]), false, 'translation matches its revision');

  const reopened = upsertTranscriptSegment(first, { final: true, text: 'See you Monday morning', segmentId: 's1', translationState: 'pending', revision: 2 }, 2000);
  t.equal(reopened[0].translatedText, 'À lundi', 'old text is kept so the row does not jump');
  t.equal(reopened[0].translatedRevision, 1);
  t.equal(isTranslationStale(reopened[0]), true, 'old translation of revision 1 under revision 2 text');

  const redone = upsertTranscriptSegment(reopened, { final: true, text: 'See you Monday morning', translatedText: 'À lundi matin', segmentId: 's1', translationState: 'complete', revision: 2 }, 3000);
  t.equal(redone[0].translatedRevision, 2);
  t.equal(isTranslationStale(redone[0]), false);
  t.end();
});

t.test('segments without revisions are never stale', (t) => {
  const rows = upsertTranscriptSegment([], { final: true, text: 'Hi', translatedText: 'Salut', segmentId: 's1', translationState: 'complete' });
  t.equal(isTranslationStale(rows[0]), false);
  t.equal(isTranslationStale({ translatedText: undefined, revision: 3, translatedRevision: undefined }), false, 'nothing to be stale');
  t.end();
});

t.test('translationError is kept only while the state is error', (t) => {
  const failed = upsertTranscriptSegment([], { final: true, text: 'Hello', segmentId: 's1', translationState: 'error', translationError: 'timeout' });
  t.equal(failed[0].translationError, 'timeout');
  const retried = upsertTranscriptSegment(failed, { final: true, text: 'Hello', segmentId: 's1', translationState: 'pending' });
  t.equal(retried[0].translationError, undefined, 'a retry clears the reason');
  const ok = upsertTranscriptSegment([], { final: true, text: 'Hi', segmentId: 's2', translationState: 'complete', translationError: 'auth' });
  t.equal(ok[0].translationError, undefined, 'a reason on a non-error event is ignored');
  t.end();
});
