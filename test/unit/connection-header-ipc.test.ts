import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { CredentialsManager } from '../../electron/services/CredentialsManager';
import type { ConnectionView } from '../../electron/services/aiConnections';
import type { HeaderState } from '../../electron/services/connectionHeaders';
import type { AppState } from '../../electron/main';
import Database from 'better-sqlite3';
import { buildEmbeddingConfig } from '../../electron/rag/embeddingConfig';
import type { AppAPIConfig } from '../../electron/rag/EmbeddingProviderResolver';

function credentials() {
    const cm = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(cm, 'credentials', {
        openaiCompatibleProviders: [{ id: 'gateway', name: 'Invented gateway', type: 'openai', baseUrl: 'http://127.0.0.1:1234', apiKey: 'fake-key', headers: { 'X-Gateway': 'fake-header-secret' } }],
        embeddingConnectionId: 'gateway', embeddingModel: 'example',
        transcriptTranslationProvider: 'gateway', transcriptTranslationModel: 'example', transcriptTranslationPrompt: 'Translate.',
    });
    Reflect.set(cm, 'saveCredentials', () => {});
    return cm;
}

t.test('save rebuilds only the selected connection on changed headers or host; draft discovery applies edits without saving', async t => {
    const cm = credentials();
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const calls: Array<{ config: AppAPIConfig; options: unknown }> = [];
    const requests: unknown[] = [];
    const { registerConnectionHandlers } = mockRequire(path.resolve('electron/ipc/connections.ts'), {
        electron: { BrowserWindow: { getAllWindows: () => [] } },
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
        [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => cm } },
        [path.resolve('electron/utils/connectionModels.ts')]: { fetchConnectionModels: async (input: unknown) => { requests.push(input); return [{ id: 'example', label: 'example' }]; } },
    }) as typeof import('../../electron/ipc/connections');
    registerConnectionHandlers({ getRAGManager: () => ({ initializeEmbeddings: async (config: AppAPIConfig, options: unknown) => { calls.push({ config, options }); } }) } as unknown as AppState);
    const invoke = (name: string, input?: unknown) => handlers.get(name)!(undefined, input);
    const before = structuredClone(cm.getAllCredentials());
    t.same(await invoke('ai-connection-models', { id: 'gateway', baseUrl: '   ' }), { success: false, error: 'Enter a Base URL' }, 'a blank draft URL is refused');
    t.same(await invoke('ai-connection-models', { type: 'openai', baseUrl: '' }), { success: false, error: 'Enter a Base URL' }, 'a blank URL on a new draft is refused');
    t.equal(requests.length, 0, 'a blank URL sends no request');
    t.match(await invoke('ai-connection-models', { id: 'gateway', headerEdits: [{ op: 'set', name: 'X-Draft', value: 'fake-draft-secret' }] }), { success: true });
    t.match(requests[0], { headers: { 'X-Gateway': 'fake-header-secret', 'X-Draft': 'fake-draft-secret' } }, 'model-list projection carries saved and draft headers');
    await invoke('ai-connection-models', { id: 'gateway', headerEdits: [{ op: 'remove', name: 'X-Gateway' }] });
    t.equal((requests[1] as { headers?: unknown }).headers, undefined);
    t.same(cm.getAllCredentials(), before, 'draft Test writes nothing');
    t.match(await invoke('ai-connection-models', { id: 'gateway', headerEdits: [{ op: 'set', name: 'Host', value: 'fake-invalid-secret' }] }), { success: false, error: /Host/ });
    t.match(await invoke('ai-connection-models', { id: 'gateway', baseUrl: 'http://127.0.0.1:5678' }), { success: false, error: /saved credentials/i }, 'unsaved destinations cannot receive retained secrets');
    t.equal(requests.length, 2, 'invalid drafts never send a request');
    const input = { id: 'gateway', name: 'Invented gateway', type: 'openai', baseUrl: 'http://127.0.0.1:1234' };
    t.match(await invoke('ai-connection-save', { ...input, headerEdits: [{ op: 'set', name: 'X-Gateway', value: 'fake-new-secret' }] }), { success: true });
    t.equal(calls.length, 1);
    t.match(calls[0], { config: { selected: { connection: { headers: { 'X-Gateway': 'fake-new-secret' } }, model: 'example' } }, options: { force: true } });
    await invoke('ai-connection-save', input);
    t.equal(calls.length, 1, 'unchanged connection is not rebuilt');
    await invoke('ai-connection-save', { ...input, baseUrl: 'http://127.0.0.1:5678' });
    t.equal(calls.length, 2);
    t.equal(calls[1].config.selected?.connection.baseUrl, 'http://127.0.0.1:5678');
    await invoke('ai-connection-save', { ...input, id: undefined, headerEdits: [{ op: 'set', name: 'X-Other', value: 'fake-other-secret' }] });
    t.equal(calls.length, 2, 'another connection does not rebuild the selection');
    const views = await invoke('ai-connections-list') as ConnectionView[];
    t.match(views, [{ id: 'gemini' }]);
    t.match(views.find((c: { id: string }) => c.id === 'gateway'), { headers: [{ name: 'X-Gateway', set: true }] });
    t.notMatch(JSON.stringify(views), /fake-(key|new-secret|other-secret)/);
});

