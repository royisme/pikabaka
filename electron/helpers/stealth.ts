import { SettingsManager } from "../services/SettingsManager"
import { setVerboseLoggingFlag } from "../lib/verboseLog"
import type { AppState } from "../main"

export function setHasDebugged(appState: AppState, value: boolean): void {
  appState.hasDebugged = value
}

export function getHasDebugged(appState: AppState): boolean {
  return appState.hasDebugged
}

export function setUndetectable(appState: AppState, state: boolean): void {
  // Guard: skip if state hasn't actually changed to prevent
  // duplicate dock hide/show cycles from renderer feedback loops
  if (appState.isUndetectable === state) return;

  console.log(`[Stealth] setUndetectable(${state}) called`);

  appState.isUndetectable = state
  appState.windowHelper.setContentProtection(state)
  appState.settingsWindowHelper.setContentProtection(state)
  appState.modelSelectorWindowHelper.setContentProtection(state)
  appState.cropperWindowHelper.setContentProtection(state)

  // Persist state via SettingsManager
  SettingsManager.getInstance().set('isUndetectable', state);

  // Broadcast state change to all relevant windows
  _broadcastToAllWindows(appState, 'undetectable-changed', state);
}

export function getUndetectable(appState: AppState): boolean {
  return appState.isUndetectable
}

export function setOverlayMousePassthrough(appState: AppState, state: boolean): void {
  if (appState.overlayMousePassthrough === state) return;

  console.log(`[Overlay] setOverlayMousePassthrough(${state}) called`);

  appState.overlayMousePassthrough = state;
  appState.windowHelper.syncOverlayInteractionPolicy();
  _broadcastToAllWindows(appState, 'overlay-mouse-passthrough-changed', state);
}

export function toggleOverlayMousePassthrough(appState: AppState): boolean {
  const next = !appState.overlayMousePassthrough;
  setOverlayMousePassthrough(appState, next);
  return next;
}

export function getOverlayMousePassthrough(appState: AppState): boolean {
  return appState.overlayMousePassthrough;
}

export function getVerboseLogging(appState: AppState): boolean {
  return appState._verboseLogging;
}

export function setVerboseLogging(appState: AppState, enabled: boolean): void {
  appState._verboseLogging = enabled;
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
