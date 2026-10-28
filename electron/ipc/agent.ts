import { BrowserWindow } from 'electron';
import type { AppState } from '../main';
import { safeHandle } from './safeHandle';
import { reportAgentError, type ThreadLine } from '../agent/MeetingAgent';
import { testAgentModel } from '../agent/agentTest';
import { CredentialsManager } from '../services/CredentialsManager';

export function registerAgentHandlers(appState: AppState): void {
  const agent = appState.getMeetingAgent();

  agent.onEvent((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent-event', event);
      }
    }
  });

  // Runs the agent's model on two invented questions, for the settings as shown (saved or not).
  safeHandle('agent-test', async (_event, draft: { connectionId: string; model: string; supportsImages?: boolean }) => {
    const cm = CredentialsManager.getInstance();
    const connectionId = typeof draft?.connectionId === 'string' ? draft.connectionId.trim() : '';
    const model = typeof draft?.model === 'string' ? draft.model.trim() : '';
    if (!connectionId && !model) return { success: false, error: 'Choose a connection and enter a model before testing.' };
    if (!connectionId) return { success: false, error: 'Choose a connection before testing.' };
    if (!model) return { success: false, error: 'Enter a model before testing.' };
    const connection = cm.resolveConnection(connectionId);
    if (!connection) return { success: false, error: 'That connection does not exist.' };
    if (!connection.apiKey && !cm.isConnectionReady(connection.id)) return { success: false, error: `No API key is saved for ${connection.name}.` };
    return testAgentModel(connection, model, draft?.supportsImages === true);
  });

  safeHandle('agent-status', async () => {
    const meetingId = appState.getCurrentMeetingId();
    if (!meetingId) {
      return { meetingActive: false, available: false };
    }
    try {
      const availability = await agent.modelAvailability();
      if (!availability.ok) {
        return { meetingActive: true, available: false, reason: availability.reason };
      }
      return { meetingActive: true, available: true };
    } catch (error) {
      reportAgentError(error, meetingId);
      return { meetingActive: true, available: false, reason: 'The agent could not be reached' };
    }
  });

  safeHandle('agent-submit', async (_event, payload: unknown) => {
    const meetingId = appState.getCurrentMeetingId();
    if (!meetingId) {
      return { ok: false, reason: 'No meeting is running' };
    }

    if (!payload || typeof payload !== 'object') {
      return { ok: false, reason: 'Invalid payload' };
    }

    const { text, mode, requestId } = payload as { text?: unknown; mode?: unknown; requestId?: unknown };

    if (typeof text !== 'string' || !text.trim() || text.length > 8000) {
      return { ok: false, reason: 'Message must be a non-empty string of at most 8000 characters' };
    }

    if (mode !== undefined && mode !== 'followup' && mode !== 'steer') {
      return { ok: false, reason: 'Invalid mode' };
    }

    if (requestId !== undefined && (typeof requestId !== 'string' || !requestId.trim())) {
      return { ok: false, reason: 'Invalid requestId' };
    }

    try {
      return await agent.submit(meetingId, text, {
        mode: mode as 'followup' | 'steer' | undefined,
        requestId: requestId as string | undefined,
      });
    } catch (error) {
      reportAgentError(error, meetingId);
      return { ok: false, reason: 'Agent submission failed' };
    }
  });

  safeHandle('agent-abort', async () => {
    const meetingId = appState.getCurrentMeetingId();
    if (meetingId) {
      try {
        await agent.abort(meetingId);
      } catch (error) {
        reportAgentError(error, meetingId);
      }
    }
    return { success: true };
  });

  safeHandle('agent-get-thread', async (): Promise<ThreadLine[]> => {
    const meetingId = appState.getCurrentMeetingId();
    if (!meetingId) {
      return [];
    }
    try {
      return await agent.getThread(meetingId);
    } catch (error) {
      reportAgentError(error, meetingId);
      return [];
    }
  });
}
