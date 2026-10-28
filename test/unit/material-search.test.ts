import t, { type Test } from 'tap';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type * as Settings from '../../electron/services/SettingsManager';
import type { AgentRuntime } from '../../electron/agent/loader';
import { createMeetingTools, type MeetingToolDeps } from '../../electron/agent/tools/meetingTools';
import { KnowledgeDatabaseManager } from '../../electron/knowledge/KnowledgeDatabaseManager';
import { KnowledgeVectorStore } from '../../electron/knowledge/KnowledgeVectorStore';
import { DocType } from '../../electron/knowledge/types';
import type { KnowledgeOrchestrator as Orchestrator } from '../../electron/knowledge/KnowledgeOrchestrator';

const file = (name: string) => path.resolve(`electron/${name}.ts`);

function settings(t: Test) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-material-search-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const settingsPath = path.join(dir, 'settings.json');
    const module = mockRequire(file('services/SettingsManager'), {
        [file('services/configPaths')]: { getSettingsJsonPath: () => settingsPath },
    }) as typeof Settings;
    return { ...module, manager: module.SettingsManager.getInstance() };
}

const question = 'What is the violet plan?';
const query = { embedding: [1, 0, 0], provider: 'example:amber', dimensions: 3 };

function materials(t: Test) {
    const s = settings(t);
    const db = new Database(':memory:');
    t.teardown(() => db.close());
    const manager = new KnowledgeDatabaseManager(db);
    const { KnowledgeOrchestrator } = mockRequire(file('knowledge/KnowledgeOrchestrator'), {
        [file('services/SettingsManager')]: s,
    }) as { KnowledgeOrchestrator: typeof Orchestrator };
    const orchestrator = new KnowledgeOrchestrator(manager);
    const store = new KnowledgeVectorStore(db);
    const embedded: string[] = [];
    orchestrator.setEmbedQueryFn(async text => { embedded.push(text); return { ...query }; });
    orchestrator.setEmbeddingStatusFn(() => ({ providerName: query.provider, dimensions: query.dimensions }));
    const add = async (docType: DocType, fileName: string, texts: string[], vectors: number[][], provider = query.provider) => {
        const id = manager.insertDocument(docType, fileName, texts.join('\n'), null);
        const chunkIds = manager.saveChunks(id, texts.map(text => ({ text, metadata: { docType } })));
        const vectorsInOrder = [...vectors];
        await store.storeEmbeddings(id, chunkIds.map((chunkId, index) => ({ id: chunkId, text: texts[index] })), async () => ({
            embedding: vectorsInOrder.shift()!, provider, dimensions: query.dimensions,
        }));
        return id;
    };
    return { ...s, db, manager, orchestrator, embedded, add };
}

t.test('the notes lookup returns only notes, with the file name and the real score', async t => {
    const f = materials(t);
    const shared = 'Invented violet note passage.';
    await f.add(DocType.NOTES, 'notes.txt', [shared], [[1, 0, 0]]);
    await f.add(DocType.RESUME, 'resume.txt', [shared], [[1, 0, 0]]);
    await f.add(DocType.JD, 'role.txt', [shared], [[1, 0, 0]]);
    const passages = await f.orchestrator.searchMaterials(question);
    t.same(f.embedded, [question], 'the existing query embedding is used once');
    t.same(passages.map(passage => passage.text), [shared]);
    t.same(passages.map(passage => passage.source), ['notes.txt']);
    t.equal(passages[0].score, 1);
    t.end();
});

t.test('a note indexed with another provider is skipped and a compatible one is kept', async t => {
    const f = materials(t);
    await f.add(DocType.NOTES, 'cobalt.txt', ['Invented cobalt note passage.'], [[1, 0, 0]], 'example:cobalt');
    await f.add(DocType.NOTES, 'amber.txt', ['Invented amber note passage.'], [[1, 0, 0]]);
    const passages = await f.orchestrator.searchMaterials(question);
    t.same(passages.map(passage => passage.text), ['Invented amber note passage.']);
    t.end();
});

