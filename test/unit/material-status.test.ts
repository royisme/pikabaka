import t, { type Test } from 'tap';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { KnowledgeDatabaseManager } from '../../electron/knowledge/KnowledgeDatabaseManager';
import type { KnowledgeOrchestrator as Orchestrator } from '../../electron/knowledge/KnowledgeOrchestrator';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { KnowledgeVectorStore } from '../../electron/knowledge/KnowledgeVectorStore';
import { DocType } from '../../electron/knowledge/types';

const { KnowledgeOrchestrator } = mockRequire(path.resolve('electron/knowledge/KnowledgeOrchestrator.ts'), {
    [path.resolve('electron/services/SettingsManager.ts')]: { getAnswerSources: () => ({ meetings: true, materials: true, profile: true }) },
}) as { KnowledgeOrchestrator: typeof Orchestrator };

function setup(t: Test, legacy = false, native = false) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-material-status-'));
    const db = new Database(path.join(dir, 'synthetic.sqlite'));
    db.pragma('foreign_keys = ON');
    if (native) sqliteVec.load(db);
    if (legacy) db.exec(`
        CREATE TABLE knowledge_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT, doc_type TEXT NOT NULL, file_name TEXT,
            raw_text TEXT NOT NULL, parsed_data TEXT, created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO knowledge_documents (doc_type, file_name, raw_text, parsed_data)
        VALUES ('notes', 'notes.txt', 'Invented amber lantern inventory.', 'null');
    `);
    const manager = new KnowledgeDatabaseManager(db);
    const orchestrator = new KnowledgeOrchestrator(manager);
    t.teardown(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
    return { db, manager, orchestrator };
}

for (const native of [false, true]) {
    t.test(`${native ? 'native' : 'JS'}: Re-index all re-embeds unchanged notes through the saved-notes path`, async t => {
        const f = setup(t, false, native);
        f.orchestrator.setEmbedFn(async () => ({ embedding: [1, 0, 0], provider: 'example:old', dimensions: 3 }));
        await f.orchestrator.setNotes('Invented amber lantern inventory.');
        const oldDoc = f.manager.getDocumentByType(DocType.NOTES)!;
        const calls: string[] = [];
        f.orchestrator.setEmbedFn(async text => {
            calls.push(text);
            return { embedding: [0, 1], provider: 'example:new', dimensions: 2 };
        });
        const handlers = new Map<string, () => Promise<unknown>>();
        const { registerRagHandlers } = mockRequire(path.resolve('electron/ipc/rag.ts'), {
            [path.resolve('electron/main.ts')]: {},
            [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (channel: string, handler: () => Promise<unknown>) => handlers.set(channel, handler) },
        }) as typeof import('../../electron/ipc/rag');
        let rebuilds = 0;
        registerRagHandlers({
            getRAGManager: () => ({ reindexAllMeetings: async () => { rebuilds++; } }),
            getKnowledgeOrchestrator: () => f.orchestrator,
        } as unknown as Parameters<typeof registerRagHandlers>[0]);
        t.same(await Promise.all([handlers.get('rag:reindex-all')!(), handlers.get('rag:reindex-all')!()]), [{ success: true }, { success: true }]);
        t.equal(rebuilds, 1, 'repeat presses share the operation including notes');
        t.same(calls, ['Invented amber lantern inventory.']);
        const doc = f.manager.getDocumentByType(DocType.NOTES)!;
        t.equal(doc.id, oldDoc.id, 'unchanged notes retain their source id');
        t.match(doc, { embedding_provider: 'example:new', embedding_dimensions: 2, index_error: null });
        t.same(f.manager.getChunksForDoc(doc.id).map(chunk => chunk.embedding), [blob([0, 1])]);
        if (native) {
            t.same(f.db.prepare('SELECT * FROM vec_knowledge_3').all(), []);
            t.equal((f.db.prepare('SELECT COUNT(*) AS count FROM vec_knowledge_2').get() as { count: number }).count, 1);
        }
        f.orchestrator.setEmbedFn(async () => { throw new Error('Synthetic notes rebuild refused'); });
        t.same(await handlers.get('rag:reindex-all')!(), { success: false, error: 'Synthetic notes rebuild refused' });
        t.match(f.manager.getDocumentByType(DocType.NOTES), { embedding_provider: 'example:new', index_error: 'Synthetic notes rebuild refused' });
        t.same(f.manager.getChunksForDoc(doc.id).map(chunk => chunk.embedding), [blob([0, 1])], 'failed notes rebuild preserves vectors');
    });
}

