import t from 'tap';
import { splitAtLastSentence } from '../electron/transcript/sentences';

t.test('splitAtLastSentence keeps finished sentences apart from the unfinished rest', async (t) => {
  t.same(splitAtLastSentence('We shipped it. Then the billing job failed and we'), { finished: 'We shipped it.', rest: 'Then the billing job failed and we' });
  t.same(splitAtLastSentence('One. Two! Three?'), { finished: 'One. Two! Three?', rest: '' });
  t.same(splitAtLastSentence('no end yet'), { finished: '', rest: 'no end yet' });
  t.same(splitAtLastSentence(''), { finished: '', rest: '' });
});

t.test('abbreviations, initials and decimals do not end a sentence', async (t) => {
  t.same(splitAtLastSentence('Ask Dr. Lee about 3.5 percent. Then call'), { finished: 'Ask Dr. Lee about 3.5 percent.', rest: 'Then call' });
  t.same(splitAtLastSentence('It costs money, e.g. a lot'), { finished: '', rest: 'It costs money, e.g. a lot' });
  t.same(splitAtLastSentence('Meet J. Smith tomorrow'), { finished: '', rest: 'Meet J. Smith tomorrow' });
});

t.test('full-width marks end a sentence without a space', async (t) => {
  t.same(splitAtLastSentence('我们先看价格。然后再讨论'), { finished: '我们先看价格。', rest: '然后再讨论' });
  t.same(splitAtLastSentence('可以吗？好的！'), { finished: '可以吗？好的！', rest: '' });
});

t.test('closing quotes and brackets stay with their sentence', async (t) => {
  t.same(splitAtLastSentence('He said "go now." Then we left'), { finished: 'He said "go now."', rest: 'Then we left' });
});
