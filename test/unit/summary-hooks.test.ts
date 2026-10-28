import t, { type Test } from 'tap';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { DatabaseManager as DBManager } from '../../electron/db/DatabaseManager';
import type { IntelligenceManager as Intelligence } from '../../electron/IntelligenceManager';
import type { RAGManager as Manager } from '../../electron/rag/RAGManager';
import type { EmbeddingPipeline as Pipeline } from '../../electron/rag/EmbeddingPipeline';
import type { VectorStore as Store } from '../../electron/rag/VectorStore';
import type { IEmbeddingProvider } from '../../electron/rag/providers/IEmbeddingProvider';
import type { AppState } from '../../electron/main';

const file = (name: string) => path.resolve(`electron/${name}.ts`);
const notes = { overview: 'Invented lantern planning.', keyPoints: ['Amber lanterns need a shelf.'], actionItems: ['Build the shelf.'] };
const indexedText = 'Amber lanterns need a shelf.. Action: Build the shelf.';
const vector = [1, 0, 0];
const blob = (v: number[]) => Buffer.from(new Float32Array(v).buffer);
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

async function setup(t: Test) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-summary-hooks-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const dbPath = path.join(dir, 'synthetic.sqlite');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    sqliteVec.load(db);
    db.exec(`
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, duration_ms INTEGER,
            summary_json TEXT, created_at TEXT, is_processed INTEGER DEFAULT 0, embedding_provider TEXT, embedding_dimensions INTEGER);
        CREATE TABLE transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
            segment_id TEXT, revision INTEGER, speaker TEXT, content TEXT, timestamp_ms INTEGER, UNIQUE(meeting_id, segment_id));
        CREATE TABLE ai_interactions (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
            type TEXT, timestamp INTEGER, user_query TEXT, ai_response TEXT, metadata_json TEXT);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
            chunk_index INTEGER, speaker TEXT, start_timestamp_ms INTEGER, end_timestamp_ms INTEGER,
            cleaned_text TEXT, token_count INTEGER, embedding BLOB);
        CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
            summary_text TEXT, embedding BLOB);
        CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, chunk_id INTEGER,
            status TEXT DEFAULT 'pending', retry_count INTEGER DEFAULT 0, error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT, UNIQUE(meeting_id, chunk_id));
    `);
    const { DatabaseManager } = mockRequire(file('db/DatabaseManager'), { electron: {} }) as { DatabaseManager: typeof DBManager };
    const database = Object.create(DatabaseManager.prototype) as DBManager;
    Reflect.set(database, 'db', db);
    Reflect.set(database, 'ensuredDims', new Set<number>());
    for (const dim of [3, 768]) database.ensureVecTableForDim(dim);
    const dbMock = { DatabaseManager: { getInstance: () => database } };
    const { VectorStore } = mockRequire(file('rag/VectorStore'), {
        [file('db/DatabaseManager')]: dbMock,
    }) as { VectorStore: typeof Store };
    const inputs: string[] = [];
    const p: IEmbeddingProvider = {
        name: 'example:hooks', dimensions: 3, isAvailable: async () => true,
        embed: async text => { inputs.push(text); return vector; },
        embedQuery: async () => vector, embedBatch: async texts => texts.map(() => vector),
    };
    const electron = { BrowserWindow: { getAllWindows: () => [] } };
    const { EmbeddingPipeline } = mockRequire(file('rag/EmbeddingPipeline'), {
        [file('rag/providers/LocalEmbeddingProvider')]: { LocalEmbeddingProvider: class { async isAvailable() { return false; } } },
        [file('rag/EmbeddingProviderResolver')]: { EmbeddingProviderResolver: { resolve: async () => p } },
        electron,
    }) as { EmbeddingPipeline: typeof Pipeline };
    const { RAGManager } = mockRequire(file('rag/RAGManager'), {
        [file('rag/VectorStore')]: { VectorStore }, [file('rag/EmbeddingPipeline')]: { EmbeddingPipeline },
    }) as { RAGManager: typeof Manager };
    const manager = new RAGManager({ db, dbPath, extPath: sqliteVec.getLoadablePath() });
    const pipeline = manager.getEmbeddingPipeline();
    await pipeline.initialize({});
    const store = Reflect.get(manager, 'vectorStore') as Store;
    const generation = deferred<string>();
    const llm = { generateMeetingSummary: () => generation.promise };
    const mocks = {
        electron, [file('db/DatabaseManager')]: dbMock,
        [file('core/LLMHelper')]: { LLMHelper: class {} },
        [file('core/IntelligenceEngine')]: { IntelligenceEngine: EventEmitter },
        [file('agent/workspace')]: { renameMeetingFolder: async () => {} },
    };
    const { IntelligenceManager } = mockRequire(file('IntelligenceManager'), mocks) as { IntelligenceManager: typeof Intelligence };
    let rag: Manager | null = manager;
    const intelligence = new IntelligenceManager(llm as unknown as ConstructorParameters<typeof IntelligenceManager>[0], () => rag);
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const { registerMeetingHandlers } = mockRequire(file('ipc/meeting'), {
        ...mocks, [file('main')]: {},
        [file('ipc/safeHandle')]: { safeHandle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(channel, handler) },
    }) as { registerMeetingHandlers: (state: AppState) => void };
    registerMeetingHandlers({ getRAGManager: () => rag } as AppState);
    const edit = (id: string, updates: Parameters<DBManager['updateMeetingSummary']>[1]) => handlers.get('update-meeting-summary')!(undefined, { id, updates });
    const seed = (id: string) => {
        for (let i = 1; i <= 3; i++) {
            const segment = { speaker: 'user' as const, text: `Invented lantern line ${i}.`, timestamp: Date.now() + i, final: true };
            intelligence.addTranscript(segment, true);
            if (database.getMeetingDetails(id)) database.upsertSegment({ meetingId: id, segmentId: `line-${i}`, revision: 1,
                speaker: segment.speaker, text: segment.text, timestampMs: segment.timestamp });
        }
    };
    const start = () => { const id = intelligence.startMeeting({ title: 'Invented lantern meeting' })!; seed(id); return id; };
    const summary = (id: string) => db.prepare('SELECT id, summary_text, embedding FROM chunk_summaries WHERE meeting_id = ?').get(id) as {
        id: number; summary_text: string; embedding: Buffer | null;
    } | undefined;
    const jobs = () => db.prepare('SELECT meeting_id, chunk_id, status, error_message FROM embedding_queue ORDER BY id').all();
    const errors: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(arg => arg instanceof Error ? arg.message : String(arg)).join(' ')); };
    t.teardown(async () => {
        await pipeline.processQueue();
        await store.destroy();
        db.close();
        console.error = realError;
    });
    const mainState = (id: string) => {
        const modules = [
            'helpers/WindowHelper', 'helpers/SettingsWindowHelper', 'helpers/ModelSelectorWindowHelper',
            'helpers/CropperWindowHelper', 'helpers/ScreenshotHelper', 'services/KeybindManager', 'helpers/ProcessingHelper',
            'IntelligenceManager', 'audio/SystemAudioCapture', 'audio/MicrophoneCapture', 'helpers/ThemeManager',
            'rag/RAGManager', 'rag/embeddingConfig', 'agent/MeetingAgent', 'llm/index', 'lib/auto-updater',
            'lib/transcript-assembler', 'lib/audio-pipeline', 'lib/tray-menu', 'helpers/stealth',
            'knowledge/KnowledgeOrchestrator', 'knowledge/KnowledgeDatabaseManager', 'services/CredentialsManager',
            'services/SettingsManager', 'lib/verboseLog', 'services/OllamaManager',
        ];
        const events = ['uncaughtException', 'unhandledRejection'] as const;
        const previous = events.map(event => process.listeners(event));
        const { AppState: StateClass } = mockRequire(file('main'), {
            ...Object.fromEntries(modules.map(name => [file(name), {}])),
            [file('db/DatabaseManager')]: dbMock,
            electron: { app: { isPackaged: true } },
            [file('lib/logging')]: { setupConsoleOverrides: () => {} },
            [file('lib/lifecycle')]: { initializeApp: async () => {} },
            [file('agent/instance')]: {},
        }) as { AppState: typeof AppState };
        t.teardown(() => events.forEach((event, i) => {
            for (const listener of process.listeners(event)) if (!previous[i].includes(listener)) process.removeListener(event, listener);
        }));
        const state = Object.create(StateClass.prototype) as AppState;
        Reflect.set(state, 'ragManager', manager);
        Reflect.set(state, 'intelligenceManager', { stopMeeting: async () => id });
        for (const name of ['broadcastMeetingState', 'resetBufferedTranscriptTurns']) Reflect.set(state, name, () => {});
        return state;
    };
    return { db, database, intelligence, manager, pipeline, p, inputs, edit, seed, start, summary, jobs, errors, mainState,
        release: () => generation.resolve(JSON.stringify(notes)),
        noRAG: () => { rag = null; },
    };
}