const note = 'Invented amber lantern inventory.\nInvented cobalt lantern inventory.';
const oldVector = [1, 0, 0];
const blob = (vector: number[]) => Buffer.from(new Float32Array(vector).buffer);

for (const legacy of [false, true]) {
    t.test(`${legacy ? 'old' : 'fresh'} schema adds nullable provenance idempotently`, t => {
        const f = setup(t, legacy);
        new KnowledgeDatabaseManager(f.db);
        const columns = f.db.pragma('table_info(knowledge_documents)') as Array<{ name: string; type: string; notnull: number }>;
        for (const [name, type] of [
            ['embedding_provider', 'TEXT'], ['embedding_dimensions', 'INTEGER'], ['indexed_at', 'TEXT'], ['index_error', 'TEXT'],
        ]) t.match(columns.find(column => column.name === name), { name, type, notnull: 0 });
        if (!legacy) f.manager.upsertDocument(DocType.NOTES, 'notes.txt', 'Invented amber lantern inventory.', null);
        const doc = f.manager.getDocumentByType(DocType.NOTES)!;
        t.same([doc.embedding_provider, doc.embedding_dimensions, doc.indexed_at, doc.index_error], [null, null, null, null]);
        t.equal(f.orchestrator.getStatus().notesIndex?.state, 'unknown');
        t.equal(f.orchestrator.getNotes(), 'Invented amber lantern inventory.', 'the saved source survives');
        t.end();
    });
}

t.test('saving notes embeds every chunk and records the actual provider, dimensions and completion time', async t => {
    const f = setup(t);
    const inputs: string[] = [];
    f.orchestrator.setEmbedFn(async text => {
        inputs.push(text);
        return { embedding: oldVector, provider: 'example:amber', dimensions: 3 };
    });
    const before = Date.now();
    await f.orchestrator.setNotes(note);
    const doc = f.manager.getDocumentByType(DocType.NOTES)!;
    t.same(inputs, note.split('\n'));
    t.equal(f.orchestrator.getNotes(), note);
    t.same(f.manager.getChunksForDoc(doc.id).map(chunk => chunk.embedding), [blob(oldVector), blob(oldVector)]);
    t.equal(doc.embedding_provider, 'example:amber');
    t.equal(doc.embedding_dimensions, 3);
    t.equal(doc.index_error, null);
    t.ok(Date.parse(doc.indexed_at!) >= before && Date.parse(doc.indexed_at!) <= Date.now(), 'time marks completion');
    t.same(f.orchestrator.getStatus().notesIndex, {
        state: 'indexed', provider: 'example:amber', dimensions: 3, indexedAt: doc.indexed_at, error: null,
    });
});

t.test('an initial embedding failure records its first line without inventing provenance', async t => {
    const f = setup(t);
    f.orchestrator.setEmbedFn(async () => { throw new Error(`Embedding service unavailable\n${note}`); });
    await f.orchestrator.setNotes(note);
    const doc = f.manager.getDocumentByType(DocType.NOTES)!;
    t.same(f.orchestrator.getStatus().notesIndex, {
        state: 'not-indexed', provider: null, dimensions: null, indexedAt: null, error: 'Embedding service unavailable',
    });
    t.same([doc.embedding_provider, doc.embedding_dimensions, doc.indexed_at], [null, null, null]);
    t.same(f.manager.getChunksForDoc(doc.id).map(chunk => chunk.embedding), [null, null]);
    t.equal(f.orchestrator.getNotes(), note, 'failed indexing does not lose the source');
});

