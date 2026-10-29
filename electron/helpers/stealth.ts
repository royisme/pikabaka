import { app } from "electron"
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
