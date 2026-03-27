import { app, nativeImage } from "electron"
import path from "path"
import fs from "fs"
import { SettingsManager } from "../services/SettingsManager"
import { setVerboseLoggingFlag } from "../lib/verboseLog"
import type { AppState } from "../main"
import { hideTray, showTray } from "../lib/tray-menu"

export function setHasDebugged(appState: AppState, value: boolean): void {
  (appState as any).hasDebugged = value
}

export function getHasDebugged(appState: AppState): boolean {
  return (appState as any).hasDebugged
}

export function setUndetectable(appState: AppState, state: boolean): void {
  const appStateInternal = appState as any;

  // Guard: skip if state hasn't actually changed to prevent
  // duplicate dock hide/show cycles from renderer feedback loops
  if (appStateInternal.isUndetectable === state) return;

  console.log(`[Stealth] setUndetectable(${state}) called`);

  appStateInternal.isUndetectable = state
  appState.windowHelper.setContentProtection(state)
  appState.settingsWindowHelper.setContentProtection(state)
  appState.modelSelectorWindowHelper.setContentProtection(state)
  appState.cropperWindowHelper.setContentProtection(state)

  // Persist state via SettingsManager
  SettingsManager.getInstance().set('isUndetectable', state);

  // Cancel all pending disguise timers to prevent their app.setName() calls
  // from re-registering the dock icon after we hide it
  if (state) {
    for (const timer of appStateInternal._disguiseTimers) {
      clearTimeout(timer);
    }
    appStateInternal._disguiseTimers = [];
  }

  // Broadcast state change to all relevant windows
  _broadcastToAllWindows(appState, 'undetectable-changed', state);

  // --- STEALTH MODE LOGIC ---
  // The dock hide/show is debounced: rapid toggles update isUndetectable immediately
  // (so content protection, IPC broadcasts and the guard above are always current),
  // but the actual macOS dock/tray/focus operation only fires once the user stops
  // toggling. This eliminates the race where dock.show() + NSApp.activate() lingers
  // after a subsequent dock.hide() call.
  if (process.platform === 'darwin') {
    if (appStateInternal._dockDebounceTimer) {
      clearTimeout(appStateInternal._dockDebounceTimer);
      appStateInternal._dockDebounceTimer = null;
    }

    appStateInternal._dockDebounceTimer = setTimeout(() => {
      appStateInternal._dockDebounceTimer = null;

      // Read the settled state — may differ from the `state` captured above
      // if the user toggled again before the timer fired.
      const settled = appStateInternal.isUndetectable;

      const activeWindow = appState.windowHelper.getMainWindow();
      const settingsWindow = appState.settingsWindowHelper.getSettingsWindow();
      let targetFocusWindow = activeWindow;
      if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) {
        targetFocusWindow = settingsWindow;
      }

      const modelSelectorWindow = appState.modelSelectorWindowHelper.getWindow();
      const isModelSelectorVisible = modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible();

      if (targetFocusWindow && targetFocusWindow === settingsWindow) {
        appState.settingsWindowHelper.setIgnoreBlur(true);
      }
      if (isModelSelectorVisible) {
        appState.modelSelectorWindowHelper.setIgnoreBlur(true);
      }

      if (settled) {
        // Capture whether Pika is currently the frontmost app BEFORE
        // dock.hide() — that call triggers an implicit macOS app-deactivation
        // which shifts keyboard focus to the next frontmost app (Chrome, etc.).
        const pikaWasFocused =
          targetFocusWindow != null &&
          !targetFocusWindow.isDestroyed() &&
          targetFocusWindow.isFocused();

        console.log('[Stealth] Calling app.dock.hide()');
        app.dock.hide();
        hideTray(appState);

        // If Pika was the focused window when the user toggled stealth,
        // restore focus to our window after dock.hide() so macOS does not
        // hand control to Chrome / whatever is behind us.
        // We use win.focus() (not app.focus()) to avoid the heavy-handed
        // [NSApp activateIgnoringOtherApps:YES] side-effect.
        if (pikaWasFocused && targetFocusWindow && !targetFocusWindow.isDestroyed()) {
          targetFocusWindow.focus();
        }
      } else {
        console.log('[Stealth] Calling app.dock.show()');
        app.dock.show();
        showTray(appState);
        // Do NOT call focus() — let the user's current app retain focus
      }

      if (targetFocusWindow && targetFocusWindow === settingsWindow) {
        setTimeout(() => { appState.settingsWindowHelper.setIgnoreBlur(false); }, 500);
      }
      if (isModelSelectorVisible) {
        setTimeout(() => { appState.modelSelectorWindowHelper.setIgnoreBlur(false); }, 500);
      }
    }, 150);
  }
}

