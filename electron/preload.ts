import { contextBridge, ipcRenderer } from "electron"
import type { KeybindStatus, KeybindResult } from './services/KeybindManager'
import type { ImportedDocument, NotesIndexStatus } from './knowledge/types'
import type { CredentialStorageStatus } from './services/CredentialsManager'

type PreloadAgentEvent = { meetingId: string } & (
  | { type: 'run_started' | 'run_settled' }
  | { type: 'text_delta' | 'text_final'; text: string }
  | { type: 'tool_started' | 'tool_finished'; toolName: string }
  | { type: 'run_failed'; errorClass: string }
);

type PreloadThreadLine = { id: string; role: 'user' | 'assistant' | 'tool'; text: string };

// Types for the exposed Electron API
type AiConnectionType = 'openai' | 'anthropic' | 'gemini'
type HeaderEdit = { op: 'keep' | 'remove'; name: string } | { op: 'set'; name: string; value: string }
type HeaderState = { name: string; set: true }
interface AiConnectionView { id: string; name: string; type: AiConnectionType; baseUrl: string; customBaseUrl: boolean; hasApiKey: boolean; headers?: HeaderState[]; builtin: boolean }
interface AgentApprovalRequest { id: string; meetingId: string; tool: 'bash' | 'write' | 'edit' | 'read'; target: string; detail?: string; folder: string; outside?: boolean }
type AgentApprovalEvent = { type: 'requested'; request: AgentApprovalRequest } | { type: 'settled'; id: string; allowed: boolean }
interface AgentProactiveCard { id: string; meetingId: string; segmentId: string; kind: string; text: string; time: number }
interface AgentGateDecision {
  time: number; meetingId: string; segmentId: string; revision: number; model: string; threshold: number; cooldownSeconds: number
  help?: number; kind?: string; kindProbability?: number; latencyMs?: number; outcome: string
}
interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  getRecognitionLanguages: () => Promise<Record<string, any>>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onScreenshotAttached: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void

  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  takeScreenshot: () => Promise<void>
  takeSelectiveScreenshot: () => Promise<{ path: string; preview: string; cancelled?: boolean }>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>

  analyzeImageFile: (path: string) => Promise<void>
  quitApp: () => Promise<void>
  selectServiceAccount: () => Promise<{ success: boolean; path?: string; cancelled?: boolean; error?: string }>
  getStoredCredentials: () => Promise<{ storage: CredentialStorageStatus; connectionHeaders?: Record<string, HeaderState[]>; hasGeminiKey: boolean; hasGroqKey: boolean; hasOpenaiKey: boolean; hasClaudeKey: boolean; googleServiceAccountPath: string | null; sttProvider: string; hasSttGroqKey: boolean; hasSttOpenaiKey: boolean; hasDeepgramKey: boolean; hasElevenLabsKey: boolean; hasAzureKey: boolean; azureRegion: string; hasIbmWatsonKey: boolean; ibmWatsonRegion: string; hasSonioxKey: boolean }>
  testTranscriptTranslation: (draft: { provider: string; model: string; prompt?: string; targetLanguage: string }) => Promise<{ success: boolean; sample: string; translatedText?: string; firstTokenMs?: number; totalMs?: number; error?: string }>
  getTranscriptTranslationSettings: () => Promise<{ enabled: boolean; provider: string; model: string; prompt: string; displayMode: 'original' | 'translated' | 'both' }>
  setTranscriptTranslationSettings: (settings: { enabled?: boolean; provider?: string; model?: string; prompt?: string; displayMode?: 'original' | 'translated' | 'both' }) => Promise<{ success: boolean; error?: string }>
  agentGateGetSettings: () => Promise<{ mode: 'log' | 'on' | 'off'; model: string; baseUrl: string; hasApiKey: boolean; threshold: number; cooldownSeconds: number }>
  agentGateSetSettings: (settings: { mode?: 'log' | 'on' | 'off'; model?: string; baseUrl?: string; apiKey?: string; threshold?: number; cooldownSeconds?: number }) => Promise<{ success: boolean; error?: string }>
  agentGateStatus: () => Promise<{ mode: 'log' | 'on' | 'off'; configured: boolean; state: 'ok' | 'unavailable' | 'unconfigured'; reason?: string; lastDecision?: AgentGateDecision }>
  agentGateLog: () => Promise<AgentGateDecision[]>
  onAgentProactive: (callback: (card: AgentProactiveCard) => void) => () => void
  agentApprovalsList: () => Promise<AgentApprovalRequest[]>
  agentApprovalRespond: (payload: { id: string; allowed: boolean }) => Promise<{ success: boolean }>
  onAgentApproval: (callback: (event: AgentApprovalEvent) => void) => () => void
  agentWorkspaceGet: () => Promise<{ root: string; error?: string }>
  agentWorkspacePick: () => Promise<{ canceled: boolean; root?: string; error?: string }>
  agentWorkspaceClear: () => Promise<{ success: boolean }>
  aiConnectionsList: () => Promise<AiConnectionView[]>
  aiConnectionSave: (input: { id?: string; name?: string; type?: AiConnectionType; baseUrl?: string; apiKey?: string; headerEdits?: HeaderEdit[] }) => Promise<{ success: boolean; id?: string; error?: string }>
  aiConnectionDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  aiConnectionModels: (input: { id?: string; type?: AiConnectionType; baseUrl?: string; apiKey?: string; headerEdits?: HeaderEdit[] }) => Promise<{ success: boolean; models?: Array<{ id: string; label: string }>; error?: string }>
  agentTest: (draft: { connectionId: string; model: string; supportsImages?: boolean }) => Promise<{ success: boolean; reply?: string; toolCalls?: boolean | null; totalMs?: number; error?: string }>
  modelTest: (draft: { job: 'chat' | 'summary'; connectionId: string; model: string }) => Promise<{ success: boolean; reply?: string; firstTokenMs?: number; totalMs?: number; error?: string }>

  embeddingUseGet: () => Promise<{ connectionId: string; model: string }>
  embeddingUseSet: (use: { connectionId: string; model: string }) => Promise<{ success: boolean; error?: string }>
  embeddingStatus: () => Promise<{ providerName: string | null; dimensions: number | null; usingSelected: boolean; selectedLabel: string | null; incompatible: number; meetingCount: number; failedMeetings: number; firstError: string | null }>
  reindexIncompatibleMeetings: () => Promise<{ success: boolean; error?: string }>
  reindexAllMeetings: () => Promise<{ success: boolean; error?: string }>
  agentGateTest: (draft: { model?: string; baseUrl?: string; apiKey?: string }) => Promise<{ success: boolean; help?: number; kind?: string; latencyMs?: number; error?: string }>
  agentModelGet: () => Promise<{ connectionId: string; model: string; supportsImages: boolean }>
  agentModelSet: (use: { connectionId: string; model: string; supportsImages?: boolean }) => Promise<{ success: boolean; error?: string }>
  chatModelGet: () => Promise<{ connectionId: string; model: string }>
  chatModelSet: (use: { connectionId: string; model: string }) => Promise<{ success: boolean; error?: string }>
  summaryModelGet: () => Promise<{ connectionId: string; model: string }>
  summaryModelSet: (use: { connectionId: string; model: string }) => Promise<{ success: boolean; error?: string }>
  translateTranscriptSegment: (segment: { segmentId: string; text: string; speaker?: 'interviewer' | 'user'; speakerLabel?: string; timestamp?: number }) => Promise<{ success: boolean; error?: string }>

  // STT Provider Management
  setSttProvider: (provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox') => Promise<{ success: boolean; error?: string }>
  getSttProvider: () => Promise<string>
  getTranscriptAssemblerProfile: () => Promise<'sentence_bias' | 'low_latency' | 'coherent'>
  setTranscriptAssemblerProfile: (profile: 'sentence_bias' | 'low_latency' | 'coherent') => Promise<{ success: boolean; error?: string }>
  setGroqSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenAiSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setDeepgramApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setElevenLabsApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setAzureApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setAzureRegion: (region: string) => Promise<{ success: boolean; error?: string }>
  setIbmWatsonApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setGroqSttModel: (model: string) => Promise<{ success: boolean; error?: string }>
  setSttModel: (provider: string, model: string) => Promise<{ success: boolean; error?: string }>
  fetchSttModels: (provider: string, apiKey?: string) => Promise<{ success: boolean; models?: Array<{ id: string; label: string }>; error?: string }>
  setSonioxApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey: string, region?: string) => Promise<{ success: boolean; error?: string }>

  // Native Audio Service Events
  onNativeAudioTranscript: (callback: (transcript: { speaker: string; text: string; final: boolean; timestamp?: number; confidence?: number; segmentId?: string; sourceText?: string; translatedText?: string; translationState?: 'pending' | 'complete' | 'error' | 'skipped'; displayMode?: 'original' | 'translated' | 'both'; speakerLabel?: string }) => void) => () => void
  onNativeAudioSuggestion: (callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void) => () => void
  onNativeAudioConnected: (callback: () => void) => () => void
  onNativeAudioDisconnected: (callback: () => void) => () => void
  onSuggestionGenerated: (callback: (data: { question: string; suggestion: string; confidence: number }) => void) => () => void
  onSuggestionProcessingStart: (callback: () => void) => () => void
  onSuggestionError: (callback: (error: { error: string }) => void) => () => void
  generateSuggestion: (context: string, lastQuestion: string) => Promise<{ suggestion: string }>
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>
  setRecognitionLanguage: (key: string, speaker?: 'interviewer' | 'user') => Promise<{ success: boolean; error?: string }>
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>
  setAiResponseLanguage: (language: string) => Promise<{ success: boolean; error?: string }>
  getSttLanguage: (speaker?: 'interviewer' | 'user') => Promise<string>
  getAiResponseLanguage: () => Promise<string>
  getAnswerStyle: () => Promise<string>
  getAnswerSources: () => Promise<{ meetings: boolean; materials: boolean; profile: boolean }>
  setAnswerSources: (sources: { meetings?: boolean; materials?: boolean; profile?: boolean }) => Promise<{ success: boolean; error?: string }>
  profileGetNotes: () => Promise<string>
  profileSetNotes: (text: string) => Promise<{ success: boolean; error?: string }>
  setAnswerStyle: (style: string) => Promise<{ success: boolean; error?: string }>
  getNativeAudioStatus: () => Promise<{
    connected: boolean;
    meetingActive: boolean;
    hasRecentSystemAudioChunk: boolean;
    hasRecentInterviewerTranscript: boolean;
    lastSystemAudioChunkAt: number | null;
    lastInterviewerTranscriptAt: number | null;
    lastError: string | null;
  }>

  // Intelligence Mode IPC
  generateAssist: () => Promise<{ insight: string | null }>
  generateWhatToSay: (question?: string, imagePaths?: string[]) => Promise<{ answer: string | null; question?: string; error?: string }>
  generateFollowUp: (intent: string, userRequest?: string) => Promise<{ refined: string | null; intent: string }>
  generateRecap: () => Promise<{ summary: string | null }>
  submitManualQuestion: (question: string) => Promise<{ answer: string | null; question: string }>
  getIntelligenceContext: () => Promise<{ context: string; lastAssistantMessage: string | null; activeMode: string }>
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>
  endMeeting: () => Promise<{ success: boolean; error?: string }>
  finalizeMicSTT: () => Promise<void>
  getRecentMeetings: () => Promise<Array<{ id: string; title: string; date: string; duration: string; summary: string }>>
  getMeetingDetails: (id: string) => Promise<any>
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>
  updateMeetingSummary: (id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }) => Promise<boolean>
  onMeetingsUpdated: (callback: () => void) => () => void

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number }) => void) => () => void
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => () => void
  onKnowledgeContextUpdate: (callback: (data: { matchedJDSignals: any[]; resumeEvidence: any[]; mustHitKeywords: string[]; questionCategory: string }) => void) => () => void
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceManualStarted: (callback: () => void) => () => void
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => () => void
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void
  onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => () => void

  // Model Management
  toggleModelSelector: (coords: { x: number; y: number }) => Promise<void>

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>
  // Opens the full settings, on one tab (for example 'audio'), from any window
  openSettingsSection: (section: string) => Promise<{ success: boolean }>
  onOpenSettingsSection: (callback: (data: { section: string }) => void) => () => void

  // Demo
  seedDemo: () => Promise<{ success: boolean }>

  // Follow-up Email

  // Audio Test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>
  stopAudioTest: () => Promise<{ success: boolean }>
  onAudioTestLevel: (callback: (level: number) => void) => () => void

  // Database
  flushDatabase: () => Promise<{ success: boolean }>
  showWindow: () => Promise<void>
  hideWindow: () => Promise<void>
  showOverlay: () => Promise<void>
  hideOverlay: () => Promise<void>
  getMeetingActive: () => Promise<boolean>
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => () => void
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
  onEnsureExpanded: (callback: () => void) => () => void
  onToggleExpand: (callback: () => void) => () => void
  toggleAdvancedSettings: () => Promise<void>
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>
  getOverlayMousePassthrough: () => Promise<boolean>
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void

  // Streaming listeners
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean; ragMiss?: boolean }) => Promise<void>
  cancelGeneration: () => Promise<{ success: boolean }>
  onGeminiStreamToken: (callback: (token: string) => void) => () => void
  onGeminiStreamDone: (callback: () => void) => () => void
  onGeminiStreamError: (callback: (error: string) => void) => () => void


  onUndetectableChanged: (callback: (state: boolean) => void) => () => void
  getMicrophoneMuted: () => Promise<boolean>
  setMicrophoneMuted: (muted: boolean) => Promise<{ success: boolean }>
  onMicrophoneMutedChanged: (callback: (muted: boolean) => void) => () => void
  onModelChanged: (callback: (modelId: string) => void) => () => void

  // Ollama
  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => () => void
  onOllamaPullComplete: (callback: () => void) => () => void

  // Theme API
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }>
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => () => void

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void
  onUpdateChecking: (callback: () => void) => () => void
  onUpdateNotAvailable: (callback: (info: any) => void) => () => void
  onUpdateError: (callback: (err: string) => void) => () => void
  onDownloadProgress: (callback: (progressObj: any) => void) => () => void
  restartAndInstall: () => Promise<void>
  getUpdateState: () => Promise<{ autoCheck: boolean; checking: boolean; lastCheckedAt: number | null; availableVersion: string | null; downloadedVersion: string | null }>
  setAutoCheckUpdates: (enabled: boolean) => Promise<{ success: boolean }>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  testReleaseFetch: () => Promise<{ success: boolean; error?: string }>

  // RAG (Retrieval-Augmented Generation) API
  ragQueryMeeting: (meetingId: string, query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryLive: (query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryGlobal: (query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) => Promise<{ success: boolean }>
  ragIsMeetingProcessed: (meetingId: string) => Promise<boolean>
  ragGetQueueStatus: () => Promise<{ pending: number; processing: number; completed: number; failed: number }>
  ragRetryEmbeddings: () => Promise<{ success: boolean; error?: string }>
  onRAGStreamChunk: (callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void) => () => void
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean }) => void) => () => void
  onRAGStreamError: (callback: (data: { meetingId?: string; global?: boolean; error: string }) => void) => () => void

  // Chat Streaming API
  chatStreamMeeting: (params: { requestId: string; meetingId: string; messages: Array<{ role: string; content: string }>; context?: string }) => Promise<{ success?: boolean; error?: string }>
  chatCancelStream: (requestId: string) => Promise<{ success: boolean }>
  onChatStreamChunk: (callback: (data: { requestId: string; chunk: string }) => void) => () => void
  onChatStreamComplete: (callback: (data: { requestId: string }) => void) => () => void
  onChatStreamError: (callback: (data: { requestId: string; error: string }) => void) => () => void

  // Keybind Management
  getKeybinds: () => Promise<KeybindStatus[]>
  setKeybind: (id: string, accelerator: string) => Promise<KeybindResult>
  resetKeybinds: () => Promise<KeybindStatus[]>
  onKeybindsUpdate: (callback: (keybinds: KeybindStatus[]) => void) => () => void

  // Global shortcut events (stealth: fired even when window is not focused)
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void

  // Donation API
  getDonationStatus: () => Promise<{ shouldShow: boolean; hasDonated: boolean; lifetimeShows: number }>;
  markDonationToastShown: () => Promise<{ success: boolean }>;
  setDonationComplete: () => Promise<{ success: boolean }>;

  // Profile Engine API
  profileUploadResume: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  profileGetStatus: () => Promise<{ hasProfile: boolean; profileMode: boolean; name?: string; role?: string; totalExperienceYears?: number; notesIndex?: NotesIndexStatus | null }>;
  profileSetMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  profileDelete: () => Promise<{ success: boolean; error?: string }>;
  profileGetProfile: () => Promise<any>;
  profileSelectFile: () => Promise<{ success?: boolean; cancelled?: boolean; filePath?: string; error?: string }>;

  // JD & Research API
  profileUploadJD: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  profileDeleteJD: () => Promise<{ success: boolean; error?: string }>;

  // Multi-JD Management
  knowledgeGetAllJDs: () => Promise<any[]>;
  knowledgeSetActiveJD: (docId: number) => Promise<{ success: boolean; error?: string }>;
  knowledgeDeleteJD: (docId: number) => Promise<{ success: boolean; error?: string }>;
  knowledgeUploadJD: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  knowledgeUpdateProfile: (updates: any) => Promise<{ success: boolean; error?: string }>;
  knowledgeGeneratePrep: (jdId?: number) => Promise<{ success: boolean; data?: any; error?: string }>;
  knowledgeListDocuments: () => Promise<{ success: true; documents: ImportedDocument[] } | { success: false; error: string }>;
  knowledgeImportDocument: () => Promise<{ cancelled: true } | { success: true; document: ImportedDocument } | { success: false; error: string }>;
  knowledgeRemoveDocument: (id: number) => Promise<{ success: boolean; error?: string }>;
  knowledgeReindexDocument: (id: number) => Promise<{ success: boolean; error?: string }>;
  profileResearchCompany: (companyName: string) => Promise<{ success: boolean; dossier?: any; error?: string }>;
  profileGenerateNegotiation: (force?: boolean) => Promise<{ success: boolean; script?: any; error?: string }>;
  profileGetNegotiationState: () => Promise<{ success: boolean; state?: any; isActive?: boolean; error?: string }>;
  profileResetNegotiation: () => Promise<{ success: boolean; error?: string }>;

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Verbose / Debug Logging
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  
  // Arch
  getArch: () => Promise<string>;

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => void;
  cropperCancelled: () => void;
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => () => void;

  // Agent API
  agentStatus: () => Promise<{ meetingActive: boolean; available: boolean; reason?: string }>;
  agentSubmit: (payload: { text: string; mode?: 'followup' | 'steer'; requestId?: string }) => Promise<{ ok: true; requestId: string } | { ok: false; reason: string }>;
  agentAbort: () => Promise<{ success: boolean }>;
  agentGetThread: () => Promise<PreloadThreadLine[]>;
  onAgentEvent: (callback: (event: PreloadAgentEvent) => void) => () => void;

  // Platform
  platform: NodeJS.Platform;
}

