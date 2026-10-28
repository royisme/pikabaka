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
    t.same(f.getAnswerSources(), { meetings: true, materials: false, profile: false });
    f.manager.set('answerUsesMeetings', false);
    f.manager.set('answerUsesMaterials', true);
    f.manager.set('answerUsesProfile', true);
    t.same(f.getAnswerSources(), { meetings: false, materials: true, profile: true });
    t.same(JSON.parse(readFileSync(f.settingsPath, 'utf8')), {
        answerUsesMeetings: false, answerUsesMaterials: true, answerUsesProfile: true,
    });
    f.manager.set('answerUsesMeetings', true);
    f.manager.set('answerUsesMaterials', false);
    f.manager.set('answerUsesProfile', false);
    t.same(f.getAnswerSources(), { meetings: true, materials: false, profile: false });
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
const resumeText = 'Invented copper resume fact.';
const roleText = 'Invented silver role fact.';
const identity = 'Invented Candidate Cedar';
const vector = { embedding: [1, 0, 0], provider: 'example:index', dimensions: 3 };
async function knowledge(t: Test, native = false, notesOnly = false) {
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
    for (const [type, text, parsed] of [
        [DocType.NOTES, noteText, null],
        ...notesOnly ? [] : [
            [DocType.RESUME, resumeText, { identity: { name: identity }, skills: ['InventedCopperSkill'],
                experience: [{ role: 'InventedCopperRole', company: 'Invented Copper Co', highlights: [resumeText] }],
                projects: [], education: [], totalExperienceYears: 3 }],
            [DocType.JD, roleText, { title: 'InventedSilverRole', company: 'Invented Silver Co',
                requirements: [roleText], technologies: ['InventedSilverTech'], keywords: ['InventedSilverKeyword'] }],
        ],
    ] as Array<[DocType, string, unknown]>) {
        const id = manager.insertDocument(type, 'invented.txt', text, parsed);
        if (type === DocType.JD) manager.setActiveDocument(id);
        const [chunkId] = manager.saveChunks(id, [{ text, metadata: { docType: type } }]);
        await store.storeEmbeddings(id, [{ id: chunkId, text }], async () => vector);
    }
    orchestrator.setKnowledgeMode(true);
    orchestrator.setEmbedQueryFn(async () => vector);
    orchestrator.setEmbeddingStatusFn(() => ({ providerName: vector.provider, dimensions: 3 }));
    const prompts: string[] = [];
    orchestrator.setGenerateContentFn(async contents => {
        prompts.push(JSON.stringify(contents)); return 'Invented intro reply.';
    });
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
    const ask = (stream: boolean, question = 'Explain the invented silver plan') => stream
        ? collect(helper.streamChat(question, undefined, 'Invented live transcript context.'))
        : helper.chatWithGemini(question, undefined, 'Invented live transcript context.');
    return { ...s, db, knowledgeDb: manager, orchestrator, helper, prompts, ask };
}

