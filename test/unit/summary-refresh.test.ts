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
import type { IEmbeddingProvider } from '../../electron/rag/providers/IEmbeddingProvider';

const file = (name: string) => path.resolve(`electron/${name}.ts`);
const firstText = '  Amber lanterns need a new shelf.  ';
const newestText = 'Cobalt lanterns will stay by the window.';
const firstVector = [1, 0, 0];
const newestVector = [0, 1, 0];
const blob = (vector: number[]) => Buffer.from(new Float32Array(vector).buffer);
const provider = (name = 'example:summary', dimensions = 3): IEmbeddingProvider => ({
    name, dimensions, isAvailable: async () => true,
    embed: async text => [...(text === firstText ? firstVector : newestVector), ...Array(dimensions - 3).fill(0)],
    embedQuery: async () => [...newestVector, ...Array(dimensions - 3).fill(0)],
    embedBatch: async texts => texts.map(text => [...(text === firstText ? firstVector : newestVector), ...Array(dimensions - 3).fill(0)]),
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

async function setup(t: Test, native: boolean, p = provider(), chunkState: 'completed' | 'failed' | 'pending' = 'completed') {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-summary-refresh-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const dbPath = path.join(dir, 'synthetic.sqlite');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    sqliteVec.load(db);
    db.exec(`
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, summary_json TEXT, is_processed INTEGER DEFAULT 1,
            embedding_provider TEXT, embedding_dimensions INTEGER);
        CREATE TABLE transcripts (id INTEGER PRIMARY KEY, meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE, content TEXT);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
            chunk_index INTEGER, speaker TEXT, start_timestamp_ms INTEGER, end_timestamp_ms INTEGER,
            cleaned_text TEXT, token_count INTEGER, embedding BLOB);
        CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
            summary_text TEXT NOT NULL, embedding BLOB, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL, chunk_id INTEGER,
            status TEXT DEFAULT 'pending', retry_count INTEGER DEFAULT 0, error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT, UNIQUE(meeting_id, chunk_id));
        INSERT INTO meetings VALUES ('meeting-a', 'Invented meeting', '{"legacySummary":"Recorded summary stays."}', 1, 'example:summary', 3);
        INSERT INTO transcripts VALUES (1, 'meeting-a', 'Invented recorded line stays.');
        INSERT INTO chunks VALUES (1, 'meeting-a', 0, 'Speaker', 1000, 2000, 'Invented chunk stays.', 4, NULL);
        INSERT INTO embedding_queue (meeting_id, chunk_id, status, processed_at) VALUES ('meeting-a', 1, 'completed', '2026-01-01T00:00:00Z');
    `);
    const ensureVecTableForDim = (dim: number) => db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_${dim} USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dim}]);
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries_${dim} USING vec0(summary_id INTEGER PRIMARY KEY, embedding float[${dim}]);
    `);
    for (const dim of [3, 5, 768]) ensureVecTableForDim(dim);
    if (chunkState === 'completed') {
        db.prepare('UPDATE chunks SET embedding = ?').run(blob([0, 0, 1]));
        db.prepare('INSERT INTO vec_chunks_3 (chunk_id, embedding) VALUES (?, ?)').run(1n, blob([0, 0, 1]));
        db.prepare('INSERT INTO vec_chunks_5 (chunk_id, embedding) VALUES (?, ?)').run(1n, blob([1, 0, 0, 0, 0]));
    } else {
        db.prepare('UPDATE meetings SET embedding_provider = NULL, embedding_dimensions = NULL').run();
        db.prepare('UPDATE embedding_queue SET status = ?, processed_at = NULL').run(chunkState);
    }
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
    const { EmbeddingPipeline } = mockRequire(file('rag/EmbeddingPipeline'), {
        [file('rag/providers/LocalEmbeddingProvider')]: { LocalEmbeddingProvider: class { async isAvailable() { return false; } } },
        [file('rag/EmbeddingProviderResolver')]: { EmbeddingProviderResolver: { resolve: async () => p } },
        electron: { BrowserWindow: { getAllWindows: () => [] } },
    }) as { EmbeddingPipeline: typeof Pipeline };
    const { RAGManager } = mockRequire(file('rag/RAGManager'), {
        [file('rag/VectorStore')]: { VectorStore }, [file('rag/EmbeddingPipeline')]: { EmbeddingPipeline },
    }) as { RAGManager: typeof Manager };
    const manager = new RAGManager({ db, dbPath, extPath: sqliteVec.getLoadablePath() });
    const pipeline = manager.getEmbeddingPipeline();
    await pipeline.initialize({});
    const store = Reflect.get(manager, 'vectorStore') as Store;
    Reflect.set(store, 'useNativeVec', native);
    const summary = () => db.prepare('SELECT * FROM chunk_summaries WHERE meeting_id = ?').get('meeting-a') as {
        id: number; meeting_id: string; summary_text: string; embedding: Buffer | null; created_at: string;
    } | undefined;
    const jobs = () => db.prepare('SELECT * FROM embedding_queue WHERE meeting_id = ? AND chunk_id IS NULL ORDER BY id').all('meeting-a');
    const metadata = () => db.prepare('SELECT embedding_provider, embedding_dimensions FROM meetings WHERE id = ?').get('meeting-a');
    const vectors = () => [3, 5, 768].map(dim => db.prepare(`SELECT * FROM vec_summaries_${dim} ORDER BY summary_id`).all());
    const untouched = () => ({
        record: db.prepare('SELECT id, title, summary_json, is_processed FROM meetings').all(),
        transcripts: db.prepare('SELECT * FROM transcripts').all(),
        chunks: db.prepare('SELECT * FROM chunks').all(),
        queue: db.prepare('SELECT * FROM embedding_queue WHERE chunk_id IS NOT NULL').all(),
        vectors: [3, 5, 768].map(dim => db.prepare(`SELECT * FROM vec_chunks_${dim}`).all()),
    });
    const before = untouched();
    t.teardown(async () => {
        await pipeline.processQueue();
        await store.destroy();
        db.close();
    });
    return { db, manager, pipeline, store, summary, jobs, metadata, vectors, requests,
        assertUnchanged: () => t.same(untouched(), before, 'record, transcripts, chunk content/BLOBs, chunk jobs and all chunk vectors are untouched'),
        pause: () => Reflect.set(pipeline, 'provider', null),
        resume: async () => { await pipeline.processQueue(); Reflect.set(pipeline, 'provider', p); await pipeline.processQueue(); },
        embedSummary: (active = p) => (Reflect.get(pipeline, 'embedMeetingSummary') as (id: string, p: IEmbeddingProvider) => Promise<void>).call(pipeline, 'meeting-a', active),
        search: (query = newestVector) => store.searchSummaries(query, 5, 'example:summary'),
    };
}

for (const native of [true, false]) {
    const mode = native ? 'native vec' : 'JS fallback';
    t.test(`${mode}: first refresh queues once and embeds the exact stored text`, async t => {
        const p = provider();
        const inputs: string[] = [];
        p.embed = async text => { inputs.push(text); return firstVector; };
        const f = await setup(t, native, p);
        f.manager.refreshMeetingSummary('meeting-a', firstText);
        t.match(f.summary(), { meeting_id: 'meeting-a', summary_text: firstText, embedding: null });
        t.match(f.jobs(), [{ meeting_id: 'meeting-a', chunk_id: null, status: 'pending', retry_count: 0, error_message: null }]);
        t.equal(f.jobs().length, 1);
        await f.pipeline.processQueue();
        t.same(inputs, [firstText], 'the provider receives the unmodified text');
        t.same(f.summary()?.embedding, blob(firstVector));
        t.same(f.metadata(), { embedding_provider: 'example:summary', embedding_dimensions: 3 });
        t.match(f.jobs(), [{ status: 'completed' }]);
        t.same(await f.search(firstVector), [{ meetingId: 'meeting-a', summaryText: firstText, similarity: 1 }]);
        t.same(f.requests, [native ? 'nativeVecSearchSummaries' : 'searchSummaries'], 'the real requested search path ran without a silent fallback');
        if (native) t.same(f.db.prepare('SELECT summary_id, embedding FROM vec_summaries_3').all(), [{ summary_id: f.summary()?.id, embedding: blob(firstVector) }]);
        f.assertUnchanged();
    });

    t.test(`${mode}: replacement removes the old BLOB and native rows in every dimension`, async t => {
        const f = await setup(t, native);
        f.manager.refreshMeetingSummary('meeting-a', firstText);
        await f.pipeline.processQueue();
        const old = f.summary()!;
        for (const dim of [3, 5, 768]) {
            f.db.prepare(`DELETE FROM vec_summaries_${dim} WHERE summary_id = ?`).run(old.id);
            f.db.prepare(`INSERT INTO vec_summaries_${dim} (summary_id, embedding) VALUES (?, ?)`)
                .run(BigInt(old.id), blob(Array(dim).fill(1)));
        }
        f.pause();
        f.manager.refreshMeetingSummary('meeting-a', newestText);
        t.equal(f.summary()?.summary_text, newestText);
        t.equal(f.summary()?.embedding, null, 'the old BLOB is discarded before re-embedding');
        t.same(f.vectors(), [[], [], []], 'cleanup includes dynamically provisioned dimensions even in fallback mode');
        t.equal(f.db.prepare('SELECT count(*) FROM chunk_summaries').pluck().get(), 1);
        t.equal(f.jobs().length, 1);
        await f.resume();
        t.same(f.summary()?.embedding, blob(newestVector));
        t.same(await f.search(), [{ meetingId: 'meeting-a', summaryText: newestText, similarity: 1 }]);
        t.same(f.requests, [native ? 'nativeVecSearchSummaries' : 'searchSummaries']);
        t.same(f.metadata(), { embedding_provider: 'example:summary', embedding_dimensions: 3 });
        if (native) t.same(f.db.prepare('SELECT summary_id, embedding FROM vec_summaries_3').all(), [{ summary_id: f.summary()?.id, embedding: blob(newestVector) }]);
        t.same(f.db.prepare('SELECT * FROM vec_summaries_5').all(), []);
        t.same(f.db.prepare('SELECT * FROM vec_summaries_768').all(), []);
        f.assertUnchanged();
    });

    t.test(`${mode}: two quick refreshes leave one pending job for the newest text`, async t => {
        const f = await setup(t, native);
        f.pause();
        f.manager.refreshMeetingSummary('meeting-a', firstText);
        f.manager.refreshMeetingSummary('meeting-a', newestText);
        t.equal(f.jobs().length, 1);
        t.match(f.jobs(), [{ status: 'pending', retry_count: 0, chunk_id: null }]);
        t.equal(f.summary()?.summary_text, newestText);
        t.equal(f.summary()?.embedding, null);
        await f.resume();
        t.same(f.summary()?.embedding, blob(newestVector));
        t.same(await f.search(), [{ meetingId: 'meeting-a', summaryText: newestText, similarity: 1 }]);
        f.assertUnchanged();
    });

    t.test(`${mode}: refresh never starts or changes pending chunk work`, async t => {
        const f = await setup(t, native, provider(), 'pending');
        f.manager.refreshMeetingSummary('meeting-a', firstText);
        f.manager.refreshMeetingSummary('meeting-a', newestText);
        await new Promise<void>(resolve => setImmediate(resolve));
        t.equal(f.jobs().length, 1);
        t.match(f.jobs(), [{ status: 'pending', retry_count: 0 }]);
        t.match(f.summary(), { summary_text: newestText, embedding: null });
        t.same(f.metadata(), { embedding_provider: null, embedding_dimensions: null });
        f.manager.refreshMeetingSummary('meeting-a', '');
        t.same(f.jobs(), []);
        f.assertUnchanged();
        f.pause();
    });

    for (const status of ['pending', 'processing']) {
        t.test(`${mode}: queueMeeting deduplicates an existing ${status} summary job`, async t => {
            const f = await setup(t, native);
            f.pause();
            f.manager.refreshMeetingSummary('meeting-a', firstText);
            f.db.prepare('UPDATE embedding_queue SET status = ? WHERE chunk_id IS NULL').run(status);
            const queued = f.jobs();
            await f.pipeline.queueMeeting('meeting-a');
            await f.pipeline.queueMeeting('meeting-a');
            t.same(f.jobs(), queued, 'NULL-keyed work is not duplicated or reset');
            t.equal(f.summary()?.summary_text, firstText);
            await f.resume();
            t.same(f.summary()?.embedding, blob(firstVector));
            f.assertUnchanged();
        });
    }

    t.test(`${mode}: an in-flight old result cannot attach to refreshed text or stamp its provider`, async t => {
        const oldResult = deferred<number[]>();
        const newStarted = deferred<void>();
        const newResult = deferred<number[]>();
        const p = provider();
        const inputs: string[] = [];
        p.embed = text => {
            inputs.push(text);
            if (text === firstText) return oldResult.promise;
            newStarted.resolve();
            return newResult.promise;
        };
        const f = await setup(t, native, p, 'failed');
        f.manager.refreshMeetingSummary('meeting-a', firstText);
        const processing = f.pipeline.processQueue();
        t.same(inputs, [firstText]);
        f.manager.refreshMeetingSummary('meeting-a', newestText);
        t.equal(f.jobs().length, 1, 'the superseded processing job is canceled, leaving one pending replacement');
        t.match(f.jobs(), [{ status: 'pending' }]);
        oldResult.resolve(firstVector);
        await newStarted.promise;
        t.equal(f.summary()?.summary_text, newestText);
        t.equal(f.summary()?.embedding, null, 'the stale result stores no BLOB');
        t.same(f.vectors(), [[], [], []]);
        t.same(f.metadata(), { embedding_provider: null, embedding_dimensions: null }, 'the discarded result stamps no provider');
        t.match(f.jobs(), [{ status: 'processing' }], 'the old job completion cannot complete the new job');
        newResult.resolve(newestVector);
        await processing;
        t.same(inputs, [firstText, newestText]);
        t.same(f.summary()?.embedding, blob(newestVector));
        t.same(f.metadata(), { embedding_provider: 'example:summary', embedding_dimensions: 3 });
        t.match(f.jobs(), [{ status: 'completed' }]);
        t.same(await f.search(), [{ meetingId: 'meeting-a', summaryText: newestText, similarity: 1 }]);
        f.assertUnchanged();
    });

    for (const empty of ['', ' \n\t ']) {
        t.test(`${mode}: ${empty ? 'whitespace' : 'empty'} text deletes only the derived summary and cancels its jobs`, async t => {
            const f = await setup(t, native);
            f.manager.refreshMeetingSummary('meeting-a', firstText);
            await f.pipeline.processQueue();
            const id = f.summary()!.id;
            f.db.prepare('INSERT OR REPLACE INTO vec_summaries_5 (summary_id, embedding) VALUES (?, ?)').run(BigInt(id), blob([1, 0, 0, 0, 0]));
            f.pause();
            f.db.prepare("INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('meeting-a', NULL, 'pending')").run();
            f.manager.refreshMeetingSummary('meeting-a', empty);
            t.equal(f.summary(), undefined);
            t.same(f.vectors(), [[], [], []]);
            t.same(f.jobs(), []);
            t.same(await f.search(), []);
            t.same(f.metadata(), { embedding_provider: 'example:summary', embedding_dimensions: 3 });
            f.manager.refreshMeetingSummary('meeting-a', empty);
            t.same(f.jobs(), [], 'repeated removal queues nothing');
            f.assertUnchanged();
        });
    }

    t.test(`${mode}: removal while an embed is in flight cannot resurrect the summary`, async t => {
        const result = deferred<number[]>();
        const p = provider();
        p.embed = () => result.promise;
        const f = await setup(t, native, p);
        f.manager.refreshMeetingSummary('meeting-a', firstText);
        const processing = f.pipeline.processQueue();
        f.manager.refreshMeetingSummary('meeting-a', '  ');
        result.resolve(firstVector);
        await processing;
        t.equal(f.summary(), undefined);
        t.same(f.vectors(), [[], [], []]);
        t.same(f.jobs(), []);
        t.same(f.metadata(), { embedding_provider: 'example:summary', embedding_dimensions: 3 });
        f.assertUnchanged();
    });

    for (const mismatch of [provider('example:other', 3), provider('example:summary', 5)]) {
        t.test(`${mode}: provider compatibility refuses ${mismatch.name}/${mismatch.dimensions} without altering old vectors`, async t => {
            const f = await setup(t, native);
            f.manager.refreshMeetingSummary('meeting-a', firstText);
            await f.pipeline.processQueue();
            const before = { summary: f.summary(), vectors: f.vectors(), metadata: f.metadata() };
            await t.rejects(f.embedSummary(mismatch), /Meeting embeddings use a different provider; rebuild required/);
            t.same({ summary: f.summary(), vectors: f.vectors(), metadata: f.metadata() }, before);
            Reflect.set(f.pipeline, 'provider', mismatch);
            Reflect.set(f.pipeline, 'delay', async () => {});
            f.db.prepare("INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('meeting-a', NULL, 'pending')").run();
            await f.pipeline.processQueue();
            t.match(f.jobs(), [{ status: 'completed' }, { status: 'pending', retry_count: 3, error_message: 'Meeting embeddings use a different provider; rebuild required' }]);
            t.same({ summary: f.summary(), vectors: f.vectors(), metadata: f.metadata() }, before, 'queue retries also preserve the old index when no fallback is available');
            f.assertUnchanged();
        });
    }

    t.test(`${mode}: a failed refresh rolls back summary, native vectors and queue together`, async t => {
        const f = await setup(t, native);
        f.manager.refreshMeetingSummary('meeting-a', firstText);
        await f.pipeline.processQueue();
        const before = { summary: f.summary(), vectors: f.vectors(), jobs: f.jobs(), metadata: f.metadata() };
        f.db.exec(`CREATE TRIGGER refuse_summary_queue BEFORE INSERT ON embedding_queue WHEN NEW.chunk_id IS NULL
            BEGIN SELECT RAISE(ABORT, 'Synthetic queue refusal'); END`);
        t.throws(() => f.manager.refreshMeetingSummary('meeting-a', newestText), /Synthetic queue refusal/);
        t.same({ summary: f.summary(), vectors: f.vectors(), jobs: f.jobs(), metadata: f.metadata() }, before);
        f.assertUnchanged();
    });

    t.test(`${mode}: a provider-stamp failure rolls back the vector write and propagates`, async t => {
        const f = await setup(t, native, provider(), 'failed');
        f.pause();
        f.manager.refreshMeetingSummary('meeting-a', firstText);
        f.db.exec(`CREATE TRIGGER refuse_provider_stamp BEFORE UPDATE OF embedding_provider ON meetings
            BEGIN SELECT RAISE(ABORT, 'Synthetic metadata refusal'); END`);
        await t.rejects(f.embedSummary(), /Synthetic metadata refusal/);
        t.equal(f.summary()?.summary_text, firstText);
        t.equal(f.summary()?.embedding, null);
        t.same(f.vectors(), [[], [], []]);
        t.same(f.metadata(), { embedding_provider: null, embedding_dimensions: null });
        f.assertUnchanged();
    });
}
