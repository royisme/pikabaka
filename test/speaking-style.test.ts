import t from 'tap';
import { speakingStyleInstruction, ANSWER_STYLE_MAX_LENGTH, DEFAULT_ANSWER_STYLE } from '../electron/llm/speakingStyle';

t.test('the user\'s manner of speaking goes into the instruction, and an empty one gives the plain default', async (t) => {
  t.match(speakingStyleInstruction('blunt and short, like a founder').header, /Manner of speaking: blunt and short, like a founder\./);
  t.match(speakingStyleInstruction('   ').header, new RegExp(`Manner of speaking: ${DEFAULT_ANSWER_STYLE}\\.`));
});

t.test('the style text is cut to its limit', async (t) => {
  const long = 'x'.repeat(ANSWER_STYLE_MAX_LENGTH + 50);
  t.notMatch(speakingStyleInstruction(long).header, new RegExp('x'.repeat(ANSWER_STYLE_MAX_LENGTH + 1)));
});

t.test('the instruction asks for STAR on stories, spoken sentences, and brackets instead of invented facts', async (t) => {
  const { header, footer } = speakingStyleInstruction('');
  t.match(header, /STAR/);
  t.match(header, /"S ·".*"T ·".*"A ·".*"R ·"/s);
  t.match(header, /short bracket the user fills in/);
  t.match(header, /Never invent the user's experience/);
  t.match(header, /Borrow only that manner/);
  t.match(footer, /no invented facts/);
});
