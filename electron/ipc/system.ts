import { systemPreferences, shell } from "electron"
import { AppState } from "../main"
import { safeHandle } from "./safeHandle"

export function registerSystemHandlers(appState: AppState): void {
  // ==========================================
  // Theme System Handlers
  // ==========================================

  safeHandle("theme:get-mode", () => {
    const tm = appState.getThemeManager();
    return {
      mode: tm.getMode(),
      resolved: tm.getResolvedTheme()
    };
  });

  safeHandle("theme:set-mode", (_, mode: 'system' | 'light' | 'dark') => {
    appState.getThemeManager().setMode(mode);
    return { success: true };
  });

  // ==========================================
  // Permission Status Handlers
  // ==========================================

  safeHandle("get-permission-status", () => {
    return {
      microphone: systemPreferences.getMediaAccessStatus('microphone'),
      screen: systemPreferences.getMediaAccessStatus('screen'),
    };
  });

  safeHandle("open-privacy-settings", async (_, type: 'microphone' | 'screen') => {
    if (type === 'microphone') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    } else {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
    return { success: true };
  });

}
