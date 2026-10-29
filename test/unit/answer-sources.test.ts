import t, { type Test } from 'tap';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type * as Settings from '../../electron/services/SettingsManager';
import type { RAGManager } from '../../electron/rag/RAGManager';
import type { AppState } from '../../electron/main';
import type { AgentRuntime } from '../../electron/agent/loader';
import { createMeetingTools, type MeetingToolDeps } from '../../electron/agent/tools/meetingTools';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { KnowledgeDatabaseManager } from '../../electron/knowledge/KnowledgeDatabaseManager';
import { KnowledgeVectorStore } from '../../electron/knowledge/KnowledgeVectorStore';
import { DocType } from '../../electron/knowledge/types';
import type { KnowledgeOrchestrator } from '../../electron/knowledge/KnowledgeOrchestrator';
import type { LLMHelper } from '../../electron/core/LLMHelper';

const file = (name: string) => path.resolve(`electron/${name}.ts`);
function settings(t: Test) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-answer-sources-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const settingsPath = path.join(dir, 'settings.json');
    const module = mockRequire(file('services/SettingsManager'), {
        [file('services/configPaths')]: { getSettingsJsonPath: () => settingsPath },
    }) as typeof Settings;
    return { ...module, manager: module.SettingsManager.getInstance(), settingsPath };
}

t.test('missing source keys use the approved defaults; each read sees changes on the same settings object', t => {
    const f = settings(t);
    t.same(f.getAnswerSources(), { meetings: true, materials: false });
    f.manager.set('answerUsesMeetings', false);
    f.manager.set('answerUsesMaterials', true);
    f.manager.set('answerUsesProfile', true);
    t.same(f.getAnswerSources(), { meetings: false, materials: true }, 'the dormant profile setting is not read');
    t.same(JSON.parse(readFileSync(f.settingsPath, 'utf8')), {
        answerUsesMeetings: false, answerUsesMaterials: true, answerUsesProfile: true,
    }, 'the stored profile value stays written but unread');
    f.manager.set('answerUsesMeetings', true);
    f.manager.set('answerUsesMaterials', false);
    f.manager.set('answerUsesProfile', false);
    t.same(f.getAnswerSources(), { meetings: true, materials: false });
    t.end();
});

const off = 'Past-meeting search is turned off.';
const pastText = 'Invented amber meeting evidence.';
async function collect(stream: AsyncIterable<string>) {
    let text = '';
    for await (const chunk of stream) text += chunk;
    return text;
}

function retrieval(t: Test) {
    const s = settings(t);
    let searches = 0;
    let summaries = 0;
    let embeds = 0;
    let hits = true;
    const prompts: string[] = [];
    const chunk = { id: 1, meetingId: 'saved-open', text: pastText, tokenCount: 8,
        speaker: 'Speaker', startMs: 0, endMs: 1, similarity: 1, chunkIndex: 0 };
    const store = {
        hasEmbeddings: () => true,
        searchSimilar: async () => { searches++; return hits ? [chunk] : []; },
        searchSummaries: async () => { summaries++; return []; },
    };
    const pipeline = {
        initialize: async () => {}, isReady: () => true, getActiveProviderName: () => 'example:index',
        getEmbeddingForQuery: async () => { embeds++; return [1, 0, 0]; },
    };
    const { RAGManager: Manager } = mockRequire(file('rag/RAGManager'), {
        [file('services/SettingsManager')]: s,
        [file('rag/VectorStore')]: { VectorStore: class { constructor() { return store; } } },
        [file('rag/EmbeddingPipeline')]: { EmbeddingPipeline: class { constructor() { return pipeline; } } },
        [file('rag/LiveRAGIndexer')]: { LiveRAGIndexer: class { getActiveMeetingId() { return 'saved-open'; } } },
    }) as { RAGManager: typeof RAGManager };
    const rag = new Manager({ db: {} as ConstructorParameters<typeof Manager>[0]['db'], dbPath: '', extPath: '' });
    rag.setLLMHelper({ streamChatWithGemini: async function* (prompt: string) {
        prompts.push(prompt); yield 'Invented model reply.';
    } } as Parameters<RAGManager['setLLMHelper']>[0]);
    let ready = true;
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const { registerRagHandlers } = mockRequire(file('ipc/rag'), {
        [file('main')]: {}, [file('services/SettingsManager')]: s,
        [file('ipc/safeHandle')]: { safeHandle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(channel, handler) },
    }) as typeof import('../../electron/ipc/rag');
    registerRagHandlers({ getRAGManager: () => ready ? rag : null } as AppState);
    const events: Array<{ channel: string; payload: unknown }> = [];
    const invoke = (channel: string, payload: unknown) => handlers.get(channel)!({ sender: {
        send: (channel: string, payload: unknown) => events.push({ channel, payload }),
    } }, payload);
    return { ...s, rag, prompts, events, invoke, store, pipeline,
        counts: () => [searches, summaries, embeds], noHits: () => { hits = false; }, unavailable: () => { ready = false; } };
}