t.test('the indexed summary text is empty for a meeting without a summary and drops blank entries', async t => {
    const { buildMeetingSummaryText } = mockRequire(file('rag/meetingSummaryIndex'), {
        [file('db/DatabaseManager')]: { DatabaseManager: {} },
    }) as typeof import('../../electron/rag/meetingSummaryIndex');
    t.equal(buildMeetingSummaryText({}), '');
    t.equal(buildMeetingSummaryText({ detailedSummary: { keyPoints: [], actionItems: [] } }), '');
    t.equal(buildMeetingSummaryText({ detailedSummary: { keyPoints: ['  ', 'Lamps are approved'], actionItems: ['', 'Order the shelf'] } }),
        'Lamps are approved. Action: Order the shelf');
});

t.test('final commit refreshes the recorded summary and starts embedding without blocking stop', async t => {
    const f = await setup(t);
    const embedded = deferred<number[]>();
    f.p.embed = text => {
        f.inputs.push(text);
        t.same(f.database.getMeetingDetails(id)?.detailedSummary, notes, 'embedding begins only after the metadata commit');
        return embedded.promise;
    };
    const id = f.start();
    t.equal(await f.intelligence.stopMeeting(Date.now() + 2000), id);
    t.equal(f.summary(id), undefined, 'the stop placeholder is not indexed');
    t.same(f.inputs, []);
    f.release();
    await turn();
    t.same(f.database.getMeetingDetails(id)?.detailedSummary, notes, 'metadata was committed before embedding');
    t.match(f.summary(id), { summary_text: indexedText, embedding: null });
    t.same(f.jobs(), [{ meeting_id: id, chunk_id: null, status: 'processing', error_message: null }]);
    t.same(f.inputs, [indexedText], 'the queue runner starts and receives exactly the composed text');
    embedded.resolve(vector);
    await f.pipeline.processQueue();
    t.same(f.summary(id)?.embedding, blob(vector));
    t.match(f.jobs(), [{ status: 'completed' }]);
    t.same(f.db.prepare('SELECT embedding FROM vec_summaries_3').all(), [{ embedding: blob(vector) }]);
});