for (const native of [false, true]) {
    t.test(`${native ? 'native' : 'JS'} disabled kinds cannot crowd permitted evidence out of the top five`, async t => {
        for (const [disabled, materials, profile, expected] of [
            [DocType.NOTES, false, true, resumeText], [DocType.RESUME, true, false, noteText],
        ] as const) {
            const f = await knowledge(t, native);
            const store = new KnowledgeVectorStore(f.db);
            const id = f.knowledgeDb.insertDocument(disabled, 'invented.txt', 'Invented unrelated passage.', null);
            const chunks = Array.from({ length: 8 }, () => ({ text: 'Invented unrelated passage.', metadata: { docType: disabled } }));
            const ids = f.knowledgeDb.saveChunks(id, chunks);
            await store.storeEmbeddings(id, ids.map(id => ({ id, text: 'Invented unrelated passage.' })), async () => vector);
            f.manager.set('answerUsesMaterials', materials);
            f.manager.set('answerUsesProfile', profile);
            f.prompts.length = 0;
            t.match(await f.ask(true), 'Invented model reply.');
            t.match(f.prompts[0], expected);
            t.notMatch(f.prompts[0], 'Invented unrelated passage.');
        }
    });

    for (const stream of [false, true]) {
        t.test(`${native ? 'native' : 'JS'} ${stream ? 'stream' : 'non-stream'} interceptor isolates all four source combinations and re-reads toggles`, async t => {
            const f = await knowledge(t, native);
            for (const [materials, profile] of [[false, false], [true, false], [false, true], [true, true], [false, false]]) {
                f.manager.set('answerUsesMaterials', materials);
                f.manager.set('answerUsesProfile', profile);
                f.prompts.length = 0;
                const reply = await f.ask(stream);
                t.match(reply, 'Invented model reply.', 'a real fake-model result is delivered');
                t.equal(f.prompts.length, 1);
                const prompt = f.prompts[0];
                t.equal(prompt.includes(noteText), materials, 'only opted-in materials reach the model');
                // Identity and role keywords travel in the knowledge system prompt, which non-streaming chat has never applied.
                for (const text of [resumeText, roleText, ...(stream ? [identity, 'InventedSilverKeyword'] : [])]) {
                    t.equal(prompt.includes(text), profile, 'only opted-in profile/roles reach the model');
                }
                if (!profile) for (const text of [identity, 'InventedSilverKeyword']) t.notMatch(prompt, text);
                t.match(prompt, 'Invented live transcript context.', 'current context always survives');
                if (!profile) t.notMatch(prompt, /Candidate identity:|0 years of experience/, 'off profile contributes no invented stand-in identity');
                t.equal(reply, 'Invented model reply.', 'a switched-off kind adds nothing to the answer text');
            }
        });
    }
}

for (const stream of [false, true]) {
    t.test(`notes-only ${stream ? 'stream' : 'non-stream'} user: default-off contributes nothing, opt-in contributes notes`, async t => {
        const f = await knowledge(t, false, true);
        t.match(await f.ask(stream), 'Invented model reply.');
        t.notMatch(f.prompts.join('\n'), noteText);
        f.manager.set('answerUsesProfile', true);
        f.prompts.length = 0;
        t.match(await f.ask(stream), 'Invented model reply.');
        t.notMatch(f.prompts.join('\n'), noteText, 'profile opt-in cannot enable notes');
        f.manager.set('answerUsesProfile', false);
        f.manager.set('answerUsesMaterials', true);
        f.prompts.length = 0;
        t.match(await f.ask(stream), 'Invented model reply.');
        t.match(f.prompts.join('\n'), noteText);
        t.notMatch(f.prompts.join('\n'), identity);
    });

    t.test(`${stream ? 'stream' : 'non-stream'} both-off skips the interceptor entirely; processing failure keeps live context`, async t => {
        const f = await knowledge(t);
        let intercepted = 0;
        Reflect.set(f.orchestrator, 'isKnowledgeMode', () => { intercepted++; return true; });
        Reflect.set(f.orchestrator, 'processQuestion', () => { throw new Error('Synthetic knowledge unavailable'); });
        t.match(await f.ask(stream), 'Invented model reply.');
        t.equal(intercepted, 0, 'even isKnowledgeMode is skipped');
        f.manager.set('answerUsesMaterials', true);
        f.prompts.length = 0;
        t.match(await f.ask(stream), 'Invented model reply.');
        t.equal(intercepted, 1);
        t.match(f.prompts[0], 'Invented live transcript context.');
        t.notMatch(f.prompts[0], /Invented Candidate Cedar|Invented violet material fact|Invented copper resume fact|Invented silver role fact/);
    });

    t.test(`${stream ? 'stream' : 'non-stream'} live coaching is profile-gated and preserves its existing structured answer`, async t => {
        const f = await knowledge(t);
        Reflect.set(f.orchestrator, 'negotiationTracker', {
            isActive: () => true, getCoachingResponse: () => ({ line: 'Invented copper coaching.' }),
        });
        f.manager.set('answerUsesMaterials', true);
        t.match(await f.ask(stream), 'Invented model reply.');
        f.manager.set('answerUsesProfile', true);
        f.manager.set('answerUsesMaterials', false);
        f.prompts.length = 0;
        t.same(JSON.parse(await f.ask(stream)), { __negotiationCoaching: { line: 'Invented copper coaching.' } });
        t.same(f.prompts, [], 'coaching remains a shortcut, not a second model request');
    });

    t.test(`${stream ? 'stream' : 'non-stream'} intro and no-index/no-match/throw fallbacks cannot reintroduce off kinds`, async t => {
        const f = await knowledge(t);
        f.manager.set('answerUsesMaterials', true);
        t.match(await f.ask(stream, 'Tell me about yourself'), 'Invented model reply.');
        t.notMatch(f.prompts.join('\n'), identity, 'intro shortcut cannot load an opted-out profile');
        f.manager.set('answerUsesProfile', true);
        f.prompts.length = 0;
        t.match(await f.ask(stream, 'Tell me about yourself'), 'Invented intro reply.');
        t.match(f.prompts.join('\n'), identity);
        t.notMatch(f.prompts.join('\n'), noteText, 'intro remains profile-only');
        f.db.exec('UPDATE knowledge_chunks SET embedding = NULL');
        f.manager.set('answerUsesProfile', false);
        f.prompts.length = 0;
        t.match(await f.ask(stream), 'Invented model reply.');
        t.notMatch(f.prompts.join('\n'), /Invented Candidate Cedar|Invented copper resume fact|Invented silver role fact/);
        f.manager.set('answerUsesProfile', true);
        f.manager.set('answerUsesMaterials', false);
        f.prompts.length = 0;
        t.match(await f.ask(stream), 'Invented model reply.');
        t.match(f.prompts.join('\n'), resumeText, 'profile fallback still works without vectors');
        // Role keywords and identity reach the model through the knowledge system prompt, which non-streaming chat has never applied.
        if (stream) t.match(f.prompts.join('\n'), 'InventedSilverKeyword');
        t.notMatch(f.prompts.join('\n'), noteText);
        f.db.prepare('UPDATE knowledge_chunks SET embedding = ?').run(Buffer.from(new Float32Array([1, 0, 0]).buffer));
        f.orchestrator.setEmbedQueryFn(async () => ({ ...vector, embedding: [0, 1, 0] }));
        f.prompts.length = 0;
        t.match(await f.ask(stream), 'Invented model reply.');
        if (stream) t.match(f.prompts.join('\n'), identity, 'no-match identity is allowed only with profile on');
        t.notMatch(f.prompts.join('\n'), noteText);
        f.manager.set('answerUsesProfile', false);
        f.manager.set('answerUsesMaterials', true);
        f.prompts.length = 0;
        t.match(await f.ask(stream), 'Invented model reply.');
        t.notMatch(f.prompts.join('\n'), identity);
        f.orchestrator.setEmbedQueryFn(async () => { throw new Error('Synthetic embedding unavailable'); });
        f.prompts.length = 0;
        t.match(await f.ask(stream), 'Invented model reply.');
        t.notMatch(f.prompts.join('\n'), /Invented Candidate Cedar|Invented copper resume fact|Invented silver role fact/);
    });
}


