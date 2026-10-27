import t from 'tap';
import { EchoFilter, wordsOf } from '../electron/lib/echo-filter';

// Invented sentences; the filter only compares words.
t.test('the microphone repeating the other party word for word is an echo', async (t) => {
  const filter = new EchoFilter();
  filter.noteOther('We could start with the east region and then move to the west by spring', 1000);
  t.equal(filter.isEcho('we could start with the east region and then move', 2500), true, 'a cut-off repeat');
  t.equal(filter.isEcho('We could start with the east region, and then move to the west', 3000), true, 'punctuation and case do not matter');
});

t.test('what the user says is not an echo', async (t) => {
  const filter = new EchoFilter();
  filter.noteOther('We could start with the east region and then move to the west by spring', 1000);
  t.equal(filter.isEcho('That sounds fine to me but I need to check the budget first', 2000), false);
  t.equal(filter.isEcho('Yes', 2000), false, 'a short answer is never an echo');
  t.equal(filter.isEcho('start with the east', 2000), true, 'four words that all repeat count as an echo');
  t.equal(filter.isEcho('okay then the east plan', 2000), false, 'one shared word does not');
});

t.test('only recent lines can be echoed, and a line before any other line is not', async (t) => {
  const filter = new EchoFilter();
  t.equal(filter.isEcho('we could start with the east region', 500), false, 'nothing from the other party yet');
  filter.noteOther('we could start with the east region and then move on', 1000);
  t.equal(filter.isEcho('we could start with the east region', 30_000), false, 'too long after');
});

t.test('Chinese is compared by characters', async (t) => {
  t.same(wordsOf('我们先从东区开始'), ['我', '们', '先', '从', '东', '区', '开', '始']);
  const filter = new EchoFilter();
  filter.noteOther('我们先从东区开始然后再到西区', 1000);
  t.equal(filter.isEcho('我们先从东区开始', 2000), true);
  t.equal(filter.isEcho('这个预算需要再确认一下', 2000), false);
});