t.test('summary edits replace the vector using the merged committed notes, and an empty edit removes it', async t => {
    const f = await setup(t);
    const id = f.start();
    f.release();
    await f.intelligence.stopMeeting(Date.now() + 2000);
    await turn();
    await f.pipeline.processQueue();
    const oldId = f.summary(id)?.id;
    const newVector = [0, 1, 0];
    f.p.embed = async text => { f.inputs.push(text); return newVector; };
    t.equal(await f.edit(id, { keyPoints: ['Cobalt lanterns stay.'] }), true);
    await f.pipeline.processQueue();
    t.same(f.inputs, [indexedText, 'Cobalt lanterns stay.. Action: Build the shelf.']);
    t.not(f.summary(id)?.id, oldId, 'the old vector identity is replaced');
    t.same(f.summary(id)?.embedding, blob(newVector));
    t.same(f.db.prepare('SELECT summary_id, embedding FROM vec_summaries_3').all(), [{ summary_id: f.summary(id)?.id, embedding: blob(newVector) }]);
    t.equal(await f.edit(id, { overview: '', keyPoints: [], actionItems: [] }), true);
    await f.pipeline.processQueue();
    t.same(f.database.getMeetingDetails(id)?.detailedSummary, { overview: '', keyPoints: [], actionItems: [] });
    t.equal(f.summary(id), undefined);
    t.same(f.db.prepare('SELECT * FROM vec_summaries_3').all(), []);
    t.same(f.jobs(), []);
    t.equal(f.inputs.length, 2, 'empty edits do not embed the surviving legacySummary');
});

t.test('the main stop path uses the shared composition and never indexes placeholder or blank notes', async t => {
    const f = await setup(t);
    for (const [index, detailedSummary] of [undefined, { keyPoints: [], actionItems: [] }, { keyPoints: [' ', ''], actionItems: ['\t'] }, notes].entries()) {
        const id = `main-${index}`;
        f.database.saveMeeting({ id, title: 'Processing...', date: new Date().toISOString(), duration: '0:02',
            summary: index % 2 ? 'Processing...' : 'Generating summary...', detailedSummary,
            transcript: [{ speaker: 'user', text: 'An invented lantern needs a wooden shelf.', timestamp: 1000 }],
        }, 1000, 2000);
        await f.mainState(id).endMeeting();
        await turn();
        await f.pipeline.processQueue();
        if (index < 3) t.equal(f.summary(id), undefined, 'placeholder or blank notes create no summary index');
        else t.match(f.summary(id), { summary_text: indexedText, embedding: blob(vector) });
    }
    t.notOk(f.inputs.some(text => /Generating summary|Processing|Action: \t/.test(text)), 'no placeholder or empty action reaches the provider');
});

