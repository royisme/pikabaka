import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { ElectronAPI } from '../src/types/electron'

// The preload is sandboxed and cannot require local modules at runtime, so this helper stays in this file.
function on<T>(channel: string, callback: (data: T) => void) {
  const listener = (_: IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}

const api = {
  updateContentDimensions: (dimensions) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  getRecognitionLanguages: () => ipcRenderer.invoke("get-recognition-languages"),
  takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
  takeSelectiveScreenshot: () => ipcRenderer.invoke("take-selective-screenshot"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path) =>
    ipcRenderer.invoke("delete-screenshot", path),

  // Event listeners
  onScreenshotTaken: (callback) => on("screenshot-taken", callback),
  onScreenshotAttached: (callback) => on("screenshot-attached", callback),
  onCaptureAndProcess: (callback) => on("capture-and-process", callback),
  onSolutionsReady: (callback) => on("solutions-ready", callback),
  moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
  moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
  moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
  moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),

  analyzeImageFile: (path) => ipcRenderer.invoke("analyze-image-file", path),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  toggleWindow: () => ipcRenderer.invoke("toggle-window"),
  showWindow: (inactive) => ipcRenderer.invoke("show-window", inactive),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showOverlay: () => ipcRenderer.invoke("show-overlay"),
  hideOverlay: () => ipcRenderer.invoke("hide-overlay"),
  getMeetingActive: () => ipcRenderer.invoke("get-meeting-active"),
  onMeetingStateChanged: (callback) => on('meeting-state-changed', callback),
  onWindowMaximizedChanged: (callback) => on('window-maximized-changed', callback),
  onEnsureExpanded: (callback) => on('ensure-expanded', callback),
  toggleAdvancedSettings: () => ipcRenderer.invoke("toggle-advanced-settings"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  setUndetectable: (state) => ipcRenderer.invoke("set-undetectable", state),
  getUndetectable: () => ipcRenderer.invoke("get-undetectable"),
  setOverlayMousePassthrough: (enabled) => ipcRenderer.invoke("set-overlay-mouse-passthrough", enabled),
  toggleOverlayMousePassthrough: () => ipcRenderer.invoke("toggle-overlay-mouse-passthrough"),
  getOverlayMousePassthrough: () => ipcRenderer.invoke("get-overlay-mouse-passthrough"),
  setOpenAtLogin: (open) => ipcRenderer.invoke("set-open-at-login", open),
  getOpenAtLogin: () => ipcRenderer.invoke("get-open-at-login"),
  getPermissionStatus: () => ipcRenderer.invoke("get-permission-status"),
  openPrivacySettings: (type) => ipcRenderer.invoke("open-privacy-settings", type),

  onSettingsVisibilityChange: (callback) => on("settings-visibility-changed", callback),

  onToggleExpand: (callback) => on("toggle-expand", callback),
  selectServiceAccount: () => ipcRenderer.invoke("select-service-account"),
  getStoredCredentials: () => ipcRenderer.invoke("get-stored-credentials"),
  testTranscriptTranslation: (draft) => ipcRenderer.invoke("test-transcript-translation", draft),
  getTranscriptTranslationSettings: () => ipcRenderer.invoke("get-transcript-translation-settings"),
  setTranscriptCorrectionSettings: (settings) => ipcRenderer.invoke("set-transcript-correction-settings", settings),
  setTranscriptTranslationSettings: (settings) =>
    ipcRenderer.invoke("set-transcript-translation-settings", settings),
  agentGateGetSettings: () => ipcRenderer.invoke("agent-gate-get-settings"),
  agentGateSetSettings: (settings) => ipcRenderer.invoke("agent-gate-set-settings", settings),
  agentGateStatus: () => ipcRenderer.invoke("agent-gate-status"),
  agentGateLog: () => ipcRenderer.invoke("agent-gate-log"),
  onAgentProactive: (callback) => on("agent-proactive", callback),
  agentApprovalsList: () => ipcRenderer.invoke("agent-approvals-list"),
  agentApprovalRespond: (payload) => ipcRenderer.invoke("agent-approval-respond", payload),
  onAgentApproval: (callback) => on("agent-approval", callback),
  agentWorkspaceGet: () => ipcRenderer.invoke("agent-workspace-get"),
  agentWorkspacePick: () => ipcRenderer.invoke("agent-workspace-pick"),
  agentWorkspaceClear: () => ipcRenderer.invoke("agent-workspace-clear"),
  aiConnectionsList: () => ipcRenderer.invoke("ai-connections-list"),
  aiConnectionSave: (input) => ipcRenderer.invoke("ai-connection-save", input),
  aiConnectionDelete: (id) => ipcRenderer.invoke("ai-connection-delete", id),
  aiConnectionModels: (input) => ipcRenderer.invoke("ai-connection-models", input),
  agentTest: (draft) => ipcRenderer.invoke("agent-test", draft),
  modelTest: (draft) => ipcRenderer.invoke("model-test", draft),

  embeddingUseGet: () => ipcRenderer.invoke("embedding-use-get"),
  embeddingUseSet: (use) => ipcRenderer.invoke("embedding-use-set", use),
  embeddingStatus: () => ipcRenderer.invoke("embedding-status"),
  agentGateTest: (draft) => ipcRenderer.invoke("agent-gate-test", draft),
  agentModelGet: () => ipcRenderer.invoke("agent-model-get"),
  agentModelSet: (use) => ipcRenderer.invoke("agent-model-set", use),
  chatModelGet: () => ipcRenderer.invoke("chat-model-get"),
  chatModelSet: (use) => ipcRenderer.invoke("chat-model-set", use),
  summaryModelGet: () => ipcRenderer.invoke("summary-model-get"),
  summaryModelSet: (use) => ipcRenderer.invoke("summary-model-set", use),
  translateTranscriptSegment: (segment) =>
    ipcRenderer.invoke("translate-transcript-segment", segment),

  // STT Provider Management
  setSttProvider: (provider) => ipcRenderer.invoke("set-stt-provider", provider),
  getSttProvider: () => ipcRenderer.invoke("get-stt-provider"),
  getTranscriptAssemblerProfile: () => ipcRenderer.invoke("get-transcript-assembler-profile"),
  setTranscriptAssemblerProfile: (profile) => ipcRenderer.invoke("set-transcript-assembler-profile", profile),
  setGroqSttApiKey: (apiKey) => ipcRenderer.invoke("set-groq-stt-api-key", apiKey),
  setOpenAiSttApiKey: (apiKey) => ipcRenderer.invoke("set-openai-stt-api-key", apiKey),
  setDeepgramApiKey: (apiKey) => ipcRenderer.invoke("set-deepgram-api-key", apiKey),
  setElevenLabsApiKey: (apiKey) => ipcRenderer.invoke("set-elevenlabs-api-key", apiKey),
  setFishAudioApiKey: (apiKey) => ipcRenderer.invoke("set-fish-audio-api-key", apiKey),
  interpretingGetSettings: () => ipcRenderer.invoke("interpreting:get-settings"),
  interpretingSetSettings: (settings) => ipcRenderer.invoke("interpreting:set-settings", settings),
  interpretingGetState: () => ipcRenderer.invoke("interpreting:get-state"),
  interpretingToggleTalk: () => ipcRenderer.invoke("interpreting:toggle-talk"),
  interpretingPlayed: (ack) => ipcRenderer.invoke("interpreting:played", ack),
  interpretingTestVoice: () => ipcRenderer.invoke("interpreting:test-voice"),
  interpretingCloneVoice: (provider, sample) => ipcRenderer.invoke("interpreting:clone-voice", { provider, sample }),
  interpretingPreviewVoice: (provider) => ipcRenderer.invoke("interpreting:preview-voice", { provider }),
  interpretingDeleteVoice: (provider) => ipcRenderer.invoke("interpreting:delete-voice", { provider }),
  onInterpretingStateChanged: (callback) => on('interpreting-state-changed', callback),
  onInterpretingAudio: (callback) => on('interpreting-audio', callback),
  onInterpretingStop: (callback) => on('interpreting-stop', callback),
  setAzureApiKey: (apiKey) => ipcRenderer.invoke("set-azure-api-key", apiKey),
  setAzureRegion: (region) => ipcRenderer.invoke("set-azure-region", region),
  setIbmWatsonApiKey: (apiKey) => ipcRenderer.invoke("set-ibmwatson-api-key", apiKey),
  setGroqSttModel: (model) => ipcRenderer.invoke("set-groq-stt-model", model),
  setSttModel: (provider, model) => ipcRenderer.invoke("set-stt-model", provider, model),
  fetchSttModels: (provider, apiKey) => ipcRenderer.invoke("fetch-stt-models", provider, apiKey),
  setSonioxApiKey: (apiKey) => ipcRenderer.invoke("set-soniox-api-key", apiKey),
  setGeminiApiKey: (apiKey) => ipcRenderer.invoke("set-gemini-api-key", apiKey),
  testSttConnection: (provider, apiKey, region) => ipcRenderer.invoke("test-stt-connection", provider, apiKey, region),

  // Native Audio Service Events
  onNativeAudioTranscript: (callback) => on("native-audio-transcript", callback),
  onNativeAudioSuggestion: (callback) => on("native-audio-suggestion", callback),
  onNativeAudioConnected: (callback) => on("native-audio-connected", callback),
  onNativeAudioDisconnected: (callback) => on("native-audio-disconnected", callback),
  onSuggestionGenerated: (callback) => on("suggestion-generated", callback),
  onSuggestionProcessingStart: (callback) => on("suggestion-processing-start", callback),
  onSuggestionError: (callback) => on("suggestion-error", callback),
  generateSuggestion: (context, lastQuestion) =>
    ipcRenderer.invoke("generate-suggestion", context, lastQuestion),

  getNativeAudioStatus: () => ipcRenderer.invoke("native-audio-status"),
  getInputDevices: () => ipcRenderer.invoke("get-input-devices"),
  getOutputDevices: () => ipcRenderer.invoke("get-output-devices"),
  setRecognitionLanguage: (key, speaker) => ipcRenderer.invoke("set-recognition-language", key, speaker),
  getAiResponseLanguages: () => ipcRenderer.invoke("get-ai-response-languages"),
  setAiResponseLanguage: (language) => ipcRenderer.invoke("set-ai-response-language", language),
  getSttLanguage: (speaker) => ipcRenderer.invoke("get-stt-language", speaker),
  getAiResponseLanguage: () => ipcRenderer.invoke("get-ai-response-language"),
  getAnswerStyle: () => ipcRenderer.invoke("get-answer-style"),
  getPrompts: () => ipcRenderer.invoke("prompts:get"),
  setPrompts: (edit) => ipcRenderer.invoke("prompts:set", edit),
  getScenario: () => ipcRenderer.invoke("scenario:get"),
  setScenario: (edit) => ipcRenderer.invoke("scenario:set", edit),
  getAnswerSources: () => ipcRenderer.invoke("answer-sources:get"),
  setAnswerSources: (sources) => ipcRenderer.invoke("answer-sources:set", sources),
  profileGetNotes: () => ipcRenderer.invoke("profile:get-notes"),
  profileGetStatus: () => ipcRenderer.invoke("profile:get-status"),
  profileSetNotes: (text) => ipcRenderer.invoke("profile:set-notes", text),
  setAnswerStyle: (style) => ipcRenderer.invoke("set-answer-style", style),

  // Intelligence Mode IPC
  generateAssist: () => ipcRenderer.invoke("generate-assist"),
  generateAsk: () => ipcRenderer.invoke("generate-ask"),
  generateFollowUp: (intent, userRequest) => ipcRenderer.invoke("generate-follow-up", intent, userRequest),
  generateCatchUp: () => ipcRenderer.invoke("generate-catch-up"),
  submitManualQuestion: (question) => ipcRenderer.invoke("submit-manual-question", question),
  getIntelligenceContext: () => ipcRenderer.invoke("get-intelligence-context"),
  resetIntelligence: () => ipcRenderer.invoke("reset-intelligence"),

  // Meeting Lifecycle
  startMeeting: (metadata) => ipcRenderer.invoke("start-meeting", metadata),
  endMeeting: () => ipcRenderer.invoke("end-meeting"),
  finalizeMicSTT: () => ipcRenderer.invoke("finalize-mic-stt"),
  getRecentMeetings: () => ipcRenderer.invoke("get-recent-meetings"),
  getMeetingDetails: (id) => ipcRenderer.invoke("get-meeting-details", id),
  updateMeetingTitle: (id, title) => ipcRenderer.invoke("update-meeting-title", { id, title }),
  updateMeetingSummary: (id, updates) => ipcRenderer.invoke("update-meeting-summary", { id, updates }),
  deleteMeeting: (id) => ipcRenderer.invoke("delete-meeting", id),

  onMeetingsUpdated: (callback) => on("meetings-updated", callback),

  // Window Mode
  setWindowMode: (mode, inactive) => ipcRenderer.invoke("set-window-mode", mode, inactive),

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback) => on("intelligence-assist-update", callback),
  onIntelligenceRefinedAnswerToken: (callback) => on("intelligence-refined-answer-token", callback),
  onIntelligenceRefinedAnswer: (callback) => on("intelligence-refined-answer", callback),
  onIntelligenceCatchUpToken: (callback) => on("intelligence-catch-up-token", callback),
  onIntelligenceCatchUp: (callback) => on("intelligence-catch-up", callback),
  onIntelligenceAskToken: (callback) => on("intelligence-ask-token", callback),
  onIntelligenceAsk: (callback) => on("intelligence-ask", callback),
  onIntelligenceManualStarted: (callback) => on("intelligence-manual-started", callback),
  onIntelligenceManualResult: (callback) => on("intelligence-manual-result", callback),
  onIntelligenceModeChanged: (callback) => on("intelligence-mode-changed", callback),
  onIntelligenceError: (callback) => on("intelligence-error", callback),
  onSessionReset: (callback) => on("session-reset", callback),


  // Streaming Chat
  streamGeminiChat: (message, imagePaths, context, options) => ipcRenderer.invoke("gemini-chat-stream", message, imagePaths, context, options),
  cancelGeneration: () => ipcRenderer.invoke('cancel-generation'),

  onGeminiStreamToken: (callback) => on("gemini-stream-token", callback),

  onGeminiStreamDone: (callback) => on("gemini-stream-done", callback),

  onGeminiStreamError: (callback) => on("gemini-stream-error", callback),

  // Model Management
  toggleModelSelector: (coords) => ipcRenderer.invoke('toggle-model-selector', coords),

  // Settings Window
  toggleSettingsWindow: (coords) => ipcRenderer.invoke('toggle-settings-window', coords),
  openSettingsSection: (section) => ipcRenderer.invoke('open-settings-section', section),
  onOpenSettingsSection: (callback) => on('open-settings-section', callback),

  // Demo
  seedDemo: () => ipcRenderer.invoke('seed-demo'),

  // Follow-up Email

  // Audio Test
  startAudioTest: (deviceId) => ipcRenderer.invoke('start-audio-test', deviceId),
  stopAudioTest: () => ipcRenderer.invoke('stop-audio-test'),
  onAudioTestLevel: (callback) => on('audio-test-level', callback),

  // Database
  flushDatabase: () => ipcRenderer.invoke('flush-database'),



  getMicrophoneMuted: () => ipcRenderer.invoke('get-microphone-muted'),
  setMicrophoneMuted: (muted) => ipcRenderer.invoke('set-microphone-muted', muted),
  onMicrophoneMutedChanged: (callback) => on('microphone-muted-changed', callback),

  onUndetectableChanged: (callback) => on('undetectable-changed', callback),

  onOverlayMousePassthroughChanged: (callback) => on('overlay-mouse-passthrough-changed', callback),

  onModelChanged: (callback) => on('model-changed', callback),

  onOllamaPullProgress: (callback) => on('ollama:pull-progress', callback),

  onOllamaPullComplete: (callback) => on('ollama:pull-complete', callback),

  // Theme API
  getThemeMode: () => ipcRenderer.invoke('theme:get-mode'),
  setThemeMode: (mode) => ipcRenderer.invoke('theme:set-mode', mode),
  onThemeChanged: (callback) => on('theme:changed', callback),

  // Auto-Update
  onUpdateAvailable: (callback) => on("update-available", callback),
  onUpdateDownloaded: (callback) => on("update-downloaded", callback),
  onUpdateChecking: (callback) => on("update-checking", callback),
  onUpdateNotAvailable: (callback) => on("update-not-available", callback),
  onUpdateError: (callback) => on("update-error", callback),
  onDownloadProgress: (callback) => on("download-progress", callback),
  restartAndInstall: () => ipcRenderer.invoke("quit-and-install-update"),
  getUpdateState: () => ipcRenderer.invoke("get-update-state"),
  setAutoCheckUpdates: (enabled) => ipcRenderer.invoke("set-auto-check-updates", enabled),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  testReleaseFetch: () => ipcRenderer.invoke("test-release-fetch"),

  // RAG API
  ragQueryMeeting: (meetingId, query) => ipcRenderer.invoke('rag:query-meeting', { meetingId, query }),
  ragQueryLive: (query) => ipcRenderer.invoke('rag:query-live', { query }),
  ragQueryGlobal: (query) => ipcRenderer.invoke('rag:query-global', { query }),
  ragCancelQuery: (options) => ipcRenderer.invoke('rag:cancel-query', options),
  ragIsMeetingProcessed: (meetingId) => ipcRenderer.invoke('rag:is-meeting-processed', meetingId),
  ragGetQueueStatus: () => ipcRenderer.invoke('rag:get-queue-status'),
  ragRetryEmbeddings: () => ipcRenderer.invoke('rag:retry-embeddings'),
  
  onIncompatibleProviderWarning: (callback) => on('embedding:incompatible-provider-warning', callback),
  reindexIncompatibleMeetings: () => ipcRenderer.invoke('rag:reindex-incompatible-meetings'),
  reindexAllMeetings: () => ipcRenderer.invoke('rag:reindex-all'),

  onRAGStreamChunk: (callback) => on('rag:stream-chunk', callback),
  onRAGStreamComplete: (callback) => on('rag:stream-complete', callback),
  onRAGStreamError: (callback) => on('rag:stream-error', callback),

  // Chat Streaming API
  chatStreamMeeting: (params) =>
    ipcRenderer.invoke('chat:stream-meeting', params),
  chatCancelStream: (requestId) =>
    ipcRenderer.invoke('chat:cancel-stream', { requestId }),
  onChatStreamChunk: (callback) => on('chat:stream-chunk', callback),
  onChatStreamComplete: (callback) => on('chat:stream-complete', callback),
  onChatStreamError: (callback) => on('chat:stream-error', callback),

  // Keybind Management
  getKeybinds: () => ipcRenderer.invoke('keybinds:get-all'),
  setKeybind: (id, accelerator) => ipcRenderer.invoke('keybinds:set', id, accelerator),
  resetKeybinds: () => ipcRenderer.invoke('keybinds:reset'),
  onKeybindsUpdate: (callback) => on('keybinds:update', callback),

  // Global shortcut listener — fired stealthily from main process without focusing the window
  onGlobalShortcut: (callback) => on('global-shortcut', callback),

  // Donation API
  getDonationStatus: () => ipcRenderer.invoke("get-donation-status"),
  markDonationToastShown: () => ipcRenderer.invoke("mark-donation-toast-shown"),
  setDonationComplete: () => ipcRenderer.invoke('set-donation-complete'),

  // Imported documents
  knowledgeListDocuments: () => ipcRenderer.invoke('knowledge:list-documents'),
  knowledgeImportDocument: () => ipcRenderer.invoke('knowledge:import-document'),
  knowledgeRemoveDocument: (id) => ipcRenderer.invoke('knowledge:remove-document', id),
  knowledgeReindexDocument: (id) => ipcRenderer.invoke('knowledge:reindex-document', id),
  // License Management
  licenseActivate: (key) => ipcRenderer.invoke('license:activate', key),
  licenseCheckPremium: () => ipcRenderer.invoke('license:check-premium'),
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
  licenseGetHardwareId: () => ipcRenderer.invoke('license:get-hardware-id'),

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity) => ipcRenderer.invoke('set-overlay-opacity', opacity),
  onOverlayOpacityChanged: (callback) => on('overlay-opacity-changed', callback),

  // Verbose / Debug Logging
  getVerboseLogging: () => ipcRenderer.invoke('get-verbose-logging'),
  setVerboseLogging: (enabled) => ipcRenderer.invoke('set-verbose-logging', enabled),
  
  // Arch
  getArch: () => ipcRenderer.invoke('get-arch'),

  // Cropper API
  cropperConfirmed: (bounds) => ipcRenderer.send('cropper-confirmed', bounds),
  cropperCancelled: () => ipcRenderer.send('cropper-cancelled'),
  onResetCropper: (callback) => on('reset-cropper', callback),

  // Agent API
  agentStatus: () => ipcRenderer.invoke('agent-status'),
  agentSubmit: (payload) =>
    ipcRenderer.invoke('agent-submit', payload),
  agentAbort: () => ipcRenderer.invoke('agent-abort'),
  agentGetThread: () => ipcRenderer.invoke('agent-get-thread'),
  onAgentEvent: (callback) => on('agent-event', callback),

  // Platform
  platform: process.platform,
} satisfies ElectronAPI

contextBridge.exposeInMainWorld("electronAPI", api)
