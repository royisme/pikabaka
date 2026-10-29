import t from 'tap';
import { mockRequire } from '../../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import path from 'node:path';

import type { KnowledgeOrchestrator } from '../../../electron/knowledge/KnowledgeOrchestrator';
import type { AppState } from '../../../electron/main';

type RegisteredHandler = (event: unknown, ...args: any[]) => Promise<any>;

const projectRoot = process.cwd();
const knowledgeModulePath = path.join(projectRoot, 'electron/ipc/knowledge.ts');
const safeHandleModulePath = path.join(projectRoot, 'electron/ipc/safeHandle.ts');
const mainModulePath = path.join(projectRoot, 'electron/main.ts');

/** Every channel the Knowledge handlers own now: notes, the answer-source switches and imported documents. */
const KEPT_CHANNELS = [
  'answer-sources:get',
  'answer-sources:set',
  'profile:get-notes',
  'profile:set-notes',
  'profile:get-status',
  'knowledge:list-documents',
  'knowledge:import-document',
  'knowledge:remove-document',
  'knowledge:reindex-document',
].sort();

/** The removed interview, resume, profile and negotiation channels. */
const REMOVED_CHANNELS = [
  'profile:upload-resume',
  'profile:set-mode',
  'profile:delete',
  'profile:get-profile',
  'profile:select-file',
  'profile:upload-jd',
  'profile:delete-jd',
  'profile:research-company',
  'profile:generate-negotiation',
  'profile:get-negotiation-state',
  'profile:reset-negotiation',
  'set-tavily-api-key',
  'knowledge:get-all-jds',
  'knowledge:set-active-jd',
  'knowledge:delete-jd',
  'knowledge:upload-jd',
  'knowledge:update-profile',
  'knowledge:generate-prep',
];