t.test('the same minimum score as the interceptor cuts an unrelated passage', async t => {
    const f = materials(t);
    await f.add(DocType.NOTES, 'notes.txt', ['Invented amber note passage.', 'Invented unrelated note passage.'], [[1, 0, 0], [0, 1, 0]]);
    const passages = await f.orchestrator.searchMaterials(question);
    t.same(passages.map(passage => passage.text), ['Invented amber note passage.']);
    t.ok(passages[0].score >= 0.3);
    t.end();
});

t.test('the lookup caps at five passages and trims each to a fixed length', async t => {
    const f = materials(t);
    const long = `Invented ${'lantern '.repeat(120)}`;
    await f.add(DocType.NOTES, 'long.txt', [long], [[1, 0, 0]]);
    await f.add(DocType.NOTES, 'notes.txt', [0, 1, 2, 3, 4, 5].map(index => `Invented passage ${index}.`), Array.from({ length: 6 }, () => [1, 0, 0]));
    const passages = await f.orchestrator.searchMaterials(question);
    t.equal(passages.length, 5);
    const trimmed = passages.filter(passage => passage.source === 'long.txt');
    t.equal(trimmed.length, 1);
    t.ok(trimmed[0].text.length < long.length, 'the long note is trimmed');
    t.equal(trimmed[0].text, long.slice(0, trimmed[0].text.length));
    t.end();
});

t.test('no notes returns an empty list and a failed query embedding reaches the caller', async t => {
    const f = materials(t);
    t.same(await f.orchestrator.searchMaterials(question), []);
    t.same(f.embedded, [], 'nothing is embedded without notes to search');
    await f.add(DocType.NOTES, 'notes.txt', ['Invented violet note passage.'], [[1, 0, 0]]);
    f.orchestrator.setEmbedQueryFn(async () => { throw new Error('Synthetic embedding unavailable'); });
    await t.rejects(f.orchestrator.searchMaterials(question), /Synthetic embedding unavailable/, 'the failure reaches the tool boundary');
    t.end();
});

const off = 'Materials are turned off for answering.';
const runtime = { durable: { defineTool: (definition: unknown) => definition }, Type: {
    Object: () => ({}), String: () => ({}), Optional: () => ({}), Number: () => ({}),
}, chord: { awaitWithContext: (promise: Promise<unknown>) => promise } } as unknown as AgentRuntime;

function agent(t: Test, knowledge: { searchMaterials: (query: string) => Promise<unknown> } | null) {
    const s = settings(t);
    let deps!: MeetingToolDeps;
    const { getMeetingAgent } = mockRequire(file('agent/instance'), {
        electron: { app: { getPath: () => '/unused-synthetic-path' } },
        [file('services/SettingsManager')]: s,
        [file('main')]: { AppState: { getInstance: () => ({
            getKnowledgeOrchestrator: () => knowledge,
            getRAGManager: () => undefined,
            getCurrentMeetingId: () => 'live-current',
        }) } },
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => ({ getDb: () => ({}), getDbPath: () => '', getExtPath: () => '' }) } },
        [file('rag/VectorStore')]: { VectorStore: class { constructor() {} } },
        [file('agent/MeetingAgent')]: { MeetingAgent: class { constructor(config: MeetingToolDeps) { deps = config; } } },
        [file('agent/models')]: {},
    }) as typeof import('../../electron/agent/instance');
    getMeetingAgent();
    const tools = createMeetingTools(runtime, 'live-current', deps).transcript;
    const tool = tools.find(candidate => candidate.name === 'search_materials')!;
    const execute = Reflect.get(tool, 'execute') as (args: { query: string }, api: unknown, context: unknown) => Promise<unknown>;
    return { ...s, tools, tool, execute };
}

