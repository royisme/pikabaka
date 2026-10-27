import { ipcRenderer } from "electron"

export function llmChannels() {
  return {
    selectServiceAccount: () => ipcRenderer.invoke("select-service-account"),
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
    toggleModelSelector: (coords: { x: number; y: number }) => ipcRenderer.invoke('toggle-model-selector', coords),
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
