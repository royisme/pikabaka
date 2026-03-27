import { app, BrowserWindow, Tray, ipcMain, screen } from "electron"
import path from "path"
import fs from "fs"
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
import { DatabaseManager } from "./db/DatabaseManager"
import { warmupIntentClassifier } from "./llm"
import {
  setupAutoUpdater as setupAutoUpdaterFn,
  checkForUpdatesManual as checkForUpdatesManualFn,
  isVersionNewer as isVersionNewerFn,
  quitAndInstallUpdate as quitAndInstallUpdateFn,
  checkForUpdates as checkForUpdatesFn,
  downloadUpdate as downloadUpdateFn,
} from "./lib/auto-updater"
import {
  type BufferedTranscriptTurn,
  type TranscriptAssemblerThresholds,
  type TranscriptSpeaker,
  getTranscriptAssemblerThresholds as getTranscriptAssemblerThresholdsFn,
  emitNativeAudioTranscript as emitNativeAudioTranscriptFn,
  createTranscriptSegmentId as createTranscriptSegmentIdFn,
  normalizeTranscriptText as normalizeTranscriptTextFn,
  endsSentence as endsSentenceFn,
  mergeTranscriptText as mergeTranscriptTextFn,
  scheduleBufferedTranscriptFlush as scheduleBufferedTranscriptFlushFn,
  bufferFinalTranscriptChunk as bufferFinalTranscriptChunkFn,
  handleSpeakerSpeechEnded as handleSpeakerSpeechEndedFn,
  resetBufferedTranscriptTurns as resetBufferedTranscriptTurnsFn,
  flushBufferedTranscriptTurn as flushBufferedTranscriptTurnFn,
  emitTranscriptWithTranslation as emitTranscriptWithTranslationFn,
} from "./lib/transcript-assembler"
import {
  type STTProvider,
  createSTTProvider as createSTTProviderFn,
  setupSystemAudioPipeline as setupSystemAudioPipelineFn,
  startAudioTest as startAudioTestFn,
  _startAudioTestImpl as startAudioTestImplFn,
  stopAudioTest as stopAudioTestFn,
  finalizeMicSTT as finalizeMicSTTFn,
  translateTranscriptSegment as translateTranscriptSegmentFn,
  getNativeAudioStatus as getNativeAudioStatusFn,
} from "./lib/audio-pipeline"
import {
  createTray as createTrayFn,
  showTray as showTrayFn,
  updateTrayMenu as updateTrayMenuFn,
  hideTray as hideTrayFn,
} from "./lib/tray-menu"
import {
  setHasDebugged as setHasDebuggedFn,
  getHasDebugged as getHasDebuggedFn,
  setUndetectable as setUndetectableFn,
  getUndetectable as getUndetectableFn,
  setOverlayMousePassthrough as setOverlayMousePassthroughFn,
  toggleOverlayMousePassthrough as toggleOverlayMousePassthroughFn,
  getOverlayMousePassthrough as getOverlayMousePassthroughFn,
  getVerboseLogging as getVerboseLoggingFn,
  setVerboseLogging as setVerboseLoggingFn,
  setDisguise as setDisguiseFn,
  applyInitialDisguise as applyInitialDisguiseFn,
  _applyDisguise as applyDisguiseFn,
  _broadcastToAllWindows as broadcastToAllWindowsFn,
  getDisguise as getDisguiseFn,
} from "./helpers/stealth"
import { initializeApp } from "./lib/lifecycle"

/** Unified type for all STT providers with optional extended capabilities */
type ScreenshotWindowMode = 'launcher' | 'overlay';
type ScreenshotCaptureKind = 'full' | 'selective';

interface ScreenshotCaptureSession {
  captureKind: ScreenshotCaptureKind;
  wasMainWindowVisible: boolean;
  windowMode: ScreenshotWindowMode;
  wasSettingsVisible: boolean;
  wasModelSelectorVisible: boolean;
  overlayBounds: Electron.Rectangle | null;
  overlayDisplayId: number | null;
  restoreWithoutFocus: boolean;
}

// Knowledge modules (local implementation)
import { KnowledgeOrchestrator as KnowledgeOrchestratorClass } from './knowledge/KnowledgeOrchestrator';
import { KnowledgeDatabaseManager as KnowledgeDatabaseManagerClass } from './knowledge/KnowledgeDatabaseManager';

import { CredentialsManager } from "./services/CredentialsManager"
import { SettingsManager } from "./services/SettingsManager"
import { setVerboseLoggingFlag } from "./lib/verboseLog"
import { OllamaManager } from './services/OllamaManager'

export class AppState {
  private static instance: AppState | null = null

  public windowHelper: WindowHelper
  public settingsWindowHelper: SettingsWindowHelper
  public modelSelectorWindowHelper: ModelSelectorWindowHelper
  public cropperWindowHelper: CropperWindowHelper
  private screenshotHelper: ScreenshotHelper
  public processingHelper: ProcessingHelper