export const PROCESSING_EVENTS = {
  //global states
  UNAUTHORIZED: "procesing-unauthorized",
  NO_SCREENSHOTS: "processing-no-screenshots",

  //states for generating the initial solution
  INITIAL_START: "initial-start",
  PROBLEM_EXTRACTED: "problem-extracted",
  SOLUTION_SUCCESS: "solution-success",
  INITIAL_SOLUTION_ERROR: "solution-error",

  //states for processing the debugging
  DEBUG_START: "debug-start",
  DEBUG_SUCCESS: "debug-success",
  DEBUG_ERROR: "debug-error"
} as const

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  getRecognitionLanguages: () => ipcRenderer.invoke("get-recognition-languages"),
  takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
  takeSelectiveScreenshot: () => ipcRenderer.invoke("take-selective-screenshot"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path: string) =>
    ipcRenderer.invoke("delete-screenshot", path),

  // Event listeners
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-taken", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription)
    }
  },
  onScreenshotAttached: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-attached", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-attached", subscription)
    }
  },
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("capture-and-process", subscription)
    return () => {
      ipcRenderer.removeListener("capture-and-process", subscription)
    }
  },
  onSolutionsReady: (callback: (solutions: string) => void) => {
    const subscription = (_: any, solutions: string) => callback(solutions)
    ipcRenderer.on("solutions-ready", subscription)
    return () => {
      ipcRenderer.removeListener("solutions-ready", subscription)
    }
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription)
    }
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription)
    }
  },

  onDebugSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("debug-success", subscription)
    return () => {
      ipcRenderer.removeListener("debug-success", subscription)
    }
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    }
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        subscription
      )
    }
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    }
  },

  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        subscription
      )
    }
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.SOLUTION_SUCCESS,
        subscription
      )
    }
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    }
  },
  moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
  moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
  moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
  moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),

  analyzeImageFile: (path: string) => ipcRenderer.invoke("analyze-image-file", path),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  toggleWindow: () => ipcRenderer.invoke("toggle-window"),
  showWindow: (inactive?: boolean) => ipcRenderer.invoke("show-window", inactive),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showOverlay: () => ipcRenderer.invoke("show-overlay"),
  hideOverlay: () => ipcRenderer.invoke("hide-overlay"),
  getMeetingActive: () => ipcRenderer.invoke("get-meeting-active"),
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => {
    const subscription = (_: any, data: { isActive: boolean }) => callback(data);
    ipcRenderer.on('meeting-state-changed', subscription);
    return () => { ipcRenderer.removeListener('meeting-state-changed', subscription); };
  },
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const subscription = (_: any, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-maximized-changed', subscription);
    return () => { ipcRenderer.removeListener('window-maximized-changed', subscription); };
  },
  onEnsureExpanded: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('ensure-expanded', subscription);
    return () => { ipcRenderer.removeListener('ensure-expanded', subscription); };
  },
  toggleAdvancedSettings: () => ipcRenderer.invoke("toggle-advanced-settings"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  setUndetectable: (state: boolean) => ipcRenderer.invoke("set-undetectable", state),
  getUndetectable: () => ipcRenderer.invoke("get-undetectable"),
  setOverlayMousePassthrough: (enabled: boolean) => ipcRenderer.invoke("set-overlay-mouse-passthrough", enabled),
  toggleOverlayMousePassthrough: () => ipcRenderer.invoke("toggle-overlay-mouse-passthrough"),
  getOverlayMousePassthrough: () => ipcRenderer.invoke("get-overlay-mouse-passthrough"),
  setOpenAtLogin: (open: boolean) => ipcRenderer.invoke("set-open-at-login", open),
  getOpenAtLogin: () => ipcRenderer.invoke("get-open-at-login"),
  getPermissionStatus: () => ipcRenderer.invoke("get-permission-status"),
  openPrivacySettings: (type: 'microphone' | 'screen') => ipcRenderer.invoke("open-privacy-settings", type),
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') => ipcRenderer.invoke("set-disguise", mode),
  getDisguise: () => ipcRenderer.invoke("get-disguise"),
  onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => {
    const subscription = (_: any, mode: any) => callback(mode)
    ipcRenderer.on('disguise-changed', subscription)
    return () => {
      ipcRenderer.removeListener('disguise-changed', subscription)
    }
  },

  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => {
    const subscription = (_: any, isVisible: boolean) => callback(isVisible)
    ipcRenderer.on("settings-visibility-changed", subscription)
    return () => {
      ipcRenderer.removeListener("settings-visibility-changed", subscription)
    }
  },

  onToggleExpand: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("toggle-expand", subscription)
    return () => {
      ipcRenderer.removeListener("toggle-expand", subscription)
    }
  },
  selectServiceAccount: () => ipcRenderer.invoke("select-service-account"),
  getStoredCredentials: () => ipcRenderer.invoke("get-stored-credentials"),
  testTranscriptTranslation: (draft: { provider: string; model: string; prompt?: string; targetLanguage: string }) => ipcRenderer.invoke("test-transcript-translation", draft),
  getTranscriptTranslationSettings: () => ipcRenderer.invoke("get-transcript-translation-settings"),
  setTranscriptTranslationSettings: (settings: { enabled?: boolean; provider?: string; model?: string; prompt?: string; displayMode?: 'original' | 'translated' | 'both' }) =>
    ipcRenderer.invoke("set-transcript-translation-settings", settings),
  agentGateGetSettings: () => ipcRenderer.invoke("agent-gate-get-settings"),
  agentGateSetSettings: (settings: { mode?: 'log' | 'on' | 'off'; model?: string; baseUrl?: string; apiKey?: string; threshold?: number; cooldownSeconds?: number }) => ipcRenderer.invoke("agent-gate-set-settings", settings),
  agentGateStatus: () => ipcRenderer.invoke("agent-gate-status"),
  agentGateLog: () => ipcRenderer.invoke("agent-gate-log"),
  onAgentProactive: (callback: (card: AgentProactiveCard) => void) => {
    const subscription = (_: unknown, card: AgentProactiveCard) => callback(card)
    ipcRenderer.on("agent-proactive", subscription)
    return () => { ipcRenderer.removeListener("agent-proactive", subscription) }
  },
  agentApprovalsList: () => ipcRenderer.invoke("agent-approvals-list"),
  agentApprovalRespond: (payload: { id: string; allowed: boolean }) => ipcRenderer.invoke("agent-approval-respond", payload),
  onAgentApproval: (callback: (event: AgentApprovalEvent) => void) => {
    const subscription = (_: unknown, event: AgentApprovalEvent) => callback(event)
    ipcRenderer.on("agent-approval", subscription)
    return () => { ipcRenderer.removeListener("agent-approval", subscription) }
  },
  agentWorkspaceGet: () => ipcRenderer.invoke("agent-workspace-get"),
  agentWorkspacePick: () => ipcRenderer.invoke("agent-workspace-pick"),
  agentWorkspaceClear: () => ipcRenderer.invoke("agent-workspace-clear"),
  aiConnectionsList: () => ipcRenderer.invoke("ai-connections-list"),
  aiConnectionSave: (input: { id?: string; name?: string; type?: AiConnectionType; baseUrl?: string; apiKey?: string; headerEdits?: HeaderEdit[] }) => ipcRenderer.invoke("ai-connection-save", input),
  aiConnectionDelete: (id: string) => ipcRenderer.invoke("ai-connection-delete", id),
  aiConnectionModels: (input: { id?: string; type?: AiConnectionType; baseUrl?: string; apiKey?: string; headerEdits?: HeaderEdit[] }) => ipcRenderer.invoke("ai-connection-models", input),
  agentTest: (draft: { connectionId: string; model: string; supportsImages?: boolean }) => ipcRenderer.invoke("agent-test", draft),
  modelTest: (draft: { job: 'chat' | 'summary'; connectionId: string; model: string }) => ipcRenderer.invoke("model-test", draft),

  embeddingUseGet: () => ipcRenderer.invoke("embedding-use-get"),
  embeddingUseSet: (use: { connectionId: string; model: string }) => ipcRenderer.invoke("embedding-use-set", use),
  embeddingStatus: () => ipcRenderer.invoke("embedding-status"),
  agentGateTest: (draft: { model?: string; baseUrl?: string; apiKey?: string }) => ipcRenderer.invoke("agent-gate-test", draft),
  agentModelGet: () => ipcRenderer.invoke("agent-model-get"),
  agentModelSet: (use: { connectionId: string; model: string; supportsImages?: boolean }) => ipcRenderer.invoke("agent-model-set", use),
  chatModelGet: () => ipcRenderer.invoke("chat-model-get"),
  chatModelSet: (use: { connectionId: string; model: string }) => ipcRenderer.invoke("chat-model-set", use),
  summaryModelGet: () => ipcRenderer.invoke("summary-model-get"),
  summaryModelSet: (use: { connectionId: string; model: string }) => ipcRenderer.invoke("summary-model-set", use),
  translateTranscriptSegment: (segment: { segmentId: string; text: string; speaker?: 'interviewer' | 'user'; speakerLabel?: string; timestamp?: number }) =>
    ipcRenderer.invoke("translate-transcript-segment", segment),

  // STT Provider Management
  setSttProvider: (provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox') => ipcRenderer.invoke("set-stt-provider", provider),
  getSttProvider: () => ipcRenderer.invoke("get-stt-provider"),
  getTranscriptAssemblerProfile: () => ipcRenderer.invoke("get-transcript-assembler-profile"),
  setTranscriptAssemblerProfile: (profile: 'sentence_bias' | 'low_latency' | 'coherent') => ipcRenderer.invoke("set-transcript-assembler-profile", profile),
  setGroqSttApiKey: (apiKey: string) => ipcRenderer.invoke("set-groq-stt-api-key", apiKey),
  setOpenAiSttApiKey: (apiKey: string) => ipcRenderer.invoke("set-openai-stt-api-key", apiKey),
  setDeepgramApiKey: (apiKey: string) => ipcRenderer.invoke("set-deepgram-api-key", apiKey),
  setElevenLabsApiKey: (apiKey: string) => ipcRenderer.invoke("set-elevenlabs-api-key", apiKey),
  setAzureApiKey: (apiKey: string) => ipcRenderer.invoke("set-azure-api-key", apiKey),
  setAzureRegion: (region: string) => ipcRenderer.invoke("set-azure-region", region),
  setIbmWatsonApiKey: (apiKey: string) => ipcRenderer.invoke("set-ibmwatson-api-key", apiKey),
  setGroqSttModel: (model: string) => ipcRenderer.invoke("set-groq-stt-model", model),
  setSttModel: (provider: string, model: string) => ipcRenderer.invoke("set-stt-model", provider, model),
  fetchSttModels: (provider: string, apiKey?: string) => ipcRenderer.invoke("fetch-stt-models", provider, apiKey),
  setSonioxApiKey: (apiKey: string) => ipcRenderer.invoke("set-soniox-api-key", apiKey),
  testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey: string, region?: string) => ipcRenderer.invoke("test-stt-connection", provider, apiKey, region),

  // Native Audio Service Events
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
  setRecognitionLanguage: (key: string, speaker?: 'interviewer' | 'user') => ipcRenderer.invoke("set-recognition-language", key, speaker),
  getAiResponseLanguages: () => ipcRenderer.invoke("get-ai-response-languages"),
  setAiResponseLanguage: (language: string) => ipcRenderer.invoke("set-ai-response-language", language),
  getSttLanguage: (speaker?: 'interviewer' | 'user') => ipcRenderer.invoke("get-stt-language", speaker),
  getAiResponseLanguage: () => ipcRenderer.invoke("get-ai-response-language"),
  getAnswerStyle: () => ipcRenderer.invoke("get-answer-style"),
  getAnswerSources: () => ipcRenderer.invoke("answer-sources:get"),
  setAnswerSources: (sources: { meetings?: boolean; materials?: boolean; profile?: boolean }) => ipcRenderer.invoke("answer-sources:set", sources),
  profileGetNotes: () => ipcRenderer.invoke("profile:get-notes"),
  profileSetNotes: (text: string) => ipcRenderer.invoke("profile:set-notes", text),
  setAnswerStyle: (style: string) => ipcRenderer.invoke("set-answer-style", style),

  // Intelligence Mode IPC
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

  // Action Button Mode (Dynamic Recap / Brainstorm toggle)
  getActionButtonMode: () => ipcRenderer.invoke("get-action-button-mode"),
  setActionButtonMode: (mode: 'recap' | 'brainstorm') => ipcRenderer.invoke("set-action-button-mode", mode),
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => {
    const subscription = (_: any, mode: 'recap' | 'brainstorm') => callback(mode);
    ipcRenderer.on('action-button-mode-changed', subscription);
    return () => { ipcRenderer.removeListener('action-button-mode-changed', subscription); };
  },

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => ipcRenderer.invoke("start-meeting", metadata),
  endMeeting: () => ipcRenderer.invoke("end-meeting"),
  finalizeMicSTT: () => ipcRenderer.invoke("finalize-mic-stt"),
  getRecentMeetings: () => ipcRenderer.invoke("get-recent-meetings"),
  getMeetingDetails: (id: string) => ipcRenderer.invoke("get-meeting-details", id),
  updateMeetingTitle: (id: string, title: string) => ipcRenderer.invoke("update-meeting-title", { id, title }),
  updateMeetingSummary: (id: string, updates: any) => ipcRenderer.invoke("update-meeting-summary", { id, updates }),
  deleteMeeting: (id: string) => ipcRenderer.invoke("delete-meeting", id),

  onMeetingsUpdated: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("meetings-updated", subscription)
    return () => {
      ipcRenderer.removeListener("meetings-updated", subscription)
    }
  },

  // Window Mode
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => ipcRenderer.invoke("set-window-mode", mode, inactive),

  // Intelligence Mode Events
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
  onKnowledgeContextUpdate: (callback: (data: { matchedJDSignals: any[]; resumeEvidence: any[]; mustHitKeywords: string[]; questionCategory: string }) => void) => {
    const subscription = (_event: any, data: any) => callback(data)
    ipcRenderer.on("knowledge:context-update", subscription)
    return () => {
      ipcRenderer.removeListener("knowledge:context-update", subscription)
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


  // Streaming Chat
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean; ragMiss?: boolean }) => ipcRenderer.invoke("gemini-chat-stream", message, imagePaths, context, options),
  cancelGeneration: () => ipcRenderer.invoke('cancel-generation'),

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

  // Model Management
  toggleModelSelector: (coords: { x: number; y: number }) => ipcRenderer.invoke('toggle-model-selector', coords),

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => ipcRenderer.invoke('toggle-settings-window', coords),
  openSettingsSection: (section: string) => ipcRenderer.invoke('open-settings-section', section),
  onOpenSettingsSection: (callback: (data: { section: string }) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: { section: string }) => callback(data)
    ipcRenderer.on('open-settings-section', subscription)
    return () => {
      ipcRenderer.removeListener('open-settings-section', subscription)
    }
  },

  // Demo
  seedDemo: () => ipcRenderer.invoke('seed-demo'),

  // Follow-up Email

  // Audio Test
  startAudioTest: (deviceId?: string) => ipcRenderer.invoke('start-audio-test', deviceId),
  stopAudioTest: () => ipcRenderer.invoke('stop-audio-test'),
  onAudioTestLevel: (callback: (level: number) => void) => {
    const subscription = (_: any, level: number) => callback(level)
    ipcRenderer.on('audio-test-level', subscription)
    return () => {
      ipcRenderer.removeListener('audio-test-level', subscription)
    }
  },

  // Database
  flushDatabase: () => ipcRenderer.invoke('flush-database'),



  getMicrophoneMuted: () => ipcRenderer.invoke('get-microphone-muted'),
  setMicrophoneMuted: (muted: boolean) => ipcRenderer.invoke('set-microphone-muted', muted),
  onMicrophoneMutedChanged: (callback: (muted: boolean) => void) => {
    const subscription = (_: any, muted: boolean) => callback(muted)
    ipcRenderer.on('microphone-muted-changed', subscription)
    return () => {
      ipcRenderer.removeListener('microphone-muted-changed', subscription)
    }
  },

  onUndetectableChanged: (callback: (state: boolean) => void) => {
    const subscription = (_: any, state: boolean) => callback(state)
    ipcRenderer.on('undetectable-changed', subscription)
    return () => {
      ipcRenderer.removeListener('undetectable-changed', subscription)
    }
  },

  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled)
    ipcRenderer.on('overlay-mouse-passthrough-changed', subscription)
    return () => {
      ipcRenderer.removeListener('overlay-mouse-passthrough-changed', subscription)
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

  // Theme API
  getThemeMode: () => ipcRenderer.invoke('theme:get-mode'),
  setThemeMode: (mode: 'system' | 'light' | 'dark') => ipcRenderer.invoke('theme:set-mode', mode),
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('theme:changed', subscription)
    return () => {
      ipcRenderer.removeListener('theme:changed', subscription)
    }
  },

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-available", subscription)
    return () => {
      ipcRenderer.removeListener("update-available", subscription)
    }
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-downloaded", subscription)
    return () => {
      ipcRenderer.removeListener("update-downloaded", subscription)
    }
  },
  onUpdateChecking: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("update-checking", subscription)
    return () => {
      ipcRenderer.removeListener("update-checking", subscription)
    }
  },
  onUpdateNotAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-not-available", subscription)
    return () => {
      ipcRenderer.removeListener("update-not-available", subscription)
    }
  },
  onUpdateError: (callback: (err: string) => void) => {
    const subscription = (_: any, err: string) => callback(err)
    ipcRenderer.on("update-error", subscription)
    return () => {
      ipcRenderer.removeListener("update-error", subscription)
    }
  },
  onDownloadProgress: (callback: (progressObj: any) => void) => {
    const subscription = (_: any, progressObj: any) => callback(progressObj)
    ipcRenderer.on("download-progress", subscription)
    return () => {
      ipcRenderer.removeListener("download-progress", subscription)
    }
  },
  restartAndInstall: () => ipcRenderer.invoke("quit-and-install-update"),
  getUpdateState: () => ipcRenderer.invoke("get-update-state"),
  setAutoCheckUpdates: (enabled: boolean) => ipcRenderer.invoke("set-auto-check-updates", enabled),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  testReleaseFetch: () => ipcRenderer.invoke("test-release-fetch"),

  // RAG API
  ragQueryMeeting: (meetingId: string, query: string) => ipcRenderer.invoke('rag:query-meeting', { meetingId, query }),
  ragQueryLive: (query: string) => ipcRenderer.invoke('rag:query-live', { query }),
  ragQueryGlobal: (query: string) => ipcRenderer.invoke('rag:query-global', { query }),
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) => ipcRenderer.invoke('rag:cancel-query', options),
  ragIsMeetingProcessed: (meetingId: string) => ipcRenderer.invoke('rag:is-meeting-processed', meetingId),
  ragGetQueueStatus: () => ipcRenderer.invoke('rag:get-queue-status'),
  ragRetryEmbeddings: () => ipcRenderer.invoke('rag:retry-embeddings'),
  
  onIncompatibleProviderWarning: (callback: (data: { count: number, oldProvider: string, newProvider: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('embedding:incompatible-provider-warning', subscription)
    return () => {
      ipcRenderer.removeListener('embedding:incompatible-provider-warning', subscription)
    }
  },
  reindexIncompatibleMeetings: () => ipcRenderer.invoke('rag:reindex-incompatible-meetings'),
  reindexAllMeetings: () => ipcRenderer.invoke('rag:reindex-all'),

  onRAGStreamChunk: (callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('rag:stream-chunk', subscription)
    return () => {
      ipcRenderer.removeListener('rag:stream-chunk', subscription)
    }
  },
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('rag:stream-complete', subscription)
    return () => {
      ipcRenderer.removeListener('rag:stream-complete', subscription)
    }
  },
  onRAGStreamError: (callback: (data: { meetingId?: string; global?: boolean; error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('rag:stream-error', subscription)
    return () => {
      ipcRenderer.removeListener('rag:stream-error', subscription)
    }
  },

  // Chat Streaming API
  chatStreamMeeting: (params: { requestId: string; meetingId: string; messages: Array<{ role: string; content: string }>; context?: string }) =>
    ipcRenderer.invoke('chat:stream-meeting', params),
  chatCancelStream: (requestId: string) =>
    ipcRenderer.invoke('chat:cancel-stream', { requestId }),
  onChatStreamChunk: (callback: (data: { requestId: string; chunk: string }) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('chat:stream-chunk', handler)
    return () => ipcRenderer.removeListener('chat:stream-chunk', handler)
  },
  onChatStreamComplete: (callback: (data: { requestId: string }) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('chat:stream-complete', handler)
    return () => ipcRenderer.removeListener('chat:stream-complete', handler)
  },
  onChatStreamError: (callback: (data: { requestId: string; error: string }) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('chat:stream-error', handler)
    return () => ipcRenderer.removeListener('chat:stream-error', handler)
  },

  // Keybind Management
  getKeybinds: (): Promise<KeybindStatus[]> => ipcRenderer.invoke('keybinds:get-all'),
  setKeybind: (id: string, accelerator: string): Promise<KeybindResult> => ipcRenderer.invoke('keybinds:set', id, accelerator),
  resetKeybinds: (): Promise<KeybindStatus[]> => ipcRenderer.invoke('keybinds:reset'),
  onKeybindsUpdate: (callback: (keybinds: KeybindStatus[]) => void) => {
    const subscription = (_: Electron.IpcRendererEvent, keybinds: KeybindStatus[]) => callback(keybinds)
    ipcRenderer.on('keybinds:update', subscription)
    return () => {
      ipcRenderer.removeListener('keybinds:update', subscription)
    }
  },

  // Global shortcut listener — fired stealthily from main process without focusing the window
  onGlobalShortcut: (callback: (data: { action: string }) => void) => {
    const subscription = (_: any, data: { action: string }) => callback(data)
    ipcRenderer.on('global-shortcut', subscription)
    return () => {
      ipcRenderer.removeListener('global-shortcut', subscription)
    }
  },

  // Donation API
  getDonationStatus: () => ipcRenderer.invoke("get-donation-status"),
  markDonationToastShown: () => ipcRenderer.invoke("mark-donation-toast-shown"),
  setDonationComplete: () => ipcRenderer.invoke('set-donation-complete'),

  // Profile Engine API
  profileUploadResume: (filePath: string) => ipcRenderer.invoke('profile:upload-resume', filePath),
  profileGetStatus: () => ipcRenderer.invoke('profile:get-status'),
  profileSetMode: (enabled: boolean) => ipcRenderer.invoke('profile:set-mode', enabled),
  profileDelete: () => ipcRenderer.invoke('profile:delete'),
  profileGetProfile: () => ipcRenderer.invoke('profile:get-profile'),
  profileSelectFile: () => ipcRenderer.invoke('profile:select-file'),

  // JD & Research API
  profileUploadJD: (filePath: string) => ipcRenderer.invoke('profile:upload-jd', filePath),
  profileDeleteJD: () => ipcRenderer.invoke('profile:delete-jd'),

  // Multi-JD Management
  knowledgeGetAllJDs: () => ipcRenderer.invoke('knowledge:get-all-jds'),
  knowledgeSetActiveJD: (docId: number) => ipcRenderer.invoke('knowledge:set-active-jd', docId),
  knowledgeDeleteJD: (docId: number) => ipcRenderer.invoke('knowledge:delete-jd', docId),
  knowledgeUploadJD: (filePath: string) => ipcRenderer.invoke('knowledge:upload-jd', filePath),
  knowledgeUpdateProfile: (updates: any) => ipcRenderer.invoke('knowledge:update-profile', updates),
  knowledgeGeneratePrep: (jdId?: number) => ipcRenderer.invoke('knowledge:generate-prep', jdId),
  knowledgeListDocuments: () => ipcRenderer.invoke('knowledge:list-documents'),
  knowledgeImportDocument: () => ipcRenderer.invoke('knowledge:import-document'),
  knowledgeRemoveDocument: (id: number) => ipcRenderer.invoke('knowledge:remove-document', id),
  knowledgeReindexDocument: (id: number) => ipcRenderer.invoke('knowledge:reindex-document', id),
  profileResearchCompany: (companyName: string) => ipcRenderer.invoke('profile:research-company', companyName),
  profileGenerateNegotiation: (force?: boolean) => ipcRenderer.invoke('profile:generate-negotiation', force),
  profileGetNegotiationState: () => ipcRenderer.invoke('profile:get-negotiation-state'),
  profileResetNegotiation: () => ipcRenderer.invoke('profile:reset-negotiation'),

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => ipcRenderer.invoke('set-tavily-api-key', apiKey),

  // License Management
  licenseActivate: (key: string) => ipcRenderer.invoke('license:activate', key),
  licenseCheckPremium: () => ipcRenderer.invoke('license:check-premium'),
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
  licenseGetHardwareId: () => ipcRenderer.invoke('license:get-hardware-id'),

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => ipcRenderer.invoke('set-overlay-opacity', opacity),
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => {
    const subscription = (_: any, opacity: number) => callback(opacity)
    ipcRenderer.on('overlay-opacity-changed', subscription)
    return () => {
      ipcRenderer.removeListener('overlay-opacity-changed', subscription)
    }
  },

  // Verbose / Debug Logging
  getVerboseLogging: () => ipcRenderer.invoke('get-verbose-logging'),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke('set-verbose-logging', enabled),
  
  // Arch
  getArch: () => ipcRenderer.invoke('get-arch'),

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => ipcRenderer.send('cropper-confirmed', bounds),
  cropperCancelled: () => ipcRenderer.send('cropper-cancelled'),
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => {
    const subscription = (_: Electron.IpcRendererEvent, data: { hudPosition: { x: number; y: number } }) => callback(data)
    ipcRenderer.on('reset-cropper', subscription)
    return () => {
      ipcRenderer.removeListener('reset-cropper', subscription)
    }
  },

  // Agent API
  agentStatus: () => ipcRenderer.invoke('agent-status'),
  agentSubmit: (payload: { text: string; mode?: 'followup' | 'steer'; requestId?: string }) =>
    ipcRenderer.invoke('agent-submit', payload),
  agentAbort: () => ipcRenderer.invoke('agent-abort'),
  agentGetThread: () => ipcRenderer.invoke('agent-get-thread'),
  onAgentEvent: (callback: (event: PreloadAgentEvent) => void) => {
    const subscription = (_: unknown, event: PreloadAgentEvent) => callback(event)
    ipcRenderer.on('agent-event', subscription)
    return () => {
      ipcRenderer.removeListener('agent-event', subscription)
    }
  },

  // Platform
  platform: process.platform,
} as ElectronAPI)
