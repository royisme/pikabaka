import t from 'tap';
import {
  appendStreaming,
  endStreaming,
  finalizeStreaming,
  pushStreamError,
  pushSystem,
} from '../../src/hooks/meetingChatMessages';
import type { Message } from '../../src/hooks/useMeetingChat';

const streaming = (text: string, intent?: string): Message => ({
  id: '1', role: 'system', text, isStreaming: true, ...(intent ? { intent } : {}),
});

t.test('a token extends the open message of the same intent', (t) => {
  const next = appendStreaming([streaming('He', 'ask')], 'llo', 'ask');
  t.equal(next.length, 1);
  t.equal(next[0].text, 'Hello');
  t.equal(next[0].isStreaming, true);
  t.end();
});

t.test('a new intent starts a new streaming message', (t) => {
  const next = appendStreaming([streaming('He', 'ask')], 'x', 'catch_up');
  t.equal(next.length, 2);
  t.equal(next[1].intent, 'catch_up');
  t.equal(next[1].isStreaming, true);
  t.end();
});

t.test('without an intent a token extends any open message, and starts one without an intent key', (t) => {
  t.equal(appendStreaming([streaming('a', 'ask')], 'b')[0].text, 'ab');
  const started = appendStreaming([], 'b');
  t.equal(started.length, 1);
  t.notOk('intent' in started[0]);
  t.end();
});

t.test('finalize closes the open message, or adds a finished one', (t) => {
  const closed = finalizeStreaming([streaming('part', 'ask')], 'full', 'ask');
  t.equal(closed.length, 1);
  t.equal(closed[0].text, 'full');
  t.equal(closed[0].isStreaming, false);
  const added = finalizeStreaming([], 'full', 'ask');
  t.equal(added.length, 1);
  t.notOk(added[0].isStreaming);
  t.equal(added[0].intent, 'ask');
  t.end();
});

t.test('endStreaming stops the open message and leaves a closed list alone', (t) => {
  t.equal(endStreaming([streaming('a')])[0].isStreaming, false);
  const done: Message[] = [{ id: '1', role: 'system', text: 'a' }];
  t.equal(endStreaming(done), done);
  t.end();
});

t.test('an error after streaming: an empty placeholder gives way, text stays', (t) => {
  const afterEmpty = pushStreamError([streaming('')], 'Error: boom');
  t.equal(afterEmpty.length, 1);
  t.equal(afterEmpty[0].isError, true);
  const afterText = pushStreamError([streaming('partial')], 'Error: boom');
  t.equal(afterText.length, 2);
  t.equal(afterText[0].text, 'partial');
  t.equal(afterText[1].isError, true);
  t.end();
});

t.test('pushSystem adds a message, marked as an error only when asked', (t) => {
  t.notOk('isError' in pushSystem([], 'ok')[0]);
  t.equal(pushSystem([], 'bad', true)[0].isError, true);
  t.end();
});
