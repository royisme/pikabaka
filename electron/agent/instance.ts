import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { AppState } from '../main';
import { CredentialsManager } from '../services/CredentialsManager';
import { getAnswerSources, MATERIALS_SEARCH_OFF, PAST_MEETING_SEARCH_OFF } from '../services/SettingsManager';
import { DatabaseManager } from '../db/DatabaseManager';
import { VectorStore } from '../rag/VectorStore';
import { MeetingAgent } from './MeetingAgent';
import { resolveAgentModel, createGateClassify } from './models';
import { Gate, type GateClassify, type GateDecision } from './gate';
import { runAssist, type AssistCard } from './assist';
import { randomUUID } from 'node:crypto';
import { ApprovalBroker } from './approval';
import { appendGateDecision } from './gateLog';
import { reportAgentError } from './MeetingAgent';

let instance: MeetingAgent | undefined;
const broker = new ApprovalBroker();

export function getApprovalBroker(): ApprovalBroker { return broker; }

export function getMeetingAgent(): MeetingAgent {
  if (instance) return instance;
  const state = AppState.getInstance();
  let vectorStore: VectorStore | undefined;
  instance = new MeetingAgent({
    userDataDir: app.getPath('userData'),
    local: {
      broker,
      getRoot: () => CredentialsManager.getInstance().getAgentWorkspaceRoot(),
      getStartTimeMs: meetingId => DatabaseManager.getInstance().getMeetingDetails(meetingId)?.startTimeMs ?? Date.now(),
      dataDir: app.getPath('userData'),
    },
    getModelConfigSource: () => ({ resolve: () => resolveAgentModel(CredentialsManager.getInstance()) }),
    recentSegments: (id, sinceMs) => DatabaseManager.getInstance().getRecentSegments(id, sinceMs),
    searchSegments: (id, query, limit) => DatabaseManager.getInstance().searchSegments(id, query, limit),
    searchMeetings: async query => {
      if (!getAnswerSources().meetings) return PAST_MEETING_SEARCH_OFF;
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
    searchMaterials: async query => {
      if (!getAnswerSources().materials) return MATERIALS_SEARCH_OFF;
      const knowledge = state.getKnowledgeOrchestrator();
      if (!knowledge) throw new Error('Materials search unavailable');
      const passages = await knowledge.searchMaterials(query);
      return passages.length ? JSON.stringify(passages) : 'No notes or documents match that question.';
    },
    captureScreenshot: async () => ({
      data: (await readFile(await state.takeScreenshot(false))).toString('base64'), mimeType: 'image/png',
    }),
  });
  return instance;
}

let gate: Gate | undefined;
let classifier: GateClassify | undefined;
let classifierFor = '';

/** Builds the decision-model classifier for the current settings; the gate itself reads it synchronously. */
export async function refreshGate(): Promise<void> {
  const cm = CredentialsManager.getInstance();
  const signature = [cm.getAgentGateModel(), cm.getAgentGateBaseUrl(), cm.getAgentGateApiKey()].join('\n');
  if (signature === classifierFor) return;
  classifierFor = signature;
  classifier = await createGateClassify(cm).catch((error): undefined => { reportAgentError(error); return undefined; });
}

export function getGate(): Gate {
  if (gate) return gate;
  const cm = CredentialsManager.getInstance();
  const manager = () => DatabaseManager.getInstance();
  gate = new Gate({
    getClassifier: () => classifier,
    getSettings: () => ({
      mode: cm.getAgentGateMode(),
      threshold: cm.getAgentGateThreshold(),
      cooldownSeconds: cm.getAgentGateCooldownSeconds(),
      model: cm.getAgentGateModel(),
    }),
    now: () => Date.now(),
    getSegmentRevision: (meetingId, segmentId) => manager().getSegmentRevision(meetingId, segmentId),
    isMeetingActive: meetingId => AppState.getInstance().getCurrentMeetingId() === meetingId,
    getLines: meetingId => manager().getRecentSegments(meetingId, Date.now() - 3 * 60_000).slice(-6)
      .map(segment => ({ speaker: segment.speaker === 'user' ? 'You' as const : 'Them' as const, text: segment.text })),
    getUserLanguage: () => cm.getSttLanguageUser(),
    log: decision => appendGateDecision(app.getPath('userData'), decision),
  });
  return gate;
}

/** Drafts the card for a gate decision that passed (mode on); undefined when there is nothing to say. */
export async function draftCard(decision: GateDecision): Promise<AssistCard | undefined> {
  const state = AppState.getInstance();
  const cm = CredentialsManager.getInstance();
  if (!decision.kind || state.getCurrentMeetingId() !== decision.meetingId) return undefined;
  try {
    const resolved = await resolveAgentModel(cm);
    if (!resolved.ok) return undefined;
    const lines = DatabaseManager.getInstance().getRecentSegments(decision.meetingId, Date.now() - 3 * 60_000).slice(-6)
      .map(segment => ({ speaker: segment.speaker === 'user' ? 'You' as const : 'Them' as const, text: segment.text }));
    const text = await runAssist(resolved.model, { kind: decision.kind, lines, language: cm.getAiResponseLanguage(), spokenLanguageKey: cm.getSttLanguageUser(), style: cm.getAnswerStyle() }, AbortSignal.timeout(15_000));
    if (!text || state.getCurrentMeetingId() !== decision.meetingId) return undefined;
    return { id: randomUUID(), meetingId: decision.meetingId, segmentId: decision.segmentId, kind: decision.kind, text, time: Date.now() };
  } catch (error) {
    reportAgentError(error, decision.meetingId);
    return undefined;
  }
}