t.test('knowledge mode needs the mode flag and an opted-in kind that has stored content', async t => {
    const full = await knowledge(t);
    const notesOnly = await knowledge(t, false, true);
    const resumeOnly = await knowledge(t);
    resumeOnly.orchestrator.deleteDocumentsByType(DocType.NOTES);
    for (const [materials, profile] of [[false, false], [true, false], [false, true], [true, true]]) {
        for (const f of [full, notesOnly, resumeOnly]) {
            f.manager.set('answerUsesMaterials', materials);
            f.manager.set('answerUsesProfile', profile);
        }
        t.equal(full.orchestrator.isKnowledgeMode(), materials || profile);
        t.equal(notesOnly.orchestrator.isKnowledgeMode(), materials, 'the profile switch cannot make notes count');
        t.equal(resumeOnly.orchestrator.isKnowledgeMode(), profile, 'the materials switch cannot make a resume count');
    }
    full.orchestrator.setKnowledgeMode(false);
    t.equal(full.orchestrator.isKnowledgeMode(), false, 'opted-in kinds do not switch the mode on by themselves');
});

for (const stream of [false, true]) {
    t.test(`${stream ? 'stream' : 'non-stream'} chat answers normally when no knowledge store is attached, even with every kind opted in`, async t => {
        const f = await knowledge(t);
        f.manager.set('answerUsesMaterials', true);
        f.manager.set('answerUsesProfile', true);
        f.helper.setKnowledgeOrchestrator(null as never);
        t.equal(await f.ask(stream), 'Invented model reply.');
        t.match(f.prompts[0], 'Invented live transcript context.');
    });
}
