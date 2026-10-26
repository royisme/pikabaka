import { BrowserWindow } from "electron"
import { AppState } from "../main"
import { safeHandle } from "./safeHandle"
import { CredentialsManager } from "../services/CredentialsManager"
import { CONNECTION_TYPES, isBuiltinConnection, type ConnectionType } from "../services/aiConnections"
import { fetchConnectionModels } from "../utils/connectionModels"

// Connections (type, host, key) and the agent's own model. The key never leaves the main process:
// the list says only whether one is saved, and a missing `apiKey` on save leaves it as it is.
export function registerConnectionHandlers(appState: AppState): void {
  safeHandle("ai-connections-list", async () => CredentialsManager.getInstance().listConnections())

  safeHandle("ai-connection-save", async (_, input: { id?: string; name?: string; type?: ConnectionType; baseUrl?: string; apiKey?: string }) => {
    if (typeof input !== 'object' || input === null) return { success: false, error: 'Invalid connection' }
    for (const key of ['id', 'name', 'baseUrl', 'apiKey'] as const) {
      const value = input[key]
      if (value !== undefined && (typeof value !== 'string' || value.length > 2048)) return { success: false, error: `Invalid ${key}` }
    }
    if (input.type !== undefined && !CONNECTION_TYPES.includes(input.type)) return { success: false, error: 'Invalid type' }
    const cm = CredentialsManager.getInstance()
    const result = cm.saveConnection(input)
    if ('error' in result) return { success: false, error: result.error }
    // The chat helper builds its clients from the key and host: rebuild them when a built-in one changed.
    if (isBuiltinConnection(result.id)) {
      const llm = appState.processingHelper.getLLMHelper()
      if (result.id === 'gemini') llm.setApiKey(cm.getGeminiApiKey() ?? '')
      else if (result.id === 'groq') llm.setGroqApiKey(cm.getGroqApiKey() ?? '')
      else if (result.id === 'openai') llm.setOpenaiApiKey(cm.getOpenaiApiKey() ?? '')
      else if (result.id === 'claude') llm.setClaudeApiKey(cm.getClaudeApiKey() ?? '')
      appState.getIntelligenceManager().resetEngine()
      appState.getIntelligenceManager().initializeLLMs()
    }
    return { success: true, id: result.id }
  })

  safeHandle("ai-connection-delete", async (_, id: string) => ({ success: typeof id === 'string' && CredentialsManager.getInstance().deleteConnection(id) }))

  // Fetch the models a connection serves: a saved one by id, or a draft (type, host, key) before saving.
  safeHandle("ai-connection-models", async (_, input: { id?: string; type?: ConnectionType; baseUrl?: string; apiKey?: string }) => {
    try {
      const cm = CredentialsManager.getInstance()
      const saved = input?.id ? cm.resolveConnection(input.id) : undefined
      const type = input?.type ?? saved?.type
      if (!type || !CONNECTION_TYPES.includes(type)) return { success: false, error: 'Choose a type' }
      const models = await fetchConnectionModels({
        type,
        baseUrl: input?.baseUrl?.trim() || saved?.baseUrl || '',
        // A draft without a key tests the saved one.
        apiKey: input?.apiKey?.trim() || saved?.apiKey || '',
      })
      return { success: true, models }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  safeHandle("agent-model-get", async () => CredentialsManager.getInstance().getAgentUse())

  safeHandle("agent-model-set", async (_, use: { connectionId: string; model: string; supportsImages?: boolean }) => {
    if (typeof use?.connectionId !== 'string' || typeof use.model !== 'string' || use.model.length > 512) return { success: false, error: 'Invalid model' }
    const cm = CredentialsManager.getInstance()
    if (use.connectionId && !cm.resolveConnection(use.connectionId)) return { success: false, error: 'That connection does not exist' }
    cm.setAgentUse(use)
    return { success: true }
  })

  // The model of quick answers ("chat") and of meeting summaries ("summary"): a connection and a model id.
  // An empty connection means "not chosen": quick answers then use the model chosen before connections existed,
  // and summaries use the quick-answers model.
  for (const job of ['chat', 'summary'] as const) {
    safeHandle(`${job}-model-get`, async () => CredentialsManager.getInstance().getModelUse(job))

    safeHandle(`${job}-model-set`, async (_, use: { connectionId: string; model: string }) => {
      if (typeof use?.connectionId !== 'string' || typeof use.model !== 'string' || use.model.length > 512) return { success: false, error: 'Invalid model' }
      const cm = CredentialsManager.getInstance()
      if (use.connectionId && !cm.resolveConnection(use.connectionId)) return { success: false, error: 'That connection does not exist' }
      cm.setModelUse(job, use)
      if (job === 'chat') {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('model-changed', use.model)
        }
      }
      return { success: true }
    })
  }
}
