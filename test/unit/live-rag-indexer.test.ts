import t from 'tap';
import path from 'node:path';
import Database from 'better-sqlite3';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { LiveRAGIndexer as Indexer } from '../../electron/rag/LiveRAGIndexer';
import type { EmbeddingPipeline as Pipeline } from '../../electron/rag/EmbeddingPipeline';
import type { VectorStore as Store } from '../../electron/rag/VectorStore';
import type { IEmbeddingProvider } from '../../electron/rag/providers/IEmbeddingProvider';

const modulePath = (name: string) => path.resolve(`electron/rag/${name}.ts`);
const segments = (count: number, label = 'Amber') => Array.from({ length: count }, (_, i) => ({
    speaker: 'Speaker', text: `${label} lantern number ${i} glows.`, timestamp: i * 1000,
}));
const provider = (name = 'example:first', dimensions = 3): IEmbeddingProvider => ({
    name, dimensions,
    isAvailable: async () => true,
    embed: async () => Array(dimensions).fill(1),
    embedQuery: async () => Array(dimensions).fill(1),
    embedBatch: async texts => texts.map(() => Array(dimensions).fill(1)),
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

async function setup(initialProvider: IEmbeddingProvider | null = provider()) {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE meetings (id TEXT PRIMARY KEY, embedding_provider TEXT, embedding_dimensions INTEGER, is_processed INTEGER DEFAULT 0);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, chunk_index INTEGER, speaker TEXT,
            start_timestamp_ms INTEGER, end_timestamp_ms INTEGER, cleaned_text TEXT, token_count INTEGER, embedding BLOB);
        CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY, meeting_id TEXT, summary_text TEXT, embedding BLOB);
        CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY, meeting_id TEXT, chunk_id INTEGER, status TEXT,
            retry_count INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT, error_message TEXT);
        INSERT INTO meetings (id) VALUES ('meeting-a'), ('meeting-b');
    `);
    const { VectorStore } = mockRequire(modulePath('VectorStore'), {
        [path.resolve('electron/db/DatabaseManager.ts')]: { DatabaseManager: { KNOWN_DIMS: [] } },
    }) as { VectorStore: typeof Store };
    let selected = initialProvider;
    const { EmbeddingPipeline } = mockRequire(modulePath('EmbeddingPipeline'), {
        [modulePath('providers/LocalEmbeddingProvider')]: { LocalEmbeddingProvider: class { async isAvailable() { return false; } } },
        [modulePath('EmbeddingProviderResolver')]: { EmbeddingProviderResolver: { resolve: async () => selected } },
        electron: { BrowserWindow: { getAllWindows: () => [] } },
    }) as { EmbeddingPipeline: typeof Pipeline };
    const { LiveRAGIndexer } = mockRequire(modulePath('LiveRAGIndexer'), {}) as { LiveRAGIndexer: typeof Indexer };
    const store = new VectorStore(db, '', '');
    const pipeline = new EmbeddingPipeline(db, store);
    if (selected) await pipeline.initialize({});
    const indexer = new LiveRAGIndexer(store, pipeline);
    return {
        db, store, pipeline, indexer,
        tick: () => (Reflect.get(indexer, 'tick') as () => Promise<void>).call(indexer),
        switchProvider: async (next: IEmbeddingProvider, force = true) => {
            selected = next;
            await pipeline.initialize(force ? {} : { ollamaUrl: 'http://localhost:1234' }, { force });
        },
        rows: (id = 'meeting-a') => db.prepare('SELECT chunk_index, cleaned_text, embedding FROM chunks WHERE meeting_id = ? ORDER BY chunk_index').all(id) as { chunk_index: number; cleaned_text: string; embedding: Buffer | null }[],
        metadata: (id = 'meeting-a') => db.prepare('SELECT embedding_provider, embedding_dimensions FROM meetings WHERE id = ?').get(id),
        close: async () => { await indexer.stop(); await store.destroy(); db.close(); },
    };
}

for (const count of [0, 1, 2, 3]) {
    t.test(`stop drains ${count} valid segments and ignores invalid content`, async t => {
        const f = await setup();
        t.teardown(f.close);
        f.indexer.start('meeting-a');
        const input = segments(count);
        f.indexer.feedSegments([...input, { speaker: 'Other', text: 'um', timestamp: 5000 }]);
        await f.indexer.stop();
        t.same(f.rows().map(row => row.cleaned_text), count ? [input.map(s => s.text).join(' ')] : []);
        t.same(f.rows().map(row => row.embedding), count ? [Buffer.from(new Float32Array([1, 1, 1]).buffer)] : []);
        t.same(f.metadata(), { embedding_provider: count ? 'example:first' : null, embedding_dimensions: count ? 3 : null });
        t.equal(f.indexer.isRunning(), false);
        t.equal(f.indexer.getActiveMeetingId(), null);
    });
}

t.test('arrivals during embedding remain pending for the next batch', async t => {
    const delayed = deferred<number[]>();
    const first = provider();
    let calls = 0;
    first.embed = async () => ++calls === 1 ? delayed.promise : [1, 1, 1];
    const f = await setup(first);
    t.teardown(f.close);
    f.indexer.start('meeting-a');
    f.indexer.feedSegments(segments(3));
    const active = f.tick();
    f.indexer.feedSegments(segments(3, 'Violet'));
    await f.tick();
    t.equal(calls, 1, 'a concurrent tick starts no extra provider work');
    delayed.resolve([1, 1, 1]);
    await active;
    await f.tick();
    t.same(f.rows().map(row => row.cleaned_text), [segments(3), segments(3, 'Violet')].map(batch => batch.map(s => s.text).join(' ')));
    t.same(f.rows().map(row => row.chunk_index), [0, 1]);
    t.ok(f.rows().every(row => row.embedding?.length === 12));
    t.same(f.metadata(), { embedding_provider: 'example:first', embedding_dimensions: 3 });
});

t.test('stop waits for an active batch then drains the short tail exactly once', async t => {
    const delayed = deferred<number[]>();
    const first = provider();
    let calls = 0;
    first.embed = async () => ++calls === 1 ? delayed.promise : [1, 1, 1];
    const f = await setup(first);
    t.teardown(f.close);
    f.indexer.start('meeting-a');
    f.indexer.feedSegments(segments(3));
    const active = f.tick();
    f.indexer.feedSegments(segments(2, 'Violet'));
    let stopped = false;
    const stopping = f.indexer.stop().then(() => { stopped = true; });
    const repeated = f.indexer.stop();
    await new Promise<void>(resolve => setImmediate(resolve));
    t.equal(stopped, false, 'stop cannot return before the active embedding settles');
    t.equal(f.rows().length, 1, 'tail waits behind the active batch');
    delayed.resolve([1, 1, 1]);
    await Promise.all([active, stopping, repeated]);
    const stored = f.rows();
    t.same(stored.map(row => row.cleaned_text), [segments(3), segments(2, 'Violet')].map(batch => batch.map(s => s.text).join(' ')));
    t.ok(stored.every(row => row.embedding?.length === 12));
    await f.indexer.stop();
    t.same(f.rows(), stored, 'another stop neither re-embeds nor appends');
    t.equal(calls, 2);
});

for (const nextId of ['meeting-b', 'meeting-a']) {
    t.test(`fast stop/start isolates late work when restarting as ${nextId}`, async t => {
        const delayed = deferred<number[]>();
        const first = provider();
        let calls = 0;
        first.embed = async () => ++calls === 1 ? delayed.promise : [1, 1, 1];
        const f = await setup(first);
        t.teardown(f.close);
        f.indexer.start('meeting-a');
        f.indexer.feedSegments(segments(3));
        const active = f.tick();
        f.indexer.feedSegments(segments(1, 'Discarded'));
        const stopping = f.indexer.stop();
        f.indexer.start(nextId);
        f.indexer.feedSegments(segments(1, 'Violet'));
        delayed.resolve([1, 1, 1]);
        await Promise.all([active, stopping]);
        t.equal(f.indexer.getActiveMeetingId(), nextId);
        t.equal(f.indexer.isRunning(), true);
        t.equal(f.indexer.getIndexedChunkCount(), 0);
        t.equal(f.rows()[0].embedding, null, 'superseded result is not stored, even with a reused provisional id');
        t.same(f.metadata(), { embedding_provider: null, embedding_dimensions: null });
        await f.indexer.stop();
        const fresh = f.rows(nextId).find(row => row.cleaned_text === segments(1, 'Violet')[0].text);
        t.equal(fresh?.chunk_index, 0, 'new session starts with a clean chunk index');
        t.ok(fresh?.embedding);
        t.notOk(f.rows().some(row => row.cleaned_text.includes('Discarded')), 'superseded stop does not drain into the new session');
        t.same(f.metadata(nextId), { embedding_provider: 'example:first', embedding_dimensions: 3 });
    });
}

t.test('late completion cannot overwrite an already indexed later session', async t => {
    const delayed = deferred<number[]>();
    const first = provider();
    let calls = 0;
    first.embed = async () => ++calls === 1 ? delayed.promise : [2, 2, 2];
    const f = await setup(first);
    t.teardown(f.close);
    f.indexer.start('meeting-a');
    f.indexer.feedSegments(segments(3));
    const active = f.tick();
    const stopping = f.indexer.stop();
    f.indexer.start('meeting-b');
    f.indexer.feedSegments(segments(3, 'Violet'));
    await f.tick();
    const stored = f.rows('meeting-b');
    t.same(stored.map(row => row.cleaned_text), [segments(3, 'Violet').map(s => s.text).join(' ')]);
    t.same(stored[0].embedding, Buffer.from(new Float32Array([2, 2, 2]).buffer));
    delayed.resolve([1, 1, 1]);
    await Promise.all([active, stopping]);
    t.same(f.rows('meeting-b'), stored);
    t.equal(f.rows()[0].embedding, null);
    t.equal(f.indexer.getIndexedChunkCount(), 1);
    t.equal(f.indexer.getActiveMeetingId(), 'meeting-b');
    t.same(f.metadata('meeting-b'), { embedding_provider: 'example:first', embedding_dimensions: 3 });
});

t.test('starting an active session also supersedes its in-flight work', async t => {
    const delayed = deferred<number[]>();
    const first = provider();
    first.embed = () => delayed.promise;
    const f = await setup(first);
    t.teardown(f.close);
    f.indexer.start('meeting-a');
    f.indexer.feedSegments(segments(3));
    const active = f.tick();
    f.indexer.start('meeting-b');
    delayed.resolve([1, 1, 1]);
    await active;
    t.equal(f.rows()[0].embedding, null);
    t.equal(f.indexer.getActiveMeetingId(), 'meeting-b');
    t.equal(f.indexer.hasIndexedChunks(), false);
});

t.test('failed and unavailable providers leave stored chunks unready and retryable', async t => {
    const failing = provider();
    failing.embed = async () => { throw new Error('Synthetic embedding failure'); };
    const f = await setup(failing);
    t.teardown(f.close);
    f.indexer.start('meeting-a');
    f.indexer.feedSegments(segments(1));
    await f.indexer.stop();
    t.same(f.rows().map(row => [row.cleaned_text, row.embedding]), [[segments(1)[0].text, null]]);
    t.same(f.metadata(), { embedding_provider: null, embedding_dimensions: null });
    await f.switchProvider(provider());
    await f.pipeline.queueMeeting('meeting-a');
    await f.pipeline.processQueue();
    t.equal(f.rows()[0].embedding?.length, 12, 'existing queue retries the failed live chunk without appending');
    t.equal(f.rows().length, 1);
    t.same(f.metadata(), { embedding_provider: 'example:first', embedding_dimensions: 3 });

    const unavailable = await setup(null);
    t.teardown(unavailable.close);
    unavailable.indexer.start('meeting-a');
    unavailable.indexer.feedSegments(segments(1));
    await unavailable.indexer.stop();
    t.equal(unavailable.rows()[0].embedding, null);
    t.same(unavailable.metadata(), { embedding_provider: null, embedding_dimensions: null });
});

for (const dimensions of [3, 5]) {
    t.test(`provider switch between batches cannot mix models (${dimensions} dimensions)`, async t => {
        const f = await setup();
        t.teardown(f.close);
        f.indexer.start('meeting-a');
        f.indexer.feedSegments(segments(3));
        await f.tick();
        await f.switchProvider(provider('example:second', dimensions));
        f.indexer.feedSegments(segments(1, 'Violet'));
        await f.indexer.stop();
        t.same(f.rows().map(row => row.cleaned_text), [segments(3).map(s => s.text).join(' '), segments(1, 'Violet')[0].text]);
        t.same(f.rows().map(row => row.embedding?.length ?? null), [12, null]);
        t.same(f.metadata(), { embedding_provider: 'example:first', embedding_dimensions: 3 });
        f.indexer.start('meeting-b');
        f.indexer.feedSegments(segments(1, 'Cobalt'));
        await f.indexer.stop();
        t.equal(f.rows('meeting-b')[0].embedding?.length, dimensions * 4);
        t.same(f.metadata('meeting-b'), { embedding_provider: 'example:second', embedding_dimensions: dimensions });
    });
}

t.test('one provider is captured for all chunks in a batch during reinitialization', async t => {
    const delayed = deferred<number[]>();
    const first = provider();
    let calls = 0;
    first.embed = async () => ++calls === 1 ? delayed.promise : [1, 1, 1];
    const f = await setup(first);
    t.teardown(f.close);
    f.indexer.start('meeting-a');
    f.indexer.feedSegments(segments(3).map((s, i) => ({ ...s, speaker: i % 2 ? 'You' : 'Speaker' })));
    const active = f.tick();
    await f.switchProvider(provider('example:second', 5), false);
    delayed.resolve([1, 1, 1]);
    await active;
    t.same(f.rows().map(row => row.cleaned_text), segments(3).map(s => s.text));
    t.same(f.rows().map(row => row.embedding?.length), [12, 12, 12]);
    t.same(f.metadata(), { embedding_provider: 'example:first', embedding_dimensions: 3 });
});

t.test('forced provider switch waits for the complete live batch', async t => {
    const delayed = deferred<number[]>();
    const first = provider();
    first.embed = () => delayed.promise;
    const f = await setup(first);
    t.teardown(f.close);
    f.indexer.start('meeting-a');
    f.indexer.feedSegments(segments(3));
    const active = f.tick();
    const switching = f.switchProvider(provider('example:second', 5));
    await new Promise<void>(resolve => setImmediate(resolve));
    t.equal(f.pipeline.getActiveProviderName(), 'example:first');
    delayed.resolve([1, 1, 1]);
    await Promise.all([active, switching]);
    t.equal(f.rows()[0].embedding?.length, 12);
    t.same(f.metadata(), { embedding_provider: 'example:first', embedding_dimensions: 3 });
    t.equal(f.pipeline.getActiveProviderName(), 'example:second');
});

t.test('missing meeting metadata is a no-op and deletion during embedding cannot resurrect vectors', async t => {
    const f = await setup();
    t.teardown(f.close);
    f.indexer.start('missing-row');
    f.indexer.feedSegments(segments(1));
    await f.indexer.stop();
    t.equal(f.rows('missing-row')[0].embedding?.length, 12);
    t.equal(f.metadata('missing-row'), undefined);

    const delayed = deferred<number[]>();
    const next = provider();
    next.embed = () => delayed.promise;
    await f.switchProvider(next);
    f.indexer.start('meeting-b');
    f.indexer.feedSegments(segments(3));
    const active = f.tick();
    f.db.prepare('DELETE FROM chunks WHERE meeting_id = ?').run('meeting-b');
    f.db.prepare('DELETE FROM meetings WHERE id = ?').run('meeting-b');
    delayed.resolve([1, 1, 1]);
    await active;
    t.same(f.rows('meeting-b'), []);
    t.equal(f.metadata('meeting-b'), undefined);
    t.equal(f.indexer.getIndexedChunkCount(), 0);
});