function loadRegisterKnowledgeHandlers(options?: {
  orchestrator?: Partial<KnowledgeOrchestrator> | null;
  showOpenDialog?: (options: any) => Promise<any>;
}) {
  const registeredHandlers = new Map<string, RegisteredHandler>();

  const safeHandle = (channel: string, listener: RegisteredHandler) => {
    registeredHandlers.set(channel, listener);
  };

  const dialog = {
    showOpenDialog: options?.showOpenDialog || (async () => ({ canceled: true, filePaths: [] })),
  };

  const { registerKnowledgeHandlers } = mockRequire(knowledgeModulePath, {
    electron: { dialog },
    [safeHandleModulePath]: { safeHandle },
    [mainModulePath]: {
      AppState: class AppStateMock {},
    },
  }) as {
    registerKnowledgeHandlers: (appState: AppState) => void;
  };

  const appState = {
    getKnowledgeOrchestrator: () => (options?.orchestrator ?? null),
  } as AppState;

  registerKnowledgeHandlers(appState);

  return {
    channels: [...registeredHandlers.keys()].sort(),
    invoke: async (channel: string, ...args: any[]) => {
      const handler = registeredHandlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for channel: ${channel}`);
      }
      return handler({}, ...args);
    },
  };
}

t.test('only the notes, answer-source and document channels are registered; every removed channel is gone', async t => {
  const harness = loadRegisterKnowledgeHandlers();
  t.same(harness.channels, KEPT_CHANNELS, 'the kept channels are exactly the listed ones');
  for (const channel of REMOVED_CHANNELS) {
    await t.rejects(harness.invoke(channel), { message: `No handler registered for channel: ${channel}` });
  }
});

t.test('profile:get-status replies with the notes index status only', async t => {
  const notesIndex = { state: 'needs-reindex' as const, provider: 'example:amber', dimensions: 3, indexedAt: '2026-10-27T12:34:56.000Z', error: null };
  const harness = loadRegisterKnowledgeHandlers({ orchestrator: {
    getStatus: () => ({ notesIndex }),
  } });
  t.same(await harness.invoke('profile:get-status'), { notesIndex }, 'nothing about a resume or a profile is in the reply');
  const missing = loadRegisterKnowledgeHandlers({ orchestrator: null });
  t.same(await missing.invoke('profile:get-status'), { notesIndex: undefined }, 'without the engine the reply has no index status');
});

t.test('the preload exposes the kept calls and none of the removed ones', async t => {
  let api!: Record<string, unknown>;
  mockRequire(path.resolve('electron/preload.ts'), {
    electron: {
      contextBridge: { exposeInMainWorld: (_name: string, exposed: Record<string, unknown>) => { api = exposed; } },
      ipcRenderer: { invoke: async () => ({ success: true }), on: () => {}, removeListener: () => {} },
    },
  });
  for (const kept of [
    'getAnswerSources', 'setAnswerSources', 'profileGetNotes', 'profileSetNotes', 'profileGetStatus',
    'knowledgeListDocuments', 'knowledgeImportDocument', 'knowledgeRemoveDocument', 'knowledgeReindexDocument',
  ]) t.equal(typeof api[kept], 'function', `${kept} is on the preload`);
  for (const removed of [
    'getProfile', 'uploadResume', 'generateInterviewPrep', 'getAllJDs',
    'profileGetProfile', 'profileUploadResume', 'profileSetMode', 'profileDelete',
    'profileSelectFile', 'profileUploadJD', 'profileDeleteJD', 'profileResearchCompany',
    'profileGenerateNegotiation', 'profileGetNegotiationState', 'profileResetNegotiation',
    'knowledgeGetAllJDs', 'knowledgeSetActiveJD', 'knowledgeDeleteJD', 'knowledgeUploadJD',
    'knowledgeUpdateProfile', 'knowledgeGeneratePrep', 'setTavilyApiKey', 'onKnowledgeContextUpdate',
  ]) t.equal(api[removed], undefined, `${removed} is not on the preload`);
});

t.test('profile:set-notes waits for the saved index result before replying', async t => {
  let finish!: () => void;
  let saved = false;
  const harness = loadRegisterKnowledgeHandlers({ orchestrator: {
    setNotes: async () => { await new Promise<void>(resolve => { finish = resolve; }); saved = true; },
  } });
  const result = harness.invoke('profile:set-notes', 'Invented lantern inventory.');
  await new Promise(setImmediate);
  t.equal(saved, false);
  finish();
  t.same(await result, { success: true });
  t.equal(saved, true, 'the reply comes after the notes are saved and indexed');
});

// An invented material row; every field is synthetic and no file or store is read.
const importedDocument = {
  id: 4,
  name: 'quarterly-planning.md',
  kind: 'md' as const,
  importedAt: '2026-10-28T09:15:00.000Z',
  passages: 42,
  state: 'indexed' as const,
  provider: 'example:amber',
  dimensions: 3,
  indexedAt: '2026-10-28T09:16:00.000Z',
  error: null,
};

t.test('knowledge:list-documents returns the material rows with ISO dates, or the real error', async t => {
  const harness = loadRegisterKnowledgeHandlers({ orchestrator: { listDocuments: () => [importedDocument] } });
  const result = await harness.invoke('knowledge:list-documents');
  t.same(result, { success: true, documents: [importedDocument] });
  t.equal(new Date(result.documents[0].importedAt).toISOString(), importedDocument.importedAt, 'the imported date is an ISO 8601 instant');
  t.equal(new Date(result.documents[0].indexedAt).toISOString(), importedDocument.indexedAt, 'the indexed date is an ISO 8601 instant');

  const failing = loadRegisterKnowledgeHandlers({ orchestrator: { listDocuments: () => { throw new Error('Synthetic document listing unavailable'); } } });
  t.same(await failing.invoke('knowledge:list-documents'), { success: false, error: 'Synthetic document listing unavailable' });

  const missing = loadRegisterKnowledgeHandlers({ orchestrator: null });
  const reply = await missing.invoke('knowledge:list-documents');
  t.equal(reply.success, false, 'a missing engine is a failure, never an empty list');
  t.match(reply.error, /Knowledge engine not initialized/);
});

t.test('knowledge:import-document opens the dialog itself, ignores any renderer path, and answers cancel, success and failure', async t => {
  const opened: Array<Record<string, any>> = [];
  const imported: string[] = [];
  const harness = loadRegisterKnowledgeHandlers({
    showOpenDialog: async (options: any) => {
      opened.push(options);
      return { canceled: false, filePaths: ['/tmp/invented-materials/quarterly-planning.md'] };
    },
    orchestrator: { importDocument: async (filePath: string) => { imported.push(filePath); return importedDocument; } },
  });

  t.same(await harness.invoke('knowledge:import-document', '/etc/hosts'), { success: true, document: importedDocument });
  t.same(imported, ['/tmp/invented-materials/quarterly-planning.md'], 'the renderer path is never read');
  t.same(opened[0].properties, ['openFile'], 'one file, no folder and no multi-selection');
  t.ok(opened[0].filters[0].extensions.includes('txt'));
  t.ok(opened[0].filters[0].extensions.includes('md'));

  let attempted = 0;
  const cancelled = loadRegisterKnowledgeHandlers({
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    orchestrator: { importDocument: async () => { attempted++; return importedDocument; } },
  });
  t.same(await cancelled.invoke('knowledge:import-document'), { cancelled: true }, 'a cancelled dialog is a normal reply');
  t.equal(attempted, 0);

  const refused = loadRegisterKnowledgeHandlers({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/invented-materials/scan.pdf'] }),
    orchestrator: { importDocument: async () => { throw new Error('This document has no text Pika can read.'); } },
  });
  t.same(await refused.invoke('knowledge:import-document'), { success: false, error: 'This document has no text Pika can read.' });
});

t.test('remove and re-index refuse a non-integer, a missing id and a non-material id, and carry the real failure', async t => {
  const removed: number[] = [];
  const reindexed: number[] = [];
  const orchestrator = {
    listDocuments: () => [importedDocument],
    removeDocument: (docId: number) => {
      if (docId === 4) throw new Error('Synthetic removal refused');
      removed.push(docId);
    },
    reindexDocument: (docId: number) => {
      if (docId === 4) throw new Error('That document is already indexing.');
      reindexed.push(docId);
    },
  } as Partial<KnowledgeOrchestrator>;

  const harness = loadRegisterKnowledgeHandlers({ orchestrator });
  for (const bad of ['4', 4.5, NaN, null, undefined]) {
    t.same(await harness.invoke('knowledge:remove-document', bad), { success: false, error: 'That document is not in Pika.' }, `${String(bad)} is refused`);
    t.same(await harness.invoke('knowledge:reindex-document', bad), { success: false, error: 'That document is not in Pika.' }, `${String(bad)} is refused`);
  }
  t.same(await harness.invoke('knowledge:remove-document', 99), { success: false, error: 'That document is not in Pika.' }, 'an id that is not an imported document is refused');
  t.same(await harness.invoke('knowledge:reindex-document', 99), { success: false, error: 'That document is not in Pika.' });
  t.same(removed, []);
  t.same(reindexed, []);

  t.same(await harness.invoke('knowledge:remove-document', 4), { success: false, error: 'Synthetic removal refused' });
  t.same(await harness.invoke('knowledge:reindex-document', 4), { success: false, error: 'That document is already indexing.' });
});

t.test('remove and re-index forward a valid imported-document id', async t => {
  const removed: number[] = [];
  const reindexed: number[] = [];
  const harness = loadRegisterKnowledgeHandlers({ orchestrator: {
    listDocuments: () => [importedDocument],
    removeDocument: (docId: number) => { removed.push(docId); },
    reindexDocument: (docId: number) => { reindexed.push(docId); },
  } });

  t.same(await harness.invoke('knowledge:remove-document', 4), { success: true });
  t.same(await harness.invoke('knowledge:reindex-document', 4), { success: true });
  t.same(removed, [4]);
  t.same(reindexed, [4]);
});

t.test('the notes channels work without the knowledge engine: no notes, and a refusal to save', async t => {
  const harness = loadRegisterKnowledgeHandlers({ orchestrator: null });
  t.equal(await harness.invoke('profile:get-notes'), '', 'no engine means empty notes, not an error');
  const result = await harness.invoke('profile:set-notes', 'Invented note.');
  t.equal(result.success, false);
  t.match(result.error, /Knowledge engine not initialized/);
});
