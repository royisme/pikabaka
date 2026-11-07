/** The longest brief: it goes into every answer prompt. */
export const SCENARIO_BRIEF_MAX = 600;

/** The one active scenario: a short plain-language brief, and optionally the language answers are spoken in. */
export interface Scenario {
  brief: string;
  answerLanguage?: string;
}

/** What Settings reads: the scenario in force (empty fields when none) and the brief's length cap. */
export interface ScenarioReply {
  brief: string;
  answerLanguage: string;
  maxLength: number;
}

/**
 * What a scenario adds to a prompt: the language to answer in (undefined follows the conversation) and a
 * header with the brief (empty when there is none). No scenario changes nothing.
 */
export function scenarioInstruction(scenario: Scenario | undefined): { answerLanguage?: string; header: string } {
  const brief = scenario?.brief.trim();
  return {
    answerLanguage: scenario?.answerLanguage?.trim() || undefined,
    header: brief ? `[SCENARIO — WHAT THIS CONVERSATION IS]\n${brief}\n[END SCENARIO]\n\n` : '',
  };
}
