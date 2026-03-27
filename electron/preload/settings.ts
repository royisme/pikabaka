import { ipcRenderer } from "electron"

export function settingsChannels() {
  return {
    setOpenAtLogin: (open: boolean) => ipcRenderer.invoke("set-open-at-login", open),
    getOpenAtLogin: () => ipcRenderer.invoke("get-open-at-login"),
    getThemeMode: () => ipcRenderer.invoke('theme:get-mode'),
    setThemeMode: (mode: 'system' | 'light' | 'dark') => ipcRenderer.invoke('theme:set-mode', mode),
    onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on('theme:changed', subscription)
      return () => {
        ipcRenderer.removeListener('theme:changed', subscription)
      }
    },
    getKeybinds: () => ipcRenderer.invoke('keybinds:get-all'),
    setKeybind: (id: string, accelerator: string) => ipcRenderer.invoke('keybinds:set', id, accelerator),
    resetKeybinds: () => ipcRenderer.invoke('keybinds:reset'),
    onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => {
      const subscription = (_: any, keybinds: any) => callback(keybinds)
      ipcRenderer.on('keybinds:update', subscription)
      return () => {
        ipcRenderer.removeListener('keybinds:update', subscription)
      }
    },
    onGlobalShortcut: (callback: (data: { action: string }) => void) => {
      const subscription = (_: any, data: { action: string }) => callback(data)
      ipcRenderer.on('global-shortcut', subscription)
      return () => {
        ipcRenderer.removeListener('global-shortcut', subscription)
      }
    },
    setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') => ipcRenderer.invoke("set-disguise", mode),
    getDisguise: () => ipcRenderer.invoke("get-disguise"),
    onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => {
      const subscription = (_: any, mode: any) => callback(mode)
      ipcRenderer.on('disguise-changed', subscription)
      return () => {
        ipcRenderer.removeListener('disguise-changed', subscription)
      }
    },
    checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
    downloadUpdate: () => ipcRenderer.invoke("download-update"),
    restartAndInstall: () => ipcRenderer.invoke("quit-and-install-update"),
    testReleaseFetch: () => ipcRenderer.invoke("test-release-fetch"),
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
    profileUploadResume: (filePath: string) => ipcRenderer.invoke('profile:upload-resume', filePath),
    profileGetStatus: () => ipcRenderer.invoke('profile:get-status'),
    profileSetMode: (enabled: boolean) => ipcRenderer.invoke('profile:set-mode', enabled),
    profileDelete: () => ipcRenderer.invoke('profile:delete'),
    profileGetProfile: () => ipcRenderer.invoke('profile:get-profile'),
    profileSelectFile: () => ipcRenderer.invoke('profile:select-file'),
    profileUploadJD: (filePath: string) => ipcRenderer.invoke('profile:upload-jd', filePath),
    profileDeleteJD: () => ipcRenderer.invoke('profile:delete-jd'),
    profileResearchCompany: (companyName: string) => ipcRenderer.invoke('profile:research-company', companyName),
    profileGenerateNegotiation: (force?: boolean) => ipcRenderer.invoke('profile:generate-negotiation', force),
    profileGetNegotiationState: () => ipcRenderer.invoke('profile:get-negotiation-state'),
    profileResetNegotiation: () => ipcRenderer.invoke('profile:reset-negotiation'),
    calendarConnect: () => ipcRenderer.invoke('calendar-connect'),
    calendarDisconnect: () => ipcRenderer.invoke('calendar-disconnect'),
    getCalendarStatus: () => ipcRenderer.invoke('get-calendar-status'),
    getUpcomingEvents: () => ipcRenderer.invoke('get-upcoming-events'),
    calendarRefresh: () => ipcRenderer.invoke('calendar-refresh'),
    getCalendarAttendees: (eventId: string) => ipcRenderer.invoke('get-calendar-attendees', eventId),
    openMailto: (params: { to: string; subject: string; body: string }) => ipcRenderer.invoke('open-mailto', params),
    generateFollowupEmail: (input: any) => ipcRenderer.invoke('generate-followup-email', input),
    extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => ipcRenderer.invoke('extract-emails-from-transcript', transcript),
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
    getDonationStatus: () => ipcRenderer.invoke("get-donation-status"),
    markDonationToastShown: () => ipcRenderer.invoke("mark-donation-toast-shown"),
    setDonationComplete: () => ipcRenderer.invoke('set-donation-complete'),
    setTavilyApiKey: (apiKey: string) => ipcRenderer.invoke('set-tavily-api-key', apiKey),
    getVerboseLogging: () => ipcRenderer.invoke('get-verbose-logging'),
    setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke('set-verbose-logging', enabled),
    getArch: () => ipcRenderer.invoke('get-arch'),
    flushDatabase: () => ipcRenderer.invoke('flush-database'),
    seedDemo: () => ipcRenderer.invoke('seed-demo'),
    getTranscriptTranslationSettings: () => ipcRenderer.invoke("get-transcript-translation-settings"),
    setTranscriptTranslationSettings: (settings: { enabled?: boolean; provider?: 'ollama' | 'gemini' | 'groq' | 'openai' | 'claude'; model?: string; prompt?: string; displayMode?: 'original' | 'translated' | 'both' }) =>
      ipcRenderer.invoke("set-transcript-translation-settings", settings),
    translateTranscriptSegment: (segment: { segmentId: string; text: string; speaker?: 'interviewer' | 'user'; speakerLabel?: string; timestamp?: number }) =>
      ipcRenderer.invoke("translate-transcript-segment", segment),
    licenseActivate: (key: string) => ipcRenderer.invoke('license:activate', key),
    licenseCheckPremium: () => ipcRenderer.invoke('license:check-premium'),
    licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
    licenseGetHardwareId: () => ipcRenderer.invoke('license:get-hardware-id'),
    cropperConfirmed: (bounds: Electron.Rectangle) => ipcRenderer.send('cropper-confirmed', bounds),
    cropperCancelled: () => ipcRenderer.send('cropper-cancelled'),
    onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => {
      const subscription = (_: Electron.IpcRendererEvent, data: { hudPosition: { x: number; y: number } }) => callback(data)
      ipcRenderer.on('reset-cropper', subscription)
      return () => {
        ipcRenderer.removeListener('reset-cropper', subscription)
      }
    },
    setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => ipcRenderer.invoke("set-window-mode", mode, inactive),
  }
}
