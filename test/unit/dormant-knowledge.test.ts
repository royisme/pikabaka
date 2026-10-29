import t, { type Test } from 'tap';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { KnowledgeDatabaseManager } from '../../electron/knowledge/KnowledgeDatabaseManager';
import { KnowledgeVectorStore } from '../../electron/knowledge/KnowledgeVectorStore';
import type { DocType } from '../../electron/knowledge/types';
import type { KnowledgeOrchestrator as Orchestrator } from '../../electron/knowledge/KnowledgeOrchestrator';
import type { DatabaseManager as DBManager } from '../../electron/db/DatabaseManager';

const file = (name: string) => path.resolve(`electron/${name}.ts`);
/**
 * The document types the removed interview feature wrote. They are dormant: nothing may list,
 * search, answer from or re-index them, but Clear all data must still remove them.
 */
const RESUME = 'resume' as DocType;
const JD = 'jd' as DocType;

const vector = { embedding: [1, 0, 0], provider: 'example:index', dimensions: 3 };

function setup(t: Test) {
    const db = new Database(':memory:');
    sqliteVec.load(db);
    // The meeting tables clearAllData also flushes; empty here, the real ones hold meeting data.
    db.exec(`
        CREATE TABLE meetings (id TEXT PRIMARY KEY);
        CREATE TABLE transcripts (id INTEGER PRIMARY KEY, meeting_id TEXT);
        CREATE TABLE ai_interactions (id INTEGER PRIMARY KEY, meeting_id TEXT);
        CREATE TABLE chunks (id INTEGER PRIMARY KEY, meeting_id TEXT);
        CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY, meeting_id TEXT);
        CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY, meeting_id TEXT);
    `);
    t.teardown(() => db.close());
    const manager = new KnowledgeDatabaseManager(db);
    const settings = {
        getAnswerSources: () => ({ meetings: true, materials: true }),
        SettingsManager: { getInstance: () => ({ set: () => {} }) },
    };
    const { KnowledgeOrchestrator } = mockRequire(file('knowledge/KnowledgeOrchestrator'), {
        [file('services/SettingsManager')]: settings,
    }) as { KnowledgeOrchestrator: typeof Orchestrator };
    const orchestrator = new KnowledgeOrchestrator(manager);
    orchestrator.setEmbedQueryFn(async () => vector);
    orchestrator.setEmbeddingStatusFn(() => ({ providerName: vector.provider, dimensions: vector.dimensions }));
    const store = new KnowledgeVectorStore(db);
    const add = async (type: DocType, name: string, text: string) => {
        const id = manager.insertDocument(type, name, text, null);
        const [chunkId] = manager.saveChunks(id, [{ text, metadata: { docType: type } }]);
        await store.storeEmbeddings(id, [{ id: chunkId, text }], async () => vector);
        return { id, chunkId };
    };
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const { registerKnowledgeHandlers } = mockRequire(file('ipc/knowledge'), {
        electron: { dialog: {} },
        [file('main')]: {},
        [file('services/SettingsManager')]: settings,
        [file('services/CredentialsManager')]: { CredentialsManager: { getInstance: () => ({}) } },
        [file('ipc/safeHandle')]: {
            safeHandle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler),
        },
    }) as typeof import('../../electron/ipc/knowledge');
    registerKnowledgeHandlers({ getKnowledgeOrchestrator: () => orchestrator } as never);
    return { db, manager, orchestrator, store, add, invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args) };
}

const notesText = 'Invented amber note about the lantern shelf.';
const materialText = 'Invented cobalt document about the lantern shelf.';
const resumeText = 'Invented dormant resume evidence about the lantern shelf.';
const jdText = 'Invented dormant role requirement about the lantern shelf.';

async function fiveRows(t: Test) {
    const f = setup(t);
    const notes = await f.add('notes' as DocType, 'notes.txt', notesText);
    const material = await f.add('material' as DocType, 'inventory.md', materialText);
    const resume = await f.add(RESUME, 'resume.txt', resumeText);
    const jd = await f.add(JD, 'role.txt', jdText);
    return { ...f, notes, material, resume, jd };
}

