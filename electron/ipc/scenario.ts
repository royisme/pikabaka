import { safeHandle } from "./safeHandle"
import { SettingsManager, getScenario } from "../services/SettingsManager"
import { SCENARIO_BRIEF_MAX, type Scenario, type ScenarioReply } from "../llm/scenario"

export function registerScenarioHandlers(): void {
  safeHandle("scenario:get", async (): Promise<ScenarioReply> => {
    const scenario = getScenario()
    return { brief: scenario?.brief ?? '', answerLanguage: scenario?.answerLanguage ?? '', maxLength: SCENARIO_BRIEF_MAX }
  })

  // Both fields are checked before anything is written; an empty brief and language clears the scenario.
  safeHandle("scenario:set", async (_, edit: unknown) => {
    if (typeof edit !== 'object' || edit === null || Array.isArray(edit)) {
      return { success: false, error: 'Invalid scenario' }
    }
    const { brief, answerLanguage } = edit as Record<string, unknown>
    if (typeof brief !== 'string') return { success: false, error: 'brief must be text' }
    if (answerLanguage !== undefined && typeof answerLanguage !== 'string') return { success: false, error: 'answerLanguage must be text' }
    const text = brief.trim()
    if (text.length > SCENARIO_BRIEF_MAX) return { success: false, error: `brief is longer than ${SCENARIO_BRIEF_MAX} characters` }
    const language = answerLanguage?.trim()
    const next: Scenario = { brief: text }
    if (language) next.answerLanguage = language
    SettingsManager.getInstance().set('scenario', text || language ? next : undefined)
    return { success: true }
  })
}
