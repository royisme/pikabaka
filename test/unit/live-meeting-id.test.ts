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
import type { LiveRAGIndexer as Indexer } from '../../electron/rag/LiveRAGIndexer';
import type { AppState as State } from '../../electron/main';
import type { IEmbeddingProvider } from '../../electron/rag/providers/IEmbeddingProvider';
import { createMeeting } from '../../electron/db/meetingRecord';

const file = (name: string) => path.resolve(`electron/${name}.ts`);
const segments = (count: number, label = 'Amber') => Array.from({ length: count }, (_, i) => ({
    speaker: i % 2 ? 'user' : 'interviewer', text: `${label} lantern number ${i} glows.`, timestamp: i * 1000,
}));
const provider = (name = 'example:first', dimensions = 3): IEmbeddingProvider => ({
    name, dimensions, isAvailable: async () => true,
    embed: async () => Array(dimensions).fill(1), embedQuery: async () => Array(dimensions).fill(1),
    embedBatch: async texts => texts.map(() => Array(dimensions).fill(1)),
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

async function setup(t: Test, legacy = false, native = true, initial: IEmbeddingProvider | null = provider()) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-live-id-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const dbPath = path.join(dir, 'synthetic.sqlite');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    sqliteVec.load(db);
    db.exec(`
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, duration_ms INTEGER,
            summary_json TEXT, created_at TEXT, is_processed INTEGER DEFAULT 0,
            embedding_provider TEXT, embedding_dimensions INTEGER${legacy ? ', source TEXT' : ''});
        CREATE TABLE transcripts (id INTEGER PRIMARY KEY, meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE, content TEXT);
        CREATE TABLE ai_interactions (id INTEGER PRIMARY KEY, meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE, ai_response TEXT);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
            chunk_index INTEGER, speaker TEXT, start_timestamp_ms INTEGER, end_timestamp_ms INTEGER,
            cleaned_text TEXT, token_count INTEGER, embedding BLOB);
        CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
            summary_text TEXT, embedding BLOB);
        CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, chunk_id INTEGER, status TEXT,
            retry_count INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT, error_message TEXT,
            UNIQUE(meeting_id, chunk_id));
    `);
    const ensureVecTableForDim = (dim: number) => db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_${dim} USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${dim}] distance_metric=cosine);
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries_${dim} USING vec0(summary_id INTEGER PRIMARY KEY, embedding float[${dim}] distance_metric=cosine);
    `);
    for (const dim of [3, 5, 768]) ensureVecTableForDim(dim);
    const { VectorStore } = mockRequire(file('rag/VectorStore'), {
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => ({ ensureVecTableForDim }), KNOWN_DIMS: [768, 1536, 3072] } },
        worker_threads: { Worker: class extends Worker {
            constructor() {
                super(`require(${JSON.stringify(require.resolve('tsx/cjs'))}); require(${JSON.stringify(file('rag/vectorSearchWorker'))});`, { eval: true });
            }
        } },
    }) as { VectorStore: typeof Store };
    let selected = initial ?? provider();
    const { EmbeddingPipeline } = mockRequire(file('rag/EmbeddingPipeline'), {
        [file('rag/providers/LocalEmbeddingProvider')]: { LocalEmbeddingProvider: class { async isAvailable() { return false; } } },
        [file('rag/EmbeddingProviderResolver')]: { EmbeddingProviderResolver: { resolve: async () => selected } },
        electron: { BrowserWindow: { getAllWindows: () => [] } },
    }) as { EmbeddingPipeline: typeof Pipeline };
    const { RAGManager } = mockRequire(file('rag/RAGManager'), {
        [file('rag/VectorStore')]: { VectorStore },
        [file('rag/EmbeddingPipeline')]: { EmbeddingPipeline },
    }) as { RAGManager: typeof Manager };
    const manager = new RAGManager({ db, dbPath, extPath: sqliteVec.getLoadablePath() });
    const pipeline = manager.getEmbeddingPipeline();
    await pipeline.initialize({});
    if (!initial) Reflect.set(pipeline, 'provider', null);
    const store = Reflect.get(manager, 'vectorStore') as Store;
    if (!native) Reflect.set(store, 'useNativeVec', false);
    const indexer = Reflect.get(manager, 'liveIndexer') as Indexer;
    manager.setLLMHelper({ streamChatWithGemini: async function* (prompt: string) { yield prompt; } } as Parameters<Manager['setLLMHelper']>[0]);
    const addMeeting = (id: string) => {
        createMeeting(db, { id, title: 'Synthetic meeting', startTimeMs: 1000, createdAt: '2026-01-01T00:00:00Z' });
        db.prepare('INSERT INTO transcripts (meeting_id, content) VALUES (?, ?)').run(id, 'Invented recorded line.');
        db.prepare('INSERT INTO ai_interactions (meeting_id, ai_response) VALUES (?, ?)').run(id, 'Invented interaction.');
    };
    const search = (id: string, name = pipeline.getActiveProviderName(), dimensions = pipeline.getStatus().dimensions ?? 3) =>
        store.searchSimilar(Array(dimensions).fill(1), { meetingId: id, providerName: name, minSimilarity: 0.25, limit: 30 });
    const rows = (id: string) => store.getChunksForMeeting(id);
    const metadata = (id: string) => db.prepare('SELECT embedding_provider, embedding_dimensions FROM meetings WHERE id = ?').get(id);
    t.teardown(async () => { await manager.stopLiveIndexing(); await pipeline.processQueue(); await store.destroy(); db.close(); });
    return { db, manager, pipeline, indexer, store, addMeeting, search, rows, metadata,
        tick: () => (Reflect.get(indexer, 'tick') as () => Promise<void>).call(indexer),
        switchProvider: async (next: IEmbeddingProvider) => { selected = next; await pipeline.initialize({}, { force: true }); },
    };
}

for (const legacy of [false, true]) for (const native of [false, true]) for (const count of [0, 1, 2, 3]) {
    t.test(`${legacy ? 'legacy' : 'fresh'} schema, ${native ? 'native' : 'JS'} search, ${count} segments: real identity and final replacement`, async t => {
        const f = await setup(t, legacy, native);
        f.addMeeting('real-a');
        const record = f.db.prepare('SELECT * FROM meetings').get();
        f.manager.startLiveIndexing('real-a');
        t.equal(f.manager.getActiveLiveMeetingId(), 'real-a');
        t.same(f.db.prepare('SELECT * FROM meetings').get(), record, 'starting does not insert or modify the record, including nullable legacy source');
        f.manager.feedLiveTranscript(segments(count));
        await f.tick();
        if (count === 3) t.same((await f.search('real-a')).map(row => row.text).sort(), segments(count).map(s => s.text).sort(), 'live content is queryable under the real id');
        await f.manager.stopLiveIndexing();
        const liveIds = f.rows('real-a').map(row => row.id);
        t.same((await f.search('real-a')).map(row => row.text).sort(), segments(count).map(s => s.text).sort(), 'forced stop covers even one or two segments');
        if (count) {
            let prompt = '';
            for await (const token of f.manager.queryMeeting('real-a', 'What did we decide?')) prompt += token;
            for (const segment of segments(count)) t.ok(prompt.includes(segment.text), 'the real RAG retriever supplies indexed text to the fake LLM');
        }
        const before = f.db.prepare('SELECT id, title, start_time, summary_json, is_processed FROM meetings').get();
        const final = [...segments(count), ...segments(1, 'Violet tail')];
        await f.manager.processMeeting('real-a', final);
        await f.pipeline.processQueue();
        const result = await f.search('real-a');
        t.same(result.map(row => row.text).sort(), f.rows('real-a').map(row => row.text).sort());
        const text = result.map(row => row.text).join(' ');
        for (const segment of final) t.equal(text.split(segment.text).length - 1, 1, 'each final segment occurs exactly once');
        t.equal(result.filter(row => row.text.includes('Violet tail')).length, 1, 'final transcript includes its tail once');
        t.ok(f.rows('real-a').every(row => !liveIds.includes(row.id)), 'live chunk identities are gone');
        t.same(f.metadata('real-a'), { embedding_provider: 'example:first', embedding_dimensions: 3 });
        t.same(await f.search('real-a', 'example:wrong'), [], 'same-dimension model mismatch remains excluded');
        t.same(await f.search('real-a', 'example:first', 5), [], 'wrong dimensions remain excluded');
        const chunkJobs = f.db.prepare('SELECT chunk_id FROM embedding_queue WHERE meeting_id = ? AND chunk_id IS NOT NULL ORDER BY chunk_id').all('real-a');
        t.same(chunkJobs, f.rows('real-a').map(row => ({ chunk_id: row.id })), 'only final chunks have queue rows');
        if (native) t.same(f.db.prepare('SELECT chunk_id FROM vec_chunks_3 ORDER BY chunk_id').all(), chunkJobs, 'native vectors match the final chunk/queue identities');
        t.same(f.db.prepare('SELECT id, title, start_time, summary_json, is_processed FROM meetings').get(), before);
        t.equal(f.db.prepare('SELECT content FROM transcripts').pluck().get(), 'Invented recorded line.');
        t.equal(f.db.prepare('SELECT ai_response FROM ai_interactions').pluck().get(), 'Invented interaction.');
        const firstFinal = f.rows('real-a').map(row => row.text);
        await f.manager.processMeeting('real-a', final);
        await f.pipeline.processQueue();
        t.same((await f.search('real-a')).map(row => row.text).sort(), firstFinal.sort(), 'repeated final processing replaces rather than appends');
        t.equal(f.db.prepare('SELECT count(*) FROM meetings').pluck().get(), 1, 'no provisional or second meeting row');
    });
}

t.test('empty final transcript removes previous live chunks, queue and dynamic-dimension vectors atomically', async t => {
    const f = await setup(t);
    f.addMeeting('real-a');
    f.manager.startLiveIndexing('real-a');
    f.manager.feedLiveTranscript(segments(3));
    await f.manager.stopLiveIndexing();
    await f.pipeline.queueMeeting('real-a');
    await f.pipeline.processQueue();
    for (const row of f.rows('real-a')) f.db.prepare("INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES (?, ?, 'completed')").run('real-a', row.id);
    f.db.exec(`CREATE TRIGGER refuse_chunk_delete BEFORE DELETE ON chunks BEGIN SELECT RAISE(ABORT, 'Synthetic delete refusal'); END`);
    await t.rejects(f.manager.processMeeting('real-a', []), /Synthetic delete refusal/);
    t.equal((await f.search('real-a')).length, 3, 'failed replacement rolls back vector deletion');
    t.equal(f.db.prepare('SELECT count(*) FROM embedding_queue WHERE chunk_id IS NOT NULL').pluck().get(), 3, 'failed replacement rolls back queue deletion too');
    f.db.exec('DROP TRIGGER refuse_chunk_delete');
    await f.manager.processMeeting('real-a', []);
    t.same(await f.search('real-a'), []);
    t.same(f.db.prepare('SELECT * FROM vec_chunks_3').all(), []);
    t.same(f.db.prepare('SELECT * FROM embedding_queue WHERE chunk_id IS NOT NULL').all(), []);
    t.equal(f.db.prepare('SELECT count(*) FROM transcripts').pluck().get(), 1);
});

t.test('transcript replacement preserves a surviving summary vector and its provider metadata', async t => {
    const f = await setup(t);
    f.addMeeting('real-a');
    f.manager.startLiveIndexing('real-a');
    f.manager.feedLiveTranscript(segments(3));
    await f.manager.stopLiveIndexing();
    f.store.saveSummary('real-a', 'Invented approved summary.');
    f.store.storeSummaryEmbedding('real-a', [1, 1, 1]);
    const summary = f.db.prepare('SELECT * FROM chunk_summaries').get();
    const vector = f.db.prepare('SELECT * FROM vec_summaries_3').get();
    await f.manager.processMeeting('real-a', segments(2, 'Final cobalt'));
    await f.pipeline.processQueue();
    t.same((await f.search('real-a')).map(row => row.text).sort(), segments(2, 'Final cobalt').map(s => s.text).sort());
    t.same(f.db.prepare('SELECT * FROM chunk_summaries').get(), summary);
    t.same(f.db.prepare('SELECT * FROM vec_summaries_3').get(), vector);
    t.same(f.metadata('real-a'), { embedding_provider: 'example:first', embedding_dimensions: 3 });
});

t.test('unavailable and failed providers remain unready; final replacement and retry recover without duplicates', async t => {
    const unavailable = await setup(t, false, true, null);
    unavailable.addMeeting('real-a');
    unavailable.manager.startLiveIndexing('real-a');
    t.equal(unavailable.manager.getActiveLiveMeetingId(), null);
    await unavailable.manager.processMeeting('real-a', segments(2));
    t.same(await unavailable.search('real-a'), []);
    t.same(unavailable.metadata('real-a'), { embedding_provider: null, embedding_dimensions: null });
    await unavailable.switchProvider(provider());
    await unavailable.pipeline.queueMeeting('real-a');
    await unavailable.pipeline.processQueue();
    t.same((await unavailable.search('real-a')).map(row => row.text).sort(), segments(2).map(s => s.text).sort());

    const failed = provider();
    failed.embed = async () => { throw new Error('Synthetic provider failure'); };
    const f = await setup(t, false, true, failed);
    f.addMeeting('real-a');
    f.manager.startLiveIndexing('real-a');
    f.manager.feedLiveTranscript(segments(3));
    await f.manager.stopLiveIndexing();
    t.same(await f.search('real-a'), []);
    t.same(f.metadata('real-a'), { embedding_provider: null, embedding_dimensions: null });
    await f.switchProvider(provider());
    await f.manager.processMeeting('real-a', segments(3));
    await f.pipeline.processQueue();
    t.same((await f.search('real-a')).map(row => row.text).sort(), segments(3).map(s => s.text).sort());
});

t.test('provider switch at stop replaces old vectors and stamps the complete final set with the new model', async t => {
    const f = await setup(t);
    f.addMeeting('real-a');
    f.manager.startLiveIndexing('real-a');
    f.manager.feedLiveTranscript(segments(3));
    await f.manager.stopLiveIndexing();
    await f.switchProvider(provider('example:second', 5));
    t.same(await f.search('real-a'), []);
    await f.manager.processMeeting('real-a', [...segments(3), ...segments(1, 'Cobalt tail')]);
    await f.pipeline.processQueue();
    t.same((await f.search('real-a')).map(row => row.text).sort(), [segments(3)[0].text, segments(3)[1].text, `${segments(3)[2].text} ${segments(1, 'Cobalt tail')[0].text}`].sort());
    t.same(f.metadata('real-a'), { embedding_provider: 'example:second', embedding_dimensions: 5 });
    t.same(f.db.prepare('SELECT * FROM vec_chunks_3').all(), []);
    t.same(f.db.prepare('SELECT chunk_id FROM vec_chunks_5 ORDER BY chunk_id').all(), f.rows('real-a').map(row => ({ chunk_id: row.id })));
});

t.test('replacement waits for pending queue work; deleting during a live embed cannot resurrect rows or vectors', async t => {
    const f = await setup(t);
    f.addMeeting('real-a');
    await f.manager.processMeeting('real-a', segments(1));
    await f.pipeline.processQueue();
    const delayed = deferred<number[]>();
    const p = provider();
    p.embed = () => delayed.promise;
    await f.switchProvider(p);
    const ids = f.rows('real-a').map(row => row.id);
    f.db.prepare('UPDATE chunks SET embedding = NULL WHERE meeting_id = ?').run('real-a');
    f.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run('real-a');
    await f.pipeline.queueMeeting('real-a');
    let replaced = false;
    const replacement = f.manager.processMeeting('real-a', []).then(() => { replaced = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    t.equal(replaced, false);
    t.same(f.rows('real-a').map(row => row.id), ids, 'old queue work finishes before its chunks are removed');
    delayed.resolve([1, 1, 1]);
    await replacement;
    t.same(await f.search('real-a'), []);

    const pending = deferred<number[]>();
    p.embed = () => pending.promise;
    f.manager.startLiveIndexing('real-a');
    f.manager.feedLiveTranscript(segments(3));
    const ticking = f.tick();
    f.manager.feedLiveTranscript(segments(1, 'Pending tail'));
    f.manager.deleteMeetingData('real-a');
    f.db.prepare('DELETE FROM meetings WHERE id = ?').run('real-a');
    pending.resolve([1, 1, 1]);
    await ticking;
    await f.manager.stopLiveIndexing();
    await f.manager.processMeeting('real-a', segments(3));
    t.same(f.rows('real-a'), []);
    t.same(await f.search('real-a'), []);
    t.same(f.db.prepare('SELECT * FROM vec_chunks_3').all(), []);
    t.same(f.db.prepare('SELECT * FROM embedding_queue WHERE meeting_id = ?').all('real-a'), []);
    t.equal(f.metadata('real-a'), undefined);
});

t.test('agent past-meeting search excludes the real active id and leaves historical provisional data untouched', async t => {
    const f = await setup(t);
    for (const id of ['real-current', 'past-meeting', 'live-meeting-current']) {
        f.addMeeting(id);
        await f.manager.processMeeting(id, segments(1, id === 'past-meeting' ? 'Past cobalt' : 'Other amber'));
        await f.pipeline.processQueue();
    }
    let searchMeetings!: (query: string) => Promise<string>;
    const { getMeetingAgent } = mockRequire(file('agent/instance'), {
        electron: { app: { getPath: () => '/unused-synthetic-path' } },
        [file('main')]: { AppState: { getInstance: () => ({ getRAGManager: () => f.manager, getCurrentMeetingId: () => 'real-current' }) } },
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => ({ getDb: () => f.db, getDbPath: () => '', getExtPath: () => '' }) } },
        [file('rag/VectorStore')]: { VectorStore: class { constructor() { return f.store; } } },
        [file('agent/MeetingAgent')]: { MeetingAgent: class {
            constructor(config: { searchMeetings: typeof searchMeetings }) { searchMeetings = config.searchMeetings; }
        } },
        [file('agent/models')]: {},
    }) as typeof import('../../electron/agent/instance');
    getMeetingAgent();
    t.same(JSON.parse(await searchMeetings('Invented lantern question')), [{
        meetingId: 'past-meeting', text: 'Past cobalt lantern number 0 glows.', startMs: 0, endMs: 0,
    }]);
    t.equal((await f.search('live-meeting-current')).length, 1, 'historical provisional rows are not cleaned up');
    t.equal((await f.search('real-current')).length, 1, 'active content is excluded by the tool, not removed from the index');
});

function mainClass(t: Test, getMeetingDetails: (id: string) => unknown = () => undefined) {
    const modules = [
        'helpers/WindowHelper', 'helpers/SettingsWindowHelper', 'helpers/ModelSelectorWindowHelper',
        'helpers/CropperWindowHelper', 'helpers/ScreenshotHelper', 'services/KeybindManager', 'helpers/ProcessingHelper',
        'IntelligenceManager', 'audio/SystemAudioCapture', 'audio/MicrophoneCapture', 'helpers/ThemeManager',
        'rag/RAGManager', 'rag/embeddingConfig', 'db/DatabaseManager', 'agent/MeetingAgent', 'llm/index',
        'lib/auto-updater', 'lib/transcript-assembler', 'lib/audio-pipeline', 'lib/tray-menu', 'helpers/stealth',
        'knowledge/KnowledgeOrchestrator', 'knowledge/KnowledgeDatabaseManager', 'services/CredentialsManager',
        'services/SettingsManager', 'lib/verboseLog', 'services/OllamaManager',
    ];
    const mocks = Object.fromEntries(modules.map(name => [file(name), {}]));
    const events = ['uncaughtException', 'unhandledRejection'] as const;
    const previous = events.map(event => process.listeners(event));
    const { AppState } = mockRequire(file('main'), {
        ...mocks,
        electron: { app: { isPackaged: true } },
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => ({ getMeetingDetails }) } },
        [file('lib/logging')]: { setupConsoleOverrides: () => {}, ensureMacMicrophoneAccess: async () => true },
        [file('lib/lifecycle')]: { initializeApp: async () => {} },
        [file('agent/instance')]: { refreshGate: async () => {}, getGate: () => ({ stop: () => {} }) },
    }) as { AppState: typeof State };
    t.teardown(() => events.forEach((event, i) => {
        for (const listener of process.listeners(event)) if (!previous[i].includes(listener)) process.removeListener(event, listener);
    }));
    return AppState;
}

for (const short of [false, true]) {
    t.test(`main stop ${short ? 'drains before a short meeting is deleted' : 'does not wait for the drain, and the full index starts after it'}`, async t => {
        const delayed = deferred<number[]>();
        const p = provider();
        let calls = 0;
        p.embed = async () => ++calls === 1 ? delayed.promise : [1, 1, 1];
        const f = await setup(t, false, true, p);
        const AppState = mainClass(t, id => f.db.prepare('SELECT start_time AS startTimeMs FROM meetings WHERE id = ?').get(id));
        const state = Object.create(AppState.prototype) as State;
        let next = 0;
        const starts: string[] = [];
        const post = deferred<void>();
        const postStarted = deferred<void>();
        const stopLiveIndexing = f.manager.stopLiveIndexing.bind(f.manager);
        f.manager.stopLiveIndexing = async () => {
            await stopLiveIndexing();
            if (state.getCurrentMeetingId() === 'real-1') {
                t.same((await f.search('real-1')).map(row => row.text).sort(), [...segments(3), ...segments(1, 'Violet tail')].map(s => s.text).sort(), 'drain includes the pending tail before cleanup');
            }
        };
        Reflect.set(state, 'ragManager', f.manager);
        Reflect.set(state, 'intelligenceManager', {
            startMeeting: () => {
                const id = `real-${++next}`;
                f.addMeeting(id);
                f.db.prepare('UPDATE meetings SET start_time = ? WHERE id = ?').run(Date.now() - (short ? 0 : 2000), id);
                starts.push(id);
                return id;
            },
            stopMeeting: async () => {
                if (short) t.equal(f.manager.getActiveLiveMeetingId(), null, 'a short meeting is deleted only after its drain');
                if (short) { f.db.prepare('DELETE FROM meetings WHERE id = ?').run('real-1'); return null; }
                return 'real-1';
            },
        });
        Reflect.set(state, 'getMeetingAgent', () => ({ open: async () => {}, stop: async () => {}, deleteStore: async () => {} }));
        Reflect.set(state, 'getWindowHelper', () => ({ getOverlayWindow: () => undefined, getLauncherWindow: () => undefined }));
        for (const name of ['setMicrophoneMuted', 'resetBufferedTranscriptTurns', 'broadcastMeetingState', 'setupSystemAudioPipeline']) Reflect.set(state, name, () => {});
        Reflect.set(state, 'processCompletedMeetingForRAG', async (id: string) => {
            t.not(f.manager.getActiveLiveMeetingId(), 'real-1', 'the full index starts after the old live session has ended');
            postStarted.resolve();
            await post.promise;
            await f.manager.processMeeting(id, [...segments(3), ...segments(1, 'Violet tail')]);
        });
        await state.startMeeting();
        f.manager.feedLiveTranscript(segments(3));
        const active = f.tick();
        f.manager.feedLiveTranscript(segments(1, 'Violet tail'));
        const stopping = state.endMeeting();
        t.equal(state.endMeeting(), stopping, 'repeated stop shares the existing fence');
        const starting = state.startMeeting();
        await new Promise<void>(resolve => setImmediate(resolve));
        t.same(starts, short ? ['real-1'] : ['real-1', 'real-2'], short ? 'the next start waits for the short meeting to be deleted' : 'a normal stop does not hold the next start behind the drain');
        delayed.resolve([1, 1, 1]);
        await Promise.all([active, stopping, starting]);
        t.equal(state.getCurrentMeetingId(), 'real-2');
        t.equal(f.manager.getActiveLiveMeetingId(), 'real-2');
        f.manager.feedLiveTranscript(segments(3, 'Cobalt'));
        await f.tick();
        if (!short) await postStarted.promise;
        post.resolve();
        await new Promise<void>(resolve => setImmediate(resolve));
        await f.pipeline.processQueue();
        t.equal(f.manager.getActiveLiveMeetingId(), 'real-2', 'delayed old post-processing cannot stop the next session');
        if (!short) {
            const texts = (await f.search('real-1')).map(row => row.text);
            t.equal(texts.join(' ').split('Violet tail').length - 1, 1, 'the full index covers the tail the superseded live session never wrote, once');
            t.equal(texts.length, 3, 'the full index replaced the live chunks instead of adding a second copy');
        }
        t.same((await f.search('real-2')).map(row => row.text).sort(), segments(3, 'Cobalt').map(s => s.text).sort());
        t.same(f.metadata('real-2'), { embedding_provider: 'example:first', embedding_dimensions: 3 });
        if (short) {
            t.equal(f.metadata('real-1'), undefined);
            t.same(f.rows('real-1'), []);
            t.equal(f.db.prepare('SELECT count(*) FROM vec_chunks_3').pluck().get(), 3, 'short-meeting cleanup leaves only the next meeting vectors');
        }
    });
}

t.test('record creation failure does not start live indexing, even after deferred audio initialization', async t => {
    const f = await setup(t);
    const AppState = mainClass(t);
    const state = Object.create(AppState.prototype) as State;
    Reflect.set(state, 'ragManager', f.manager);
    Reflect.set(state, 'intelligenceManager', { startMeeting: () => null });
    Reflect.set(state, 'getWindowHelper', () => ({ getOverlayWindow: () => undefined, getLauncherWindow: () => undefined }));
    for (const name of ['setMicrophoneMuted', 'resetBufferedTranscriptTurns', 'broadcastMeetingState', 'setupSystemAudioPipeline']) Reflect.set(state, name, () => {});
    await state.startMeeting();
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    t.equal(state.getCurrentMeetingId(), null);
    t.equal(f.manager.getActiveLiveMeetingId(), null);
    f.manager.startLiveIndexing('nonexistent');
    t.equal(f.manager.getActiveLiveMeetingId(), null, 'RAGManager never manufactures a missing record');
    t.same(f.db.prepare('SELECT * FROM meetings').all(), []);
    t.same(f.db.prepare('SELECT * FROM chunks').all(), []);
});
