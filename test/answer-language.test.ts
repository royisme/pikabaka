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

t.test('an explicit answer language fixes the language and adds the reading-language line', async (t) => {
  const instruction = answerLanguageInstruction('Chinese', 'chinese', 'French');
  t.ok(instruction);
  t.match(instruction!.header, /every word of the answer in French/);
  t.match(instruction!.header, /last separate line that starts with "Chinese:"/);
  t.notMatch(instruction!.header, /Decide the conversation language/);
  t.match(instruction!.footer, /in French/);
});

t.test('an explicit answer language also applies when everything else is English', async (t) => {
  t.match(answerLanguageInstruction('English', 'english-us', 'French')!.header, /every word of the answer in French/);
});

t.test('an unset or blank answer language changes nothing', async (t) => {
  t.same(answerLanguageInstruction('Chinese', 'english-us', undefined), answerLanguageInstruction('Chinese', 'english-us'));
  t.same(answerLanguageInstruction('Chinese', 'english-us', '  '), answerLanguageInstruction('Chinese', 'english-us'));
  t.equal(answerLanguageInstruction('English', 'english-us', ''), null);
});

t.test('an explicit language equal to the reading language keeps the one-language rule', async (t) => {
  const instruction = answerLanguageInstruction('Chinese', 'english-us', 'chinese');
  t.ok(instruction);
  t.notMatch(instruction!.header, /last separate line/);
  t.match(instruction!.header, /every single word of your response in Chinese/);
});
