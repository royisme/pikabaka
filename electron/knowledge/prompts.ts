// electron/knowledge/prompts.ts
// LLM prompt templates for the Knowledge answer path

/** The user's notes have nothing for this question: answer as an expert in the field would, without inventing a past. */
export function buildNoMatchPrompt(question: string): string {
  return `You are helping the user answer a question in a live conversation. The user's own notes have nothing relevant to it, so answer it the way a senior practitioner in this field would: with the approach experts and industry best practice agree on, the reasoning behind it and the trade-offs, concrete enough to sound like someone who has done the work.

Question: ${question}

Instructions:
- Write it as lines the user can say out loud, in first person, about how they approach and decide ("The way I approach this is...", "What I check first is...")
- Be specific and practical: name the standard technique, the first step, the main risk, how you would verify it
- Do not invent a past: no made-up employers, projects, team sizes, numbers or results, and do not claim an event happened to the user. For a "tell me about a time" question, build the STAR shape around a typical case ("A typical situation is...", "In a case like that I...") and the approach, not around a fabricated event
- No placeholders in brackets and no notes to the user: give the answer`;
}

/** Passages from the user's notes matched the question: use them to make the answer specific. */
export function buildContextEnhancementPrompt(question: string, relevantChunks: string[]): string {
  return `You are helping the user answer a question in a live conversation. Use the user's notes below to craft a personalized, specific answer.

Relevant notes:
${relevantChunks.map((c, i) => `[${i + 1}] ${c}`).join('\n')}

Question: ${question}

Instructions:
- Answer in first person, as the user
- Reference specific experiences, projects and skills from the notes
- Be specific with numbers, technologies and outcomes where possible
- Keep the answer focused and natural (not a lecture)`;
}
