import { ipcRenderer } from "electron"

export function llmChannels() {
  return {
    getCurrentLlmConfig: () => ipcRenderer.invoke("get-current-llm-config"),
    getAvailableOllamaModels: () => ipcRenderer.invoke("get-available-ollama-models"),
    switchToOllama: (model?: string, url?: string) => ipcRenderer.invoke("switch-to-ollama", model, url),
    switchToGemini: (apiKey?: string, modelId?: string) => ipcRenderer.invoke("switch-to-gemini", apiKey, modelId),
    testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => ipcRenderer.invoke("test-llm-connection", provider, apiKey),
    selectServiceAccount: () => ipcRenderer.invoke("select-service-account"),
    setGeminiApiKey: (apiKey: string) => ipcRenderer.invoke("set-gemini-api-key", apiKey),
    setGroqApiKey: (apiKey: string) => ipcRenderer.invoke("set-groq-api-key", apiKey),
    setOpenaiApiKey: (apiKey: string) => ipcRenderer.invoke("set-openai-api-key", apiKey),
    setClaudeApiKey: (apiKey: string) => ipcRenderer.invoke("set-claude-api-key", apiKey),
    getStoredCredentials: () => ipcRenderer.invoke("get-stored-credentials"),
    streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean }) => ipcRenderer.invoke("gemini-chat-stream", message, imagePaths, context, options),
    onGeminiStreamToken: (callback: (token: string) => void) => {
      const subscription = (_: any, token: string) => callback(token)
      ipcRenderer.on("gemini-stream-token", subscription)
      return () => {
        ipcRenderer.removeListener("gemini-stream-token", subscription)
      }
    },
    onGeminiStreamDone: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on("gemini-stream-done", subscription)
      return () => {
        ipcRenderer.removeListener("gemini-stream-done", subscription)
      }
    },
    onGeminiStreamError: (callback: (error: string) => void) => {
      const subscription = (_: any, error: string) => callback(error)
      ipcRenderer.on("gemini-stream-error", subscription)
      return () => {
        ipcRenderer.removeListener("gemini-stream-error", subscription)
      }
    },
    getDefaultModel: () => ipcRenderer.invoke('get-default-model'),
    setModel: (modelId: string) => ipcRenderer.invoke('set-model', modelId),
    setDefaultModel: (modelId: string) => ipcRenderer.invoke('set-default-model', modelId),
    toggleModelSelector: (coords: { x: number; y: number }) => ipcRenderer.invoke('toggle-model-selector', coords),
    forceRestartOllama: () => ipcRenderer.invoke('force-restart-ollama'),
    getGroqFastTextMode: () => ipcRenderer.invoke('get-groq-fast-text-mode'),
    setGroqFastTextMode: (enabled: boolean) => ipcRenderer.invoke('set-groq-fast-text-mode', enabled),
    saveCustomProvider: (provider: any) => ipcRenderer.invoke('save-custom-provider', provider),
    getCustomProviders: () => ipcRenderer.invoke('get-custom-providers'),
    deleteCustomProvider: (id: string) => ipcRenderer.invoke('delete-custom-provider', id),
    getOpenAICompatibleProviders: () => ipcRenderer.invoke('get-openai-compatible-providers'),
    saveOpenAICompatibleProvider: (provider: { id: string; name: string; baseUrl: string; apiKey: string; preferredModel?: string }) =>
      ipcRenderer.invoke('save-openai-compatible-provider', provider),
    deleteOpenAICompatibleProvider: (id: string) => ipcRenderer.invoke('delete-openai-compatible-provider', id),
    fetchOpenAICompatibleModels: (baseUrl: string, apiKey: string) =>
      ipcRenderer.invoke('fetch-openai-compatible-models', baseUrl, apiKey),
    fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => ipcRenderer.invoke('fetch-provider-models', provider, apiKey),
    setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string) => ipcRenderer.invoke('set-provider-preferred-model', provider, modelId),
    onGroqFastTextChanged: (callback: (enabled: boolean) => void) => {
      const subscription = (_: any, enabled: boolean) => callback(enabled)
      ipcRenderer.on('groq-fast-text-changed', subscription)
      return () => {
        ipcRenderer.removeListener('groq-fast-text-changed', subscription)
      }
    },
    onOpenAICompatibleProvidersChanged: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('openai-compatible-providers-changed', subscription)
      return () => {
        ipcRenderer.removeListener('openai-compatible-providers-changed', subscription)
      }
    },
    onModelChanged: (callback: (modelId: string) => void) => {
      const subscription = (_: any, modelId: string) => callback(modelId)
      ipcRenderer.on('model-changed', subscription)
      return () => {
        ipcRenderer.removeListener('model-changed', subscription)
      }
    },
    onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('ollama:pull-progress', subscription)
      return () => {
        ipcRenderer.removeListener('ollama:pull-progress', subscription)
      }
    },
    onOllamaPullComplete: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on('ollama:pull-complete', subscription)
      return () => {
        ipcRenderer.removeListener('ollama:pull-complete', subscription)
      }
    },
  }
}
