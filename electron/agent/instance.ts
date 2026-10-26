import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { AppState } from '../main';
import { CredentialsManager } from '../services/CredentialsManager';
import { DatabaseManager } from '../db/DatabaseManager';
import { VectorStore } from '../rag/VectorStore';
import { MeetingAgent } from './MeetingAgent';
import { resolveAgentModel } from './models';

let instance: MeetingAgent | undefined;

export function getMeetingAgent(): MeetingAgent {
  if (instance) return instance;
  const state = AppState.getInstance();
  let vectorStore: VectorStore | undefined;
  instance = new MeetingAgent({
    userDataDir: app.getPath('userData'),
    getModelConfigSource: () => ({ resolve: () => resolveAgentModel(state.processingHelper.getLLMHelper(), CredentialsManager.getInstance()) }),
    recentSegments: (id, sinceMs) => DatabaseManager.getInstance().getRecentSegments(id, sinceMs),
    searchSegments: (id, query, limit) => DatabaseManager.getInstance().searchSegments(id, query, limit),
    searchMeetings: async query => {
      const rag = state.getRAGManager();
      if (!rag?.isReady()) throw new Error('Meeting search unavailable');
      const manager = DatabaseManager.getInstance();
      const db = manager.getDb();
      if (!db) throw new Error('Database not initialized');
      vectorStore ??= new VectorStore(db, manager.getDbPath(), manager.getExtPath());
      const pipeline = rag.getEmbeddingPipeline();
      const embedding = await pipeline.getEmbeddingForQuery(query);
      const chunks = await vectorStore.searchSimilar(embedding, {
        limit: 16, minSimilarity: 0.25, providerName: pipeline.getActiveProviderName(),
      });
      return JSON.stringify(chunks.filter(chunk => chunk.meetingId !== state.getCurrentMeetingId() && chunk.meetingId !== 'live-meeting-current').slice(0, 8).map(chunk => ({
        meetingId: chunk.meetingId, text: chunk.text, startMs: chunk.startMs, endMs: chunk.endMs,
      })));
    },
    captureScreenshot: async () => ({
      data: (await readFile(await state.takeScreenshot(false))).toString('base64'), mimeType: 'image/png',
    }),
  });
  return instance;
}
