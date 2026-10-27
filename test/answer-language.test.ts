import t from 'tap';
import { answerLanguageInstruction } from '../electron/llm/answerLanguage';

t.test('everything English needs no instruction', async (t) => {
  t.equal(answerLanguageInstruction('English', 'english-us'), null);
});

t.test('speaking English and reading Chinese: answer in the conversation language, then a Chinese line', async (t) => {
  const instruction = answerLanguageInstruction('Chinese', 'english-us');
  t.ok(instruction);
  t.match(instruction!.header, /read.*out loud/s);
  t.match(instruction!.header, /last separate line that starts with "Chinese:"/);
  t.match(instruction!.header, /set to English/);
});

t.test('speaking and reading the same language that is not English keeps the one-language rule', async (t) => {
  const instruction = answerLanguageInstruction('Spanish', 'spanish');
  t.ok(instruction);
  t.notMatch(instruction!.header, /last separate line/);
  t.match(instruction!.header, /every single word of your response in Spanish/);
});

t.test('reading English while speaking another language gets a spoken answer and an English line', async (t) => {
  const instruction = answerLanguageInstruction('English', 'chinese');
  t.ok(instruction);
  t.match(instruction!.header, /starts with "English:"/);
});
