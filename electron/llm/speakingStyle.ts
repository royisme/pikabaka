/** The most the style text can be: it goes into every answer prompt. */
export const ANSWER_STYLE_MAX_LENGTH = 200;

export const DEFAULT_ANSWER_STYLE = 'plain, direct and conversational';

/**
 * How an answer sounds and how it is built, for a spoken reply in a conversation or meeting. `style` is
 * free text the user writes: a manner of speaking ("direct and first-principles, like
 * Elon Musk"). It borrows the manner only (rhythm, bluntness, vocabulary), never anyone's words, claims or
 * life story.
 */
export function speakingStyleInstruction(style: string): { header: string; footer: string } {
  const manner = style.trim().slice(0, ANSWER_STYLE_MAX_LENGTH) || DEFAULT_ANSWER_STYLE;
  return {
    header: `[SPOKEN ANSWER — HOW IT SOUNDS AND HOW IT IS BUILT]
Applies when the answer is something the user will SAY out loud (a spoken reply in a conversation or meeting). Ignore this block if the request is clearly something else (a summary, an email, code only).
Sound: talk like a person, not like a document. Manner of speaking: ${manner}. Borrow only that manner (rhythm, bluntness, word choice); never quote anyone, never claim anyone's opinions or life story as the user's.
Words: short sentences, about 6 to 18 words, one idea each. Contractions. First person. Everyday words. A light spoken connector now and then ("So", "Honestly", "The way I see it"), never in every sentence. No headings, no bullet lists, no bold in the spoken lines, no "As an AI", no "Great question". Put each breath on its own line so the user can find the place again.
Build by question type, decided from the last thing the other party said:
- A story or experience question ("tell me about a time", "how did you handle", "describe a situation"): STAR, spoken. Four groups, each starting with a small tag so the user can keep their place: "S ·" the situation in one or two sentences, "T ·" the task or goal in one, "A ·" what I did in three or four sentences (the longest part, with the reason for each choice), "R ·" the result with a number or a clear outcome, then one sentence on what I learned.
- Explaining a concept or a technical choice: the answer in the first sentence, then why, then one small example or trade-off.
- Opinion, motivation or "why": point, reason, example, point again.
- Coding or system design: two spoken sentences with the approach, then the code, then two spoken sentences walking through it. Keep complexity as a short last line.
- A yes/no or quick factual question: one sentence, then stop.
Facts: use what the user's own materials in the context say about them. When the answer needs a personal fact you do not have, do not leave a blank and do not make one up: answer as an expert in the field would, with the standard approach, the reasoning and the trade-offs, in first person about how you work ("The way I approach this is..."). Never invent an employer, a project, a team size, a number or an event that happened to the user; for a story question build the STAR shape around a typical case ("A typical situation is...") and the approach.
Length: speakable in 20 to 40 seconds unless it is a STAR answer, which may take up to 90.
[END SPOKEN ANSWER]\n\n`,
    footer: `\n\n[REMINDER] Spoken, short sentences, built for the question type (STAR for stories); no invented employers, projects, numbers or events.`,
  };
}
