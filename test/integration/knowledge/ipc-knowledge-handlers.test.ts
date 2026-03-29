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