  private intelligenceManager: IntelligenceManager
  private themeManager: ThemeManager
  private ragManager: RAGManager | null = null
  private knowledgeOrchestrator: any = null
  public tray: Tray | null = null
  public updateAvailable: boolean = false
  public disguiseMode: 'terminal' | 'settings' | 'activity' | 'none' = 'none'

  // View management
  private view: "queue" | "solutions" = "queue"
  public isUndetectable: boolean = false

  private problemInfo: {
    problem_statement: string
    input_format: Record<string, any>
    output_format: Record<string, any>
    constraints: Array<Record<string, any>>
    test_cases: Array<Record<string, any>>
  } | null = null // Allow null

  public hasDebugged: boolean = false
  private isMeetingActive: boolean = false; // Guard for session state leaks
  private _isQuitting: boolean = false;
  public _verboseLogging: boolean = false;
  public _disguiseTimers: NodeJS.Timeout[] = []; // Track forceUpdate timeouts
  public _dockDebounceTimer: NodeJS.Timeout | null = null; // Debounce dock state changes
  public _dockReassertTimers: NodeJS.Timeout[] = []; // Re-assert dock-hidden state after show+focus
  private _ollamaBootstrapPromise: Promise<void> | null = null;
  public screenshotCaptureInProgress: boolean = false;


