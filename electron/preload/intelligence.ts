import { ipcRenderer } from "electron"

export function intelligenceChannels() {
  return {
    generateAssist: () => ipcRenderer.invoke("generate-assist"),
    generateWhatToSay: (question?: string, imagePaths?: string[]) => ipcRenderer.invoke("generate-what-to-say", question, imagePaths),
    generateClarify: () => ipcRenderer.invoke("generate-clarify"),
    generateCodeHint: (imagePaths?: string[], problemStatement?: string) => ipcRenderer.invoke("generate-code-hint", imagePaths, problemStatement),
    generateBrainstorm: (imagePaths?: string[], problemStatement?: string) => ipcRenderer.invoke("generate-brainstorm", imagePaths, problemStatement),
    generateFollowUp: (intent: string, userRequest?: string) => ipcRenderer.invoke("generate-follow-up", intent, userRequest),
    generateFollowUpQuestions: () => ipcRenderer.invoke("generate-follow-up-questions"),
    generateRecap: () => ipcRenderer.invoke("generate-recap"),
    submitManualQuestion: (question: string) => ipcRenderer.invoke("submit-manual-question", question),
    getIntelligenceContext: () => ipcRenderer.invoke("get-intelligence-context"),
    resetIntelligence: () => ipcRenderer.invoke("reset-intelligence"),
    getActionButtonMode: () => ipcRenderer.invoke("get-action-button-mode"),
    setActionButtonMode: (mode: 'recap' | 'brainstorm') => ipcRenderer.invoke("set-action-button-mode", mode),
    onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => {
      const subscription = (_: any, mode: 'recap' | 'brainstorm') => callback(mode);
      ipcRenderer.on('action-button-mode-changed', subscription);
      return () => { ipcRenderer.removeListener('action-button-mode-changed', subscription); };
    },
    onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-assist-update", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-assist-update", subscription)
      }
    },
    onIntelligenceSuggestedAnswerToken: (callback: (data: { token: string; question: string; confidence: number }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-suggested-answer-token", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-suggested-answer-token", subscription)
      }
    },
    onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-suggested-answer", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-suggested-answer", subscription)
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
    onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-recap-token", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-recap-token", subscription)
      }
    },
    onIntelligenceRecap: (callback: (data: { summary: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-recap", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-recap", subscription)
      }
    },
    onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-clarify-token", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-clarify-token", subscription)
      }
    },
    onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-clarify", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-clarify", subscription)
      }
    },
    onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-follow-up-questions-token", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-follow-up-questions-token", subscription)
      }
    },
    onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("intelligence-follow-up-questions-update", subscription)
      return () => {
        ipcRenderer.removeListener("intelligence-follow-up-questions-update", subscription)
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
