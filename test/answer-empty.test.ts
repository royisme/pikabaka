import t from 'tap';
import { answerEmptyHint } from '../src/lib/answerEmpty';
import type { AudioStatusKey } from '../src/lib/audioStatus';

const keys: AudioStatusKey[] = ['off', 'starting', 'waiting', 'listening', 'live', 'no-audio', 'stopped'];

t.test('every audio state has a one-line hint, with no hard-coded key names', async (t) => {
  for (const key of keys) {
    const hint = answerEmptyHint(key);
    const text = hint.before + hint.after;
    t.ok(text.length > 0 && text.length <= 80, `${key}: ${text.length} characters`);
    t.notMatch(text, /⌘|Ctrl|Cmd/, `${key}: the shortcut comes from the user's config, not the copy`);
  }
});

t.test('hints that name a shortcut say which one', async (t) => {
  t.equal(answerEmptyHint('listening').key, 'whatToAnswer');
  t.equal(answerEmptyHint('live').key, 'whatToAnswer');
  t.equal(answerEmptyHint('stopped').key, 'selectiveScreenshot');
  t.equal(answerEmptyHint('no-audio').key, null);
});

t.test('with no audio the hint says What to say needs their words', async (t) => {
  t.match(answerEmptyHint('no-audio').before, /needs their words first/);
});

t.test('with lines on screen, no audio does not claim their words are missing', async (t) => {
  const hint = answerEmptyHint('no-audio', true);
  t.notMatch(hint.before, /needs their words/);
  t.match(hint.before, /No new sound/);
  t.equal(answerEmptyHint('listening', true).key, 'whatToAnswer', 'other states are unchanged');
});
