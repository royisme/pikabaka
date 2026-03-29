import t from 'tap';
import { DepthScorer } from '../../../electron/knowledge/DepthScorer';

t.test('DepthScorer starts shallow for a new topic', (t) => {
  const scorer = new DepthScorer();

  scorer.feed('Can you walk me through your system design approach?');

  t.equal(scorer.getCurrentTopic(), 'system-design');
  t.equal(scorer.getCurrentDepth('How would you design a scalable architecture?'), 1);
  t.match(scorer.getDepthInstruction(), /clear, concise overview/i);
  t.end();
});

t.test('DepthScorer increases depth for repeated questions on the same topic', (t) => {
  const scorer = new DepthScorer();

  scorer.feed('How would you design a scalable API architecture?');
  scorer.feed('What database and cache trade-offs shaped that design?');
  scorer.feed('How did the load balancer and distributed API design evolve over time?');

  t.equal(scorer.getCurrentTopic(), 'system-design');
  t.equal(scorer.getCurrentDepth('How would you design a scalable API architecture?'), 3);
  t.match(scorer.getDepthInstruction(), /deep-dive question/i);
  t.end();
});

t.test('DepthScorer uses follow-up instruction for second question in same topic', (t) => {
  const scorer = new DepthScorer();

  scorer.feed('How do you debug and test a production issue?');
  scorer.feed('How do you debug and test the same issue under pressure?');

  t.match(scorer.getDepthInstruction(), /follow-up question/i);
  t.match(scorer.getDepthInstruction(), /specific examples, numbers, and technical details/i);
  t.end();
});

t.test('DepthScorer reset clears topic and depth history', (t) => {
  const scorer = new DepthScorer();

  scorer.feed('Tell me about your salary expectations.');
  scorer.reset();

  t.equal(scorer.getCurrentTopic(), null);
  t.equal(scorer.getCurrentDepth('Tell me about your salary expectations.'), 0);
  t.equal(scorer.getDepthInstruction(), '');
  t.end();
});
