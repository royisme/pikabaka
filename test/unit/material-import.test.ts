import t, { type Test } from 'tap';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdtempSync, mkdirSync, writeFileSync, truncateSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { format } from 'node:util';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { KnowledgeDatabaseManager } from '../../electron/knowledge/KnowledgeDatabaseManager';
import { KnowledgeVectorStore } from '../../electron/knowledge/KnowledgeVectorStore';
import type { KnowledgeOrchestrator as Orchestrator } from '../../electron/knowledge/KnowledgeOrchestrator';
import { DocType } from '../../electron/knowledge/types';

const material = 'material' as DocType;
const text = 'Invented amber lantern inventory for the workshop.';
const vector = { embedding: [1, 0, 0], provider: 'example:amber', dimensions: 3 };
const blob = (values: number[]) => Buffer.from(new Float32Array(values).buffer);

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function setup(t: Test, native = false) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-material-import-'));
    const db = new Database(path.join(dir, 'synthetic.sqlite'));
    db.pragma('foreign_keys = ON');
    if (native) sqliteVec.load(db);
    const manager = new KnowledgeDatabaseManager(db);
    const switches = { meetings: true, materials: true, profile: true };
    const { KnowledgeOrchestrator } = mockRequire(path.resolve('electron/knowledge/KnowledgeOrchestrator.ts'), {
        [path.resolve('electron/services/SettingsManager.ts')]: { getAnswerSources: () => switches },
    }) as { KnowledgeOrchestrator: typeof Orchestrator };
    const logs: string[] = [];
    for (const method of ['log', 'warn', 'error'] as const) {
        const original = console[method];
        console[method] = (...args: unknown[]) => { logs.push(format(...args)); };
        t.teardown(() => { console[method] = original; });
    }
    const orchestrator = new KnowledgeOrchestrator(manager);
    orchestrator.setEmbeddingStatusFn(() => ({ providerName: vector.provider, dimensions: vector.dimensions }));
    orchestrator.setEmbedFn(async () => vector);
    orchestrator.setEmbedQueryFn(async () => vector);
    const store = new KnowledgeVectorStore(db);
    t.teardown(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
    const file = (name: string, contents = text) => {
        const target = path.join(dir, name);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, contents);
        return target;
    };
    const add = async (type: DocType, name: string, contents = text, embedding = vector) => {
        const id = manager.insertDocument(type, name, contents, null);
        const [chunkId] = manager.saveChunks(id, [{ text: contents }]);
        await store.storeEmbeddings(id, [{ id: chunkId, text: contents }], async () => embedding);
        return id;
    };
    const snapshot = () => ({
        docs: db.prepare('SELECT * FROM knowledge_documents ORDER BY id').all(),
        chunks: db.prepare('SELECT * FROM knowledge_chunks ORDER BY id').all(),
        vectors: native ? db.prepare('SELECT * FROM vec_knowledge_3 ORDER BY chunk_id').all() : [],
    });
    const idle = async () => {
        for (let count = 0; count < 1000; count++) {
            if (!orchestrator.listDocuments().some(doc => doc.state === 'indexing')) return;
            await new Promise<void>(resolve => setImmediate(resolve));
        }
        throw new Error('Synthetic indexing did not settle');
    };
    return { dir, db, manager, orchestrator, store, switches, logs, file, add, snapshot, idle, KnowledgeOrchestrator };
}

t.test('material is a value in the existing document type', t => {
    t.equal(DocType.MATERIAL, 'material');
    t.end();
});

