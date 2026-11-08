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

  // Ollama model detection (local server, 2s timeout)
  safeHandle("get-ollama-models", async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) return [];
      const data: unknown = await response.json();
      const models = (data as { models?: Array<{ name: string }> }).models;
      return Array.isArray(models) ? models.map(m => m.name) : [];
    } catch {
      return [];
    }
  });
}
