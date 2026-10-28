import { shell } from "electron"
import { AppState } from "../main"
import { DatabaseManager } from "../db/DatabaseManager"
import { safeHandle } from "./safeHandle"
import { refreshCommittedMeetingSummary } from "../rag/meetingSummaryIndex"

export function registerMeetingHandlers(appState: AppState): void {
  // ==========================================
  // Meeting Lifecycle Handlers
  // ==========================================

  safeHandle("start-meeting", async (event, metadata?: any) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error: any) {
      console.error("Error starting meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("end-meeting", async () => {
    try {
      await appState.endMeeting();
      return { success: true };
    } catch (error: any) {
      console.error("Error ending meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("get-recent-meetings", async () => {
    // Fetch from SQLite (limit 50)
    return DatabaseManager.getInstance().getRecentMeetings(50);
  });

  safeHandle("get-meeting-details", async (event, id) => {
    // Helper to fetch full details
    return DatabaseManager.getInstance().getMeetingDetails(id);
  });

  safeHandle("update-meeting-title", async (_, { id, title }: { id: string; title: string }) => {
    return DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });

  safeHandle("update-meeting-summary", async (_, { id, updates }: { id: string; updates: any }) => {
    const updated = DatabaseManager.getInstance().updateMeetingSummary(id, updates);
    if (updated) refreshCommittedMeetingSummary(appState.getRAGManager(), id);
    return updated;
  });

  safeHandle("delete-meeting", async (_, id: string) => {
    await appState.getMeetingAgent().deleteStore(id);
    try {
      appState.getRAGManager()?.deleteMeetingData(id);
    } catch (error) {
      // A search-index cleanup failure (for example sqlite-vec not loaded) must not keep the user from deleting the meeting.
      console.warn('[Meeting] Could not clear the search index for a deleted meeting:', error instanceof Error ? error.message : error);
    }
    return DatabaseManager.getInstance().deleteMeeting(id);
  });

  safeHandle("seed-demo", async () => {
    DatabaseManager.getInstance().seedDemoMeeting();

    // Ensure RAG embeddings exist for the demo meeting.
    // Use ensureDemoMeetingProcessed so we skip if already embedded
    // (avoids re-clearing 14 queue items on every app launch once processed).
    const ragManager = appState.getRAGManager();
    if (ragManager && ragManager.isReady()) {
      ragManager.ensureDemoMeetingProcessed().catch(console.error);
    }

    return { success: true };
  });

  safeHandle("flush-database", async () => {
    await appState.getMeetingAgent().deleteAllStores();
    const result = DatabaseManager.getInstance().clearAllData();
    return { success: result };
  });

  safeHandle("open-external", async (event, url: string) => {
    try {
      const parsed = new URL(url);
      if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
        await shell.openExternal(url);
      } else {
        console.warn(`[IPC] Blocked potentially unsafe open-external: ${url}`);
      }
    } catch {
      console.warn(`[IPC] Invalid URL in open-external: ${url}`);
    }
  });
}
