import { BrowserWindow } from "electron"
import type { AppState } from "../main"
import { KeybindManager } from "../services/KeybindManager"
import { takeSelectiveScreenshot } from "./screenshot-capture"

function sendToAllWindows(action: string): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('global-shortcut', { action });
    }
  });
}

/** Routes a global shortcut to the window or renderer action it names. */
export function registerGlobalShortcutDispatch(appState: AppState, keybindManager: KeybindManager): void {
  keybindManager.onShortcutTriggered(async (actionId) => {
    console.log(`[Main] Global shortcut triggered: ${actionId}`);
    try {
      if (actionId === 'general:toggle-visibility') {
        appState.toggleMainWindow();
      } else if (actionId === 'general:toggle-mouse-passthrough') {
        // Adapted from public PR #113 — verify premium interaction
        appState.toggleOverlayMousePassthrough();
      } else if (actionId === 'general:selective-screenshot') {
        const screenshotPath = await takeSelectiveScreenshot(appState, false);
        const preview = await appState.getImagePreview(screenshotPath);
        const mainWindow = appState.getMainWindow();
        if (mainWindow) {
          // preload.ts maps 'screenshot-attached' to onScreenshotAttached
          mainWindow.webContents.send("screenshot-attached", {
            path: screenshotPath,
            preview
          });
        }

      // --- STEALTH SHORTCUTS: no focus, no show, pure IPC dispatch ---

      // Chat actions — fire into the renderer without focusing the window
      } else if (
        actionId === 'chat:reply' ||
        actionId === 'translation:toggle' ||
        actionId === 'translation:toggle-original'
      ) {
        const actionMap: Record<string, string> = {
          'chat:reply': 'reply',
          'translation:toggle': 'toggleTranslation',
          'translation:toggle-original': 'toggleOriginal',
        };
        // Send to all windows without focusing — stealth operation
        sendToAllWindows(actionMap[actionId]);

      // Interpreting: the same press starts and sends the talk window
      } else if (actionId === 'interpreting:toggle-talk') {
        await appState.interpreting.toggleTalk();

      // Window movement — move window position without focus change
      } else if (actionId === 'window:move-up') {
        appState.windowHelper.moveWindowUp();
      } else if (actionId === 'window:move-down') {
        appState.windowHelper.moveWindowDown();
      } else if (actionId === 'window:move-left') {
        appState.windowHelper.moveWindowLeft();
      } else if (actionId === 'window:move-right') {
        appState.windowHelper.moveWindowRight();

      // General actions that are now global (stealth)
      } else if (actionId === 'general:reset-cancel') {
        sendToAllWindows('resetCancel');
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : undefined;
      if (message !== "Selection cancelled" && message !== "Screenshot capture already in progress") {
        console.error(`[Main] Error handling global shortcut ${actionId}:`, e);
      }
    }
  });
}