t.test('the full-save fallback refreshes only after its final save', async t => {
    const f = await setup(t);
    f.database.createMeeting = () => { throw new Error('Synthetic record creation refusal'); };
    t.equal(f.start(), null);
    const id = (await f.intelligence.stopMeeting(Date.now() + 2000))!;
    t.ok(id, 'stop still returns the fallback identity');
    t.equal(f.summary(id), undefined);
    t.same(f.inputs, []);
    f.release();
    await turn();
    await f.pipeline.processQueue();
    t.same(f.database.getMeetingDetails(id)?.detailedSummary, notes);
    t.match(f.summary(id), { summary_text: indexedText, embedding: blob(vector) });
    t.same(f.inputs, [indexedText]);
    t.match(f.jobs(), [{ status: 'completed' }]);
});

function crashed(f: Awaited<ReturnType<typeof setup>>) {
    const id = 'crashed';
    f.database.createMeeting({ id, title: 'Invented lantern meeting', startTimeMs: Date.now() - 2000, createdAt: new Date().toISOString() });
    f.seed(id);
    return id;
}

t.test('recovery commits and embeds the new notes without waiting for the provider', async t => {
    const f = await setup(t);
    const id = crashed(f);
    const result = deferred<number[]>();
    f.p.embed = text => { f.inputs.push(text); return result.promise; };
    f.release();
    let settled = false;
    const recovering = f.intelligence.recoverUnprocessedMeetings().then(() => { settled = true; });
    await turn();
    t.equal(settled, true, 'recovery returns while embedding is still pending');
    t.same(f.database.getMeetingDetails(id)?.detailedSummary, notes);
    t.match(f.summary(id), { summary_text: indexedText, embedding: null });
    t.same(f.inputs, [indexedText]);
    t.match(f.jobs(), [{ status: 'processing' }]);
    result.resolve(vector);
    await recovering;
    await f.pipeline.processQueue();
    t.match(f.summary(id), { summary_text: indexedText, embedding: blob(vector) });
    await f.intelligence.recoverUnprocessedMeetings();
    t.same(f.inputs, [indexedText], 'a second recovery does not requeue a completed record');
});

for (const failure of ['completion false', 'completion throws', 'full save throws', 'recovery false', 'edit false', 'no database'] as const) {
    t.test(`a failed write (${failure}) starts neither refresh nor the runner`, async t => {
        const f = await setup(t);
        let refreshes = 0;
        let starts = 0;
        f.manager.refreshMeetingSummary = () => { refreshes++; };
        const run = f.pipeline.processQueue.bind(f.pipeline);
        f.pipeline.processQueue = () => { starts++; return run(); };
        if (failure === 'full save throws' || failure === 'no database') {
            f.database.createMeeting = () => { throw new Error('Synthetic record creation refusal'); };
        }
        const id = failure === 'recovery false' ? crashed(f) : f.start();
        if (failure === 'edit false') {
            f.db.exec(`CREATE TRIGGER refuse_edit BEFORE UPDATE OF summary_json ON meetings BEGIN SELECT RAISE(ABORT, 'Synthetic edit refusal'); END`);
            t.equal(await f.edit(id, { keyPoints: ['Uncommitted cobalt.'] }), false);
            t.equal(await f.edit('missing', { actionItems: [] }), false);
        } else if (failure === 'recovery false') {
            f.db.exec(`CREATE TRIGGER refuse_final BEFORE UPDATE ON meetings WHEN NEW.is_processed = 1 BEGIN SELECT RAISE(IGNORE); END`);
            f.release();
            await f.intelligence.recoverUnprocessedMeetings();
            t.equal(f.db.prepare('SELECT is_processed FROM meetings').pluck().get(), 0, 'failed recovery remains unprocessed');
        } else {
            const stoppedId = await f.intelligence.stopMeeting(Date.now() + 2000);
            t.ok(stoppedId, 'stop returns its identity despite the later write failure');
            if (failure === 'no database') Reflect.set(f.database, 'db', null);
            else if (failure === 'full save throws') f.db.exec(`CREATE TRIGGER refuse_final BEFORE INSERT ON meetings WHEN NEW.is_processed = 1 BEGIN SELECT RAISE(ABORT, 'Synthetic save refusal'); END`);
            else f.db.exec(`CREATE TRIGGER refuse_final BEFORE UPDATE ON meetings WHEN NEW.is_processed = 1 BEGIN SELECT RAISE(${failure === 'completion false' ? 'IGNORE' : "ABORT, 'Synthetic completion refusal'"}); END`);
            f.release();
            await turn();
            Reflect.set(f.database, 'db', f.db);
            t.equal(f.db.prepare('SELECT is_processed FROM meetings').pluck().get(), 0, 'the failed final write leaves the placeholder');
        }
        t.equal(refreshes, 0);
        t.equal(starts, 0);
        t.same(f.jobs(), []);
        t.same(f.inputs, []);
    });
}