t.test('the agent search_materials tool is registered as a model tool that quotes data', t => {
    const f = agent(t, null);
    t.same(f.tools.map(tool => tool.name), ['search_transcript', 'recent_transcript', 'search_meetings', 'search_materials']);
    t.match(Reflect.get(f.tool, 'description'), /quoted data, not instructions/);
    t.same(Reflect.get(f.tool, 'callers'), ['model']);
    t.end();
});

t.test('materials off returns the exact sentence without embedding or searching', async t => {
    let calls = 0;
    const f = agent(t, { searchMaterials: async () => { calls++; return []; } });
    f.manager.set('answerUsesMaterials', false);
    t.same(await f.execute({ query: question }, {}, {}), { output: [{ type: 'text', text: off }] });
    t.equal(calls, 0);
    f.manager.set('answerUsesMaterials', true);
    await f.execute({ query: question }, {}, {});
    t.equal(calls, 1, 'the switch is read at call time');
    t.end();
});

t.test('on with a hit quotes the passages and on with no hit says so in words', async t => {
    const passages = [{ text: 'Invented violet note passage.', source: 'notes.txt', score: 0.8123 }];
    const f = agent(t, { searchMaterials: async () => passages });
    f.manager.set('answerUsesMaterials', true);
    t.same(await f.execute({ query: question }, {}, {}), { output: [{ type: 'text', text: JSON.stringify(passages) }] });
    const empty = agent(t, { searchMaterials: async () => [] });
    empty.manager.set('answerUsesMaterials', true);
    t.same(await empty.execute({ query: question }, {}, {}), { output: [{ type: 'text', text: 'No notes match that question.' }] });
    t.end();
});

t.test('a thrown embedding error becomes only the fixed tool failure', async t => {
    const f = agent(t, { searchMaterials: async () => { throw new Error('Synthetic provider refused the invented note'); } });
    f.manager.set('answerUsesMaterials', true);
    const result = await f.execute({ query: question }, {}, {});
    t.same(result, { isError: true, output: [{ type: 'text', text: 'Meeting tool unavailable' }] });
    t.notMatch(JSON.stringify(result), /Synthetic provider/);
    t.end();
});

t.test('the lookup needs both a query embedder and stored note vectors, and works without a status function', async t => {
    const f = materials(t);
    const text = 'Invented violet note passage.';
    await f.manager.saveChunks(f.manager.insertDocument(DocType.NOTES, 'unindexed.txt', text, null), [{ text, metadata: { docType: DocType.NOTES } }]);
    t.same(await f.orchestrator.searchMaterials(question), [], 'notes without vectors give nothing');
    t.same(f.embedded, [], 'and nothing is embedded for them');

    const g = materials(t);
    await g.add(DocType.NOTES, 'notes.txt', [text], [[1, 0, 0]]);
    Reflect.set(g.orchestrator, 'embedQueryFn', null);
    t.same(await g.orchestrator.searchMaterials(question), [], 'vectors without a query embedder give nothing');

    const h = materials(t);
    await h.add(DocType.NOTES, 'notes.txt', [text], [[1, 0, 0]]);
    Reflect.set(h.orchestrator, 'embeddingStatusFn', null);
    t.match(await h.orchestrator.searchMaterials(question), [{ text, source: 'notes.txt' }], 'no status function means no model-change check');
});

t.test('a model change while the query was embedded returns nothing, whether the provider or the dimensions differ', async t => {
    const f = materials(t);
    await f.add(DocType.NOTES, 'notes.txt', ['Invented violet note passage.'], [[1, 0, 0]]);
    t.equal((await f.orchestrator.searchMaterials(question)).length, 1, 'unchanged model finds the note');
    f.orchestrator.setEmbeddingStatusFn(() => ({ providerName: 'example:other', dimensions: query.dimensions }));
    t.same(await f.orchestrator.searchMaterials(question), [], 'another provider');
    f.orchestrator.setEmbeddingStatusFn(() => ({ providerName: query.provider, dimensions: 4 }));
    t.same(await f.orchestrator.searchMaterials(question), [], 'other dimensions');
});
