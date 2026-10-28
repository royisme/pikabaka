import t from 'tap';
import path from 'node:path';
import type { KnowledgeOrchestrator as Orchestrator } from '../../electron/knowledge/KnowledgeOrchestrator';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { DocType, type DocumentRow } from '../../electron/knowledge/types';

const { KnowledgeOrchestrator } = mockRequire(path.resolve('electron/knowledge/KnowledgeOrchestrator.ts'), {
  [path.resolve('electron/services/SettingsManager.ts')]: { getAnswerSources: () => ({ meetings: true, materials: true, profile: true }) },
}) as { KnowledgeOrchestrator: typeof Orchestrator };

const resume: DocumentRow = {
  id: 1, doc_type: DocType.RESUME, file_name: 'resume.pdf', raw_text: 'raw', created_at: '', updated_at: '', is_active: 0, label: null,
  parsed_data: JSON.stringify({
    identity: { name: 'Sam Example' }, skills: ['TypeScript'], experience: [{ company: 'Acme', role: 'Engineer', startDate: '2020-01', highlights: [] }],
    projects: [], education: [], totalExperienceYears: 4,
  }),
};

function orchestrator(options: { scores: number[]; notes?: string }) {
  const rows = new Map<string, DocumentRow>([[DocType.RESUME, resume]]);
  if (options.notes) rows.set(DocType.NOTES, { ...resume, id: 9, doc_type: DocType.NOTES, raw_text: options.notes, parsed_data: 'null' });
  const stubDb = { prepare: () => ({ run: () => ({}), all: () => [], get: () => undefined }), exec: () => {}, pragma: () => {} };
  const db: any = {
    getDb: () => stubDb,
    getDocumentByType: (docType: DocType) => rows.get(docType) ?? null,
    getActiveDocument: () => null,
    getNegotiationState: () => null,
    countDocumentsByType: () => 0,
    clearNegotiationState: () => {},
    deleteDocumentsByType: (docType: DocType) => { rows.delete(docType); },
    upsertDocument: (docType: DocType, fileName: string, rawText: string) => { rows.set(docType, { ...resume, id: 9, doc_type: docType, file_name: fileName, raw_text: rawText, parsed_data: 'null' }); return 9; },
    saveChunks: (_id: number, chunks: unknown[]) => chunks.map((_, i) => 900 + i),
  };
  const o: any = new KnowledgeOrchestrator(db);
  o.setKnowledgeMode(true);
  o.setEmbedQueryFn(async () => ({ embedding: [1, 0, 0], provider: 'example:index', dimensions: 3 }));
  o.vectorStore = {
    hasEmbeddings: () => true,
    searchSimilar: () => options.scores.map((score, i) => ({ id: i, text: `passage ${i}`, score, metadata: {}, docType: 'resume' })),
    clearEmbeddings: () => {},
    storeEmbeddings: async () => {},
  };
  return o as Orchestrator;
}

t.test('passages that are not about the question are dropped, and nothing is invented in their place', async (t) => {
  const result = await orchestrator({ scores: [0.12, 0.08] }).processQuestion('Tell me about the hardest outage you handled');
  t.equal(result?.knowledgeMiss, true);
  t.equal(result?.contextBlock, '');
  t.match(result?.systemPromptInjection, /senior practitioner/);
  t.match(result?.systemPromptInjection, /Do not invent a past/);
  t.notMatch(result?.systemPromptInjection, /Not in your notes/);
  t.notMatch(result?.systemPromptInjection, /square brackets/);
});

t.test('a passage that matches is used as background and is not a miss', async (t) => {
  const result = await orchestrator({ scores: [0.62, 0.1] }).processQuestion('How did you structure the billing service?');
  t.notOk(result?.knowledgeMiss);
  t.match(result?.contextBlock, /passage 0/);
  t.notMatch(result?.contextBlock, /passage 1/);
});

t.test('notes make the knowledge mode work without a resume, and saving empty notes removes them', async (t) => {
  const o = orchestrator({ scores: [] });
  t.equal(o.getNotes(), '');
  await o.setNotes('Led the billing migration: 40 services, no downtime.\n\nCut the close from 5 days to 2.');
  t.match(o.getNotes(), /billing migration/);
  t.equal(o.isKnowledgeMode(), true);
  await o.setNotes('   ');
  t.equal(o.getNotes(), '');
});