export function getUndetectable(appState: AppState): boolean {
  return (appState as any).isUndetectable
}

export function setOverlayMousePassthrough(appState: AppState, state: boolean): void {
  const appStateInternal = appState as any;

  if (appStateInternal.overlayMousePassthrough === state) return;

  console.log(`[Overlay] setOverlayMousePassthrough(${state}) called`);

  appStateInternal.overlayMousePassthrough = state;
  appState.windowHelper.syncOverlayInteractionPolicy();
  _broadcastToAllWindows(appState, 'overlay-mouse-passthrough-changed', state);
}

export function toggleOverlayMousePassthrough(appState: AppState): boolean {
  const next = !(appState as any).overlayMousePassthrough;
  setOverlayMousePassthrough(appState, next);
  return next;
}

export function getOverlayMousePassthrough(appState: AppState): boolean {
  return (appState as any).overlayMousePassthrough;
}

export function getVerboseLogging(appState: AppState): boolean {
  return (appState as any)._verboseLogging;
}

export function setVerboseLogging(appState: AppState, enabled: boolean): void {
  (appState as any)._verboseLogging = enabled;
  setVerboseLoggingFlag(enabled);
  SettingsManager.getInstance().set('verboseLogging', enabled);
  console.log(`[AppState] verboseLogging set to ${enabled}`);
}

export function setDisguise(appState: AppState, mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
  (appState as any).disguiseMode = mode;
  SettingsManager.getInstance().set('disguiseMode', mode);

  // Apply the disguise regardless of undetectable state
  // (disguise affects Activity Monitor name via process.title,
  //  dock icon only updates when NOT in stealth)
  _applyDisguise(appState, mode);
}

export function applyInitialDisguise(appState: AppState): void {
  _applyDisguise(appState, (appState as any).disguiseMode);
}

