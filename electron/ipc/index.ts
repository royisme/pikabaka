import { AppState } from "../main"
import { registerCoreHandlers } from "./core"
import { registerSttHandlers } from "./stt"
import { registerMeetingHandlers } from "./meeting"
import { registerIntelligenceHandlers } from "./intelligence"
import { registerSystemHandlers } from "./system"
import { registerRagHandlers } from "./rag"
import { registerKnowledgeHandlers } from "./knowledge"
import { registerTranslationHandlers } from "./translation"
import { registerMiscHandlers } from "./misc"
import { registerGateHandlers } from "./gate"
import { registerApprovalHandlers } from "./approval"
import { registerConnectionHandlers } from "./connections"
import { registerAnswerStyleHandlers } from "./answerStyle"
import { registerAgentHandlers } from "./agent"
import { registerPromptHandlers } from "./prompts"

export function initializeIpcHandlers(appState: AppState): void {
  registerCoreHandlers(appState)
  registerSttHandlers(appState)
  registerMeetingHandlers(appState)
  registerIntelligenceHandlers(appState)
  registerSystemHandlers(appState)
  registerRagHandlers(appState)
  registerKnowledgeHandlers(appState)
  registerTranslationHandlers(appState)
  registerMiscHandlers(appState)
  registerGateHandlers(appState)
  registerApprovalHandlers()
  registerConnectionHandlers(appState)
  registerAnswerStyleHandlers()
  registerAgentHandlers(appState)
  registerPromptHandlers()
}