t.test('saved header replacement/removal and host edits replace the live embedding transport', async t => {
    const cm = credentials();
    const db = new Database(':memory:');
    db.exec('CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)');
    t.teardown(() => db.close());
    const requests: Array<{ url: string; header: string | null }> = [];
    const originalFetch = globalThis.fetch;
    t.teardown(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async (url, options) => {
        const header = new Headers(options?.headers).get('x-gateway');
        requests.push({ url: String(url), header });
        return Response.json({ data: [{ index: 0, embedding: [header === 'fake-new-secret' ? 2 : 1] }] });
    };
    const { EmbeddingPipeline } = mockRequire(path.resolve('electron/rag/EmbeddingPipeline.ts'), {
        [path.resolve('electron/rag/providers/LocalEmbeddingProvider.ts')]: { LocalEmbeddingProvider: class { async isAvailable() { return false; } } },
    }) as typeof import('../../electron/rag/EmbeddingPipeline');
    const pipeline = new EmbeddingPipeline(db, {} as never);
    await pipeline.initialize(buildEmbeddingConfig(cm));
    t.same(await pipeline.getEmbeddingForQuery('Invented query.'), [1]);
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const { registerConnectionHandlers } = mockRequire(path.resolve('electron/ipc/connections.ts'), {
        electron: { BrowserWindow: { getAllWindows: () => [] } },
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
        [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => cm } },
    }) as typeof import('../../electron/ipc/connections');
    registerConnectionHandlers({ getRAGManager: () => ({ initializeEmbeddings: pipeline.initialize.bind(pipeline) }) } as unknown as AppState);
    const save = (extra: object) => handlers.get('ai-connection-save')!(undefined, { id: 'gateway', name: 'Invented gateway', type: 'openai', baseUrl: 'http://127.0.0.1:1234', ...extra });
    t.match(await save({ headerEdits: [{ op: 'set', name: 'X-Gateway', value: 'fake-new-secret' }] }), { success: true });
    t.same(await pipeline.getEmbeddingForQuery('Invented query.'), [2], 'a new provider sends the replacement secret');
    t.equal(requests.at(-1)?.header, 'fake-new-secret');
    t.match(await save({ headerEdits: [{ op: 'remove', name: 'X-Gateway' }] }), { success: true });
    t.same(await pipeline.getEmbeddingForQuery('Invented query.'), [1]);
    t.equal(requests.at(-1)?.header, null, 'removed secret is not cached');
    t.match(await save({ baseUrl: 'http://127.0.0.1:5678' }), { success: true });
    t.same(await pipeline.getEmbeddingForQuery('Invented query.'), [1]);
    t.equal(requests.at(-1)?.url, 'http://127.0.0.1:5678/v1/embeddings', 'changed host is not cached');
    t.equal(requests.length, 8, 'each replacement probes once and serves the next query');
});

t.test('credential status is allowlisted and exposes only header names and set marks', async t => {
    const cm = credentials();
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const { registerCoreHandlers } = mockRequire(path.resolve('electron/ipc/core.ts'), {
        electron: { app: {} },
        [path.resolve('electron/main.ts')]: {},
        [path.resolve('electron/lib/auto-updater.ts')]: {},
        [path.resolve('electron/services/SettingsManager.ts')]: {},
        [path.resolve('electron/db/DatabaseManager.ts')]: {},
        [path.resolve('electron/ipc/rag.ts')]: {},
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
        [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => cm } },
    }) as typeof import('../../electron/ipc/core');
    registerCoreHandlers({} as AppState);
    const status = await handlers.get('get-stored-credentials')!() as { connectionHeaders?: Record<string, HeaderState[]> };
    t.same(status.connectionHeaders, { gateway: [{ name: 'X-Gateway', set: true }] });
    t.notMatch(JSON.stringify(status), /fake-key|fake-header-secret/);
});

t.test('translation projection carries headers and its Test redacts echoed secrets', async t => {
    const cm = credentials();
    const { testTranslation } = mockRequire(path.resolve('electron/lib/transcript-assembler.ts'), {
        [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => cm } },
    }) as typeof import('../../electron/lib/transcript-assembler');
    let seen: unknown;
    let fail = false;
    const state = { processingHelper: { getLLMHelper: () => ({ translateTranscriptText: async (request: unknown) => {
        seen = request;
        if (fail) throw new Error('Echoed fake-key and fake-header-secret');
        return 'Invented translation.';
    } }) } } as unknown as AppState;
    const draft = { provider: 'gateway', model: 'example', targetLanguage: 'chinese' };
    t.match(await testTranslation(state, draft), { success: true, translatedText: 'Invented translation.' });
    t.match(seen, { connection: { headers: { 'X-Gateway': 'fake-header-secret' } } });
    fail = true;
    const failed = await testTranslation(state, draft);
    t.match(failed, { success: false, error: /\[redacted\]/ });
    t.notMatch(JSON.stringify(failed), /fake-key|fake-header-secret/);
});