export function _applyDisguise(appState: AppState, mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
  const appStateInternal = appState as any;

  let appName = "Pika";
  let iconPath = "";

  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  switch (mode) {
    case 'terminal':
      appName = isWin ? "Command Prompt " : "Terminal ";
      if (isWin) {
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/fakeicon/win/terminal.png")
          : path.join(app.getAppPath(), "assets/fakeicon/win/terminal.png");
      } else {
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/fakeicon/mac/terminal.png")
          : path.join(app.getAppPath(), "assets/fakeicon/mac/terminal.png");
      }
      break;
    case 'settings':
      appName = isWin ? "Settings " : "System Settings ";
      if (isWin) {
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/fakeicon/win/settings.png")
          : path.join(app.getAppPath(), "assets/fakeicon/win/settings.png");
      } else {
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/fakeicon/mac/settings.png")
          : path.join(app.getAppPath(), "assets/fakeicon/mac/settings.png");
      }
      break;
    case 'activity':
      appName = isWin ? "Task Manager " : "Activity Monitor ";
      if (isWin) {
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/fakeicon/win/activity.png")
          : path.join(app.getAppPath(), "assets/fakeicon/win/activity.png");
      } else {
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/fakeicon/mac/activity.png")
          : path.join(app.getAppPath(), "assets/fakeicon/mac/activity.png");
      }
      break;
    case 'none':
      appName = "Pika";
      if (isMac) {
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets", "pika.icns")
          : path.join(app.getAppPath(), "assets/pika.icns");
      } else if (isWin) {
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "assets/icons/win/icon.ico")
          : path.join(app.getAppPath(), "assets/icons/win/icon.ico");
      } else {
        iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "icon.png")
          : path.join(app.getAppPath(), "assets/icon.png");
      }
      break;
  }

  console.log(`[AppState] Applying disguise: ${mode} (${appName}) on ${process.platform}`);

  // 1. Update process title (affects Activity Monitor / Task Manager)
  process.title = appName;

  // 2. Update app name (affects macOS Menu / Dock)
  // Skip when undetectable — app.setName() causes macOS to re-register
  // the app and re-show the dock icon even after dock.hide()
  if (!appStateInternal.isUndetectable) {
    app.setName(appName);
  }

  if (isMac) {
    process.env.CFBundleName = appName.trim();
  }

  // 3. Update App User Model ID (Windows Taskbar grouping)
  if (isWin) {
    // Use unique AUMID per disguise to avoid grouping with the real app
    app.setAppUserModelId(`com.pika.assistant.${mode}`);
  }

  // 4. Update Icons
  if (fs.existsSync(iconPath)) {
    const image = nativeImage.createFromPath(iconPath);

    if (isMac) {
      // Skip dock icon update when dock is hidden to avoid potential flicker
      if (!appStateInternal.isUndetectable) {
        app.dock.setIcon(image);
      }
    } else {
      // Windows/Linux: Update all window icons
      appState.windowHelper.getLauncherWindow()?.setIcon(image);
      appState.windowHelper.getOverlayWindow()?.setIcon(image);
      appState.settingsWindowHelper.getSettingsWindow()?.setIcon(image);
    }
  } else {
    console.warn(`[AppState] Disguise icon not found: ${iconPath}`);
  }

  // 5. Update Window Titles
  const launcher = appState.windowHelper.getLauncherWindow();
  if (launcher && !launcher.isDestroyed()) {
    launcher.setTitle(appName.trim());
    launcher.webContents.send('disguise-changed', mode);
  }

  const overlay = appState.windowHelper.getOverlayWindow();
  if (overlay && !overlay.isDestroyed()) {
    overlay.setTitle(appName.trim());
    overlay.webContents.send('disguise-changed', mode);
  }

  const settingsWin = appState.settingsWindowHelper.getSettingsWindow();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.setTitle(appName.trim());
    settingsWin.webContents.send('disguise-changed', mode);
  }

  // Cancel any stale forceUpdate timeouts from previous disguise changes
  for (const timer of appStateInternal._disguiseTimers) {
    clearTimeout(timer);
  }
  appStateInternal._disguiseTimers = [];

  // Periodically re-assert process.title only — it can drift on some systems.
  // NOTE: We intentionally do NOT call app.setName() here — it was already called
  // synchronously above, and repeated calls on macOS cause the system to briefly
  // show a second dock tile while re-registering the app identity.
  const scheduleUpdate = (ms: number) => {
    const ts = setTimeout(() => {
      process.title = appName;
      appStateInternal._disguiseTimers = appStateInternal._disguiseTimers.filter((t: NodeJS.Timeout) => t !== ts);
    }, ms);
    appStateInternal._disguiseTimers.push(ts);
  };

  scheduleUpdate(200);
  scheduleUpdate(1000);
  scheduleUpdate(5000);
}

export function _broadcastToAllWindows(appState: AppState, channel: string, ...args: any[]): void {
  const windows = [
    appState.windowHelper.getMainWindow(),
    appState.windowHelper.getLauncherWindow(),
    appState.windowHelper.getOverlayWindow(),
    appState.settingsWindowHelper.getSettingsWindow(),
    appState.modelSelectorWindowHelper.getWindow(),
  ];
  const sent = new Set<number>();
  for (const win of windows) {
    if (win && !win.isDestroyed() && !sent.has(win.id)) {
      sent.add(win.id);
      win.webContents.send(channel, ...args);
    }
  }
}

export function getDisguise(appState: AppState): string {
  return (appState as any).disguiseMode;
}