for (const native of [false, true]) {
    t.test(`${native ? 'native' : 'JS'}: imports coexist without an LLM or changes to notes, resume or JD`, async t => {
        const f = setup(t, native);
        for (const type of [DocType.NOTES, DocType.RESUME, DocType.JD]) await f.add(type, `${type}.txt`);
        const before = f.snapshot();
        const first = await f.orchestrator.importDocument(f.file('first.md'));
        await f.idle();
        const second = await f.orchestrator.importDocument(f.file('second.txt', `${text} A second invented list.`));
        await f.idle();
        t.not(first.id, second.id);
        t.same(f.orchestrator.listDocuments().map(doc => doc.id), [second.id, first.id], 'newest first, including same-second imports');
        t.match(f.orchestrator.listDocuments(), [
            { name: 'second.txt', kind: 'txt', passages: 1, state: 'indexed', provider: vector.provider, dimensions: 3, error: null },
            { name: 'first.md', kind: 'md', passages: 1, state: 'indexed' },
        ]);
        for (const doc of f.orchestrator.listDocuments()) {
            t.match(doc.importedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
            const row = f.manager.getAllDocumentsByType(material).find(row => row.id === doc.id)!;
            t.match(row, { doc_type: 'material', parsed_data: 'null', label: null, is_active: 0 });
            t.notMatch(JSON.stringify(row), f.dir, 'no path stored');
        }
        const after = f.snapshot();
        t.same(after.docs.slice(0, 3), before.docs);
        t.same(after.chunks.slice(0, 3), before.chunks);
        if (native) t.same(after.vectors.slice(0, 3), before.vectors);
    });
}

const refusals = [
    { name: 'too large', filename: 'large.txt', contents: '', size: 34 * 1024 * 1024, error: 'This file is 34 MB. Pika imports files up to 20 MB.' },
    { name: 'too many characters', filename: 'long.md', contents: 'x'.repeat(200_001), error: 'This document is too long: 200,001 characters. The limit is 200,000; split it into smaller files.' },
    { name: 'too many passages', filename: 'short-lines.txt', contents: Array.from({ length: 1001 }, (_, i) => `Invented short passage number ${i}.`).join('\n\n'), error: 'This document has too many short passages: 1,001. The limit is 1,000.' },
    { name: 'empty text', filename: 'empty.txt', contents: ' \n\t', error: 'This document has no text Pika can read.' },
    { name: 'text too short to leave a passage', filename: 'tiny.txt', contents: 'Too short.\n\nAlso short.', error: 'This document has no passage of at least 20 characters to search.' },
    { name: 'unsupported extension', filename: 'unknown.csv', contents: text, error: /Unsupported file format: \.csv/ },
    { name: 'PDF even when poppler is installed', filename: 'scanned.pdf', contents: '', error: /Unsupported file format: \.pdf/ },
];
for (const refusal of refusals) {
    t.test(`refusal stores nothing: ${refusal.name}`, async t => {
        const f = setup(t, true);
        await f.add(material, 'kept.txt');
        const before = f.snapshot();
        const file = f.file(refusal.filename, refusal.contents);
        if (refusal.size) truncateSync(file, refusal.size);
        await t.rejects(f.orchestrator.importDocument(file), { message: refusal.error });
        t.same(f.snapshot(), before, 'no row, passage, vector or provenance was written');
    });
}

for (const boundary of [
    { name: '200,000 characters', contents: 'Invented boundary. '.padEnd(200_000, 'x') },
    { name: '1,000 passages', contents: Array.from({ length: 1000 }, (_, i) => `Invented boundary passage number ${i}.`).join('\n\n') },
]) {
    t.test(`import accepts exactly ${boundary.name}`, async t => {
        const f = setup(t);
        const doc = await f.orchestrator.importDocument(f.file('boundary.txt', boundary.contents));
        await f.idle();
        t.equal(f.manager.getAllDocumentsByType(material)[0].raw_text, boundary.contents);
        t.equal(f.orchestrator.listDocuments()[0].state, 'indexed');
        t.equal(doc.passages, boundary.name === '1,000 passages' ? 1000 : 2);
    });
}

t.test('20 MB is accepted and one byte more is refused before parsing', async t => {
    const f = setup(t);
    let reads = 0;
    const { KnowledgeOrchestrator } = mockRequire(path.resolve('electron/knowledge/KnowledgeOrchestrator.ts'), {
        [path.resolve('electron/services/SettingsManager.ts')]: { getAnswerSources: () => f.switches },
        [path.resolve('electron/knowledge/DocumentParser.ts')]: { DocumentParser: class {
            async parse() { reads++; return { text, metadata: { format: 'txt' } }; }
        } },
    }) as { KnowledgeOrchestrator: typeof Orchestrator };
    const orchestrator = new KnowledgeOrchestrator(f.manager);
    const source = f.file('size-boundary.txt', '');
    truncateSync(source, 20 * 1024 * 1024);
    const doc = await orchestrator.importDocument(source);
    t.equal(doc.name, 'size-boundary.txt');
    t.equal(reads, 1);
    const before = f.snapshot();
    truncateSync(source, 20 * 1024 * 1024 + 1);
    await t.rejects(orchestrator.importDocument(source), /Pika imports files up to 20 MB/);
    t.equal(reads, 1, 'size refusal never calls the parser');
    t.same(f.snapshot(), before);
});

t.test('a textless converted DOCX is refused without storing anything', async t => {
    const f = setup(t);
    const { KnowledgeOrchestrator } = mockRequire(path.resolve('electron/knowledge/KnowledgeOrchestrator.ts'), {
        [path.resolve('electron/services/SettingsManager.ts')]: { getAnswerSources: () => f.switches },
        [path.resolve('electron/knowledge/DocumentParser.ts')]: { DocumentParser: class {
            async parse() { return { text: '', metadata: { format: 'docx' } }; }
        } },
    }) as { KnowledgeOrchestrator: typeof Orchestrator };
    const orchestrator = new KnowledgeOrchestrator(f.manager);
    const before = f.snapshot();
    await t.rejects(orchestrator.importDocument(f.file('textless.docx', 'Invented binary placeholder')), { message: 'This document has no text Pika can read.' });
    t.same(f.snapshot(), before);
});

t.test('identical extracted text is refused with name and date; the same name with different text is kept', async t => {
    const f = setup(t, true);
    const first = await f.orchestrator.importDocument(f.file('left/spec.md'));
    await f.idle();
    f.db.prepare('UPDATE knowledge_documents SET created_at = ? WHERE id = ?').run('2026-10-28 12:00:00', first.id);
    const before = f.snapshot();
    await t.rejects(f.orchestrator.importDocument(f.file('right/other.txt')), { message: 'Already imported as spec.md on 28 Oct 2026.' });
    t.same(f.snapshot(), before);
    const second = await f.orchestrator.importDocument(f.file('right/spec.md', `${text} Changed inventory.`));
    await f.idle();
    t.not(first.id, second.id);
    t.same(f.orchestrator.listDocuments().map(doc => doc.name), ['spec.md', 'spec.md']);
});

t.test('row and passage insertion is one transaction', async t => {
    const f = setup(t);
    f.db.exec(`CREATE TEMP TRIGGER refuse_passages BEFORE INSERT ON knowledge_chunks
        BEGIN SELECT RAISE(ABORT, 'Synthetic passage storage refused'); END;`);
    const before = f.snapshot();
    await t.rejects(f.orchestrator.importDocument(f.file('atomic.md')), /Synthetic passage storage refused/);
    t.same(f.snapshot(), before, 'no empty document row survives');
});

t.test('Remove discovers every dimension, including 1024, and only deletes the selected material', async t => {
    const f = setup(t, true);
    const selected = await f.orchestrator.importDocument(f.file('selected.txt'));
    await f.idle();
    const other = await f.orchestrator.importDocument(f.file('other.txt', `${text} Keep this list.`));
    await f.idle();
    const chunks = f.manager.getChunksForDoc(selected.id);
    f.db.exec('CREATE VIRTUAL TABLE vec_knowledge_1024 USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[1024])');
    const otherChunk = f.manager.getChunksForDoc(other.id)[0];
    for (const id of [chunks[0].id, otherChunk.id]) {
        f.db.prepare('INSERT INTO vec_knowledge_1024(chunk_id, embedding) VALUES (?, ?)').run(BigInt(id), blob(Array(1024).fill(0.1)));
    }
    const unusualKept = f.db.prepare('SELECT * FROM vec_knowledge_1024 WHERE chunk_id = ?').all(otherChunk.id);
    const kept = f.snapshot();
    f.orchestrator.removeDocument(selected.id);
    t.same(f.manager.getChunksForDoc(selected.id), []);
    t.same(f.manager.getAllDocumentsByType(material).map(doc => doc.id), [other.id]);
    t.same(f.db.prepare('SELECT * FROM vec_knowledge_1024').all(), unusualKept, 'other documents keep unusual-dimension vectors too');
    t.same(f.snapshot().vectors, kept.vectors.filter(row => (row as { chunk_id: number }).chunk_id !== chunks[0].id));
    t.same(f.manager.getChunksForDoc(other.id), (kept.chunks as Array<{ doc_id: number }>).filter(row => row.doc_id === other.id));
    t.same((await f.orchestrator.searchMaterials('Invented inventory?')).map(passage => passage.source), ['other.txt']);
});

for (const failure of ['vector', 'row']) {
    t.test(`Remove rolls back vectors, passages and row on a ${failure} deletion failure`, async t => {
        const f = setup(t, true);
        const doc = await f.orchestrator.importDocument(f.file('atomic.txt'));
        await f.idle();
        const before = f.snapshot();
        if (failure === 'vector') {
            f.db.exec(`CREATE TABLE vec_knowledge_7 (chunk_id INTEGER PRIMARY KEY);
                CREATE TRIGGER refuse_vector BEFORE DELETE ON vec_knowledge_7
                BEGIN SELECT RAISE(ABORT, 'Synthetic vector removal refused'); END;`);
            f.db.prepare('INSERT INTO vec_knowledge_7 VALUES (?)').run(f.manager.getChunksForDoc(doc.id)[0].id);
        } else {
            f.db.exec(`CREATE TEMP TRIGGER refuse_row BEFORE DELETE ON knowledge_documents
                BEGIN SELECT RAISE(ABORT, 'Synthetic row removal refused'); END;`);
        }
        t.throws(() => f.orchestrator.removeDocument(doc.id), new RegExp(`Synthetic ${failure} removal refused`));
        t.same(f.snapshot(), before);
    });
}

t.test('Remove during indexing leaves no late vectors, passages or provenance', async t => {
    const f = setup(t, true);
    const pending = deferred();
    const finished = deferred();
    f.orchestrator.setEmbedFn(async () => { await pending.promise; finished.resolve(); return vector; });
    const doc = await f.orchestrator.importDocument(f.file('pending.txt'));
    t.equal(doc.state, 'indexing', 'import returns without waiting for the provider');
    f.orchestrator.removeDocument(doc.id);
    pending.resolve();
    await finished.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    t.same(f.orchestrator.listDocuments(), []);
    t.same(f.manager.getChunksForDoc(doc.id), []);
    t.same(f.db.prepare('SELECT * FROM vec_knowledge_3').all(), []);
});

for (const native of [false, true]) {
    t.test(`${native ? 'native' : 'JS'}: six state cases, restart, model switch and re-index of stored passages`, async t => {
        const f = setup(t, native);
        const pending = deferred();
        f.orchestrator.setEmbedFn(async () => { await pending.promise; return vector; });
        const source = f.file('states.md');
        const doc = await f.orchestrator.importDocument(source);
        t.match(f.orchestrator.listDocuments(), [{ state: 'indexing', passages: 1, provider: null }]);
        const restarted = new f.KnowledgeOrchestrator(f.manager);
        t.match(restarted.listDocuments(), [{ state: 'not-indexed', error: null }], 'a restart has no in-memory job');
        t.throws(() => f.orchestrator.reindexDocument(doc.id), /already indexing/i);
        pending.resolve();
        await f.idle();
        t.match(f.orchestrator.listDocuments(), [{ state: 'indexed', provider: vector.provider }]);
        const earlier = f.snapshot();
        f.orchestrator.setEmbedFn(async () => { throw new Error('Synthetic quota refused\nInvented private error detail'); });
        f.orchestrator.reindexDocument(doc.id);
        await f.idle();
        t.match(f.orchestrator.listDocuments(), [{ state: 'failed', provider: vector.provider, error: 'Synthetic quota refused' }], 'failed with an earlier index');
        t.same(f.snapshot().docs, (earlier.docs as Array<object>).map(row => ({ ...row, index_error: 'Synthetic quota refused' })), 'failed re-index preserves earlier provenance and time');
        t.same(f.snapshot().chunks, earlier.chunks);
        if (native) t.same(f.snapshot().vectors, earlier.vectors);
        t.match(await f.orchestrator.searchMaterials('Invented inventory?'), [{ source: 'states.md', text }], 'earlier index remains searchable');
        f.orchestrator.setEmbeddingStatusFn(() => ({ providerName: 'example:cobalt', dimensions: 2 }));
        f.orchestrator.setEmbedQueryFn(async () => ({ embedding: [0, 1], provider: 'example:cobalt', dimensions: 2 }));
        t.match(f.orchestrator.listDocuments(), [{ state: 'needs-reindex' }], 'mismatch takes precedence over an earlier failure');
        t.same(await f.orchestrator.searchMaterials('Invented inventory?'), []);
        unlinkSync(source);
        const inputs: string[] = [];
        f.orchestrator.setEmbedFn(async input => { inputs.push(input); return { embedding: [0, 1], provider: 'example:cobalt', dimensions: 2 }; });
        f.orchestrator.reindexDocument(doc.id);
        await f.idle();
        t.same(inputs, [text], 'the removed source file is never read again');
        t.match(f.orchestrator.listDocuments(), [{ state: 'indexed', provider: 'example:cobalt', dimensions: 2, error: null }]);
        t.same(f.manager.getChunksForDoc(doc.id).map(chunk => chunk.embedding), [blob([0, 1])]);
        if (native) t.same(f.db.prepare('SELECT * FROM vec_knowledge_3').all(), []);
        t.match(await f.orchestrator.searchMaterials('Invented inventory?'), [{ source: 'states.md' }]);
        f.orchestrator.setEmbedFn(async () => { throw new Error('Synthetic initial failure'); });
        const failed = await f.orchestrator.importDocument(f.file('failed.txt', `${text} Another document.`));
        await f.idle();
        t.match(f.orchestrator.listDocuments().find(row => row.id === failed.id), { state: 'failed', provider: null, dimensions: null, indexedAt: null, error: 'Synthetic initial failure' });
    });
}

t.test('an earlier index stays searchable while re-indexing; no embedder records a real failure', async t => {
    const f = setup(t, true);
    const doc = await f.orchestrator.importDocument(f.file('available.md'));
    await f.idle();
    const before = f.snapshot();
    const pending = deferred();
    f.orchestrator.setEmbedFn(async () => { await pending.promise; return vector; });
    f.orchestrator.reindexDocument(doc.id);
    t.match(f.orchestrator.listDocuments(), [{ state: 'indexing', provider: vector.provider }]);
    t.match(await f.orchestrator.searchMaterials('Invented inventory?'), [{ text, source: 'available.md' }]);
    t.same(f.snapshot(), before, 'no early vector deletion');
    pending.resolve();
    await f.idle();
    const restarted = new f.KnowledgeOrchestrator(f.manager);
    const failed = await restarted.importDocument(f.file('unavailable.txt', `${text} No provider.`));
    t.match(restarted.listDocuments().find(row => row.id === failed.id), {
        state: 'failed', provider: null, indexedAt: null, error: 'Embedding provider not initialized',
    });
});

t.test('Remove and re-index refuse ids that are not material rows', async t => {
    const f = setup(t);
    const jd = await f.add(DocType.JD, 'role.txt');
    const before = f.snapshot();
    for (const id of [0.5, -1, 900, jd]) {
        t.throws(() => f.orchestrator.removeDocument(id), { message: 'That document is not in Pika.' });
        t.throws(() => f.orchestrator.reindexDocument(id), { message: 'That document is not in Pika.' });
    }
    t.same(f.snapshot(), before);
});

for (const native of [false, true]) {
    t.test(`${native ? 'native' : 'JS'}: both answer switches never put documents in the candidate prompt`, async t => {
        const f = setup(t, native);
        await f.add(DocType.NOTES, 'notes.txt', 'Invented candidate note passage.');
        await f.add(DocType.RESUME, 'resume.txt', 'Invented candidate resume passage.');
        await f.add(DocType.JD, 'role.txt', 'Invented candidate target role passage.');
        await f.add(material, 'private.txt', 'Invented document passage must never reach a candidate prompt.');
        const result = await f.orchestrator.processQuestion('What is the invented plan?');
        t.match(result?.systemPromptInjection, /Answer in first person as the candidate/);
        t.match(result?.contextBlock, /Invented candidate note passage/);
        t.match(result?.contextBlock, /Invented candidate resume passage/);
        t.match(result?.contextBlock, /Invented candidate target role passage/);
        t.notMatch(JSON.stringify(result), /Invented document passage/);
    });
}

t.test('document vectors alone do not turn unindexed notes into a knowledge miss', async t => {
    const f = setup(t);
    const id = f.manager.insertDocument(DocType.NOTES, 'notes.txt', text, null);
    f.manager.saveChunks(id, [{ text }]);
    await f.add(material, 'only.txt', text, { ...vector, embedding: [0, 1, 0] });
    let calls = 0;
    f.orchestrator.setEmbedQueryFn(async () => { calls++; return vector; });
    t.equal(f.store.hasEmbeddings([DocType.NOTES, DocType.RESUME, DocType.JD]), false);
    t.equal(f.store.hasEmbeddings(material), true);
    t.equal(await f.orchestrator.processQuestion('What is the invented plan?'), null);
    t.equal(calls, 0);
});

for (const native of [false, true]) {
    t.test(`${native ? 'native' : 'JS'}: search_materials ranks notes and documents together with their own sources and caps`, async t => {
        const f = setup(t, native);
        await f.add(DocType.NOTES, 'notes.txt', 'Invented note ranked below the first document.', { ...vector, embedding: [0.98, 0.02, 0] });
        for (let i = 0; i < 7; i++) await f.add(material, `source-${i}.md`, `Invented document ${i}. ${'lantern '.repeat(70)}`, { ...vector, embedding: [1, i / 20, 0] });
        await f.add(DocType.RESUME, 'decoy.txt', 'Invented excluded profile decoy.');
        await f.add(material, 'wrong-model.md', text, { ...vector, provider: 'example:other' });
        await f.add(material, 'unrelated.md', text, { ...vector, embedding: [0, 1, 0] });
        let calls = 0;
        f.orchestrator.setEmbedQueryFn(async () => { calls++; return vector; });
        const passages = await f.orchestrator.searchMaterials('What is the invented plan?');
        t.equal(calls, 1);
        t.equal(passages.length, 5);
        t.same(passages.map(passage => passage.source), ['source-0.md', 'notes.txt', 'source-1.md', 'source-2.md', 'source-3.md']);
        t.equal(passages[0].text.length, 400);
        t.ok(passages.every(passage => passage.text.length <= 400 && passage.score >= 0.3));
        t.ok(passages.every((passage, i) => i === 0 || passage.score <= passages[i - 1].score));
        f.orchestrator.deleteDocumentsByType(DocType.NOTES);
        t.equal((await f.orchestrator.searchMaterials('What is the invented plan?'))[0].source, 'source-0.md', 'works with documents and no notes');
    });
}

t.test('captured success, read-refusal and indexing-failure logs contain no source path, name or text', async t => {
    const f = setup(t, true);
    const name = 'private-invented-material.md';
    const source = f.file(name);
    const doc = await f.orchestrator.importDocument(source);
    await f.idle();
    f.orchestrator.setEmbedFn(async () => { throw new Error(`Synthetic failure ${source} ${text}`); });
    f.orchestrator.reindexDocument(doc.id);
    await f.idle();
    await t.rejects(f.orchestrator.importDocument(path.join(f.dir, 'missing-private.txt')));
    const logs = f.logs.join('\n');
    t.ok(f.logs.length > 0, 'actual operations were captured');
    for (const privateValue of [f.dir, source, name, 'missing-private.txt', text]) t.notMatch(logs, privateValue);
    t.match(f.orchestrator.listDocuments()[0].error, text, 'the real error is returned, not logged');
});

t.test('the list names the kind and reads provenance exactly: either half of a mismatch, partial provenance, a stray time', async t => {
    const f = setup(t, true);
    const kinds = new Map<string, string>();
    for (const name of ['plain.txt', 'notes.md']) {
        const doc = await f.orchestrator.importDocument(f.file(name, `${text} ${name}`));
        kinds.set(name, doc.kind);
    }
    await f.idle();
    t.same([...kinds.values()], ['txt', 'md'], 'the kind is the extension without its dot');
    t.match(f.orchestrator.listDocuments(), [{ state: 'indexed' }, { state: 'indexed' }]);

    f.orchestrator.setEmbeddingStatusFn(() => ({ providerName: 'example:other', dimensions: vector.dimensions }));
    t.match(f.orchestrator.listDocuments().map(doc => doc.state), ['needs-reindex', 'needs-reindex'], 'another provider with the same dimensions');
    f.orchestrator.setEmbeddingStatusFn(() => ({ providerName: vector.provider, dimensions: 4 }));
    t.match(f.orchestrator.listDocuments().map(doc => doc.state), ['needs-reindex', 'needs-reindex'], 'the same provider with other dimensions');
    f.orchestrator.setEmbeddingStatusFn(() => ({ providerName: vector.provider, dimensions: vector.dimensions }));

    const [first] = f.orchestrator.listDocuments();
    f.db.prepare('UPDATE knowledge_documents SET embedding_dimensions = NULL WHERE id = ?').run(first.id);
    t.match(f.orchestrator.listDocuments().find(doc => doc.id === first.id), { state: 'not-indexed' }, 'a provider without dimensions is not a known index');
    f.db.prepare('UPDATE knowledge_documents SET embedding_provider = NULL, embedding_dimensions = NULL, indexed_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', first.id);
    t.match(f.orchestrator.listDocuments().find(doc => doc.id === first.id), { state: 'not-indexed' }, 'a time without provenance is not an index either');
});