t.test('the agent search_meetings tool returns a plain refusal off and actual evidence on, without restarting', async t => {
    const f = retrieval(t);
    let deps!: MeetingToolDeps;
    const { getMeetingAgent } = mockRequire(file('agent/instance'), {
        electron: { app: { getPath: () => '/unused-synthetic-path' } },
        [file('services/SettingsManager')]: f,
        [file('main')]: { AppState: { getInstance: () => ({ getRAGManager: () => f.rag, getCurrentMeetingId: () => 'live-current' }) } },
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => ({ getDb: () => ({}), getDbPath: () => '', getExtPath: () => '' }) } },
        [file('rag/VectorStore')]: { VectorStore: class { constructor() { return f.store; } } },
        [file('agent/MeetingAgent')]: { MeetingAgent: class { constructor(config: MeetingToolDeps) { deps = config; } } },
        [file('agent/models')]: {},
    }) as typeof import('../../electron/agent/instance');
    getMeetingAgent();
    const runtime = { durable: { defineTool: (definition: unknown) => definition }, Type: {
        Object: () => ({}), String: () => ({}), Optional: () => ({}), Number: () => ({}),
    }, chord: { awaitWithContext: (promise: Promise<unknown>) => promise } } as unknown as AgentRuntime;
    const tool = createMeetingTools(runtime, 'live-current', deps).transcript.find(tool => tool.name === 'search_meetings')!;
    const execute = Reflect.get(tool, 'execute') as (args: { query: string }, api: unknown, context: unknown) => Promise<unknown>;
    f.manager.set('answerUsesMeetings', false);
    t.same(await execute({ query: 'Find the amber plan' }, {}, {}), { output: [{ type: 'text', text: off }] });
    t.same(f.counts(), [0, 0, 0], 'disabled search performs no embedding or retrieval');
    f.manager.set('answerUsesMeetings', true);
    t.match(await execute({ query: 'Find the amber plan' }, {}, {}), { output: [{ type: 'text', text: JSON.stringify([
        { meetingId: 'saved-open', text: pastText, startMs: 0, endMs: 1 },
    ]) }] });
    t.same(f.counts(), [1, 0, 1]);
});

t.test('global manager and smart query refuse before retrieval; toggling on reaches the model and no-hit fallback', async t => {
    const f = retrieval(t);
    f.manager.set('answerUsesMeetings', false);
    t.equal(await collect(f.rag.queryGlobal('Find the amber plan')), off);
    t.equal(await collect(f.rag.query('Find the amber plan')), off);
    t.same(f.counts(), [0, 0, 0]);
    t.same(f.prompts, []);
    f.manager.set('answerUsesMeetings', true);
    t.equal(await collect(f.rag.queryGlobal('Find the amber plan')), 'Invented model reply.');
    t.match(f.prompts[0], pastText);
    t.same(f.counts(), [1, 1, 1]);
    f.noHits();
    const { NO_GLOBAL_CONTEXT_FALLBACK } = await import('../../electron/rag/prompts');
    t.equal(await collect(f.rag.queryGlobal('Find the amber plan')), NO_GLOBAL_CONTEXT_FALLBACK);
    f.manager.set('answerUsesMeetings', false);
    t.equal(await collect(f.rag.queryGlobal('Find the amber plan')), off, 'off does not use the no-hit reply');
    t.same(f.counts(), [2, 2, 2]);
});

