import t from 'tap';
import { scenarioInstruction } from '../electron/llm/scenario';

t.test('no scenario adds nothing', async (t) => {
  t.same(scenarioInstruction(undefined), { answerLanguage: undefined, header: '' });
  t.same(scenarioInstruction({ brief: '   ', answerLanguage: ' ' }), { answerLanguage: undefined, header: '' });
});

t.test('a brief becomes a header and a language is trimmed', async (t) => {
  const result = scenarioInstruction({ brief: ' An invented weekly class. ', answerLanguage: ' French ' });
  t.equal(result.answerLanguage, 'French');
  t.match(result.header, /An invented weekly class\./);
  t.match(result.header, /^\[SCENARIO/);
});

t.test('a language alone gives no header', async (t) => {
  t.same(scenarioInstruction({ brief: '', answerLanguage: 'French' }), { answerLanguage: 'French', header: '' });
});
