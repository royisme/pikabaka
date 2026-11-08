import { ipcRenderer } from "electron"

export function intelligenceChannels() {
  return {
    generateAssist: () => ipcRenderer.invoke("generate-assist"),
    generateAsk: () => ipcRenderer.invoke("generate-ask"),
    generateFollowUp: (intent: string, userRequest?: string) => ipcRenderer.invoke("generate-follow-up", intent, userRequest),
    generateCatchUp: () => ipcRenderer.invoke("generate-catch-up"),
    submitManualQuestion: (question: string) => ipcRenderer.invoke("submit-manual-question", question),
    getIntelligenceContext: () => ipcRenderer.invoke("get-intelligence-context"),
    resetIntelligence: () => ipcRenderer.invoke("reset-intelligence"),
    onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-assist-update", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-assist-update", subscription)
      }
    },
    onIntelligenceRefinedAnswerToken: (callback: (data: { token: string; intent: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-refined-answer-token", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-refined-answer-token", subscription)
      }
    },
    onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-refined-answer", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-refined-answer", subscription)
      }
    },
    onIntelligenceCatchUpToken: (callback: (data: { token: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-catch-up-token", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-catch-up-token", subscription)
      }
    },
    onIntelligenceCatchUp: (callback: (data: { summary: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-catch-up", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-catch-up", subscription)
      }
    },
    onIntelligenceAskToken: (callback: (data: { token: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-ask-token", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-ask-token", subscription)
      }
    },
    onIntelligenceAsk: (callback: (data: { question: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-ask", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-ask", subscription)
      }
    },
    onIntelligenceManualStarted: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on("intelligence-manual-started", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-manual-started", subscription)
      }
    },
    onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-manual-result", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-manual-result", subscription)
      }
    },
    onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-mode-changed", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-mode-changed", subscription)
      }
    },
    onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-error", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-error", subscription)
      }
    },
    onSessionReset: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on("session-reset", subscription)
      return () => {
        ipcRenderer.removeListener("session-reset", subscription)
      }
    },
  }
}
