import { app, BrowserWindow, Tray } from "electron"
import { logToFile, ensureMacMicrophoneAccess, setupConsoleOverrides } from "./lib/logging"

if (!app.isPackaged) {
  require('dotenv').config();
}

// Handle stdout/stderr errors at the process level to prevent EIO crashes
// This is critical for Electron apps that may have their terminal detached
process.stdout?.on?.('error', () => { });
process.stderr?.on?.('error', () => { });

process.on('uncaughtException', (err) => {
  logToFile('[CRITICAL] Uncaught Exception: ' + (err.stack || err.message || err));
});

process.on('unhandledRejection', (reason, promise) => {
  logToFile('[CRITICAL] Unhandled Rejection at: ' + promise + ' reason: ' + (reason instanceof Error ? reason.stack : reason));
});

setupConsoleOverrides()

import { WindowHelper } from "./helpers/WindowHelper"
import { SettingsWindowHelper } from "./helpers/SettingsWindowHelper"
import { ModelSelectorWindowHelper } from "./helpers/ModelSelectorWindowHelper"
import { CropperWindowHelper } from "./helpers/CropperWindowHelper"
import { ScreenshotHelper } from "./helpers/ScreenshotHelper"
import { KeybindManager } from "./services/KeybindManager"
import { ProcessingHelper } from "./helpers/ProcessingHelper"

import { IntelligenceManager } from "./IntelligenceManager"
import { SystemAudioCapture } from "./audio/SystemAudioCapture"
import { MicrophoneCapture } from "./audio/MicrophoneCapture"
import { ThemeManager } from "./helpers/ThemeManager"
import { RAGManager } from "./rag/RAGManager"
import { buildEmbeddingConfig } from "./rag/embeddingConfig"
import { buildMeetingSummaryText } from "./rag/meetingSummaryIndex"
import { DatabaseManager } from "./db/DatabaseManager"
import { getMeetingAgent, getGate, refreshGate } from './agent/instance'
import { type MeetingAgent, reportAgentError } from './agent/MeetingAgent'
import {
  setupAutoUpdater as setupAutoUpdaterFn,
  quitAndInstallUpdate as quitAndInstallUpdateFn,
  checkForUpdates as checkForUpdatesFn,
  downloadUpdate as downloadUpdateFn,
  flushPendingUpdateNotice,
} from "./lib/auto-updater"
import {
  type BufferedTranscriptTurn,
  type FlushedTranscriptTurn,
  DEFAULT_TRANSCRIPT_ASSEMBLER_PROFILE,
  type TranscriptAssemblerProfile,
  type TranscriptSpeaker,
  isTranscriptAssemblerProfile,
  resetBufferedTranscriptTurns as resetBufferedTranscriptTurnsFn,
} from "./lib/transcript-assembler"
import {
  type STTProvider,
  createSTTProvider as createSTTProviderFn,
  setupSystemAudioPipeline as setupSystemAudioPipelineFn,
  reconfigureAudio as reconfigureAudioFn,
  startAudioTest as startAudioTestFn,
  stopAudioTest as stopAudioTestFn,
  finalizeMicSTT as finalizeMicSTTFn,
  translateTranscriptSegment as translateTranscriptSegmentFn,
  getNativeAudioStatus as getNativeAudioStatusFn,
} from "./lib/audio-pipeline"
import {
  showTray as showTrayFn,
  updateTrayMenu as updateTrayMenuFn,
} from "./lib/tray-menu"
import {
  setUndetectable as setUndetectableFn,
  getUndetectable as getUndetectableFn,
  setOverlayMousePassthrough as setOverlayMousePassthroughFn,
  toggleOverlayMousePassthrough as toggleOverlayMousePassthroughFn,
  getOverlayMousePassthrough as getOverlayMousePassthroughFn,
  getVerboseLogging as getVerboseLoggingFn,
  setVerboseLogging as setVerboseLoggingFn,
} from "./helpers/stealth"
import { initializeApp } from "./lib/lifecycle"
import type { EchoFilter } from "./lib/echo-filter"
import { audioStats } from "./lib/audio-stats"
import { sendLag } from "./lib/send-lag"
import { registerGlobalShortcutDispatch } from "./lib/global-shortcuts"
import { forwardIntelligenceEvents } from "./ipc/intelligence"
import { createKnowledgeOrchestrator } from "./knowledge/wiring"

