import { AppState } from "../main"
import { registerCoreHandlers } from "./core"
import { registerModelDiscoveryHandlers } from "./model-discovery"
import { registerSttHandlers } from "./stt"
import { registerMeetingHandlers } from "./meeting"
import { registerIntelligenceHandlers } from "./intelligence"
import { registerSystemHandlers } from "./system"
import { registerRagHandlers } from "./rag"
import { registerKnowledgeHandlers } from "./knowledge"
import { registerTranslationHandlers } from "./translation"
import { registerMiscHandlers } from "./misc"

export function initializeIpcHandlers(appState: AppState): void {
  registerCoreHandlers(appState)
  registerModelDiscoveryHandlers(appState)
  registerSttHandlers(appState)
  registerMeetingHandlers(appState)
  registerIntelligenceHandlers(appState)
  registerSystemHandlers(appState)
  registerRagHandlers(appState)
  registerKnowledgeHandlers(appState)
  registerTranslationHandlers(appState)
  registerMiscHandlers(appState)
}
