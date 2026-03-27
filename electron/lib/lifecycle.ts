import { app, BrowserWindow } from "electron"
import { initializeIpcHandlers } from "../ipc"
import { KeybindManager } from "../services/KeybindManager"
import { SettingsManager } from "../services/SettingsManager"
import { OllamaManager } from "../services/OllamaManager"
import { AppState } from "../main"

export async function initializeApp() {
  // 1. Enforce single instance — prevent duplicate dock icons from leftover processes.
  // In development mode with hot-reload this is still safe because electron is restarted
  // by the build step, not re-launched by concurrently while the old process is alive.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.log('[Main] Another instance is already running. Quitting this instance.');
    app.quit();
    return;
  }

  // When a second instance is launched, focus the existing window instead of doing nothing.
  app.on('second-instance', () => {
    const appState = AppState.getInstance();
    const mainWin = appState.getMainWindow();
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  // 2. Wait for app to be ready
  await app.whenReady()

  // 2b. PRE-EMPTIVE dock hide: must happen before ANY operation that causes macOS to
  // register a dock entry (app.setName, BrowserWindow creation, etc.).
  // We read isUndetectable directly from settings here — AppState singleton isn't
  // constructed yet, so we cannot call appState.getUndetectable().
  if (process.platform === 'darwin') {
    // SettingsManager is already statically imported — no require() needed.
    const isUndetectableOnStartup = SettingsManager.getInstance().get('isUndetectable') ?? false;
    if (isUndetectableOnStartup) {
      app.dock.hide();
    }
  }

  // 3. Initialize Managers
  // Initialize CredentialsManager and load keys explicitly
  // This fixes the issue where keys (especially in production) aren't loaded in time for RAG/LLM
  const { CredentialsManager } = require('../services/CredentialsManager');
  CredentialsManager.getInstance().init();

  // 4. Initialize State
  const appState = AppState.getInstance()

  // Explicitly load credentials into helpers
  appState.processingHelper.loadStoredCredentials();

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  // Apply the full disguise payload (names, dock icon, AUMID) early
  appState.applyInitialDisguise();

  // Start the Ollama lifecycle manager
  OllamaManager.getInstance().init().catch(console.error);

  // NOTE: CredentialsManager.init() and loadStoredCredentials() are already called
  // above before this block — do NOT call them again here to avoid double key-load.

  // Anonymous install ping - one-time, non-blocking
  // See electron/services/InstallPingManager.ts for privacy details
  const { sendAnonymousInstallPing } = require('../services/InstallPingManager');
  sendAnonymousInstallPing();

  // Load stored Google Service Account path (for Speech-to-Text)
  const storedServiceAccountPath = CredentialsManager.getInstance().getGoogleServiceAccountPath();
  if (storedServiceAccountPath) {
    console.log("[Init] Loading stored Google Service Account path");
    appState.updateGoogleCredentials(storedServiceAccountPath);
  }

  console.log("App is ready")

  appState.createWindow()

  // Apply initial stealth state based on isUndetectable setting.
  // NOTE: app.dock.hide() was already called pre-emptively before createWindow()
  // when isUndetectable=true. Here we only need to initialize the tray for non-stealth mode.
  if (!appState.getUndetectable()) {
    // Normal mode: show tray (dock is already showing — no need to call dock.show() again)
    appState.showTray();
  }
  // Stealth mode: dock is already hidden, tray stays hidden, no action needed here.
  // Register global shortcuts using KeybindManager
  KeybindManager.getInstance().registerGlobalShortcuts()

  // Pre-create settings window in background for faster first open
  appState.settingsWindowHelper.preloadWindow()

  // Diagnostic: log all BrowserWindows to debug duplicate dock icons
  const allWindows = BrowserWindow.getAllWindows();
  console.log(`[Diagnostic] Total BrowserWindows after init: ${allWindows.length}`);
  allWindows.forEach((win, i) => {
    console.log(`[Diagnostic]   Window ${i}: id=${win.id} title="${win.getTitle()}" visible=${win.isVisible()} skipTaskbar=${(win as any).skipTaskbar ?? 'unknown'}`);
  });

  // Initialize CalendarManager
  try {
    const { CalendarManager } = require('../services/CalendarManager');
    const calMgr = CalendarManager.getInstance();
    calMgr.init();

    calMgr.on('start-meeting-requested', (event: any) => {
      console.log('[Main] Start meeting requested from calendar notification', event);
      appState.centerAndShowWindow();
      appState.startMeeting({
        title: event.title,
        calendarEventId: event.id,
        source: 'calendar'
      });
    });

    calMgr.on('open-requested', () => {
      appState.centerAndShowWindow();
    });

    console.log('[Main] CalendarManager initialized');
  } catch (e) {
    console.error('[Main] Failed to initialize CalendarManager:', e);
  }

  // Recover unprocessed meetings (persistence check)
  appState.getIntelligenceManager().recoverUnprocessedMeetings().catch(err => {
    console.error('[Main] Failed to recover unprocessed meetings:', err);
  });

  // Note: We do NOT force dock show here anymore, respecting stealth mode.

  app.on("activate", () => {
    console.log("App activated")
    if (process.platform === 'darwin') {
      // Do NOT call dock.show() while a meeting is running — the dock icon
      // appearing mid-meeting is a critical stealth failure.
      if (!appState.getUndetectable() && !appState.getIsMeetingActive()) {
        app.dock.show();
      }
    }

    // If no window exists, create it
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    } else {
      // If the window exists but is hidden, clicking the dock icon should restore it
      if (!appState.isVisible()) {
        appState.toggleMainWindow();
      }
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Scrub API keys from memory on quit to minimize exposure window
  app.on("before-quit", (event) => {
    console.log("App is quitting, cleaning up resources...");
    appState.setQuitting(true);

    // Dispose CropperWindowHelper to clean up IPC listeners and prevent memory leaks
    // This is critical to prevent resource leaks and ensure proper cleanup
    if (appState?.cropperWindowHelper) {
      appState.cropperWindowHelper.dispose();
    }

    // Kill Ollama if we started it
    OllamaManager.getInstance().stop();

    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().scrubMemory();
      appState.processingHelper.getLLMHelper().scrubKeys();
      console.log('[Main] Credentials scrubbed from memory on quit');
    } catch (e) {
      console.error('[Main] Failed to scrub credentials on quit:', e);
    }
  })



  // app.dock?.hide() // REMOVED: User wants Dock icon visible
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// initializeApp() is called from main.ts — do not call here to avoid double invocation