/** Unified type for all STT providers with optional extended capabilities */
// Knowledge modules (local implementation)
import { KnowledgeOrchestrator as KnowledgeOrchestratorClass } from './knowledge/KnowledgeOrchestrator';

import { SettingsManager } from "./services/SettingsManager"
import { setVerboseLoggingFlag } from "./lib/verboseLog"

export class AppState {
  private static instance: AppState | null = null

  public windowHelper: WindowHelper
  public settingsWindowHelper: SettingsWindowHelper
  public modelSelectorWindowHelper: ModelSelectorWindowHelper
  public cropperWindowHelper: CropperWindowHelper
  public screenshotHelper: ScreenshotHelper
  public processingHelper: ProcessingHelper

  private intelligenceManager: IntelligenceManager
  private themeManager: ThemeManager
  private ragManager: RAGManager | null = null
  private knowledgeOrchestrator: KnowledgeOrchestratorClass | null = null
  public tray: Tray | null = null
  public updateAvailable: boolean = false

  // View management
  public isUndetectable: boolean = false

  private isMeetingActive: boolean = false; // Guard for session state leaks
  /** The microphone is muted by the user: the speech service gets silence instead of the microphone. Not saved; a new meeting starts unmuted. */
  public microphoneMuted: boolean = false;
  private endingMeeting: Promise<void> | undefined;
  private _isQuitting: boolean = false;
  public _verboseLogging: boolean = false;


  constructor() {
    // 1. Load boot-critical settings first (used by WindowHelpers)
    const settingsManager = SettingsManager.getInstance();
    this.isUndetectable = settingsManager.get('isUndetectable') ?? false;
    const transcriptAssemblerProfile = settingsManager.get('transcriptAssemblerProfile');
    this.transcriptAssemblerProfile = isTranscriptAssemblerProfile(transcriptAssemblerProfile)
      ? transcriptAssemblerProfile
      : DEFAULT_TRANSCRIPT_ASSEMBLER_PROFILE;
    this._verboseLogging = settingsManager.get('verboseLogging') ?? false;
    setVerboseLoggingFlag(this._verboseLogging);
    console.log(`[AppState] Initialized with isUndetectable=${this.isUndetectable}, verboseLogging=${this._verboseLogging}`);

    // 2. Initialize Helpers with loaded state
    this.windowHelper = new WindowHelper(this)
    this.settingsWindowHelper = new SettingsWindowHelper()
    this.modelSelectorWindowHelper = new ModelSelectorWindowHelper()
    this.cropperWindowHelper = new CropperWindowHelper()

    // 3. Initialize other helpers
    this.screenshotHelper = new ScreenshotHelper()
    this.processingHelper = new ProcessingHelper(this)

    this.windowHelper.setContentProtection(this.isUndetectable);
    this.settingsWindowHelper.setContentProtection(this.isUndetectable);
    this.modelSelectorWindowHelper.setContentProtection(this.isUndetectable);
    this.cropperWindowHelper.setContentProtection(this.isUndetectable);

    if (process.platform === 'win32' || process.platform === 'darwin') {
      this.cropperWindowHelper.preload();
    }

    // Initialize KeybindManager
    const keybindManager = KeybindManager.getInstance();
    keybindManager.setWindowHelper(this.windowHelper);
    keybindManager.setupIpcHandlers();
    keybindManager.onUpdate(() => {
      this.updateTrayMenu();
    });

    registerGlobalShortcutDispatch(this, keybindManager);

    // Inject WindowHelper into other helpers
    this.settingsWindowHelper.setWindowHelper(this.windowHelper);
    this.modelSelectorWindowHelper.setWindowHelper(this.windowHelper);





    // Initialize IntelligenceManager with LLMHelper
    this.intelligenceManager = new IntelligenceManager(this.processingHelper.getLLMHelper(), () => this.ragManager)

    // Initialize ThemeManager
    this.themeManager = ThemeManager.getInstance()

    // Initialize RAGManager (requires database to be ready)
    this.initializeRAGManager()
    
    // Check and prep Ollama embedding model
    this.bootstrapOllamaEmbeddings()


    forwardIntelligenceEvents(this)


    // --- NEW SYSTEM AUDIO PIPELINE (SOX + NODE GOOGLE STT) ---
    // LAZY INIT: Do not setup pipeline here to prevent launch volume surge.
    // this.setupSystemAudioPipeline()

    // Initialize Auto-Updater
    this.setupAutoUpdater()
  }