for (const operation of ['final', 'full save', 'recovery', 'edit'] as const) {
    t.test(`a throwing refresh preserves ${operation} and reports the actual error without content`, async t => {
        const f = await setup(t);
        let refreshes = 0;
        f.manager.refreshMeetingSummary = () => { refreshes++; throw new Error('Synthetic refresh refusal'); };
        if (operation === 'full save') f.database.createMeeting = () => { throw new Error('Synthetic record creation refusal'); };
        const id = operation === 'recovery' ? crashed(f) : f.start();
        f.release();
        let committedId = id;
        if (operation === 'edit') t.equal(await f.edit(id, notes), true, 'the IPC reply remains successful');
        else if (operation === 'recovery') await f.intelligence.recoverUnprocessedMeetings();
        else {
            committedId = (await f.intelligence.stopMeeting(Date.now() + 2000))!;
            t.ok(committedId, 'stop remains successful');
            await turn();
        }
        t.same(f.database.getMeetingDetails(committedId)?.detailedSummary, notes, 'the metadata commit survives');
        t.equal(refreshes, 1);
        t.match(f.errors.join('\n'), /Synthetic refresh refusal/);
        t.notMatch(f.errors.join('\n'), /Amber|lantern|Build the shelf/);
        t.same(f.jobs(), []);
    });
}

for (const operation of ['final', 'recovery', 'edit'] as const) {
    for (const unavailable of ['no RAG manager', 'no provider'] as const) {
        t.test(`${operation} succeeds with ${unavailable}`, async t => {
            const f = await setup(t);
            if (unavailable === 'no RAG manager') f.noRAG();
            else Reflect.set(f.pipeline, 'provider', null);
            let refreshes = 0;
            const refresh = f.manager.refreshMeetingSummary.bind(f.manager);
            f.manager.refreshMeetingSummary = (id, text) => { refreshes++; refresh(id, text); };
            const id = operation === 'recovery' ? crashed(f) : f.start();
            f.release();
            if (operation === 'edit') t.equal(await f.edit(id, notes), true);
            else if (operation === 'recovery') await f.intelligence.recoverUnprocessedMeetings();
            else t.equal(await f.intelligence.stopMeeting(Date.now() + 2000), id);
            await turn();
            t.same(f.database.getMeetingDetails(id)?.detailedSummary, notes);
            t.equal(refreshes, unavailable === 'no RAG manager' ? 0 : 1);
            if (unavailable === 'no RAG manager') {
                t.equal(f.summary(id), undefined);
                t.same(f.jobs(), []);
            } else {
                t.match(f.summary(id), { summary_text: indexedText, embedding: null });
                t.match(f.jobs(), [{ status: 'pending' }]);
            }
            t.same(f.inputs, []);
            t.same(f.errors, []);
        });
    }
}

for (const operation of ['recovery', 'edit'] as const) {
    t.test(`the ${operation} caller never awaits the queue runner and logs its rejection`, async t => {
        const f = await setup(t);
        const queued = deferred<void>();
        const run = f.pipeline.processQueue.bind(f.pipeline);
        let starts = 0;
        f.pipeline.processQueue = () => { starts++; return queued.promise; };
        const id = operation === 'recovery' ? crashed(f) : f.start();
        f.release();
        let settled = false;
        const operationResult = (operation === 'recovery' ? f.intelligence.recoverUnprocessedMeetings() : f.edit(id, notes))
            .then(result => { settled = true; return result; });
        await turn();
        t.equal(settled, true, 'the caller returns while processQueue is unresolved');
        t.equal(starts, 1);
        t.match(f.summary(id), { summary_text: indexedText, embedding: null });
        t.match(f.jobs(), [{ status: 'pending' }]);
        // Reject only after the successful caller reply to catch unhandled fire-and-forget failures.
        queued.reject(new Error('Synthetic runner refusal'));
        await turn();
        t.equal(await operationResult, operation === 'edit' ? true : undefined);
        t.match(f.errors.join('\n'), /Synthetic runner refusal/);
        t.notMatch(f.errors.join('\n'), /Amber|lantern|Paint the shelf/);
        f.pipeline.processQueue = run;
    });
}
