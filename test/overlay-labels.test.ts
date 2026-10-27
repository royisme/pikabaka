import t from 'tap';
import { modelLabel } from '../src/lib/modelLabel';
import { shortLanguageLabel } from '../src/lib/languageLabel';

t.test('known model ids get their short names, others are shown as they are', async (t) => {
  t.equal(modelLabel('gemini-3.1-flash-lite-preview'), 'Gemini 3.1 Flash');
  t.equal(modelLabel('claude-sonnet-4-6'), 'Sonnet 4.6');
  t.equal(modelLabel('ollama-llama3:8b'), 'llama3:8b');
  t.equal(modelLabel('some-new-model'), 'some-new-model');
});

t.test('language labels are at most four characters', async (t) => {
  t.equal(shortLanguageLabel('chinese', 'Chinese (Simplified)'), '中文');
  t.equal(shortLanguageLabel('english-us', 'English (United States)'), 'EN');
  t.equal(shortLanguageLabel('english-india'), 'EN');
  t.equal(shortLanguageLabel('french'), 'FR');
  t.equal(shortLanguageLabel('japanese'), '日本語');
  for (const value of ['chinese', 'english-uk', 'russian', 'spanish', 'korean', 'turkish', 'swahili', 'x']) {
    t.ok(shortLanguageLabel(value, value).length <= 4, value);
  }
});

t.test('an unknown language falls back to its first two letters', async (t) => {
  t.equal(shortLanguageLabel('swahili', 'Swahili'), 'SW');
  t.equal(shortLanguageLabel('???', '???'), '???');
});
