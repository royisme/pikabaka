import { app, BrowserWindow } from "electron"
import { AppState } from "../main"
import { safeHandle } from "./safeHandle"

export function registerMiscHandlers(appState: AppState): void {
  safeHandle("audio:get-native-status", async () => {
    return appState.getNativeAudioStatus();
  });

  safeHandle("audio:get-recent-activity", async () => {
    const status = appState.getNativeAudioStatus();
    return {
      hasRecentSystemAudioChunk: status.hasRecentSystemAudioChunk,
      hasRecentInterviewerTranscript: status.hasRecentInterviewerTranscript,
      lastSystemAudioChunkAt: status.lastSystemAudioChunkAt,
      lastInterviewerTranscriptAt: status.lastInterviewerTranscriptAt,
    };
  });

  safeHandle("get-app-version", async () => {
    return app.getVersion();
  });

  safeHandle("get-electron-version", async () => {
    return process.versions.electron;
  });

  safeHandle("set-overlay-opacity", async (_, opacity: number) => {
    const clamped = Math.min(1.0, Math.max(0.35, opacity));
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('overlay-opacity-changed', clamped);
      }
    });
    return;
  });
}