  // Processing events
  public readonly PROCESSING_EVENTS = {
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

  constructor() {
    // 1. Load boot-critical settings first (used by WindowHelpers)
    const settingsManager = SettingsManager.getInstance();
    this.isUndetectable = settingsManager.get('isUndetectable') ?? false;
    this.disguiseMode = settingsManager.get('disguiseMode') ?? 'none';
    this._verboseLogging = settingsManager.get('verboseLogging') ?? false;
    setVerboseLoggingFlag(this._verboseLogging);
    console.log(`[AppState] Initialized with isUndetectable=${this.isUndetectable}, disguiseMode=${this.disguiseMode}, verboseLogging=${this._verboseLogging}`);

    // 2. Initialize Helpers with loaded state
    this.windowHelper = new WindowHelper(this)
    this.settingsWindowHelper = new SettingsWindowHelper()
    this.modelSelectorWindowHelper = new ModelSelectorWindowHelper()
    this.cropperWindowHelper = new CropperWindowHelper()

    // 3. Initialize other helpers
    this.screenshotHelper = new ScreenshotHelper(this.view)
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

    keybindManager.onShortcutTriggered(async (actionId) => {
      console.log(`[Main] Global shortcut triggered: ${actionId}`);
      try {
        if (actionId === 'general:toggle-visibility') {
          this.toggleMainWindow();
        } else if (actionId === 'general:toggle-mouse-passthrough') {
          // Adapted from public PR #113 — verify premium interaction
          this.toggleOverlayMousePassthrough();
        } else if (actionId === 'general:take-screenshot') {
          const screenshotPath = await this.takeScreenshot(false);
          const preview = await this.getImagePreview(screenshotPath);
          const mainWindow = this.getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send("screenshot-taken", {
              path: screenshotPath,
              preview
            });
          }
        } else if (actionId === 'general:selective-screenshot') {
          const screenshotPath = await this.takeSelectiveScreenshot(false);
          const preview = await this.getImagePreview(screenshotPath);
          const mainWindow = this.getMainWindow();
          if (mainWindow) {
            // preload.ts maps 'screenshot-attached' to onScreenshotAttached
            mainWindow.webContents.send("screenshot-attached", {
              path: screenshotPath,
              preview
            });
          }
        } else if (actionId === 'general:capture-and-process') {
          // Single-trigger: capture current screen then immediately request AI analysis
          const screenshotPath = await this.takeScreenshot(false);
          const preview = await this.getImagePreview(screenshotPath);
          // Ensure the window is visible so the user can see the response without stealing focus
          this.showMainWindow(true);
          // win.focus() can cause macOS to re-activate the app. Re-hide the dock
          // if we are in undetectable mode.
          if (process.platform === 'darwin' && this.isUndetectable) {
            app.dock.hide();
          }
          const mainWindow = this.getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send("capture-and-process", {
              path: screenshotPath,
              preview
            });
          }

        // --- STEALTH SHORTCUTS: no focus, no show, pure IPC dispatch ---

        // Chat actions — fire into the renderer without focusing the window
        } else if (
          actionId === 'chat:whatToAnswer' ||
          actionId === 'chat:clarify' ||
          actionId === 'chat:followUp' ||
          actionId === 'chat:answer' ||
          actionId === 'chat:codeHint' ||
          actionId === 'chat:brainstorm' ||
          actionId === 'chat:dynamicAction4' ||
          actionId === 'chat:scrollUp' ||
          actionId === 'chat:scrollDown'
        ) {
          const actionMap: Record<string, string> = {
            'chat:whatToAnswer': 'whatToAnswer',
            'chat:clarify': 'clarify',
            'chat:followUp': 'followUp',
            'chat:answer': 'answer',
            'chat:codeHint': 'codeHint',
            'chat:brainstorm': 'brainstorm',
            'chat:dynamicAction4': 'dynamicAction4',
            'chat:scrollUp': 'scrollUp',
            'chat:scrollDown': 'scrollDown',
          };
          const action = actionMap[actionId];
          // Send to all windows without focusing — stealth operation
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('global-shortcut', { action });
            }
          });

        // Window movement — move window position without focus change
        } else if (actionId === 'window:move-up') {
          this.windowHelper.moveWindowUp();
        } else if (actionId === 'window:move-down') {
          this.windowHelper.moveWindowDown();
        } else if (actionId === 'window:move-left') {
          this.windowHelper.moveWindowLeft();
        } else if (actionId === 'window:move-right') {
          this.windowHelper.moveWindowRight();

        // General actions that are now global (stealth)
        } else if (actionId === 'general:process-screenshots') {
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('global-shortcut', { action: 'processScreenshots' });
            }
          });
        } else if (actionId === 'general:reset-cancel') {
          const allWindows = BrowserWindow.getAllWindows();
          allWindows.forEach(win => {
            if (!win.isDestroyed()) {
              win.webContents.send('global-shortcut', { action: 'resetCancel' });
            }
          });
        }
      } catch (e: any) {
        if (e.message !== "Selection cancelled" && e.message !== "Screenshot capture already in progress") {
          console.error(`[Main] Error handling global shortcut ${actionId}:`, e);
        }
      }
    });

    // Inject WindowHelper into other helpers
    this.settingsWindowHelper.setWindowHelper(this.windowHelper);
    this.modelSelectorWindowHelper.setWindowHelper(this.windowHelper);





    // Initialize IntelligenceManager with LLMHelper
    this.intelligenceManager = new IntelligenceManager(this.processingHelper.getLLMHelper())

    // Initialize ThemeManager
    this.themeManager = ThemeManager.getInstance()

    // Initialize RAGManager (requires database to be ready)
    this.initializeRAGManager()
    
    // Check and prep Ollama embedding model
    this.bootstrapOllamaEmbeddings()


    this.setupIntelligenceEvents()

    // Pre-warm the zero-shot intent classifier in background
    warmupIntentClassifier();

    // Setup Ollama IPC
    this.setupOllamaIpcHandlers()

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

  private broadcastMeetingState(): void {
    this.broadcast('meeting-state-changed', { isActive: this.isMeetingActive });
  }

  private async bootstrapOllamaEmbeddings() {
    this._ollamaBootstrapPromise = (async () => {
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
             const { CredentialsManager } = require('./services/CredentialsManager');
             const cm = CredentialsManager.getInstance();
             this.ragManager.initializeEmbeddings({
                openaiKey: cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY || undefined,
                geminiKey: cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined,
                ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434"
             });
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
        const { CredentialsManager } = require('./services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        const openaiKey = cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY;
        const geminiKey = cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        
        this.ragManager = new RAGManager({ 
            db: sqliteDb, 
            dbPath: db.getDbPath(),
            extPath: db.getExtPath(),
            openaiKey,
            geminiKey,
            ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434'
        });
        this.ragManager.setLLMHelper(this.processingHelper.getLLMHelper());
        console.log('[AppState] RAGManager initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize RAGManager:', error);
    }

    // Initialize Knowledge Orchestrator
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb) {
        const knowledgeDb = new KnowledgeDatabaseManagerClass(sqliteDb);
        this.knowledgeOrchestrator = new KnowledgeOrchestratorClass(knowledgeDb);

        // Wire up LLM functions
        const llmHelper = this.processingHelper.getLLMHelper();

        // generateContent function for LLM calls
        this.knowledgeOrchestrator.setGenerateContentFn(async (contents: any[]) => {
          return await llmHelper.generateContentStructured(
            contents[0]?.text || ''
          );
        });

        // Embedding function — lazily delegate to the cascaded EmbeddingPipeline
        // (OpenAI → Gemini → Ollama → Local bundled model).
        // We await waitForReady() so uploads during boot wait for the pipeline
        // instead of immediately throwing 'not ready'.
        const self = this;
        this.knowledgeOrchestrator.setEmbedFn(async (text: string) => {
          const pipeline = self.ragManager?.getEmbeddingPipeline();
          if (!pipeline) throw new Error('RAG pipeline not available');
          await pipeline.waitForReady();
          return await pipeline.getEmbedding(text);
        });
        if (typeof this.knowledgeOrchestrator.setEmbedQueryFn === 'function') {
          this.knowledgeOrchestrator.setEmbedQueryFn(async (text: string) => {
            const pipeline = self.ragManager?.getEmbeddingPipeline();
            if (!pipeline) throw new Error('RAG pipeline not available');
            await pipeline.waitForReady();
            return await pipeline.getEmbeddingForQuery(text);
          });
        }

        // Attach KnowledgeOrchestrator to LLMHelper
        llmHelper.setKnowledgeOrchestrator(this.knowledgeOrchestrator);

        console.log('[AppState] KnowledgeOrchestrator initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize KnowledgeOrchestrator:', error);
    }
  }

  public setupAutoUpdater(): void {
    setupAutoUpdaterFn(this)
  }

  public async checkForUpdatesManual(): Promise<void> {
    await checkForUpdatesManualFn(this)
  }

  public isVersionNewer(current: string, latest: string): boolean {
    return isVersionNewerFn(this, current, latest)
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
  public systemAudioCapture: any = null;
  public microphoneCapture: any = null;
  public audioTestCapture: any = null; // For audio settings test
  private _audioTestStarting = false;               // P2-12: in-flight guard against concurrent calls
  public googleSTT: STTProvider | null = null; // Interviewer
  public googleSTT_User: STTProvider | null = null; // User
  public lastSystemAudioChunkAt: number | null = null;
  public lastInterviewerTranscriptAt: number | null = null;
  public lastAudioPipelineError: string | null = null;
  public transcriptTurnBuffers: Record<TranscriptSpeaker, BufferedTranscriptTurn | null> = {
    interviewer: null,
    user: null,
  };

  public getTranscriptAssemblerThresholds(): TranscriptAssemblerThresholds {
    return getTranscriptAssemblerThresholdsFn(this)
  }

  public emitNativeAudioTranscript(payload: any): void {
    emitNativeAudioTranscriptFn(this, payload)
  }

  public createTranscriptSegmentId(speaker: TranscriptSpeaker, timestamp: number): string {
    return createTranscriptSegmentIdFn(this, speaker, timestamp)
  }

  public normalizeTranscriptText(text: string): string {
    return normalizeTranscriptTextFn(this, text)
  }

  public endsSentence(text: string): boolean {
    return endsSentenceFn(this, text)
  }

  public mergeTranscriptText(existing: string, incoming: string): string {
    return mergeTranscriptTextFn(this, existing, incoming)
  }

  public scheduleBufferedTranscriptFlush(speaker: TranscriptSpeaker, delayMs: number): void {
    scheduleBufferedTranscriptFlushFn(this, speaker, delayMs)
  }

  public bufferFinalTranscriptChunk(
    speaker: TranscriptSpeaker,
    text: string,
    timestamp: number,
    confidence: number
  ): void {
    bufferFinalTranscriptChunkFn(this, speaker, text, timestamp, confidence)
  }

  public handleSpeakerSpeechEnded(speaker: TranscriptSpeaker): void {
    handleSpeakerSpeechEndedFn(this, speaker)
  }

  public resetBufferedTranscriptTurns(): void {
    resetBufferedTranscriptTurnsFn(this)
  }

  public async flushBufferedTranscriptTurn(speaker: TranscriptSpeaker): Promise<void> {
    await flushBufferedTranscriptTurnFn(this, speaker)
  }

  public async emitTranscriptWithTranslation(params: {
    speaker: TranscriptSpeaker;
    text: string;
    timestamp: number;
    confidence: number;
    segmentId: string;
    speakerLabel?: string;
    forceTranslate?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    return emitTranscriptWithTranslationFn(this, params)
  }

  public createSTTProvider(speaker: 'interviewer' | 'user'): STTProvider {
    return createSTTProviderFn(this, speaker)
  }

  public setupSystemAudioPipeline(): void {
    setupSystemAudioPipelineFn(this)
  }

  private async reconfigureAudio(inputDeviceId?: string, outputDeviceId?: string): Promise<void> {
    console.log(`[Main] Reconfiguring Audio: Input=${inputDeviceId}, Output=${outputDeviceId}`);
    this.resetBufferedTranscriptTurns();

    // 1. System Audio (Output Capture)
    if (this.systemAudioCapture) {
      this.systemAudioCapture.stop();
      this.systemAudioCapture = null;
    }

    try {
      console.log('[Main] Initializing SystemAudioCapture...');
      this.systemAudioCapture = new SystemAudioCapture(outputDeviceId || undefined);
      const rate = this.systemAudioCapture.getSampleRate();
      console.log(`[Main] SystemAudioCapture rate: ${rate}Hz`);
      this.googleSTT?.setSampleRate(rate);

      this.systemAudioCapture.on('data', (chunk: Buffer) => {
        // console.log('[Main] SysAudio chunk', chunk.length);
        this.lastSystemAudioChunkAt = Date.now();
        this.googleSTT?.write(chunk);
      });
      this.systemAudioCapture.on('speech_ended', () => {
        this.googleSTT?.notifySpeechEnded?.();
        this.handleSpeakerSpeechEnded('interviewer');
      });
      this.systemAudioCapture.on('error', (err: Error) => {
        console.error('[Main] SystemAudioCapture Error:', err);
        this.lastAudioPipelineError = err.message || 'System audio capture error';
      });
      console.log('[Main] SystemAudioCapture initialized.');
    } catch (err) {
      console.warn('[Main] Failed to initialize SystemAudioCapture with preferred ID. Falling back to default.', err);
      try {
        this.systemAudioCapture = new SystemAudioCapture(); // Default
        const rate = this.systemAudioCapture.getSampleRate();
        console.log(`[Main] SystemAudioCapture (Default) rate: ${rate}Hz`);
        this.googleSTT?.setSampleRate(rate);

        this.systemAudioCapture.on('data', (chunk: Buffer) => {
          this.lastSystemAudioChunkAt = Date.now();
          this.googleSTT?.write(chunk);
        });
        this.systemAudioCapture.on('speech_ended', () => {
          this.googleSTT?.notifySpeechEnded?.();
          this.handleSpeakerSpeechEnded('interviewer');
        });
        this.systemAudioCapture.on('error', (err: Error) => {
          console.error('[Main] SystemAudioCapture (Default) Error:', err);
          this.lastAudioPipelineError = err.message || 'System audio capture error';
        });
      } catch (err2) {
        console.error('[Main] Failed to initialize SystemAudioCapture (Default):', err2);
      }
    }

    // 2. Microphone (Input Capture)
    if (this.microphoneCapture) {
      this.microphoneCapture.stop();
      this.microphoneCapture = null;
    }

    try {
      console.log('[Main] Initializing MicrophoneCapture...');
      this.microphoneCapture = new MicrophoneCapture(inputDeviceId || undefined);
      const rate = this.microphoneCapture.getSampleRate();
      console.log(`[Main] MicrophoneCapture rate: ${rate}Hz`);
      this.googleSTT_User?.setSampleRate(rate);

      this.microphoneCapture.on('data', (chunk: Buffer) => {
        // console.log('[Main] Mic chunk', chunk.length);
        this.googleSTT_User?.write(chunk);
      });
      this.microphoneCapture.on('speech_ended', () => {
        this.googleSTT_User?.notifySpeechEnded?.();
        this.handleSpeakerSpeechEnded('user');
      });
      this.microphoneCapture.on('error', (err: Error) => {
        console.error('[Main] MicrophoneCapture Error:', err);
      });
      console.log('[Main] MicrophoneCapture initialized.');
    } catch (err) {
      console.warn('[Main] Failed to initialize MicrophoneCapture with preferred ID. Falling back to default.', err);
      try {
        this.microphoneCapture = new MicrophoneCapture(); // Default
        const rate = this.microphoneCapture.getSampleRate();
        console.log(`[Main] MicrophoneCapture (Default) rate: ${rate}Hz`);
        this.googleSTT_User?.setSampleRate(rate);

        this.microphoneCapture.on('data', (chunk: Buffer) => {
          this.googleSTT_User?.write(chunk);
        });
        this.microphoneCapture.on('speech_ended', () => {
          this.googleSTT_User?.notifySpeechEnded?.();
          this.handleSpeakerSpeechEnded('user');
        });
        this.microphoneCapture.on('error', (err: Error) => {
          console.error('[Main] MicrophoneCapture (Default) Error:', err);
        });
      } catch (err2) {
        console.error('[Main] Failed to initialize MicrophoneCapture (Default):', err2);
      }
    }
  }

  /**
   * Reconfigure STT provider mid-session (called from IPC when user changes provider)
   * Destroys existing STT instances and recreates them with the new provider
   */
  public async reconfigureSttProvider(): Promise<void> {
    console.log('[Main] Reconfiguring STT Provider...');

    // RC-01 fix: pause audio captures FIRST so their EventEmitter queues drain
    // before we null-out the STT instances. Without this, buffered 'data' events
    // still in-flight call this.googleSTT?.write() while googleSTT is already null.
    if (this.isMeetingActive) {
      this.systemAudioCapture?.stop();
      this.microphoneCapture?.stop();
    }

    // Now safe to destroy STT instances — no more audio events incoming
    if (this.googleSTT) {
      this.googleSTT.stop();
      this.googleSTT.removeAllListeners();
      this.googleSTT = null;
    }
    if (this.googleSTT_User) {
      this.googleSTT_User.stop();
      this.googleSTT_User.removeAllListeners();
      this.googleSTT_User = null;
    }

    // Reinitialize the pipeline (will pick up the new provider from CredentialsManager)
    this.setupSystemAudioPipeline();

    // Restart audio captures and new STT instances if a meeting is active
    if (this.isMeetingActive) {
      this.systemAudioCapture?.start();
      this.microphoneCapture?.start();
      this.googleSTT?.start();
      this.googleSTT_User?.start();
    }

    console.log('[Main] STT Provider reconfigured');
  }


  public async startAudioTest(deviceId?: string): Promise<void> {
    await startAudioTestFn(this, deviceId)
  }

  public async _startAudioTestImpl(deviceId?: string): Promise<void> {
    await startAudioTestImplFn(this, deviceId)
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
    hasRecentInterviewerTranscript: boolean;
    lastSystemAudioChunkAt: number | null;
    lastInterviewerTranscriptAt: number | null;
    lastError: string | null;
  } {
    return getNativeAudioStatusFn(this)
  }

  public async startMeeting(metadata?: any): Promise<void> {
    console.log('[Main] Starting Meeting...', metadata);

    if (!(await ensureMacMicrophoneAccess('meeting start'))) {
      const message = 'Microphone access denied. Please allow microphone access in System Settings.';
      this.broadcast('meeting-audio-error', message);
      throw new Error(message);
    }

    this.isMeetingActive = true;
    this.resetBufferedTranscriptTurns();
    this.lastSystemAudioChunkAt = null;
    this.lastInterviewerTranscriptAt = null;
    this.lastAudioPipelineError = null;
    this.broadcastMeetingState();
    if (metadata) {
      this.intelligenceManager.setMeetingMetadata(metadata);
    }

    // Emit session reset to clear UI state immediately
    this.getWindowHelper().getOverlayWindow()?.webContents.send('session-reset');
    this.getWindowHelper().getLauncherWindow()?.webContents.send('session-reset');

    // ★ ASYNC AUDIO INIT: Return INSTANTLY so the IPC response goes back
    // to the renderer immediately, allowing the UI to switch to overlay
    // without waiting for SCK/audio initialization (which takes 5-7 seconds).
    // setTimeout(0) ensures setWindowMode IPC is processed first.
    setTimeout(async () => {
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
          await this.reconfigureAudio(metadata.audio.inputDeviceId, metadata.audio.outputDeviceId);
        }

        // LAZY INIT: Ensure pipeline is ready (if not reconfigured above)
        this.setupSystemAudioPipeline();

        // Start System Audio
        this.systemAudioCapture?.start();
        this.googleSTT?.start();

        // Start Microphone
        this.microphoneCapture?.start();
        this.googleSTT_User?.start();

        // Start JIT RAG live indexing
        if (this.ragManager) {
          this.ragManager.startLiveIndexing('live-meeting-current');
        }

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

  public async endMeeting(): Promise<void> {
    console.log('[Main] Ending Meeting...');
    this.isMeetingActive = false; // Block new data immediately
    this.broadcastMeetingState();

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
    this.lastInterviewerTranscriptAt = null;
    this.lastAudioPipelineError = null;

    // Save session state and reset context — MeetingPersistence.stopMeeting() is
    // already fire-and-forget internally (processAndSaveMeeting runs in background).
    // Capture the meetingId NOW so the background IIFE uses a deterministic ID
    // rather than getRecentMeetings(1) which could return a different meeting if the
    // user starts a new session before background processing finishes.
    const meetingId = await this.intelligenceManager.stopMeeting();

    // Revert to Default Model — synchronous, no blocking I/O
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const defaultModel = cm.getDefaultModel();
      const all = cm.getMergedLlmCustomProviders();
      console.log(`[Main] Reverting model to default: ${defaultModel}`);
      this.processingHelper.getLLMHelper().setModel(defaultModel, all);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('model-changed', defaultModel);
      });
    } catch (e) {
      console.error('[Main] Failed to revert model:', e);
    }

    // ─── Background post-processing ──────────────────────────────────────────
    // These are the previously blocking operations that caused the stop-button
    // delay. They are pure background tasks with no UI dependency:
    //   • stopLiveIndexing flushes the JIT RAG live stream
    //   • processCompletedMeetingForRAG embeds the full meeting into the vector store
    //   • deleteMeetingData cleans up provisional JIT chunks
    // Chain them sequentially in the background so ordering is preserved,
    // but the IPC call returns immediately and the UI transitions without delay.
    const ragManager = this.ragManager;
    if (meetingId) {
      (async () => {
        try {
          if (ragManager) {
            await ragManager.stopLiveIndexing();
            console.log('[Main] Live RAG indexing stopped.');
          }
          await this.processCompletedMeetingForRAG(meetingId);
          // Guard: only delete live-meeting-current provisional chunks if no new
          // meeting has started while we were processing. If a new meeting IS active,
          // 'live-meeting-current' now belongs to that session — leave it alone.
          if (ragManager && !this.isMeetingActive) {
            ragManager.deleteMeetingData('live-meeting-current');
            console.log('[Main] JIT RAG provisional chunks cleaned up.');
          } else if (this.isMeetingActive) {
            console.log('[Main] New meeting started during cleanup — skipping live-meeting-current deletion.');
          }
        } catch (err) {
          console.error('[Main] Background post-meeting RAG processing failed:', err);
        }
      })();
    } else {
      // Meeting was too short — still flush the live indexer and clean up
      if (ragManager) {
        ragManager.stopLiveIndexing().catch(() => {});
        if (!this.isMeetingActive) ragManager.deleteMeetingData('live-meeting-current');
      }
    }
    // ─────────────────────────────────────────────────────────────────────────
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

      // Generate summary from detailedSummary if available
      let summary: string | undefined;
      if (meeting.detailedSummary) {
        summary = [
          ...(meeting.detailedSummary.keyPoints || []),
          ...(meeting.detailedSummary.actionItems || []).map(a => `Action: ${a}`)
        ].join('. ');
      }

      const result = await this.ragManager.processMeeting(meeting.id, segments, summary);
      console.log(`[AppState] RAG processed meeting ${meeting.id}: ${result.chunkCount} chunks`);

    } catch (error) {
      console.error('[AppState] Failed to process meeting for RAG:', error);
    }
  }

  private setupIntelligenceEvents(): void {
    const mainWindow = this.getMainWindow.bind(this)

    // Forward intelligence events to renderer
    this.intelligenceManager.on('assist_update', (insight: string) => {
      // Send to both if both exist, though mostly overlay needs it
      const helper = this.getWindowHelper();
      helper.getLauncherWindow()?.webContents.send('intelligence-assist-update', { insight });
      helper.getOverlayWindow()?.webContents.send('intelligence-assist-update', { insight });
    })

    this.intelligenceManager.on('suggested_answer', (answer: string, question: string, confidence: number) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-suggested-answer', { answer, question, confidence })
      }

    })

    this.intelligenceManager.on('suggested_answer_token', (token: string, question: string, confidence: number) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-suggested-answer-token', { token, question, confidence })
      }
    })

    this.intelligenceManager.on('refined_answer_token', (token: string, intent: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-refined-answer-token', { token, intent })
      }
    })

    this.intelligenceManager.on('refined_answer', (answer: string, intent: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-refined-answer', { answer, intent })
      }

    })

    this.intelligenceManager.on('recap', (summary: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-recap', { summary })
      }
    })

    this.intelligenceManager.on('recap_token', (token: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-recap-token', { token })
      }
    })

    this.intelligenceManager.on('clarify', (clarification: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-clarify', { clarification })
      }
    })

    this.intelligenceManager.on('clarify_token', (token: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-clarify-token', { token })
      }
    })

    this.intelligenceManager.on('follow_up_questions_update', (questions: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-follow-up-questions-update', { questions })
      }
    })

    this.intelligenceManager.on('follow_up_questions_token', (token: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-follow-up-questions-token', { token })
      }
    })

    this.intelligenceManager.on('manual_answer_started', () => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-started')
      }
    })

    this.intelligenceManager.on('manual_answer_result', (answer: string, question: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-result', { answer, question })
      }

    })

    this.intelligenceManager.on('mode_changed', (mode: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-mode-changed', { mode })
      }
    })

    this.intelligenceManager.on('error', (error: Error, mode: string) => {
      console.error(`[IntelligenceManager] Error in ${mode}:`, error)
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-error', { error: error.message, mode })
      }
    })
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

  public setRecognitionLanguage(key: string): void {
    console.log(`[AppState] Setting recognition language to: ${key}`);
    const { CredentialsManager } = require('./services/CredentialsManager');
    CredentialsManager.getInstance().setSttLanguage(key);
    this.googleSTT?.setRecognitionLanguage(key);
    this.googleSTT_User?.setRecognitionLanguage(key);
    this.processingHelper.getLLMHelper().setSttLanguage(key);
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

  public getRAGManager(): RAGManager | null {
    return this.ragManager;
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public setupOllamaIpcHandlers(): void {
    ipcMain.handle('get-ollama-models', async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout for detection

        const response = await fetch('http://localhost:11434/api/tags', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          // data.models is an array of objects: { name: "llama3:latest", ... }
          return data.models.map((m: any) => m.name);
        }
        return [];
      } catch (error) {
        // console.warn("Ollama detection failed:", error);
        return [];
      }
    });
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
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
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

    // Clear problem info
    this.problemInfo = null

    // Reset view to initial state
    this.setView("queue")
  }

  private createScreenshotCaptureSession(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean
  ): ScreenshotCaptureSession {
    const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
    const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();

    return {
      captureKind,
      wasMainWindowVisible: this.windowHelper.isVisible(),
      windowMode: this.windowHelper.getCurrentWindowMode(),
      wasSettingsVisible: !!settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible(),
      wasModelSelectorVisible: !!modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible(),
      overlayBounds: this.windowHelper.getLastOverlayBounds(),
      overlayDisplayId: this.windowHelper.getLastOverlayDisplayId(),
      restoreWithoutFocus: process.platform === 'darwin' || !restoreFocus
    };
  }

  private getDisplayById(displayId: number | null): Electron.Display | undefined {
    if (displayId === null) return undefined;
    return screen.getAllDisplays().find(display => display.id === displayId);
  }

  private getTargetDisplayForFullScreenshot(session: ScreenshotCaptureSession): Electron.Display {
    if (session.windowMode === 'overlay' && session.overlayBounds) {
      return screen.getDisplayMatching(session.overlayBounds);
    }

    const lastOverlayDisplay = this.getDisplayById(session.overlayDisplayId);
    if (lastOverlayDisplay) {
      return lastOverlayDisplay;
    }

    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  private hideWindowsForScreenshot(session: ScreenshotCaptureSession): void {
    if (session.wasModelSelectorVisible) {
      this.modelSelectorWindowHelper.hideWindow();
    }

    if (session.wasSettingsVisible) {
      this.settingsWindowHelper.closeWindow();
    }

    if (session.wasMainWindowVisible) {
      this.hideMainWindow();
    }
  }

  private restoreWindowsAfterScreenshot(session: ScreenshotCaptureSession): void {
    const activate = !session.restoreWithoutFocus;
    const shouldRestoreMainWindow = session.wasMainWindowVisible;

    if (shouldRestoreMainWindow) {
      if (session.windowMode === 'overlay') {
        this.windowHelper.switchToOverlay(!activate);
      } else {
        this.windowHelper.switchToLauncher(!activate);
      }
    }

    if (session.wasSettingsVisible) {
      const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        const { x, y } = settingsWindow.getBounds();
        this.settingsWindowHelper.showWindow(x, y, { activate });
      }
    }

    if (session.wasModelSelectorVisible) {
      const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();
      if (modelSelectorWindow && !modelSelectorWindow.isDestroyed()) {
        const { x, y } = modelSelectorWindow.getBounds();
        this.modelSelectorWindowHelper.showWindow(x, y, { activate });
      }
    }
  }

  private async withScreenshotCaptureSession<T>(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean,
    capture: (session: ScreenshotCaptureSession) => Promise<T>
  ): Promise<T> {
    if (!this.getMainWindow()) {
      throw new Error("No main window available");
    }

    if (this.screenshotCaptureInProgress) {
      throw new Error("Screenshot capture already in progress");
    }

    const session = this.createScreenshotCaptureSession(captureKind, restoreFocus);
    this.screenshotCaptureInProgress = true;

    try {
      this.hideWindowsForScreenshot(session);
      await new Promise(resolve => setTimeout(resolve, 50));
      return await capture(session);
    } finally {
      try {
        this.restoreWindowsAfterScreenshot(session);
      } finally {
        this.screenshotCaptureInProgress = false;
      }
    }
  }

  // Screenshot management methods
  public async takeScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('full', restoreFocus, (session) =>
      this.screenshotHelper.takeScreenshot(this.getTargetDisplayForFullScreenshot(session))
    )
  }

  public async takeSelectiveScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('selective', restoreFocus, async () => {
      let captureArea: Electron.Rectangle | undefined;

      if (process.platform === 'win32' || process.platform === 'darwin') {
        captureArea = await this.cropperWindowHelper.showCropper();

        if (!captureArea) {
          throw new Error("Selection cancelled");
        }
      }

      return this.screenshotHelper.takeSelectiveScreenshot(captureArea)
    })
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

  public createTray(): void {
    createTrayFn(this)
  }

  public showTray(): void {
    showTrayFn(this)
  }

  public updateTrayMenu() {
    updateTrayMenuFn(this)
  }

  public hideTray(): void {
    hideTrayFn(this)
  }

  public setHasDebugged(value: boolean): void {
    setHasDebuggedFn(this, value)
  }

  public getHasDebugged(): boolean {
    return getHasDebuggedFn(this)
  }

  public setUndetectable(state: boolean): void {
    setUndetectableFn(this, state)
  }

  public getUndetectable(): boolean {
    return getUndetectableFn(this)
  }

  // --- Mouse Passthrough (Adapted from public PR #113 — verify premium interaction) ---
  private overlayMousePassthrough: boolean = false;

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

  public setDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    setDisguiseFn(this, mode)
  }

  public applyInitialDisguise(): void {
    applyInitialDisguiseFn(this)
  }

  public _applyDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    applyDisguiseFn(this, mode)
  }

  // Helper: broadcast an IPC event to all windows
  public _broadcastToAllWindows(channel: string, ...args: any[]): void {
    broadcastToAllWindowsFn(this, channel, ...args)
  }

  public getDisguise(): string {
    return getDisguiseFn(this)
  }
}

// Start the application
initializeApp().catch(console.error)