for (const available of [true, false]) {
    t.test(`global IPC off is streamed, not a renderer fallback (RAG ${available ? 'ready' : 'unavailable'})`, async t => {
        const f = retrieval(t);
        if (!available) f.unavailable();
        f.manager.set('answerUsesMeetings', false);
        t.same(await f.invoke('rag:query-global', { query: 'Find the amber plan' }), { success: true });
        t.same(f.events, [
            { channel: 'rag:stream-chunk', payload: { global: true, chunk: off } },
            { channel: 'rag:stream-complete', payload: { global: true } },
        ]);
        t.same(f.counts(), [0, 0, 0]);
        f.events.length = 0;
        f.manager.set('answerUsesMeetings', true);
        t.same(await f.invoke('rag:query-global', { query: 'Find the amber plan' }), available ? { success: true } : { fallback: true });
        t.same(f.events, available ? [
            { channel: 'rag:stream-chunk', payload: { global: true, chunk: 'Invented model reply.' } },
            { channel: 'rag:stream-complete', payload: { global: true } },
        ] : []);
        if (available) t.match(f.prompts[0], pastText);
    });
}

t.test('live and viewed-meeting IPC and scoped smart queries retain meeting context with meetings off', async t => {
    const f = retrieval(t);
    f.manager.set('answerUsesMeetings', false);
    for (const channel of ['rag:query-live', 'rag:query-meeting']) {
        t.same(await f.invoke(channel, { query: 'What was the amber plan?', meetingId: 'saved-open' }), { success: true });
    }
    t.equal(await collect(f.rag.query('What did they say?', 'saved-open')), 'Invented model reply.');
    t.equal(f.prompts.length, 3);
    for (const prompt of f.prompts) t.match(prompt, pastText);
    t.same(f.counts(), [3, 0, 3]);
});

const noteText = 'Invented violet material fact.';
const vector = { embedding: [1, 0, 0], provider: 'example:index', dimensions: 3 };
async function knowledge(t: Test, native = false) {
    const s = settings(t);
    const db = new Database(':memory:');
    t.teardown(() => db.close());
    if (native) sqliteVec.load(db);
    const manager = new KnowledgeDatabaseManager(db);
    const { KnowledgeOrchestrator: Orchestrator } = mockRequire(file('knowledge/KnowledgeOrchestrator'), {
        [file('services/SettingsManager')]: s,
    }) as { KnowledgeOrchestrator: typeof KnowledgeOrchestrator };
    const orchestrator = new Orchestrator(manager);
    const store = new KnowledgeVectorStore(db);
    const id = manager.insertDocument(DocType.NOTES, 'notes.txt', noteText, null);
    const [chunkId] = manager.saveChunks(id, [{ text: noteText, metadata: { docType: DocType.NOTES } }]);
    await store.storeEmbeddings(id, [{ id: chunkId, text: noteText }], async () => vector);
    orchestrator.setEmbedQueryFn(async () => vector);
    orchestrator.setEmbeddingStatusFn(() => ({ providerName: vector.provider, dimensions: 3 }));
    const prompts: string[] = [];
    const { LLMHelper: Helper } = mockRequire(file('core/LLMHelper'), {
        '@google/genai': {}, openai: {}, '@anthropic-ai/sdk': {},
        [file('services/SettingsManager')]: s,
        [file('services/CredentialsManager')]: { CredentialsManager: { getInstance: () => ({
            resolveModelUse: () => ({ connection: { id: 'example', type: 'openai', baseUrl: 'https://invalid.example', apiKey: '' }, model: 'invented' }),
            getSttLanguageUser: () => 'english-us', getAnswerStyle: () => '',
        }) } },
        electron: { BrowserWindow: { getAllWindows: () => [] } },
    }) as { LLMHelper: typeof LLMHelper };
    const helper = new Helper();
    helper.setKnowledgeOrchestrator(orchestrator);
    s.manager.set('answerUsesMeetings', false);
    Reflect.set(helper, 'streamViaConnectionChat', async function* (_connection: unknown, _model: string, system: string, user: string) {
        prompts.push(`${system}\n${user}`); yield 'Invented model reply.';
    });
    const ask = (stream: boolean, question = 'Explain the invented violet plan') => stream
        ? collect(helper.streamChat(question, undefined, 'Invented live transcript context.'))
        : helper.chatWithGemini(question, undefined, 'Invented live transcript context.');
    return { ...s, db, knowledgeDb: manager, orchestrator, helper, prompts, ask };
}

