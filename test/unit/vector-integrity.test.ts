import t, { type Test } from 'tap';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { RAGManager as Manager } from '../../electron/rag/RAGManager';
import type { EmbeddingPipeline as Pipeline } from '../../electron/rag/EmbeddingPipeline';
import type { VectorStore as Store } from '../../electron/rag/VectorStore';
import type { DatabaseManager as DBManager } from '../../electron/db/DatabaseManager';
import type { IEmbeddingProvider } from '../../electron/rag/providers/IEmbeddingProvider';

const file = (name: string) => path.resolve(`electron/${name}.ts`);
const dims = [3, 768, 1024];
const oldVector = [1, 0, 0];
const newVector = [0, 1, 0];
const blob = (vector: number[]) => Buffer.from(new Float32Array(vector).buffer);
const vector = (dim: number) => [1, ...Array(dim - 1).fill(0)];
const nativeError = 'Dimension mismatch for inserted vector for the "embedding" column. Expected 5 dimensions but received 3.';

async function setup(t: Test, native: boolean) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-vector-integrity-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const dbPath = path.join(dir, 'synthetic.sqlite');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    sqliteVec.load(db);
    db.exec(`
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE transcripts (id INTEGER PRIMARY KEY, meeting_id TEXT, content TEXT, speaker TEXT, timestamp_ms INTEGER);
        CREATE TABLE ai_interactions (id INTEGER PRIMARY KEY, meeting_id TEXT, type TEXT, timestamp INTEGER,
            user_query TEXT, ai_response TEXT, metadata_json TEXT);
        CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, is_processed INTEGER DEFAULT 1,
            embedding_provider TEXT, embedding_dimensions INTEGER);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
            chunk_index INTEGER, speaker TEXT, start_timestamp_ms INTEGER, end_timestamp_ms INTEGER,
            cleaned_text TEXT, token_count INTEGER, embedding BLOB);
        CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
            summary_text TEXT, embedding BLOB);
        CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, chunk_id INTEGER,
            status TEXT DEFAULT 'pending', retry_count INTEGER DEFAULT 0, error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT, UNIQUE(meeting_id, chunk_id));
        INSERT INTO meetings VALUES ('meeting-a', 'Invented amber meeting', 1, 'example:index', 3),
            ('meeting-b', 'Invented cobalt meeting', 1, 'chosen:index', 3);
        INSERT INTO chunks VALUES (1, 'meeting-a', 0, 'Speaker', 1000, 2000, 'Amber lanterns stay.', 3, NULL),
            (2, 'meeting-b', 0, 'Speaker', 3000, 4000, 'Cobalt lanterns stay.', 3, NULL);
        INSERT INTO chunk_summaries VALUES (1, 'meeting-a', 'Amber shelf approved.', NULL),
            (2, 'meeting-b', 'Cobalt shelf approved.', NULL);
    `);
    const ensureVecTableForDim = (dim: number) => db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_${dim} USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dim}]);
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries_${dim} USING vec0(summary_id INTEGER PRIMARY KEY, embedding float[${dim}]);
    `);
    for (const dim of dims) {
        ensureVecTableForDim(dim);
        for (const id of [1, 2]) {
            db.prepare(`INSERT INTO vec_chunks_${dim} (chunk_id, embedding) VALUES (?, ?)`).run(BigInt(id), blob(vector(dim)));
            db.prepare(`INSERT INTO vec_summaries_${dim} (summary_id, embedding) VALUES (?, ?)`).run(BigInt(id), blob(vector(dim)));
        }
    }
    db.prepare('UPDATE chunks SET embedding = ?').run(blob(oldVector));
    db.prepare('UPDATE chunk_summaries SET embedding = ?').run(blob(oldVector));
    const requests: string[] = [];
    const { VectorStore } = mockRequire(file('rag/VectorStore'), {
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => ({ ensureVecTableForDim }), KNOWN_DIMS: [768, 1536, 3072] } },
        worker_threads: { Worker: class extends Worker {
            constructor() {
                super(`require(${JSON.stringify(require.resolve('tsx/cjs'))}); require(${JSON.stringify(file('rag/vectorSearchWorker'))});`, { eval: true });
            }
            postMessage(message: { type: string }, transferList?: Parameters<Worker['postMessage']>[1]) {
                requests.push(message.type);
                super.postMessage(message, transferList);
            }
        } },
    }) as { VectorStore: typeof Store };
    const inputs: string[] = [];
    const p: IEmbeddingProvider = {
        name: 'example:index', dimensions: 3, isAvailable: async () => true,
        embed: async text => { inputs.push(text); return newVector; },
        embedQuery: async () => newVector, embedBatch: async texts => texts.map(() => newVector),
    };
    let localEmbeds = 0;
    const sent: string[] = [];
    const { EmbeddingPipeline } = mockRequire(file('rag/EmbeddingPipeline'), {
        [file('rag/providers/LocalEmbeddingProvider')]: { LocalEmbeddingProvider: class {
            name = 'local'; dimensions = 384;
            async isAvailable() { return true; }
            async embed() { localEmbeds++; return vector(384); }
        } },
        [file('rag/EmbeddingProviderResolver')]: { EmbeddingProviderResolver: { resolve: async () => p } },
        electron: { BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string) => sent.push(channel) } }] } },
    }) as { EmbeddingPipeline: typeof Pipeline };
    const { DatabaseManager } = mockRequire(file('db/DatabaseManager'), { electron: {} }) as { DatabaseManager: typeof DBManager };
    const databaseManager = Object.create(DatabaseManager.prototype) as DBManager;
    Reflect.set(databaseManager, 'db', db);
    const { RAGManager } = mockRequire(file('rag/RAGManager'), {
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => databaseManager } },
        [file('rag/VectorStore')]: { VectorStore }, [file('rag/EmbeddingPipeline')]: { EmbeddingPipeline },
    }) as { RAGManager: typeof Manager };
    const manager = new RAGManager({ db, dbPath, extPath: sqliteVec.getLoadablePath() });
    const pipeline = manager.getEmbeddingPipeline();
    await pipeline.initialize({});
    Reflect.set(pipeline, 'delay', async () => {});
    const store = Reflect.get(manager, 'vectorStore') as Store;
    Reflect.set(store, 'useNativeVec', native);
    const nativeRows = (id: number) => ({
        chunks: dims.map(dim => db.prepare(`SELECT * FROM vec_chunks_${dim} WHERE chunk_id = ?`).all(id)),
        summaries: dims.map(dim => db.prepare(`SELECT * FROM vec_summaries_${dim} WHERE summary_id = ?`).all(id)),
    });
    const state = (id = 1) => {
        const meetingId = id === 1 ? 'meeting-a' : 'meeting-b';
        return {
            meeting: db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId),
            chunks: db.prepare('SELECT * FROM chunks WHERE meeting_id = ? ORDER BY id').all(meetingId),
            summaries: db.prepare('SELECT * FROM chunk_summaries WHERE meeting_id = ? ORDER BY id').all(meetingId),
            native: nativeRows(id),
        };
    };
    const jobs = () => db.prepare('SELECT * FROM embedding_queue ORDER BY id').all() as Array<{
        meeting_id: string; chunk_id: number | null; status: string; retry_count: number; error_message: string | null;
    }>;
    const queue = (kind: 'chunk' | 'summary') => db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('meeting-a', ?, 'pending')"
    ).run(kind === 'chunk' ? 1 : null);
    t.teardown(async () => { await pipeline.processQueue(); await store.destroy(); db.close(); });
    return { db, store, manager, pipeline, p, inputs, requests, sent, state, jobs, queue, nativeRows, databaseManager,
        localEmbeds: () => localEmbeds,
    };
}

async function ragHandlers(manager: Manager, orchestrator?: unknown) {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const { registerRagHandlers } = mockRequire(file('ipc/rag'), {
        [file('main')]: {},
        [file('services/CredentialsManager')]: { CredentialsManager: { getInstance: () => ({ getEmbeddingUse: () => ({ connectionId: '', model: '' }) }) } },
        [file('ipc/safeHandle')]: { safeHandle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
    }) as typeof import('../../electron/ipc/rag');
    registerRagHandlers({ getRAGManager: () => manager, getKnowledgeOrchestrator: () => orchestrator } as Parameters<typeof registerRagHandlers>[0]);
    return handlers;
}

for (const native of [true, false]) {
    const mode = native ? 'native' : 'JS';
    t.test(`${mode}: flush removes every meeting vector including orphans, but preserves knowledge`, async t => {
        const f = await setup(t, native);
        f.db.exec(`CREATE TABLE knowledge_documents (id INTEGER PRIMARY KEY, raw_text TEXT);
            INSERT INTO knowledge_documents VALUES (1, 'Invented retained notes.');
            CREATE VIRTUAL TABLE vec_knowledge_3 USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[3]);`);
        f.db.prepare('INSERT INTO vec_knowledge_3 VALUES (?, ?)').run(1n, blob(oldVector));
        f.db.exec(`INSERT INTO transcripts VALUES (1, 'meeting-a', 'Invented line.', 'Speaker', 1000);
            INSERT INTO ai_interactions (id, meeting_id) VALUES (1, 'meeting-a');`);
        f.queue('summary');
        for (const dim of dims) f.db.prepare(`INSERT INTO vec_chunks_${dim} VALUES (?, ?)`).run(999n, blob(vector(dim)));
        t.equal(f.databaseManager.clearAllData(), true);
        for (const table of ['meetings', 'chunks', 'chunk_summaries', 'embedding_queue', 'transcripts', 'ai_interactions',
            ...dims.flatMap(dim => [`vec_chunks_${dim}`, `vec_summaries_${dim}`])]) {
            t.same(f.db.prepare(`SELECT * FROM ${table}`).all(), [], `${table} is empty`);
        }
        t.match(f.db.prepare('SELECT * FROM knowledge_documents').all(), [{ raw_text: 'Invented retained notes.' }]);
        t.same(f.db.prepare('SELECT * FROM vec_knowledge_3').all(), [{ chunk_id: 1, embedding: blob(oldVector) }]);
    });

    t.test(`${mode}: processMeeting summary replacement removes the previous summary native id`, async t => {
        const f = await setup(t, native);
        await f.manager.processMeeting('meeting-a', [
            { speaker: 'Speaker', text: 'Invented amber lanterns now need another shelf.', timestamp: 1000 },
        ], 'Invented replacement shelf approved.');
        await f.pipeline.processQueue();
        const summaries = f.db.prepare('SELECT * FROM chunk_summaries WHERE meeting_id = ?').all('meeting-a') as { id: number; embedding: Buffer }[];
        t.equal(summaries.length, 1);
        t.same(summaries[0].embedding, blob(newVector));
        t.not(summaries[0].id, 1);
        for (const dim of dims) {
            const rows = f.db.prepare(`SELECT * FROM vec_summaries_${dim} WHERE summary_id != 2`).all();
            t.same(rows, native && dim === 3 ? [{ summary_id: summaries[0].id, embedding: blob(newVector) }] : []);
        }
        t.match(f.state(2).summaries, [{ id: 2, summary_text: 'Cobalt shelf approved.', embedding: blob(oldVector) }]);
    });

    t.test(`${mode}: Re-index all queues each vector once and atomically replaces each meeting`, async t => {
        const f = await setup(t, native);
        f.p.name = 'active:new-index';
        f.p.dimensions = 2;
        const inputs: string[] = [];
        let release!: () => void;
        let started!: () => void;
        const waiting = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { started = resolve; });
        const before = f.state();
        const other = f.state(2);
        f.p.embed = async text => { inputs.push(text); started(); await waiting; return [0, 1]; };
        const handlers = await ragHandlers(f.manager);
        const first = handlers.get('rag:reindex-all')!();
        const second = handlers.get('rag:reindex-all')!();
        await entered;
        t.same(f.state(), before, 'old BLOBs, native vectors and metadata survive while embedding');
        t.same(f.state(2), other);
        t.equal(f.jobs().length, 4, 'one job for each chunk and summary, not two copies');
        t.same(f.pipeline.getQueueStatus(), { pending: 2, processing: 2, completed: 0, failed: 0 });
        release();
        t.same(await Promise.all([first, second]), [{ success: true }, { success: true }]);
        t.same(inputs.sort(), ['Amber lanterns stay.', 'Amber shelf approved.', 'Cobalt lanterns stay.', 'Cobalt shelf approved.'].sort());
        t.same(f.pipeline.getQueueStatus(), { pending: 0, processing: 0, completed: 4, failed: 0 });
        for (const id of [1, 2]) {
            const state = f.state(id);
            t.match(state.meeting, { embedding_provider: 'active:new-index', embedding_dimensions: 2 });
            t.match(state.chunks, [{ embedding: blob([0, 1]) }]);
            t.match(state.summaries, [{ embedding: blob([0, 1]) }]);
            t.same(state.native, { chunks: dims.map(() => []), summaries: dims.map(() => []) }, 'all old dimensions are gone only after replacement');
        }
        if (native) {
            t.equal((f.db.prepare('SELECT COUNT(*) AS count FROM vec_chunks_2').get() as { count: number }).count, 2);
            t.equal((f.db.prepare('SELECT COUNT(*) AS count FROM vec_summaries_2').get() as { count: number }).count, 2);
        }
    });

    t.test(`${mode}: a failed full rebuild preserves the old meeting and Retry failed finishes it`, async t => {
        const f = await setup(t, native);
        const before = f.state();
        f.p.name = 'active:new-index';
        let attempts = 0;
        f.p.embed = async () => { if (++attempts % 2 === 0) throw new Error('Synthetic rebuild quota exceeded'); return newVector; };
        const handlers = await ragHandlers(f.manager);
        t.same(await handlers.get('rag:reindex-all')!(), { success: true });
        t.same(f.state(), before, 'no partial rebuild, including after three attempts');
        t.match(f.jobs().slice(0, 2), [{ status: 'failed', retry_count: 3 }, { status: 'failed', retry_count: 3 }]);
        f.p.embed = async () => newVector;
        const PipelineClass = f.pipeline.constructor as typeof Pipeline;
        const restarted = new PipelineClass(f.db, f.store);
        await restarted.initialize({});
        Reflect.set(restarted, 'delay', async () => {});
        Reflect.set(f.manager, 'embeddingPipeline', restarted);
        t.same(await handlers.get('rag:retry-embeddings')!(), { success: true });
        t.match(f.state().meeting, { embedding_provider: 'active:new-index' });
        t.match(f.state().chunks, [{ embedding: blob(newVector) }]);
        t.match(f.state().summaries, [{ embedding: blob(newVector) }]);
        t.equal(f.pipeline.getQueueStatus().failed, 0);
    });

    t.test(`${mode}: retry deduplicates historical failed summary jobs without touching completed jobs`, async t => {
        const f = await setup(t, native);
        f.db.exec(`INSERT INTO embedding_queue (meeting_id, chunk_id, status, retry_count) VALUES
            ('meeting-a', NULL, 'failed', 3), ('meeting-a', NULL, 'failed', 3), ('meeting-b', 2, 'completed', 0);`);
        const handlers = await ragHandlers(f.manager);
        await Promise.all([handlers.get('rag:retry-embeddings')!(), handlers.get('rag:retry-embeddings')!()]);
        t.same(f.inputs, ['Amber shelf approved.']);
        t.match(f.jobs(), [{ meeting_id: 'meeting-a', chunk_id: null, status: 'completed' }, { meeting_id: 'meeting-b', status: 'completed' }]);
    });

    t.test(`${mode}: Retry failed indexes only failed jobs, resets retries and is safe twice`, async t => {
        const f = await setup(t, native);
        const handlers = await ragHandlers(f.manager);
        f.db.exec(`INSERT INTO embedding_queue (meeting_id, chunk_id, status, retry_count, error_message) VALUES
            ('meeting-a', 1, 'failed', 3, 'Synthetic quota exceeded\nInvented second error line'),
            ('meeting-a', NULL, 'failed', 3, 'Synthetic quota exceeded'),
            ('meeting-b', 2, 'completed', 0, NULL);`);
        const before = f.state(2);
        const status = await handlers.get('embedding-status')!();
        t.match(status, { failedMeetings: 1, firstError: 'Synthetic quota exceeded', meetingCount: 2 });
        t.same(await Promise.all([handlers.get('rag:retry-embeddings')!(), handlers.get('rag:retry-embeddings')!()]), [{ success: true }, { success: true }]);
        t.same(f.inputs, ['Amber lanterns stay.', 'Amber shelf approved.']);
        t.match(f.jobs(), [
            { meeting_id: 'meeting-a', chunk_id: 1, status: 'completed', retry_count: 0, error_message: null },
            { meeting_id: 'meeting-a', chunk_id: null, status: 'completed', retry_count: 0, error_message: null },
            { meeting_id: 'meeting-b', chunk_id: 2, status: 'completed', retry_count: 0 },
        ]);
        t.same(f.state(2), before, 'completed meeting was not requeued');
        t.match(f.state().chunks, [{ embedding: blob(newVector) }]);
        t.match(f.state().summaries, [{ embedding: blob(newVector) }]);
        t.match(await handlers.get('embedding-status')!(), { failedMeetings: 0, firstError: null });
    });

    for (const kind of ['chunk', 'summary'] as const) {
        t.test(`${mode}: re-embedding a ${kind} replaces its vector and queries the new content`, async t => {
            const f = await setup(t, native);
            const before = f.state();
            const other = f.state(2);
            f.queue(kind);
            await f.pipeline.processQueue();
            t.same(f.inputs, [kind === 'chunk' ? 'Amber lanterns stay.' : 'Amber shelf approved.']);
            t.match(f.jobs(), [{ status: 'completed', retry_count: 0, error_message: null }]);
            t.match(f.state().meeting, { embedding_provider: 'example:index', embedding_dimensions: 3 });
            if (kind === 'chunk') {
                t.match(f.state().chunks, [{ id: 1, cleaned_text: 'Amber lanterns stay.', embedding: blob(newVector) }]);
                t.same(await f.store.searchSimilar(newVector, { meetingId: 'meeting-a', providerName: 'example:index' }), [{
                    id: 1, meetingId: 'meeting-a', chunkIndex: 0, speaker: 'Speaker', startMs: 1000, endMs: 2000,
                    text: 'Amber lanterns stay.', tokenCount: 3, similarity: 1,
                }]);
                t.same(f.requests, [native ? 'nativeVecSearch' : 'searchChunks']);
                if (native) t.same(f.nativeRows(1).chunks[0], [{ chunk_id: 1, embedding: blob(newVector) }]);
            } else {
                t.match(f.state().summaries, [{ id: 1, summary_text: 'Amber shelf approved.', embedding: blob(newVector) }]);
                t.same(await f.store.searchSummaries(newVector, 5, 'example:index'), [{
                    meetingId: 'meeting-a', summaryText: 'Amber shelf approved.', similarity: 1,
                }]);
                t.same(f.requests, [native ? 'nativeVecSearchSummaries' : 'searchSummaries']);
                if (native) t.same(f.nativeRows(1).summaries[0], [{ summary_id: 1, embedding: blob(newVector) }]);
            }
            t.same(kind === 'chunk' ? f.state().summaries : f.state().chunks,
                kind === 'chunk' ? before.summaries : before.chunks, 'the other vector family is unchanged');
            if (!native) t.same(f.nativeRows(1), before.native, 'JS writes leave native tables alone');
            t.same(f.state(2), other, 'another meeting is unchanged');
        });

        t.test(`${mode}: exhausted ${kind} jobs fail with the provider error without downgrading the meeting`, async t => {
            const f = await setup(t, native);
            const before = f.state();
            const other = f.state(2);
            let attempts = 0;
            f.p.embed = async () => { attempts++; throw new Error('Synthetic provider refusal'); };
            f.db.prepare("INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('meeting-b', 2, 'completed')").run();
            const completed = f.jobs()[0];
            f.queue(kind);
            await f.pipeline.processQueue();
            t.equal(attempts, 3);
            t.match(f.jobs(), [completed, { meeting_id: 'meeting-a', chunk_id: kind === 'chunk' ? 1 : null,
                status: 'failed', retry_count: 3, error_message: 'Synthetic provider refusal', processed_at: null }]);
            t.same(f.state(), before, 'all stored text, BLOBs, native vectors, provider and dimensions survive');
            t.same(f.state(2), other);
            t.equal(f.localEmbeds(), 0, 'the available local provider is not used by a failed job');
            t.same(f.sent, [], 'no fallback-activated event is sent');
            t.same(f.pipeline.getQueueStatus(), { pending: 0, processing: 0, completed: 1, failed: 1 });
            await f.pipeline.processQueue();
            t.equal(attempts, 3, 'failed jobs are terminal');
        });
    }

    for (const clear of ['native vectors', 'single embeddings', 'incompatible embeddings', 'store chunks', 'manager chunks', 'summary refresh', 'meeting data', 'meeting delete'] as const) {
        t.test(`${mode}: ${clear} clears dynamic dimensions without damaging unrelated data`, async t => {
            const f = await setup(t, native);
            const before = f.state();
            const other = f.state(2);
            const empty = dims.map(() => []);
            switch (clear) {
                case 'native vectors': f.store.clearNativeVectorsForMeeting('meeting-a'); break;
                case 'single embeddings': f.store.clearEmbeddingsForMeeting('meeting-a'); break;
                case 'incompatible embeddings': t.same(f.store.deleteEmbeddingsForMeetings('chosen:index'), ['meeting-a']); break;
                case 'store chunks': f.store.deleteChunksForMeeting('meeting-a'); break;
                case 'manager chunks': await f.manager.processMeeting('meeting-a', []); break;
                case 'summary refresh': f.manager.refreshMeetingSummary('meeting-a', 'New amber shelf approved.'); break;
                case 'meeting data': f.manager.deleteMeetingData('meeting-a'); break;
                case 'meeting delete': {
                    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
                    const order: string[] = [];
                    const remove = f.databaseManager.deleteMeeting.bind(f.databaseManager);
                    f.databaseManager.deleteMeeting = id => {
                        order.push('record');
                        t.same(f.nativeRows(1), { chunks: empty, summaries: empty }, 'all vectors are removed before the real record cascade');
                        return remove(id);
                    };
                    const { registerMeetingHandlers } = mockRequire(file('ipc/meeting'), {
                        electron: {}, [file('main')]: {},
                        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => f.databaseManager } },
                        [file('ipc/safeHandle')]: { safeHandle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
                    }) as typeof import('../../electron/ipc/meeting');
                    registerMeetingHandlers({
                        getMeetingAgent: () => ({ deleteStore: async () => { order.push('agent'); } }),
                        getRAGManager: () => f.manager,
                    } as unknown as Parameters<typeof registerMeetingHandlers>[0]);
                    t.equal(await handlers.get('delete-meeting')!(null, 'meeting-a'), true);
                    t.same(order, ['agent', 'record']);
                    break;
                }
            }
            const after = f.state();
            t.same(f.state(2), other, 'other meeting content, metadata and vectors in every dimension are intact');
            if (clear === 'summary refresh') {
                t.same(after.chunks, before.chunks);
                t.same(after.native, { chunks: before.native.chunks, summaries: empty });
                t.match(after.summaries, [{ meeting_id: 'meeting-a', summary_text: 'New amber shelf approved.', embedding: null }]);
                t.match(f.jobs(), [{ chunk_id: null, status: 'pending', retry_count: 0 }]);
            } else if (clear === 'store chunks' || clear === 'manager chunks') {
                t.same(after.chunks, []);
                t.same(after.summaries, before.summaries);
                t.same(after.native, { chunks: empty, summaries: before.native.summaries });
            } else if (clear === 'meeting data' || clear === 'meeting delete') {
                t.same(after.chunks, []);
                t.same(after.summaries, []);
                t.same(after.native, { chunks: empty, summaries: empty });
                t.same(f.jobs(), []);
            } else if (clear === 'native vectors') {
                t.same(after, { ...before, native: { chunks: empty, summaries: empty } });
            } else {
                t.match(after.chunks, [{ cleaned_text: 'Amber lanterns stay.', embedding: null }]);
                t.match(after.summaries, [{ summary_text: 'Amber shelf approved.', embedding: null }]);
                t.same(after.native, { chunks: empty, summaries: empty });
                t.match(after.meeting, { embedding_provider: null, embedding_dimensions: null });
            }
            if (clear === 'meeting delete') t.equal(after.meeting, undefined);
            else if (clear !== 'single embeddings' && clear !== 'incompatible embeddings') t.same(after.meeting, before.meeting);
            Reflect.set(f.pipeline, 'provider', null);
        });
    }
}

for (const kind of ['chunk', 'summary'] as const) {
    t.test(`native: a rejected ${kind} insert rolls back its BLOB and native deletion on every retry`, async t => {
        const f = await setup(t, true);
        const table = kind === 'chunk' ? 'vec_chunks_3' : 'vec_summaries_3';
        const idColumn = kind === 'chunk' ? 'chunk_id' : 'summary_id';
        // A malformed native table produces a real sqlite-vec insertion error, after the old row was deleted.
        f.db.exec(`DROP TABLE ${table}; CREATE VIRTUAL TABLE ${table} USING vec0(${idColumn} INTEGER PRIMARY KEY, embedding float[5]);`);
        for (const id of [1, 2]) f.db.prepare(`INSERT INTO ${table} (${idColumn}, embedding) VALUES (?, ?)`).run(BigInt(id), blob(vector(5)));
        const before = f.state();
        const other = f.state(2);
        let retries = 0;
        Reflect.set(f.pipeline, 'delay', async () => {
            retries++;
            t.same(f.state(), before, 'the transaction restored both the BLOB and deleted native row before retry');
            t.match(f.jobs(), [{ status: 'pending', retry_count: retries, error_message: nativeError }]);
        });
        f.queue(kind);
        await f.pipeline.processQueue();
        t.equal(retries, 2);
        t.equal(f.inputs.length, 3);
        t.match(f.jobs(), [{ status: 'failed', retry_count: 3, error_message: nativeError }]);
        t.same(f.state(), before);
        t.same(f.state(2), other);
        t.equal(f.localEmbeds(), 0);
        t.same(f.sent, []);
    });
}

t.test('Re-index all derives missing passages and summary from every saved record', async t => {
    const f = await setup(t, true);
    f.db.exec(`ALTER TABLE meetings ADD COLUMN summary_json TEXT;
        INSERT INTO meetings (id, title, is_processed) VALUES ('never-indexed', 'Invented never-indexed meeting', 1);
        INSERT INTO transcripts VALUES (1, 'never-indexed', 'Invented violet lanterns need a new shelf.', 'Speaker', 1000);`);
    f.db.prepare('UPDATE meetings SET summary_json = ? WHERE id = ?').run(JSON.stringify({ detailedSummary: {
        keyPoints: ['Invented violet lanterns need a shelf.'], actionItems: ['Build a violet shelf.'],
    } }), 'never-indexed');
    const handlers = await ragHandlers(f.manager);
    t.same(await handlers.get('rag:reindex-all')!(), { success: true });
    t.match(f.db.prepare('SELECT * FROM chunks WHERE meeting_id = ?').all('never-indexed'), [{
        cleaned_text: 'Invented violet lanterns need a new shelf.', embedding: blob(newVector),
    }]);
    t.match(f.db.prepare('SELECT * FROM chunk_summaries WHERE meeting_id = ?').all('never-indexed'), [{
        summary_text: 'Invented violet lanterns need a shelf.. Action: Build a violet shelf.', embedding: blob(newVector),
    }]);
    t.match(f.jobs().filter(job => job.meeting_id === 'never-indexed'), [{ status: 'completed' }, { status: 'completed' }]);
    t.equal(f.jobs().length, 6);
});

t.test('a full rebuild native storage failure rolls back every vector and provider metadata', async t => {
    const f = await setup(t, true);
    const before = f.state();
    f.p.name = 'active:replacement';
    f.db.exec(`CREATE TEMP TRIGGER deny_rebuild BEFORE UPDATE OF embedding ON chunk_summaries
        WHEN NEW.meeting_id = 'meeting-a' BEGIN SELECT RAISE(ABORT, 'Synthetic summary storage refused'); END;`);
    const handlers = await ragHandlers(f.manager);
    t.same(await handlers.get('rag:reindex-all')!(), { success: true });
    t.same(f.state(), before, 'even the chunk writes and native deletions rolled back');
    t.match(f.jobs().slice(0, 2), [{ status: 'failed', error_message: 'Synthetic summary storage refused' }, { status: 'failed' }]);
    f.db.exec('DROP TRIGGER deny_rebuild');
    t.same(await handlers.get('rag:retry-embeddings')!(), { success: true });
    t.match(f.state().meeting, { embedding_provider: 'active:replacement' });
    t.match(f.state().chunks, [{ embedding: blob(newVector) }]);
    t.match(f.state().summaries, [{ embedding: blob(newVector) }]);
});

t.test('SQL summary replacement and flush still succeed when sqlite-vec cannot be loaded', async t => {
    const f = await setup(t, true);
    const unloaded = new Database(f.db.name);
    t.teardown(() => unloaded.close());
    const StoreClass = f.store.constructor as typeof Store;
    const store = new StoreClass(unloaded, f.db.name, '');
    store.saveSummary('meeting-a', 'Invented offline summary replacement.');
    t.match(f.db.prepare('SELECT * FROM chunk_summaries WHERE meeting_id = ?').get('meeting-a'), { summary_text: 'Invented offline summary replacement.', embedding: null });
    Reflect.set(f.databaseManager, 'db', unloaded);
    t.equal(f.databaseManager.clearAllData(), true);
    for (const table of ['meetings', 'chunks', 'chunk_summaries', 'embedding_queue', 'transcripts', 'ai_interactions']) {
        t.same(f.db.prepare(`SELECT * FROM ${table}`).all(), []);
    }
});

t.test('a search-index cleanup failure does not stop a meeting from being deleted', async t => {
    const f = await setup(t, true);
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const { registerMeetingHandlers } = mockRequire(file('ipc/meeting'), {
        electron: {}, [file('main')]: {},
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => f.databaseManager } },
        [file('ipc/safeHandle')]: { safeHandle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
    }) as typeof import('../../electron/ipc/meeting');
    registerMeetingHandlers({
        getMeetingAgent: () => ({ deleteStore: async () => {} }),
        getRAGManager: () => ({ deleteMeetingData: () => { throw new Error('no such module: vec0'); } }),
    } as unknown as Parameters<typeof registerMeetingHandlers>[0]);
    t.equal(await handlers.get('delete-meeting')!(null, 'meeting-a'), true);
    t.equal(f.state().meeting, undefined, 'the record is gone');
    t.same(f.state(2).meeting?.id, 'meeting-b', 'the other meeting is untouched');
});

t.test('a failing job backs off 2 s then 4 s and waits no longer once it has failed', async t => {
    const f = await setup(t, true);
    const delays: number[] = [];
    Reflect.set(f.pipeline, 'delay', async (ms: number) => { delays.push(ms); });
    f.p.embed = async () => { throw new Error('Synthetic provider refusal'); };
    f.queue('chunk');
    await f.pipeline.processQueue();
    t.same(delays, [2000, 4000]);
});

t.test('an empty queue and a queue with one status report zero for every other count', async t => {
    const f = await setup(t, true);
    t.same(f.pipeline.getQueueStatus(), { pending: 0, processing: 0, completed: 0, failed: 0 });
    f.queue('chunk');
    t.same(f.pipeline.getQueueStatus(), { pending: 1, processing: 0, completed: 0, failed: 0 });
});

t.test('queue status counts exhausted pending rows as stalled without double-counting failed jobs', async t => {
    const f = await setup(t, false);
    f.db.exec(`
        INSERT INTO embedding_queue (meeting_id, chunk_id, status, retry_count) VALUES
            ('meeting-a', 10, 'pending', 0), ('meeting-a', 11, 'pending', 2),
            ('meeting-a', 12, 'pending', 3), ('meeting-a', 13, 'pending', 4),
            ('meeting-a', 14, 'processing', 0), ('meeting-a', 15, 'completed', 0),
            ('meeting-a', 16, 'failed', 3);
    `);
    const before = f.jobs();
    t.same(f.pipeline.getQueueStatus(), { pending: 2, processing: 1, completed: 1, failed: 3 });
    t.same(f.jobs(), before, 'status reporting does not rewrite jobs');
    Reflect.set(f.pipeline, 'provider', null);
});
