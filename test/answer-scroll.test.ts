import t from 'tap';
import { FOLLOW_THRESHOLD_PX, countNewRows, isNearBottom, nextScrollAction, nextTranscriptScroll } from '../src/lib/answerScroll';

t.test('isNearBottom counts only the last 32px as following', async (t) => {
  t.equal(FOLLOW_THRESHOLD_PX, 32);
  t.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }), true, 'exactly at the bottom');
  t.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 570, clientHeight: 400 }), true, '30px above the bottom');
  t.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 568, clientHeight: 400 }), false, '32px above the bottom');
  t.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 }), false, 'at the top of a long list');
  t.equal(isNearBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 }), true, 'content shorter than the view');
});

t.test('a message that has not been shown scrolls its start into view', async (t) => {
  t.equal(nextScrollAction('m2', 'm1', true), 'show-start');
  t.equal(nextScrollAction('m2', 'm1', false), 'show-start', 'even when the reader had scrolled up');
  t.equal(nextScrollAction('m1', undefined, true), 'show-start', 'first message after the overlay opens');
});

t.test('tokens of the shown message follow only while the reader is at the bottom', async (t) => {
  t.equal(nextScrollAction('m2', 'm2', true), 'follow');
  t.equal(nextScrollAction('m2', 'm2', false), 'none', 'reader scrolled up: leave the view alone');
});

t.test('an empty list does nothing', async (t) => {
  t.equal(nextScrollAction(undefined, undefined, true), 'none');
  t.equal(nextScrollAction(undefined, 'm1', false), 'none');
});

t.test('the transcript pins only while following and only when content changed', async (t) => {
  t.equal(nextTranscriptScroll({ following: true, contentChanged: true }), 'pin');
  t.equal(nextTranscriptScroll({ following: true, contentChanged: false }), 'hold');
  t.equal(nextTranscriptScroll({ following: false, contentChanged: true }), 'hold', 'reader scrolled up');
  t.equal(nextTranscriptScroll({ following: false, contentChanged: false }), 'hold');
});

t.test('new rows are counted from where following stopped', async (t) => {
  t.equal(countNewRows(10, null), 0, 'still following');
  t.equal(countNewRows(10, 10), 0, 'no new rows, only partial or translation updates');
  t.equal(countNewRows(13, 10), 3);
  t.equal(countNewRows(8, 10), 0, 'rows removed never gives a negative count');
});
