import t from 'tap';
import { latestOtherPartyText, splitLead } from '../src/lib/answerLead';

t.test('the first sentence is the lead and the rest is the details', async (t) => {
  t.same(splitLead('Ask what the shipping cost is. They said the price is unchanged; shipping is the open term.'), {
    lead: 'Ask what the shipping cost is.',
    rest: 'They said the price is unchanged; shipping is the open term.',
  });
});

t.test('a streaming answer with no sentence end yet is all lead', async (t) => {
  t.same(splitLead('Ask what the shipping cost'), { lead: 'Ask what the shipping cost', rest: '' });
  t.same(splitLead(''), { lead: '', rest: '' });
});

t.test('question marks, exclamations and full-width stops end a sentence', async (t) => {
  t.equal(splitLead('Can you confirm the delivery date? Then agree on the price.').lead, 'Can you confirm the delivery date?');
  t.equal(splitLead('请确认交付日期。然后再谈价格。').lead, '请确认交付日期。然后再谈价格。', 'no break between full-width sentences in one run when under the minimum: the second stop is the first with 12+ characters');
});

t.test('a short stretch before a stop is not a sentence', async (t) => {
  t.equal(splitLead('e.g. mention the contract terms and the price. Then wait.').lead, 'e.g. mention the contract terms and the price.');
});

t.test('leading space is ignored and a code fence stays whole in the rest', async (t) => {
  const { lead, rest } = splitLead('  Say the price is fixed.\n```js\nconst a = 1.\n```');
  t.equal(lead, 'Say the price is fixed.');
  t.match(rest, /^```js/);
});

t.test('latestOtherPartyText skips own speech and falls back to the live partial', async (t) => {
  const rows = [
    { sourceText: 'Can we move the call?', speaker: 'interviewer' as const },
    { sourceText: 'Sure, when?', speaker: 'user' as const },
  ];
  t.equal(latestOtherPartyText(rows), 'Can we move the call?');
  t.equal(latestOtherPartyText(rows, '  And what about Friday  '), 'And what about Friday', 'a live partial is newer than any final line');
  t.equal(latestOtherPartyText(rows, '   '), 'Can we move the call?', 'a blank partial is ignored');
  t.equal(latestOtherPartyText([{ sourceText: 'Me only', speaker: 'user' }], '  Are you there  '), 'Are you there');
  t.equal(latestOtherPartyText([]), undefined);
  t.equal(latestOtherPartyText([{ sourceText: '  ', speaker: 'interviewer' }]), undefined);
});
