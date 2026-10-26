import t from 'tap';
import path from 'node:path';
import Database from 'better-sqlite3';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { EmbeddingPipeline as Pipeline } from '../../electron/rag/EmbeddingPipeline';
import type { RAGManager as Manager } from '../../electron/rag/RAGManager';
import type { VectorStore as Store } from '../../electron/rag/VectorStore';

const modulePath = (name: string) => path.resolve(`electron/rag/${name}.ts`);
const local = { name: 'local', dimensions: 384, isAvailable: async () => true, embed: async () => [1], embedQuery: async () => [1], embedBatch: async () => [[1]] };

function database(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE meetings (id TEXT PRIMARY KEY, embedding_provider TEXT, embedding_dimensions INTEGER, is_processed INTEGER);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY, meeting_id TEXT, embedding BLOB, cleaned_text TEXT);
        CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY, meeting_id TEXT, embedding BLOB);
        CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY, meeting_id TEXT, chunk_id INTEGER, status TEXT,
            retry_count INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT, error_message TEXT);
    `);
    return db;
}

t.test('pipeline force retries an unchanged choice and status distinguishes selected from fallback', async t => {
    const db = database();
    t.teardown(() => db.close());
    let resolutions = 0;
    const selected = { connection: { id: 'example', name: 'Example', type: 'openai' as const, baseUrl: 'http://localhost:1234', apiKey: '', builtin: false }, model: 'exact-example' };
    const { EmbeddingPipeline } = mockRequire(modulePath('EmbeddingPipeline'), {
        [modulePath('providers/LocalEmbeddingProvider')]: { LocalEmbeddingProvider: class { name = local.name; dimensions = local.dimensions; async isAvailable() { return true; } } },
        [modulePath('EmbeddingProviderResolver')]: { EmbeddingProviderResolver: { resolve: async () => { resolutions++; return resolutions === 1 ? local : { ...local, name: 'example:exact-example', dimensions: 5 }; } } },
        electron: { BrowserWindow: { getAllWindows: () => [] } },
    }) as { EmbeddingPipeline: typeof Pipeline };
    const pipeline = new EmbeddingPipeline(db, { getIncompatibleMeetingsCount: () => 0 } as unknown as Store);
    t.same(pipeline.getStatus(), { providerName: null, dimensions: null, usingSelected: false });
    await pipeline.initialize({ selected });
    t.same(pipeline.getStatus(), { providerName: 'local', dimensions: 384, usingSelected: false });
    await pipeline.initialize({ selected });
    t.equal(resolutions, 1, 'unchanged config is skipped');
    await pipeline.initialize({ selected }, { force: true });
    t.equal(resolutions, 2, 'Save can retry exactly the same selected model');
    t.same(pipeline.getStatus(), { providerName: 'example:exact-example', dimensions: 5, usingSelected: true });
});

t.test('a forced model switch waits for active queue writes', async t => {
    const db = database();
    t.teardown(() => db.close());
    db.exec(`
        INSERT INTO meetings VALUES ('queued-example', NULL, NULL, 1);
        INSERT INTO chunks VALUES (1, 'queued-example', NULL, 'Invented queued text.');
        INSERT INTO embedding_queue (id, meeting_id, chunk_id, status) VALUES (1, 'queued-example', 1, 'pending');
    `);
    let finishEmbedding: (vector: number[]) => void = () => {};
    const embedding = new Promise<number[]>(resolve => { finishEmbedding = resolve; });
    let resolutions = 0;
    const { EmbeddingPipeline } = mockRequire(modulePath('EmbeddingPipeline'), {
        [modulePath('providers/LocalEmbeddingProvider')]: { LocalEmbeddingProvider: class { async isAvailable() { return false; } } },
        [modulePath('EmbeddingProviderResolver')]: { EmbeddingProviderResolver: { resolve: async () => {
            resolutions++;
            return { ...local, name: resolutions === 1 ? 'old:example' : 'new:example', embed: () => embedding };
        } } },
        electron: { BrowserWindow: { getAllWindows: () => [] } },
    }) as { EmbeddingPipeline: typeof Pipeline };
    const writes: number[] = [];
    const pipeline = new EmbeddingPipeline(db, {
        getIncompatibleMeetingsCount: () => 0,
        storeEmbedding: (id: number) => { writes.push(id); },
    } as unknown as Store);
    await pipeline.initialize({});
    const processing = pipeline.processQueue();
    t.equal(pipeline.processQueue(), processing, 'concurrent callers share the active queue run');
    const switching = pipeline.initialize({}, { force: true });
    await new Promise<void>(resolve => setImmediate(resolve));
    t.equal(resolutions, 1);
    t.same(writes, []);
    finishEmbedding([1]);
    await switching;
    t.same(writes, [1]);
    t.equal(pipeline.getStatus().providerName, 'new:example');
    t.equal((db.prepare("SELECT embedding_provider FROM meetings WHERE id = 'queued-example'").get() as { embedding_provider: string }).embedding_provider, 'old:example');
});

t.test('rebuild includes never-embedded completed meetings and removes stale queue rows before queueing', async t => {
    const db = database();
    t.teardown(() => db.close());
    db.exec(`
        INSERT INTO meetings VALUES ('old', 'other:example', 3, 1), ('never', NULL, NULL, 1), ('unchunked', NULL, NULL, 1), ('current', 'chosen:example', 3, 1), ('live', NULL, NULL, 0);
        INSERT INTO chunks VALUES (1, 'old', X'01', 'Invented old.'), (2, 'never', NULL, 'Invented never.'), (3, 'current', X'02', 'Invented current.');
        INSERT INTO chunk_summaries VALUES (1, 'old', X'01');
        INSERT INTO embedding_queue (id, meeting_id, chunk_id, status) VALUES (1, 'old', 1, 'completed'), (2, 'never', 2, 'failed');
    `);
    const { VectorStore } = mockRequire(modulePath('VectorStore'), {
        [path.resolve('electron/db/DatabaseManager.ts')]: { DatabaseManager: { KNOWN_DIMS: [] } },
    }) as { VectorStore: typeof Store };
    const store = new VectorStore(db, '', '');
    t.equal(store.getIncompatibleMeetingsCount('chosen:example'), 1);
    const { RAGManager } = mockRequire(modulePath('RAGManager'), {
        [modulePath('VectorStore')]: { VectorStore },
        [modulePath('EmbeddingPipeline')]: { EmbeddingPipeline: class {} },
        [modulePath('LiveRAGIndexer')]: { LiveRAGIndexer: class {} },
        [modulePath('RAGRetriever')]: { RAGRetriever: class {} },
    }) as { RAGManager: typeof Manager };
    const manager = Object.create(RAGManager.prototype) as Manager;
    const queued: string[] = [];
    const reprocessed: string[] = [];
    let drained = false;
    Reflect.set(manager, 'db', db);
    Reflect.set(manager, 'vectorStore', store);
    Reflect.set(manager, 'embeddingPipeline', {
        processQueue: async () => { drained = true; },
        getActiveProviderName: () => 'chosen:example',
        queueMeeting: async (id: string) => {
            t.ok(drained, 'old writes finish before index reset');
            t.equal(db.prepare('SELECT 1 FROM embedding_queue WHERE meeting_id = ?').get(id), undefined);
            queued.push(id);
        },
    });
    Reflect.set(manager, 'reprocessMeeting', async (id: string) => { reprocessed.push(id); });
    await manager.reindexIncompatibleMeetings();
    t.same(queued, ['old', 'never']);
    t.same(reprocessed, ['unchunked']);
    t.equal((db.prepare("SELECT embedding FROM chunks WHERE meeting_id = 'old'").get() as { embedding: null }).embedding, null);
    t.equal((db.prepare("SELECT embedding FROM chunk_summaries WHERE meeting_id = 'old'").get() as { embedding: null }).embedding, null);
    t.equal((db.prepare("SELECT embedding_provider FROM meetings WHERE id = 'current'").get() as { embedding_provider: string }).embedding_provider, 'chosen:example');
    t.equal(store.getIncompatibleMeetingsCount('chosen:example'), 0);
});