for (const native of [false, true]) {
    for (const stream of [false, true]) {
        t.test(`${native ? 'native' : 'JS'} ${stream ? 'stream' : 'non-stream'} notes contribute only with the materials switch on, and a dormant profile setting is unread`, async t => {
            const f = await knowledge(t, native);
            t.match(await f.ask(stream), 'Invented model reply.');
            t.notMatch(f.prompts.join('\n'), noteText, 'materials are off by default');
            t.equal(f.orchestrator.getNotes(), noteText, 'the notes are saved and searchable');

            f.manager.set('answerUsesProfile', true);
            f.prompts.length = 0;
            t.match(await f.ask(stream), 'Invented model reply.');
            t.notMatch(f.prompts.join('\n'), noteText, 'the stored profile setting is ignored');

            f.manager.set('answerUsesProfile', false);
            f.manager.set('answerUsesMaterials', true);
            f.prompts.length = 0;
            t.match(await f.ask(stream), 'Invented model reply.');
            t.match(f.prompts.join('\n'), noteText, 'the materials switch lets the notes answer');
            t.match(f.prompts.join('\n'), 'Invented live transcript context.', 'current context always survives');

            f.manager.set('answerUsesMaterials', false);
            f.prompts.length = 0;
            t.match(await f.ask(stream), 'Invented model reply.');
            t.notMatch(f.prompts.join('\n'), noteText, 'a later call sees the switch turned off');
        });

        t.test(`${stream ? 'stream' : 'non-stream'} both off skips the interceptor entirely; processing failure keeps live context`, async t => {
            const f = await knowledge(t);
            let intercepted = 0;
            Reflect.set(f.orchestrator, 'processQuestion', () => { intercepted++; throw new Error('Synthetic knowledge unavailable'); });
            t.match(await f.ask(stream), 'Invented model reply.');
            t.equal(intercepted, 0, 'with materials off the interceptor is never asked');
            f.manager.set('answerUsesMaterials', true);
            f.prompts.length = 0;
            t.match(await f.ask(stream), 'Invented model reply.');
            t.equal(intercepted, 1);
            t.match(f.prompts[0], 'Invented live transcript context.');
            t.notMatch(f.prompts[0], /Invented violet material fact/, 'a failing lookup adds no notes');
        });
    }
}

t.test('notes Save with an empty text removes them, so they stop answering', async t => {
    const f = await knowledge(t);
    f.manager.set('answerUsesMaterials', true);
    f.prompts.length = 0;
    t.match(await f.ask(false), 'Invented model reply.');
    t.match(f.prompts.join('\n'), noteText);
    await f.orchestrator.setNotes('   ');
    t.equal(f.orchestrator.getNotes(), '');
    f.prompts.length = 0;
    t.match(await f.ask(false), 'Invented model reply.');
    t.notMatch(f.prompts.join('\n'), noteText);
});

for (const stream of [false, true]) {
    t.test(`${stream ? 'stream' : 'non-stream'} chat answers normally when no knowledge store is attached, even with materials opted in`, async t => {
        const f = await knowledge(t);
        f.manager.set('answerUsesMaterials', true);
        f.helper.setKnowledgeOrchestrator(null as never);
        t.equal(await f.ask(stream), 'Invented model reply.');
        t.match(f.prompts[0], 'Invented live transcript context.');
    });
}
