import t from 'tap';
import { GRACE_MS, TalkWindows } from '../../electron/interpreting/talkWindow.ts';

function make() {
  let clock = 1000;
  const w = new TalkWindows(() => clock);
  return {
    w,
    at(ms: number) {
      clock = ms;
    },
  };
}

t.test('collect joins the latest revision per segment in startedAt order', (t) => {
  const { w } = make();
  w.open();
  w.noteOwnTurn({ segmentId: 'b', revision: 1, text: 'second', startedAt: 1500 });
  w.noteOwnTurn({ segmentId: 'a', revision: 1, text: 'first draft', startedAt: 1100 });
  w.noteOwnTurn({ segmentId: 'a', revision: 2, text: 'first', startedAt: 1100 });
  w.noteOwnTurn({ segmentId: 'a', revision: 1, text: 'stale', startedAt: 1100 });
  t.equal(w.collect(), null, 'not collectable while open');
  w.close();
  t.equal(w.collect(), 'first second');
  t.equal(w.collect(), null);
  t.end();
});

t.test('a segment that started before open is excluded', (t) => {
  const { w, at } = make();
  at(2000);
  w.open();
  w.noteOwnTurn({ segmentId: 'old', revision: 1, text: 'before', startedAt: 1999 });
  w.noteOwnTurn({ segmentId: 'new', revision: 1, text: 'inside', startedAt: 2000 });
  w.close();
  t.equal(w.collect(), 'inside');
  t.end();
});

t.test('a segment first noted during the grace is included', (t) => {
  const { w, at } = make();
  w.open();
  w.noteOwnTurn({ segmentId: 'a', revision: 1, text: 'hello', startedAt: 1100 });
  at(5000); // second press: the window stays open
  w.noteOwnTurn({ segmentId: 'b', revision: 1, text: 'world', startedAt: 5000 + GRACE_MS - 1 });
  w.close();
  t.equal(w.collect(), 'hello world');
  t.end();
});

t.test('notes after close or collect are ignored', (t) => {
  const { w } = make();
  w.open();
  w.noteOwnTurn({ segmentId: 'a', revision: 1, text: 'one', startedAt: 1100 });
  w.close();
  w.noteOwnTurn({ segmentId: 'a', revision: 2, text: 'changed', startedAt: 1100 });
  w.noteOwnTurn({ segmentId: 'c', revision: 1, text: 'late', startedAt: 1200 });
  t.equal(w.collect(), 'one');
  w.noteOwnTurn({ segmentId: 'a', revision: 3, text: 'again', startedAt: 1100 });
  t.equal(w.collect(), null);
  t.end();
});

t.test('a press during the grace opens a second window queued behind the first', (t) => {
  const { w, at } = make();
  w.open();
  w.noteOwnTurn({ segmentId: 'a', revision: 1, text: 'first window', startedAt: 1100 });
  at(5000);
  w.open(); // press during the first window's grace
  w.noteOwnTurn({ segmentId: 'a', revision: 2, text: 'first window done', startedAt: 1100 });
  w.noteOwnTurn({ segmentId: 'b', revision: 1, text: 'second window', startedAt: 5200 });
  t.equal(w.collect(), null);
  w.close(); // closes the first, not the second
  w.noteOwnTurn({ segmentId: 'c', revision: 1, text: 'still second', startedAt: 5300 });
  t.equal(w.collect(), 'first window done');
  t.equal(w.collect(), null, 'second window is still open');
  w.close();
  t.equal(w.collect(), 'second window still second');
  t.end();
});

t.test('reset drops everything', (t) => {
  const { w } = make();
  w.open();
  w.noteOwnTurn({ segmentId: 'a', revision: 1, text: 'x', startedAt: 1100 });
  w.open();
  w.close();
  w.reset();
  t.equal(w.collect(), null);
  w.noteOwnTurn({ segmentId: 'a', revision: 1, text: 'x', startedAt: 1100 });
  w.close();
  t.equal(w.collect(), null);
  t.end();
});