  public broadcast(channel: string, ...args: any[]): void {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    });
  }

  public getIsMeetingActive(): boolean {
    return this.isMeetingActive;
  }

  public isQuitting(): boolean {
    return this._isQuitting;
  }

  public setQuitting(value: boolean): void {
    this._isQuitting = value;
  }

  public setMicrophoneMuted(muted: boolean): void {
    this.microphoneMuted = muted;
    this.broadcast('microphone-muted-changed', muted);
  }

  private broadcastMeetingState(): void {
    this.broadcast('meeting-state-changed', { isActive: this.isMeetingActive });
    if (!this.isMeetingActive) flushPendingUpdateNotice(this);
  }

  private async bootstrapOllamaEmbeddings() {
    void (async () => {
      try {
        const { OllamaBootstrap } = require('./rag/OllamaBootstrap');
        const bootstrap = new OllamaBootstrap();

        // Fire and forget — don't await this before showing the window
        const result = await bootstrap.bootstrap('nomic-embed-text', (status: string, percent: number) => {
          // Send progress to renderer via IPC
          this.broadcast('ollama:pull-progress', { status, percent });
        });

        if (result === 'pulled' || result === 'already_pulled') {
          this.broadcast('ollama:pull-complete');
          // Re-resolve the embedding provider given that Ollama might now be available
          if (this.ragManager) {
             console.log('[AppState] Ollama model ready, re-evaluating RAG pipeline provider');
             await this.ragManager.initializeEmbeddings(buildEmbeddingConfig());
          }
        }
      } catch (err) {
         console.error('[AppState] Failed to bootstrap Ollama:', err);
      }
    })();
  }

  private initializeRAGManager(): void {
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb) {
        this.ragManager = new RAGManager({ 
            db: sqliteDb, 
            dbPath: db.getDbPath(),
            extPath: db.getExtPath(),
            ...buildEmbeddingConfig()
        });
        this.ragManager.setLLMHelper(this.processingHelper.getLLMHelper());
        console.log('[AppState] RAGManager initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize RAGManager:', error);
    }

    // Initialize Knowledge Orchestrator
    try {
      const sqliteDb = DatabaseManager.getInstance().getDb();
      if (sqliteDb) {
        this.knowledgeOrchestrator = createKnowledgeOrchestrator(sqliteDb, () => this.ragManager, this.processingHelper.getLLMHelper());
        console.log('[AppState] KnowledgeOrchestrator initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize KnowledgeOrchestrator:', error);
    }
  }

  public setupAutoUpdater(): void {
    setupAutoUpdaterFn(this)
  }

  public async quitAndInstallUpdate(): Promise<void> {
    await quitAndInstallUpdateFn(this)
  }

  public async checkForUpdates(): Promise<void> {
    await checkForUpdatesFn(this)
  }

  public downloadUpdate(): void {
    downloadUpdateFn(this)
  }

  // New Property for System Audio & Microphone
  public systemAudioCapture: SystemAudioCapture | null = null;
  public microphoneCapture: MicrophoneCapture | null = null;
  public audioTestCapture: any = null; // For audio settings test
  public _audioTestStarting = false;                // P2-12: in-flight guard against concurrent calls
  public googleSTT: STTProvider | null = null; // Them
  public googleSTT_User: STTProvider | null = null; // User
  public lastSystemAudioChunkAt: number | null = null;
  public lastThemTranscriptAt: number | null = null;
  public lastAudioPipelineError: string | null = null;
  // The microphone hears the speakers: lines that repeat the other party's stream are dropped. Created on first use.
  public echoFilter: EchoFilter | null = null;
  public transcriptAssemblerProfile: TranscriptAssemblerProfile = 'sentence_bias';
  public transcriptTurnBuffers: Record<TranscriptSpeaker, BufferedTranscriptTurn | null> = {
    them: null,
    user: null,
  };
  public lastFlushedTranscriptTurns: Record<TranscriptSpeaker, FlushedTranscriptTurn | null> = { them: null, user: null };
  public transcriptSegmentRevisions: Map<string, number> = new Map();
  public recentTranslatedTurns: Array<{ segmentId: string; source: string; translation: string }> = [];

  public resetBufferedTranscriptTurns(): void {
    resetBufferedTranscriptTurnsFn(this)
  }

  /** The meeting the assembled transcript is written to; null between meetings. */
  private currentMeetingId: string | null = null;

  public getCurrentMeetingId(): string | null { return this.currentMeetingId; }

  public recordTranscriptSegment(segment: { segmentId: string; revision: number; speaker: TranscriptSpeaker; text: string; timestampMs: number }): void {
    if (!this.currentMeetingId) return;
    try {
      const written = DatabaseManager.getInstance().upsertSegment({ meetingId: this.currentMeetingId, ...segment });
      if (written && segment.speaker === 'them') {
        getGate().onSegment({ meetingId: this.currentMeetingId, segmentId: segment.segmentId, revision: segment.revision });
      }
    } catch (err) {
      console.error('[Main] Failed to record a transcript segment:', (err as Error).message);
    }
  }

  public createSTTProvider(speaker: 'them' | 'user'): STTProvider {
    return createSTTProviderFn(this, speaker)
  }

  public setupSystemAudioPipeline(): void {
    setupSystemAudioPipelineFn(this)
  }

  public async startAudioTest(deviceId?: string): Promise<{ fallbackUsed: boolean }> {
    return startAudioTestFn(this, deviceId)
  }

  public stopAudioTest(): void {
    stopAudioTestFn(this)
  }

  public finalizeMicSTT(): void {
    finalizeMicSTTFn(this)
  }

  public async translateTranscriptSegment(segment: {
    segmentId: string;
    text: string;
    speaker?: TranscriptSpeaker;
    speakerLabel?: string;
    timestamp?: number;
  }): Promise<{ success: boolean; error?: string }> {
    return translateTranscriptSegmentFn(this, segment)
  }

  public getNativeAudioStatus(): {
    connected: boolean;
    meetingActive: boolean;
    hasRecentSystemAudioChunk: boolean;
    hasRecentThemTranscript: boolean;
    lastSystemAudioChunkAt: number | null;
    lastThemTranscriptAt: number | null;
    lastError: string | null;
  } {
    return getNativeAudioStatusFn(this)
  }

  public async startMeeting(metadata?: any): Promise<void> {
    await this.endingMeeting;
    console.log('[Main] Starting Meeting...', metadata);

    if (!(await ensureMacMicrophoneAccess('meeting start'))) {
      const message = 'Microphone access denied. Please allow microphone access in System Settings.';
      this.broadcast('meeting-audio-error', message);
      throw new Error(message);
    }

    this.isMeetingActive = true;
    audioStats.reset();
    sendLag.start();
    this.setMicrophoneMuted(false);
    this.resetBufferedTranscriptTurns();
    this.lastSystemAudioChunkAt = null;
    this.lastThemTranscriptAt = null;
    this.lastAudioPipelineError = null;
    this.broadcastMeetingState();
    if (metadata) {
      this.intelligenceManager.setMeetingMetadata(metadata);
    }
    // The meeting row exists before any audio, so each assembled line is saved as it happens.
    this.currentMeetingId = this.intelligenceManager.startMeeting(metadata);
    if (this.currentMeetingId) {
      this.ragManager?.startLiveIndexing(this.currentMeetingId);
      void this.getMeetingAgent().open(this.currentMeetingId).catch(error => reportAgentError(error));
      void refreshGate();
    }

    // Emit session reset to clear UI state immediately
    this.getWindowHelper().getOverlayWindow()?.webContents.send('session-reset');
    this.getWindowHelper().getLauncherWindow()?.webContents.send('session-reset');

    // ★ ASYNC AUDIO INIT: Return INSTANTLY so the IPC response goes back
    // to the renderer immediately, allowing the UI to switch to overlay
    // without waiting for SCK/audio initialization (which takes 5-7 seconds).
    // setTimeout(0) ensures setWindowMode IPC is processed first.
    setTimeout(async () => {
      const sessionMeetingId = this.currentMeetingId;
      // BUG-02 fix: a fast start→stop sequence can call endMeeting() before
      // this callback fires, leaving isMeetingActive=false. If that happened,
      // do NOT boot the audio pipeline — it would run forever with no stop signal.
      if (!this.isMeetingActive) {
        console.warn('[Main] Meeting was cancelled before audio pipeline could start — aborting init.');
        return;
      }
      try {
        // Check for audio configuration preference
        if (metadata?.audio) {
          await reconfigureAudioFn(this, metadata.audio.inputDeviceId, metadata.audio.outputDeviceId);
          // Another session may have ended or replaced this one while audio was reconfiguring.
          if (!this.isMeetingActive || this.currentMeetingId !== sessionMeetingId) {
            console.warn('[Main] Meeting session changed during audio reconfiguration — aborting that start.');
            return;
          }
        }

        // LAZY INIT: Ensure pipeline is ready (if not reconfigured above)
        this.setupSystemAudioPipeline();

        // Start System Audio
        this.systemAudioCapture?.start();
        this.googleSTT?.start();

        // Start Microphone
        this.microphoneCapture?.start();
        this.googleSTT_User?.start();

        if (this._verboseLogging) {
          const requestedInput = metadata?.audio?.inputDeviceId || 'default';
          const requestedOutput = metadata?.audio?.outputDeviceId || 'default';
          const backend = requestedOutput === 'sck' ? 'sck' : 'coreaudio';
          const sysRate = this.systemAudioCapture?.getSampleRate() || 48000;
          const micRate = this.microphoneCapture?.getSampleRate() || 48000;
          console.log(`[Main][debug] Audio pipeline: input=${requestedInput} output=${requestedOutput} backend=${backend} sysRate=${sysRate}Hz micRate=${micRate}Hz`);
        }
        console.log('[Main] Audio pipeline started successfully.');
        this.lastAudioPipelineError = null;
      } catch (err) {
        console.error('[Main] Error initializing audio pipeline:', err);
        this.lastAudioPipelineError = (err as Error).message || 'Audio pipeline failed to start';
        // Notify UI so user knows microphone/audio failed to start
        this.broadcast('meeting-audio-error', (err as Error).message || 'Audio pipeline failed to start');
      }
    }, 0); // Defer to next event loop tick — ensures IPC response reaches renderer before audio init
  }

  public endMeeting(): Promise<void> {
    return this.endingMeeting ??= this.finishMeeting().finally(() => { this.endingMeeting = undefined; });
  }

  private async finishMeeting(): Promise<void> {
    console.log('[Main] Ending Meeting...');
    const stoppedAtMs = Date.now();
    this.isMeetingActive = false; // Block new data immediately
    console.log(audioStats.summary());
    console.log(sendLag.summary());
    this.broadcastMeetingState();

    // Cancel the engine before the first await: stopping the agent and draining the indexer take time, and an
    // answer still streaming in that window must not reach the session of the meeting the user just ended.
    this.intelligenceManager.cancelGeneration();

    // Reset Mouse Passthrough so the next meeting overlay starts fresh and focusable
    if (this.overlayMousePassthrough) {
      this.setOverlayMousePassthrough(false);
    }

    // Stop audio captures synchronously — these are fire-and-forget internally
    this.systemAudioCapture?.stop();
    this.googleSTT?.stop();
    this.microphoneCapture?.stop();
    this.googleSTT_User?.stop();
    this.resetBufferedTranscriptTurns();
    this.lastSystemAudioChunkAt = null;
    this.lastThemTranscriptAt = null;
    this.lastAudioPipelineError = null;

    // Save session state and reset context — MeetingPersistence.stopMeeting() is
    // already fire-and-forget internally (processAndSaveMeeting runs in background).
    // Capture the meetingId NOW so the background IIFE uses a deterministic ID
    // rather than getRecentMeetings(1) which could return a different meeting if the
    // user starts a new session before background processing finishes.
    const agentMeetingId = this.currentMeetingId;
    if (agentMeetingId) {
      getGate().stop(agentMeetingId);
      await this.getMeetingAgent().stop(agentMeetingId).catch(error => reportAgentError(error, agentMeetingId));
    }
    // The live indexer drains in the background so stopping is not held up by an embedding request.
    // Only a meeting too short to be kept waits for it, because its vectors must be removed before
    // persistence deletes the record.
    const drained = (this.ragManager?.stopLiveIndexing() ?? Promise.resolve())
      .catch(error => console.error('[Main] Live indexing drain failed:', error instanceof Error ? error.message : 'unknown error'));
    if (agentMeetingId) {
      const meeting = DatabaseManager.getInstance().getMeetingDetails(agentMeetingId);
      if (meeting?.startTimeMs !== undefined && stoppedAtMs - meeting.startTimeMs < 1000) {
        await drained;
        // Remove vectors while chunk ids still exist, before the short-record cascade.
        this.ragManager?.deleteMeetingData(agentMeetingId);
      }
    }
    const meetingId = await this.intelligenceManager.stopMeeting(stoppedAtMs);
    this.currentMeetingId = null;
    if (agentMeetingId && !meetingId) {
      await this.getMeetingAgent().deleteStore(agentMeetingId).catch(error => reportAgentError(error, agentMeetingId));
    }

    if (meetingId) {
      // The full-transcript index replaces the live chunks, so it starts after the drain.
      void drained.then(() => this.processCompletedMeetingForRAG(meetingId));
    }
  }

  private async processCompletedMeetingForRAG(meetingId: string): Promise<void> {
    if (!this.ragManager) return;

    try {
      // Use the explicit meetingId passed from endMeeting() — deterministic, never
      // picks up a concurrently started meeting the way getRecentMeetings(1) could.
      const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);
      if (!meeting || !meeting.transcript || meeting.transcript.length === 0) return;

      // Convert transcript to RAG format
      const segments = meeting.transcript.map(t => ({
        speaker: t.speaker,
        text: t.text,
        timestamp: t.timestamp
      }));

      const summary = buildMeetingSummaryText(meeting);

      const result = await this.ragManager.processMeeting(meeting.id, segments, summary);
      console.log(`[AppState] RAG processed meeting ${meeting.id}: ${result.chunkCount} chunks`);

    } catch (error) {
      console.error('[AppState] Failed to process meeting for RAG:', error);
    }
  }

  public updateGoogleCredentials(keyPath: string): void {
    console.log(`[AppState] Updating Google Credentials to: ${keyPath}`);
    // Set global environment variable so new instances pick it up
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

    if (this.googleSTT) {
      this.googleSTT.setCredentials(keyPath);
    }

    if (this.googleSTT_User) {
      this.googleSTT_User.setCredentials(keyPath);
    }
  }

  // Each speaker has its own recognition language; only that speaker's stream restarts.
  public setRecognitionLanguage(key: string, speaker: 'them' | 'user' = 'them'): void {
    console.log(`[AppState] Setting ${speaker} recognition language to: ${key}`);
    const { CredentialsManager } = require('./services/CredentialsManager');
    if (speaker === 'user') {
      CredentialsManager.getInstance().setSttLanguageUser(key);
      this.googleSTT_User?.setRecognitionLanguage(key);
      return;
    }
    CredentialsManager.getInstance().setSttLanguage(key);
    this.googleSTT?.setRecognitionLanguage(key);
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public getWindowHelper(): WindowHelper {
    return this.windowHelper
  }

  public getIntelligenceManager(): IntelligenceManager {
    return this.intelligenceManager
  }

  public getThemeManager(): ThemeManager {
    return this.themeManager
  }

  public getMeetingAgent(): MeetingAgent { return getMeetingAgent(); }

  public getRAGManager(): RAGManager | null {
    return this.ragManager;
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(inactive?: boolean): void {
    if (this.windowHelper) {
      this.windowHelper.showMainWindow(inactive)
    }
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length
    )
    
    const mode = this.windowHelper.getCurrentWindowMode();
    
    if (mode === 'launcher') {
      // In launcher mode, just physically hide/show the window
      this.windowHelper.toggleMainWindow();
    } else {
      // In overlay mode, send toggle-expand IPC to expand/collapse the UI
      const targetWindow = this.windowHelper.getOverlayWindow();
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('toggle-expand');
      }
    }
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public clearQueues(): void {
    this.screenshotHelper.clearQueues()
  }


  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public showTray(): void {
    showTrayFn(this)
  }

  public updateTrayMenu() {
    updateTrayMenuFn(this)
  }

  public setUndetectable(state: boolean): void {
    setUndetectableFn(this, state)
  }

  public getUndetectable(): boolean {
    return getUndetectableFn(this)
  }

  // --- Mouse Passthrough (Adapted from public PR #113 — verify premium interaction) ---
  public overlayMousePassthrough: boolean = false;

  public setOverlayMousePassthrough(state: boolean): void {
    setOverlayMousePassthroughFn(this, state)
  }

  public toggleOverlayMousePassthrough(): boolean {
    return toggleOverlayMousePassthroughFn(this)
  }

  public getOverlayMousePassthrough(): boolean {
    return getOverlayMousePassthroughFn(this)
  }

  public getVerboseLogging(): boolean {
    return getVerboseLoggingFn(this)
  }

  public setVerboseLogging(enabled: boolean): void {
    setVerboseLoggingFn(this, enabled)
  }

}

// Start the application
initializeApp().catch(console.error)