for (const invalid of ['dimensions', 'provider'] as const) {
    t.test(`a batch with inconsistent ${invalid} is not partially indexed`, async t => {
        const f = setup(t);
        let calls = 0;
        f.orchestrator.setEmbedFn(async () => {
            const second = ++calls === 2;
            return {
                embedding: oldVector, dimensions: second && invalid === 'dimensions' ? 2 : 3,
                provider: second && invalid === 'provider' ? 'example:cobalt' : 'example:amber',
            };
        });
        await f.orchestrator.setNotes(note);
        const doc = f.manager.getDocumentByType(DocType.NOTES)!;
        t.equal(calls, 2);
        t.equal(f.orchestrator.getStatus().notesIndex?.state, 'not-indexed');
        t.equal(doc.index_error, invalid === 'dimensions' ? 'Embedding dimensions do not match the provider.' : 'Embedding provider changed while indexing. Re-index the document to retry.');
        t.same([doc.embedding_provider, doc.embedding_dimensions, doc.indexed_at], [null, null, null]);
        t.same(f.manager.getChunksForDoc(doc.id).map(chunk => chunk.embedding), [null, null]);
    });
}

t.test('a query that finishes after an active-model switch cannot return old-provider evidence', async t => {
    const f = setup(t);
    let providerName = 'example:amber';
    f.orchestrator.setEmbeddingStatusFn(() => ({ providerName, dimensions: 3 }));
    f.orchestrator.setEmbedFn(async () => ({ embedding: oldVector, provider: 'example:amber', dimensions: 3 }));
    await f.orchestrator.setNotes(note);
    let finish!: () => void;
    f.orchestrator.setEmbedQueryFn(async () => {
        await new Promise<void>(resolve => { finish = resolve; });
        return { embedding: oldVector, provider: 'example:amber', dimensions: 3 };
    });
    const pending = f.orchestrator.processQuestion('How many lanterns are available?');
    providerName = 'example:cobalt';
    finish();
    const result = await pending;
    t.equal(result?.knowledgeMiss, true);
    t.equal(result?.contextBlock, '');
});

t.test('a late embedding cannot stamp a replacement source with older provenance', async t => {
    const f = setup(t, false, true);
    let finish!: () => void;
    f.orchestrator.setEmbedFn(async () => {
        await new Promise<void>(resolve => { finish = resolve; });
        return { embedding: oldVector, provider: 'example:amber', dimensions: 3 };
    });
    const pending = f.orchestrator.setNotes('Invented amber lantern inventory.');
    f.orchestrator.setEmbedFn(async () => ({ embedding: [0, 1, 0], provider: 'example:cobalt', dimensions: 3 }));
    await f.orchestrator.setNotes('Invented replacement lantern inventory.');
    const replacement = f.manager.getDocumentByType(DocType.NOTES)!;
    finish();
    await pending;
    t.same(f.manager.getDocumentByType(DocType.NOTES), replacement);
    t.same(f.manager.getChunksForDoc(replacement.id).map(chunk => chunk.embedding), [blob([0, 1, 0])]);
    t.equal((f.db.prepare('SELECT COUNT(*) AS count FROM vec_knowledge_3').get() as { count: number }).count, 1);
});

t.test('native write and provenance update roll back together on a storage error', async t => {
    const f = setup(t, false, true);
    f.orchestrator.setEmbedFn(async () => ({ embedding: oldVector, provider: 'example:amber', dimensions: 3 }));
    await f.orchestrator.setNotes(note);
    const before = f.manager.getDocumentByType(DocType.NOTES)!;
    const chunks = f.manager.getChunksForDoc(before.id);
    const vectors = f.db.prepare('SELECT * FROM vec_knowledge_3').all();
    f.db.exec(`CREATE TEMP TRIGGER deny_provenance BEFORE UPDATE OF indexed_at ON knowledge_documents
        BEGIN SELECT RAISE(ABORT, 'Synthetic index storage unavailable'); END;`);
    f.orchestrator.setEmbedFn(async () => ({ embedding: [0, 1, 0], provider: 'example:cobalt', dimensions: 3 }));
    await f.orchestrator.setNotes(note);
    t.same(f.manager.getDocumentByType(DocType.NOTES), { ...before, index_error: 'Synthetic index storage unavailable' });
    t.same(f.manager.getChunksForDoc(before.id), chunks);
    t.same(f.db.prepare('SELECT * FROM vec_knowledge_3').all(), vectors);
});

