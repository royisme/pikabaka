import t from 'tap';
import { mockRequire } from '../../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import path from 'node:path';

import type { KnowledgeOrchestrator } from '../../../electron/knowledge/KnowledgeOrchestrator';
import type { AppState } from '../../../electron/main';

type RegisteredHandler = (event: unknown, ...args: any[]) => Promise<any>;

const projectRoot = process.cwd();
const knowledgeModulePath = path.join(projectRoot, 'electron/ipc/knowledge.ts');
const safeHandleModulePath = path.join(projectRoot, 'electron/ipc/safeHandle.ts');
const credentialsModulePath = path.join(projectRoot, 'electron/services/CredentialsManager.ts');
const mainModulePath = path.join(projectRoot, 'electron/main.ts');

function loadRegisterKnowledgeHandlers(options?: {
  orchestrator?: Partial<KnowledgeOrchestrator> | null;
  showOpenDialog?: (options: any) => Promise<any>;
  tavilyApiKey?: string | null;
  setTavilyApiKey?: (value: string) => void;
}) {
  const registeredHandlers = new Map<string, RegisteredHandler>();
  const setTavilyApiKeyCalls: string[] = [];

  const safeHandle = (channel: string, listener: RegisteredHandler) => {
    registeredHandlers.set(channel, listener);
  };

  const dialog = {
    showOpenDialog: options?.showOpenDialog || (async () => ({ canceled: true, filePaths: [] })),
  };

  const credentialsManager = {
    getTavilyApiKey: () => options?.tavilyApiKey ?? null,
    setTavilyApiKey: (value: string) => {
      setTavilyApiKeyCalls.push(value);
      options?.setTavilyApiKey?.(value);
    },
  };

  const { registerKnowledgeHandlers } = mockRequire(knowledgeModulePath, {
    electron: { dialog },
    [safeHandleModulePath]: { safeHandle },
    [credentialsModulePath]: {
      CredentialsManager: {
        getInstance: () => credentialsManager,
      },
    },
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
    invoke: async (channel: string, ...args: any[]) => {
      const handler = registeredHandlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for channel: ${channel}`);
      }
      return handler({}, ...args);
    },
    setTavilyApiKeyCalls,
  };
}

t.test('profile:get-status keeps its legacy fields and adds the notes index status', async t => {
  const notesIndex = { state: 'needs-reindex' as const, provider: 'example:amber', dimensions: 3, indexedAt: '2026-10-27T12:34:56.000Z', error: null };
  const harness = loadRegisterKnowledgeHandlers({ orchestrator: {
    getStatus: () => ({ hasResume: false, activeMode: false, jdCount: 0, notesIndex }),
  } });
  const result = await harness.invoke('profile:get-status');
  t.equal(result.hasProfile, false);
  t.equal(result.profileMode, false);
  t.same(result.notesIndex, notesIndex);
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
  t.equal(saved, true, 'the next status read observes the completed attempt');
});

t.test('set-tavily-api-key rejects invalid prefix and persists valid values', async (t) => {
  const harness = loadRegisterKnowledgeHandlers();

  const invalid = await harness.invoke('set-tavily-api-key', 'sk-invalid');
  t.same(invalid, {
    success: false,
    error: 'Invalid Tavily API key. Keys must start with "tvly-".',
  });
  t.same(harness.setTavilyApiKeyCalls, [], 'does not persist invalid values');

  const valid = await harness.invoke('set-tavily-api-key', 'tvly-abc123');
  t.same(valid, { success: true });
  t.same(harness.setTavilyApiKeyCalls, ['tvly-abc123']);

  const cleared = await harness.invoke('set-tavily-api-key', '');
  t.same(cleared, { success: true });
  t.same(harness.setTavilyApiKeyCalls, ['tvly-abc123', '']);
});

t.test('knowledge:update-profile forwards only allowed keys to the real handler', async (t) => {
  let receivedUpdates: any;
  const orchestrator = {
    updateProfileData: (updates: any) => {
      receivedUpdates = updates;
      return { success: true };
    },
  } as Partial<KnowledgeOrchestrator>;

  const harness = loadRegisterKnowledgeHandlers({ orchestrator });
  const result = await harness.invoke('knowledge:update-profile', {
    identity: { name: 'Alice' },
    skills: ['Rust'],
    experience: [{ company: 'Acme', role: 'Engineer', highlights: [] }],
    projects: [],
    education: [],
    totalExperienceYears: 5,
    password: 'secret',
    _internalField: 'drop me',
    toString: 'drop me too',
  });

  t.same(result, { success: true });
  t.same(receivedUpdates, {
    identity: { name: 'Alice' },
    skills: ['Rust'],
    experience: [{ company: 'Acme', role: 'Engineer', highlights: [] }],
    projects: [],
    education: [],
    totalExperienceYears: 5,
  });
});

t.test('profile:select-file maps cancel, success, and error using the real handler', async (t) => {
  const cancelledHarness = loadRegisterKnowledgeHandlers({
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  });
  t.same(await cancelledHarness.invoke('profile:select-file'), { cancelled: true });

  const selectedHarness = loadRegisterKnowledgeHandlers({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/resume.docx'] }),
  });
  t.same(await selectedHarness.invoke('profile:select-file'), {
    success: true,
    filePath: '/tmp/resume.docx',
  });

  const failingHarness = loadRegisterKnowledgeHandlers({
    showOpenDialog: async () => {
      throw new Error('Dialog system unavailable');
    },
  });
  const errorResult = await failingHarness.invoke('profile:select-file');
  t.equal(errorResult.success, false);
  t.match(errorResult.error, /Dialog system unavailable/);
});

t.test('handlers return real null-orchestrator responses from knowledge.ts', async (t) => {
  const harness = loadRegisterKnowledgeHandlers({ orchestrator: null });

  t.same(await harness.invoke('profile:get-status'), { hasProfile: false, profileMode: false });
  t.equal(await harness.invoke('profile:get-profile'), null);
  t.same(await harness.invoke('knowledge:get-all-jds'), []);
  t.same(await harness.invoke('profile:reset-negotiation'), { success: false });

  const envelope = await harness.invoke('knowledge:generate-prep');
  t.equal(envelope.success, false);
  t.match(envelope.error, /Knowledge engine not initialized/);
});

t.test('knowledge:get-all-jds delegates to orchestrator.getAllJDs', async (t) => {
  const orchestrator = {
    getAllJDs: () => [{ id: 1, company: 'Pika', title: 'Engineer', isActive: true, createdAt: '2025-01-01', technologies: [] }],
  } as Partial<KnowledgeOrchestrator>;

  const harness = loadRegisterKnowledgeHandlers({ orchestrator });
  const result = await harness.invoke('knowledge:get-all-jds');

  t.same(result, [{ id: 1, company: 'Pika', title: 'Engineer', isActive: true, createdAt: '2025-01-01', technologies: [] }]);
});

t.test('knowledge:set-active-jd and knowledge:delete-jd delegate to orchestrator', async (t) => {
  const activeCalls: number[] = [];
  const deleteCalls: number[] = [];
  const orchestrator = {
    setActiveJD: (docId: number) => {
      activeCalls.push(docId);
    },
    deleteJD: (docId: number) => {
      deleteCalls.push(docId);
    },
  } as Partial<KnowledgeOrchestrator>;

  const harness = loadRegisterKnowledgeHandlers({ orchestrator });

  t.same(await harness.invoke('knowledge:set-active-jd', 7), { success: true });
  t.same(await harness.invoke('knowledge:delete-jd', 9), { success: true });
  t.same(activeCalls, [7]);
  t.same(deleteCalls, [9]);
});

t.test('profile:research-company uses credentials and active JD context from the real handler', async (t) => {
  let receivedArgs: any[] = [];
  let receivedApiKey: string | null | undefined;

  const orchestrator = {
    getCompanyResearchEngine: () => ({
      setApiKey: (key: string | null) => {
        receivedApiKey = key;
      },
      researchCompany: async (...args: any[]) => {
        receivedArgs = args;
        return { company: 'Pika', overview: 'AI interview copilot' };
      },
    }),
    getProfileData: () => ({
      activeJD: {
        title: 'Staff Engineer',
        location: 'Remote',
        level: 'staff',
        technologies: ['TypeScript'],
        requirements: ['System design'],
        keywords: ['leadership'],
        compensation_hint: '$200k+',
        min_years_experience: 7,
      },
    }),
  } as Partial<KnowledgeOrchestrator>;

  const harness = loadRegisterKnowledgeHandlers({ orchestrator, tavilyApiKey: 'tvly-live-key' });
  const result = await harness.invoke('profile:research-company', 'Pika');

  t.same(result, {
    success: true,
    dossier: { company: 'Pika', overview: 'AI interview copilot' },
  });
  t.equal(receivedApiKey, 'tvly-live-key');
  t.same(receivedArgs, [
    'Pika',
    {
      title: 'Staff Engineer',
      location: 'Remote',
      level: 'staff',
      technologies: ['TypeScript'],
      requirements: ['System design'],
      keywords: ['leadership'],
      compensation_hint: '$200k+',
      min_years_experience: 7,
    },
    false,
  ]);
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
  t.same(await harness.invoke('knowledge:remove-document', 99), { success: false, error: 'That document is not in Pika.' }, 'an id that is not an imported document, such as a JD, is refused');
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
