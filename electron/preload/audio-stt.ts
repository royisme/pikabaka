import { ipcRenderer } from "electron"

export function audioSttChannels() {
  return {
    setSttProvider: (provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox') => ipcRenderer.invoke("set-stt-provider", provider),
    getSttProvider: () => ipcRenderer.invoke("get-stt-provider"),
    setGroqSttApiKey: (apiKey: string) => ipcRenderer.invoke("set-groq-stt-api-key", apiKey),
    setOpenAiSttApiKey: (apiKey: string) => ipcRenderer.invoke("set-openai-stt-api-key", apiKey),
    setDeepgramApiKey: (apiKey: string) => ipcRenderer.invoke("set-deepgram-api-key", apiKey),
    setElevenLabsApiKey: (apiKey: string) => ipcRenderer.invoke("set-elevenlabs-api-key", apiKey),
    setAzureApiKey: (apiKey: string) => ipcRenderer.invoke("set-azure-api-key", apiKey),
    setAzureRegion: (region: string) => ipcRenderer.invoke("set-azure-region", region),
    setIbmWatsonApiKey: (apiKey: string) => ipcRenderer.invoke("set-ibmwatson-api-key", apiKey),
    setGroqSttModel: (model: string) => ipcRenderer.invoke("set-groq-stt-model", model),
    setSonioxApiKey: (apiKey: string) => ipcRenderer.invoke("set-soniox-api-key", apiKey),
    testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey: string, region?: string) => ipcRenderer.invoke("test-stt-connection", provider, apiKey, region),
    onNativeAudioTranscript: (callback: (transcript: { speaker: string; text: string; final: boolean; timestamp?: number; confidence?: number; segmentId?: string; sourceText?: string; translatedText?: string; translationState?: 'pending' | 'complete' | 'error' | 'skipped'; displayMode?: 'original' | 'translated' | 'both'; speakerLabel?: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("native-audio-transcript", subscription)
      return () => {
        ipcRenderer.removeListener("native-audio-transcript", subscription)
      }
    },
    onNativeAudioSuggestion: (callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("native-audio-suggestion", subscription)
      return () => {
        ipcRenderer.removeListener("native-audio-suggestion", subscription)
      }
    },
    onNativeAudioConnected: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on("native-audio-connected", subscription)
      return () => {
        ipcRenderer.removeListener("native-audio-connected", subscription)
      }
    },
    onNativeAudioDisconnected: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on("native-audio-disconnected", subscription)
      return () => {
        ipcRenderer.removeListener("native-audio-disconnected", subscription)
      }
    },
    onSuggestionGenerated: (callback: (data: { question: string; suggestion: string; confidence: number }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("suggestion-generated", subscription)
      return () => {
        ipcRenderer.removeListener("suggestion-generated", subscription)
      }
    },
    onSuggestionProcessingStart: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on("suggestion-processing-start", subscription)
      return () => {
        ipcRenderer.removeListener("suggestion-processing-start", subscription)
      }
    },
    onSuggestionError: (callback: (error: { error: string }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("suggestion-error", subscription)
      return () => {
        ipcRenderer.removeListener("suggestion-error", subscription)
      }
    },
    generateSuggestion: (context: string, lastQuestion: string) =>
      ipcRenderer.invoke("generate-suggestion", context, lastQuestion),
    getNativeAudioStatus: () => ipcRenderer.invoke("native-audio-status"),
    getInputDevices: () => ipcRenderer.invoke("get-input-devices"),
    getOutputDevices: () => ipcRenderer.invoke("get-output-devices"),
    startAudioTest: (deviceId?: string) => ipcRenderer.invoke('start-audio-test', deviceId),
    stopAudioTest: () => ipcRenderer.invoke('stop-audio-test'),
    onAudioTestLevel: (callback: (level: number) => void) => {
      const subscription = (_: any, level: number) => callback(level)
      ipcRenderer.on('audio-test-level', subscription)
      return () => {
        ipcRenderer.removeListener('audio-test-level', subscription)
      }
    },
    finalizeMicSTT: () => ipcRenderer.invoke("finalize-mic-stt"),
    setRecognitionLanguage: (key: string) => ipcRenderer.invoke("set-recognition-language", key),
    getSttLanguage: () => ipcRenderer.invoke("get-stt-language"),
    getAiResponseLanguages: () => ipcRenderer.invoke("get-ai-response-languages"),
    setAiResponseLanguage: (language: string) => ipcRenderer.invoke("set-ai-response-language", language),
    getAiResponseLanguage: () => ipcRenderer.invoke("get-ai-response-language"),
  }
}
