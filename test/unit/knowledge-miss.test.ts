import t from 'tap';
import path from 'node:path';
import type { KnowledgeOrchestrator as Orchestrator } from '../../electron/knowledge/KnowledgeOrchestrator';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { DocType, type DocumentRow } from '../../electron/knowledge/types';

const { KnowledgeOrchestrator } = mockRequire(path.resolve('electron/knowledge/KnowledgeOrchestrator.ts'), {
  [path.resolve('electron/services/SettingsManager.ts')]: { getAnswerSources: () => ({ meetings: true, materials: true }) },
}) as { KnowledgeOrchestrator: typeof Orchestrator };

const note: DocumentRow = {
  id: 9, doc_type: DocType.NOTES, file_name: 'notes.txt', raw_text: 'Invented amber note.', created_at: '', updated_at: '', is_active: 0, label: null,
  parsed_data: 'null',
};

function orchestrator(options: { scores: number[]; notes?: string }) {
  const rows = new Map<string, DocumentRow>();
  if (options.notes) rows.set(DocType.NOTES, { ...note, raw_text: options.notes });
  const stubDb = { prepare: () => ({ run: () => ({}), all: () => [], get: () => undefined }), exec: () => {}, pragma: () => {} };
  const db: any = {
    getDb: () => stubDb,
    getDocumentByType: (docType: DocType) => rows.get(docType) ?? null,
    deleteDocumentsByType: (docType: DocType) => { rows.delete(docType); },
    upsertDocument: (docType: DocType, fileName: string, rawText: string) => { rows.set(docType, { ...note, doc_type: docType, file_name: fileName, raw_text: rawText }); return 9; },
    saveChunks: (_id: number, chunks: unknown[]) => chunks.map((_, i) => 900 + i),
  };
  const o: any = new KnowledgeOrchestrator(db);
  o.setEmbedQueryFn(async () => ({ embedding: [1, 0, 0], provider: 'example:index', dimensions: 3 }));
  o.vectorStore = {
    hasEmbeddings: () => true,
    searchSimilar: () => options.scores.map((score, i) => ({ id: i, text: `passage ${i}`, score, metadata: {}, docType: 'notes' })),
    clearEmbeddings: () => {},
    storeEmbeddings: async () => {},
  };
  return o as Orchestrator;
}

t.test('passages that are not about the question are dropped, and nothing is invented in their place', async t => {
  const result = await orchestrator({ scores: [0.12, 0.08], notes: 'Invented amber note.' }).processQuestion('Tell me about the hardest outage you handled');
  t.equal(result?.knowledgeMiss, true);
  t.equal(result?.contextBlock, '');
  t.match(result?.systemPromptInjection, /senior practitioner/);
  t.match(result?.systemPromptInjection, /Do not invent a past/);
  t.notMatch(result?.systemPromptInjection, /Not in your notes/);
  t.notMatch(result?.systemPromptInjection, /square brackets/);
});

t.test('a passage that matches is used as background and is not a miss', async t => {
  const result = await orchestrator({ scores: [0.62, 0.1], notes: 'Invented amber note.' }).processQuestion('How did you structure the billing service?');
  t.notOk(result?.knowledgeMiss);
  t.match(result?.contextBlock, /passage 0/);
  t.notMatch(result?.contextBlock, /passage 1/);
});

t.test('notes alone answer questions, and saving empty notes removes them', async t => {
  const o = orchestrator({ scores: [] });
  t.equal(o.getNotes(), '');
  t.equal(await o.processQuestion('What is the invented plan?'), null, 'no notes means no notes answer source');
  await o.setNotes('Led the billing migration: 40 services, no downtime.\n\nCut the close from 5 days to 2.');
  t.match(o.getNotes(), /billing migration/);
  await o.setNotes('   ');
  t.equal(o.getNotes(), '');
});

t.test('a passage that scores exactly the minimum is used; one just under it is not', async t => {
  const at = await orchestrator({ scores: [0.3], notes: 'Invented amber note.' }).processQuestion('How did you structure the billing service?');
  t.notOk(at?.knowledgeMiss, 'the minimum itself matches');
  t.match(at?.contextBlock, /passage 0/);
  const under = await orchestrator({ scores: [0.29], notes: 'Invented amber note.' }).processQuestion('How did you structure the billing service?');
  t.equal(under?.knowledgeMiss, true, 'just under the minimum is a miss');
});

t.test('notes indexed with another embedding model are not searched: a different provider or different dimensions is a miss', async t => {
  for (const [name, active] of [
    ['another provider', { providerName: 'example:other', dimensions: 3 }],
    ['other dimensions', { providerName: 'example:index', dimensions: 4 }],
  ] as const) {
    const o: any = orchestrator({ scores: [0.9], notes: 'Invented amber note.' });
    o.embeddingStatusFn = () => active;
    const result = await o.processQuestion('How did you structure the billing service?');
    t.equal(result?.knowledgeMiss, true, `${name}: the old index is not used`);
    t.equal(result?.contextBlock, '');
  }
  const same: any = orchestrator({ scores: [0.9], notes: 'Invented amber note.' });
  same.embeddingStatusFn = () => ({ providerName: 'example:index', dimensions: 3 });
  t.match((await same.processQuestion('How did you structure the billing service?'))?.contextBlock, /passage 0/, 'the same model is searched');
});
