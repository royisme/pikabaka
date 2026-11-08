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
    } catch (error: any) {
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
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 3: Follow-Up (Refinement)
  safeHandle("generate-follow-up", async (_, intent: string, userRequest?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest);
      return { refined, intent };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 4: Catch up (Summary)
  safeHandle("generate-catch-up", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.runCatchUp();
      return { summary };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 5: Manual Answer (Fallback)
  safeHandle("submit-manual-question", async (_, question: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runManualAnswer(question);
      return { answer, question };
    } catch (error: any) {
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
    } catch (error: any) {
      throw error;
    }
  });

  // Reset intelligence state
  safeHandle("reset-intelligence", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });


  // Service Account Selection
  safeHandle("select-service-account", async () => {
    try {
      const result: any = await dialog.showOpenDialog({
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
    } catch (error: any) {
      console.error("Error selecting service account:", error);
      return { success: false, error: error.message };
    }
  });
}
