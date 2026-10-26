import { ENGLISH_VARIANTS, RECOGNITION_LANGUAGES } from '../config/languages';

/**
 * The language instruction for answers the user may read out loud in a live conversation.
 *
 * The answer is written in the language of the conversation (the model decides it from the
 * transcript; the user's own speaking language is the hint), because that is what the user says. When
 * the language they read is another one, a last line gives them a translation to understand, not to say.
 * Returns null when no instruction is needed (everything is English), and `{ strict }` when the language
 * they speak and the language they read are the same and not English (the old rule: all of it in that language).
 */
export function answerLanguageInstruction(
  readingLanguage: string,
  spokenLanguageKey: string
): { header: string; footer: string } | null {
  const reading = readingLanguage.trim() || 'English';
  // The language family of the recognition key: 'english-us' is English, 'chinese' is Chinese.
  const spoken = (ENGLISH_VARIANTS[spokenLanguageKey] ?? RECOGNITION_LANGUAGES[spokenLanguageKey])?.group ?? 'English';
  const same = reading.toLowerCase() === spoken.toLowerCase();

  if (same && spoken === 'English') return null;

  if (same) {
    return {
      header: `[LANGUAGE OVERRIDE — HIGHEST PRIORITY]
You MUST write every single word of your response in ${reading}. Do not mix languages. This rule overrides all other instructions including formatting and brevity.
[END LANGUAGE OVERRIDE]\n\n`,
      footer: `\n\n[REMINDER] Your entire response MUST be in ${reading} only.`,
    };
  }

  return {
    header: `[ANSWER LANGUAGE — HIGHEST PRIORITY]
The user reads your answer out loud in a live conversation, so the answer itself must be in the language of that conversation: the language the other party and the user are speaking in the transcript. The user's own speaking language is set to ${spoken}; follow the transcript if it clearly shows another language. Decide the conversation language from the transcript before you write, and write every word of the answer in it. Never write the answer in ${reading} unless that is the conversation language.
After the answer, add one last separate line that starts with "${reading}:" and gives a faithful translation of what you wrote into ${reading}, so the user can understand it. That line is for reading, not for saying. Keep the structure the other rules ask for; this rule decides only the language.
[END ANSWER LANGUAGE]\n\n`,
    footer: `\n\n[REMINDER] The answer is in the conversation language, to be said out loud; the last line starts with "${reading}:" and translates it.`,
  };
}