t.test('dormant resume and job-description rows reach no listing, search, document block or re-index', async t => {
    const f = await fiveRows(t);

    const listing = await f.invoke('knowledge:list-documents') as { success: true; documents: Array<{ id: number }> };
    t.same(listing.documents.map(document => document.id), [f.material.id], 'the document list shows imported materials only');

    const passages = await f.orchestrator.searchMaterials('What does the lantern shelf hold?');
    t.same(passages.map(passage => passage.source).sort(), ['inventory.md', 'notes.txt'], 'material search reads notes and documents only');
    t.notMatch(JSON.stringify(passages), /dormant/, 'no dormant passage is quoted');

    const prepared = f.orchestrator.prepareDocumentContext('What does the lantern shelf hold?');
    t.ok(prepared);
    const block = await prepared!.contextBlock;
    t.match(block, materialText);
    t.notMatch(block, /dormant/, 'the document block carries no dormant passage');

    t.throws(() => f.orchestrator.reindexDocument(f.resume.id), { message: 'That document is not in Pika.' });
    t.throws(() => f.orchestrator.reindexDocument(f.jd.id), { message: 'That document is not in Pika.' });
    t.same(await f.invoke('knowledge:reindex-document', f.resume.id), { success: false, error: 'That document is not in Pika.' });
    t.same(await f.invoke('knowledge:remove-document', f.jd.id), { success: false, error: 'That document is not in Pika.' });
    for (const { id } of [f.resume, f.jd]) t.ok(f.manager.getDocumentById(id), 'the dormant row survives a refused action');
});

t.test('Clear all data removes the dormant resume and job-description rows, their passages and vectors, and keeps notes and materials', async t => {
    const f = await fiveRows(t);
    const chunksBefore = f.db.prepare('SELECT doc_id FROM knowledge_chunks ORDER BY id').all() as Array<{ doc_id: number }>;
    t.equal(chunksBefore.length, 4);
    t.equal((f.db.prepare('SELECT COUNT(*) AS count FROM vec_knowledge_3').get() as { count: number }).count, 4);

    const { DatabaseManager } = mockRequire(file('db/DatabaseManager'), { electron: {} }) as { DatabaseManager: typeof DBManager };
    const databaseManager = Object.create(DatabaseManager.prototype) as DBManager;
    Reflect.set(databaseManager, 'db', f.db);
    t.equal(databaseManager.clearAllData(), true);

    const types = () => (f.db.prepare('SELECT doc_type FROM knowledge_documents ORDER BY id').all() as Array<{ doc_type: string }>).map(row => row.doc_type);
    t.same(types(), ['notes', 'material'], 'the kept documents survive');
    const chunkDocIds = () => (f.db.prepare('SELECT doc_id FROM knowledge_chunks ORDER BY id').all() as Array<{ doc_id: number }>).map(row => row.doc_id);
    t.same(chunkDocIds(), [f.notes.id, f.material.id], 'only the kept passages survive');
    t.equal((f.db.prepare('SELECT COUNT(*) AS count FROM vec_knowledge_3').get() as { count: number }).count, 2, 'the dormant vectors are gone, the kept ones stay');
    t.same(f.db.prepare('SELECT chunk_id FROM vec_knowledge_3 ORDER BY chunk_id').all(), [{ chunk_id: f.notes.chunkId }, { chunk_id: f.material.chunkId }].sort((a, b) => a.chunk_id - b.chunk_id));
    t.equal(f.manager.getDocumentById(f.resume.id), null);
    t.equal(f.manager.getDocumentById(f.jd.id), null);
    t.ok(f.manager.getDocumentById(f.notes.id), 'notes are not interview data');
    t.same(f.db.prepare('SELECT id FROM knowledge_company_cache').all(), [], 'the dormant company cache is wiped');
    t.same(f.db.prepare('SELECT id FROM knowledge_negotiation').all(), [], 'the dormant negotiation state is wiped');
    t.same(f.db.prepare('SELECT id FROM interview_sessions').all(), [], 'the dormant interview sessions are wiped');

    const remaining = await f.orchestrator.searchMaterials('What does the lantern shelf hold?');
    t.same(remaining.map(passage => passage.text).sort(), [notesText, materialText].sort(), 'answering still reads the kept sources');
});