for (const native of [false, true]) {
    t.test(`${native ? 'native' : 'JS'}: incompatible hits cannot crowd compatible evidence out of the result limit`, async t => {
        const f = setup(t, false, native);
        const store = new KnowledgeVectorStore(f.db);
        for (let i = 0; i < 8; i++) {
            const id = f.manager.insertDocument(DocType.NOTES, 'notes.txt', 'Invented incompatible inventory.', null);
            const [chunkId] = f.manager.saveChunks(id, [{ text: 'Invented incompatible inventory.' }]);
            await store.storeEmbeddings(id, [{ id: chunkId, text: 'Invented incompatible inventory.' }], async () => ({ embedding: oldVector, provider: 'example:amber', dimensions: 3 }));
        }
        const id = f.manager.insertDocument(DocType.NOTES, 'notes.txt', 'Invented compatible inventory.', null);
        const [chunkId] = f.manager.saveChunks(id, [{ text: 'Invented compatible inventory.' }]);
        await store.storeEmbeddings(id, [{ id: chunkId, text: 'Invented compatible inventory.' }], async () => ({ embedding: oldVector, provider: 'example:cobalt', dimensions: 3 }));
        const results = store.searchSimilar(oldVector, 1, 'example:cobalt', DocType.NOTES);
        t.same(results.map(result => result.text), ['Invented compatible inventory.']);
        t.same(store.searchSimilar(oldVector, 1, 'example:missing', DocType.NOTES), []);
    });

    t.test(`${native ? 'native' : 'JS'}: a dimension-changing re-embed replaces all old vectors`, async t => {
        const f = setup(t, false, native);
        f.orchestrator.setEmbedFn(async () => ({ embedding: oldVector, provider: 'example:amber', dimensions: 3 }));
        await f.orchestrator.setNotes(note);
        f.orchestrator.setEmbedFn(async () => ({ embedding: [0, 1], provider: 'example:cobalt', dimensions: 2 }));
        await f.orchestrator.setNotes(note);
        t.match(f.orchestrator.getStatus().notesIndex, { state: 'indexed', provider: 'example:cobalt', dimensions: 2 });
        if (native) {
            t.same(f.db.prepare('SELECT * FROM vec_knowledge_3').all(), []);
            t.equal((f.db.prepare('SELECT COUNT(*) AS count FROM vec_knowledge_2').get() as { count: number }).count, 2);
        }
        const doc = f.manager.getDocumentByType(DocType.NOTES)!;
        t.same(f.manager.getChunksForDoc(doc.id).map(chunk => chunk.embedding), [blob([0, 1]), blob([0, 1])]);
    });

    t.test(`${native ? 'native' : 'JS'}: same-dimension provider switches exclude old evidence until re-embedded; Unknown keeps dimension-only retrieval`, async t => {
        const f = setup(t, false, native);
        let provider = 'example:amber';
        let dimensions = 3;
        let vector = oldVector;
        f.orchestrator.setEmbeddingStatusFn(() => ({ providerName: provider, dimensions }));
        f.orchestrator.setEmbedFn(async () => ({ embedding: vector, provider, dimensions }));
        f.orchestrator.setEmbedQueryFn(async () => ({ embedding: vector, provider, dimensions }));
        await f.orchestrator.setNotes(note);
        t.same((await f.orchestrator.processQuestion('How many lanterns are available?'))?.contextBlock?.split('\n\n').sort(), note.split('\n').sort());
        const before = f.manager.getDocumentByType(DocType.NOTES)!;
        const chunks = f.manager.getChunksForDoc(before.id);
        provider = 'example:cobalt';
        const miss = await f.orchestrator.processQuestion('How many lanterns are available?');
        t.equal(miss?.knowledgeMiss, true);
        t.equal(miss?.contextBlock, '');
        t.match(f.orchestrator.getStatus().notesIndex, { state: 'needs-reindex', provider: 'example:amber', dimensions: 3 });
        t.same(f.manager.getDocumentByType(DocType.NOTES), before, 'a model switch changes no persisted state');
        t.same(f.manager.getChunksForDoc(before.id), chunks, 'retrieval deletes and re-embeds nothing');
        f.db.prepare('UPDATE knowledge_documents SET embedding_provider = NULL, embedding_dimensions = NULL, indexed_at = NULL').run();
        t.equal(f.orchestrator.getStatus().notesIndex?.state, 'unknown');
        t.same((await f.orchestrator.processQuestion('How many lanterns are available?'))?.contextBlock?.split('\n\n').sort(), note.split('\n').sort());
        dimensions = 2;
        vector = [1, 0];
        t.equal((await f.orchestrator.processQuestion('How many lanterns are available?'))?.contextBlock, '', 'Unknown still rejects a different dimension');
        dimensions = 3;
        vector = [0, 1, 0];
        await f.orchestrator.setNotes(note);
        const after = f.manager.getDocumentByType(DocType.NOTES)!;
        t.equal(after.id, before.id, 're-embedding keeps the source identity');
        t.same(f.orchestrator.getStatus().notesIndex, {
            state: 'indexed', provider: 'example:cobalt', dimensions: 3, indexedAt: after.indexed_at, error: null,
        });
        t.same(f.manager.getChunksForDoc(after.id).map(chunk => chunk.embedding), [blob(vector), blob(vector)]);
        const match = await f.orchestrator.processQuestion('How many lanterns are available?');
        t.same(match?.contextBlock?.split('\n\n').sort(), note.split('\n').sort(), 'new vectors are searched, including native replacement');
        if (native) t.same((f.db.prepare('SELECT embedding FROM vec_knowledge_3').all() as Array<{ embedding: Buffer }>).map(row => row.embedding), [blob(vector), blob(vector)]);
        dimensions = 2;
        t.equal(f.orchestrator.getStatus().notesIndex?.state, 'needs-reindex', 'dimensions are part of compatibility, not just the name');
    });

    t.test(`${native ? 'native' : 'JS'}: a failed re-embed keeps the previous provenance and vectors, and reports the real first-line error`, async t => {
        const f = setup(t, false, native);
        f.orchestrator.setEmbedFn(async () => ({ embedding: oldVector, provider: 'example:amber', dimensions: 3 }));
        await f.orchestrator.setNotes(note);
        const before = f.manager.getDocumentByType(DocType.NOTES)!;
        const chunks = f.manager.getChunksForDoc(before.id);
        const nativeBefore = native ? f.db.prepare('SELECT * FROM vec_knowledge_3').all() : [];
        let calls = 0;
        f.orchestrator.setEmbedFn(async () => {
            if (++calls === 2) throw new Error(`Embedding quota exceeded\n${note}`);
            return { embedding: [0, 1, 0], provider: 'example:cobalt', dimensions: 3 };
        });
        await f.orchestrator.setNotes(note);
        t.equal(calls, 2, 'failure occurs after one successful chunk');
        const failed = f.manager.getDocumentByType(DocType.NOTES)!;
        t.same(failed, { ...before, index_error: 'Embedding quota exceeded' });
        t.same(f.manager.getChunksForDoc(before.id), chunks, 'no partial vector update');
        if (native) t.same(f.db.prepare('SELECT * FROM vec_knowledge_3').all(), nativeBefore);
        t.same(f.orchestrator.getStatus().notesIndex, {
            state: 'not-indexed', provider: 'example:amber', dimensions: 3, indexedAt: before.indexed_at, error: 'Embedding quota exceeded',
        });
        f.orchestrator.setEmbedFn(async () => ({ embedding: [0, 1, 0], provider: 'example:cobalt', dimensions: 3 }));
        await f.orchestrator.setNotes(note);
        t.match(f.orchestrator.getStatus().notesIndex, { state: 'indexed', provider: 'example:cobalt', dimensions: 3, error: null });
        t.equal(f.manager.getDocumentByType(DocType.NOTES)?.index_error, null, 'a successful retry clears the old error');
    });
}

