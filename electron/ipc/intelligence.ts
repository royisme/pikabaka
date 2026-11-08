import { dialog } from "electron"
import { AppState } from "../main"
import { safeHandle } from "./safeHandle"

export function registerIntelligenceHandlers(appState: AppState): void {
  // ==========================================
  // Intelligence Mode Handlers
  // ==========================================

  // MODE 1: Assist (Passive observation)
  safeHandle("generate-assist", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const insight = await intelligenceManager.runAssistMode();
      return { insight };
    } catch (error: unknown) {
      throw error;
    }
  });

  // The one question to ask the other party
  safeHandle("generate-ask", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const question = await intelligenceManager.runAsk();
      // If null returned without throwing, the engine already set mode to idle.
      // We must still ensure the frontend un-sticks — emit an error so onIntelligenceError fires.
      if (question === null) {
        const win = appState.getMainWindow();
        win?.webContents.send('intelligence-error', { error: 'Could not generate a question. Try again after some audio context is available.', mode: 'ask' });
      }
      return { question };
    } catch (error: unknown) {
      throw error;
    }
  });

  // MODE 3: Follow-Up (Refinement)
  safeHandle("generate-follow-up", async (_, intent: string, userRequest?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest);
      return { refined, intent };
    } catch (error: unknown) {
      throw error;
    }
  });

  // MODE 4: Catch up (Summary)
  safeHandle("generate-catch-up", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.runCatchUp();
      return { summary };
    } catch (error: unknown) {
      throw error;
    }
  });

  // MODE 5: Manual Answer (Fallback)
  safeHandle("submit-manual-question", async (_, question: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runManualAnswer(question);
      return { answer, question };
    } catch (error: unknown) {
      throw error;
    }
  });

  // Get current intelligence context
  safeHandle("get-intelligence-context", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return {
        context: intelligenceManager.getFormattedContext(),
        lastAssistantMessage: intelligenceManager.getLastAssistantMessage(),
        activeMode: intelligenceManager.getActiveMode()
      };
    } catch (error: unknown) {
      throw error;
    }
  });

  // Reset intelligence state
  safeHandle("reset-intelligence", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: (error instanceof Error ? error.message : String(error)) };
    }
  });


  // Service Account Selection
  safeHandle("select-service-account", async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      const filePath = result.filePaths[0];

      // Update backend state immediately
      appState.updateGoogleCredentials(filePath);

      // Persist the path for future sessions
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setGoogleServiceAccountPath(filePath);

      return { success: true, path: filePath };
    } catch (error: unknown) {
      console.error("Error selecting service account:", error);
      return { success: false, error: (error instanceof Error ? error.message : String(error)) };
    }
  });
}

/** Forwards the intelligence engine events to the launcher and overlay windows. Called once, from the AppState constructor. */
export function forwardIntelligenceEvents(appState: AppState): void {
  const intelligenceManager = appState.getIntelligenceManager()
  const sendToChatWindows = (channel: string, payload?: unknown) => {
    const helper = appState.getWindowHelper()
    const launcher = helper.getLauncherWindow()
    const overlay = helper.getOverlayWindow()

    if (launcher && !launcher.isDestroyed()) {
      launcher.webContents.send(channel, payload)
    }
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(channel, payload)
    }
  }

  // Forward intelligence events to renderer
  intelligenceManager.on('assist_update', (insight: string) => {
    sendToChatWindows('intelligence-assist-update', { insight })
  })

  intelligenceManager.on('refined_answer_token', (token: string, intent: string) => {
    sendToChatWindows('intelligence-refined-answer-token', { token, intent })
  })

  intelligenceManager.on('refined_answer', (answer: string, intent: string) => {
    sendToChatWindows('intelligence-refined-answer', { answer, intent })

  })

  intelligenceManager.on('catch_up', (summary: string) => {
    sendToChatWindows('intelligence-catch-up', { summary })
  })

  intelligenceManager.on('catch_up_token', (token: string) => {
    sendToChatWindows('intelligence-catch-up-token', { token })
  })

  intelligenceManager.on('ask', (question: string) => {
    sendToChatWindows('intelligence-ask', { question })
  })

  intelligenceManager.on('ask_token', (token: string) => {
    sendToChatWindows('intelligence-ask-token', { token })
  })

  intelligenceManager.on('manual_answer_started', () => {
    sendToChatWindows('intelligence-manual-started')
  })

  intelligenceManager.on('manual_answer_result', (answer: string, question: string) => {
    sendToChatWindows('intelligence-manual-result', { answer, question })

  })

  intelligenceManager.on('mode_changed', (mode: string) => {
    sendToChatWindows('intelligence-mode-changed', { mode })
  })

  intelligenceManager.on('error', (error: Error, mode: string) => {
    console.error(`[IntelligenceManager] Error in ${mode}:`, error)
    sendToChatWindows('intelligence-error', { error: error.message, mode })
  })
}
