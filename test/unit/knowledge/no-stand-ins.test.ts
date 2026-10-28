import t from 'tap';
import { InterviewPrepService } from '../../../electron/knowledge/InterviewPrepService';
import { CompanyResearchEngine } from '../../../electron/knowledge/CompanyResearchEngine';
import type { CompanyDossier, JDData, KnowledgeDatabaseManager, ProfileData } from '../../../electron/knowledge/types';

const profile: ProfileData = {
  identity: { name: 'Riley Vale', email: 'riley@example.com' },
  skills: ['TypeScript', 'SQL'],
  experience: [{ company: 'Northwind Studio', role: 'Engineer', startDate: '2021-01', endDate: 'Present', highlights: ['Built an invented dashboard'] }],
  projects: [], education: [], totalExperienceYears: 5, experienceCount: 1, projectCount: 0, nodeCount: 2,
  rawText: 'Invented profile text', hasActiveJD: true,
};

const jd: JDData = {
  company: 'Cobalt Analytics', title: 'Platform Engineer', level: 'senior',
  requirements: ['TypeScript', 'distributed systems'], technologies: ['SQL'], keywords: ['reliability'],
};

function database() {
  const dossiers: CompanyDossier[] = [];
  return {
    dossiers,
    getCachedDossier: () => null,
    cacheCompanyDossier: (_company: string, dossier: CompanyDossier) => { dossiers.push(dossier); },
  } as unknown as KnowledgeDatabaseManager & { dossiers: CompanyDossier[] };
}

t.test('Interview prep returns the real failure instead of template questions', async t => {
  const service = new InterviewPrepService(async () => 'this is not prep JSON');
  await t.rejects(service.generatePrep(profile, jd), { message: 'The model did not return valid interview prep JSON.' });
});

t.test('Interview prep passes a model failure through unchanged', async t => {
  const service = new InterviewPrepService(async () => { throw new Error('Invented model unavailable'); });
  await t.rejects(service.generatePrep(profile, jd), { message: 'Invented model unavailable' });
});

t.test('Company research is not generated without search results', async t => {
  let modelCalls = 0;
  const db = database();
  const engine = new CompanyResearchEngine(async () => { modelCalls += 1; return '{}'; }, db);
  engine.setApiKey(null);
  await t.rejects(engine.researchCompany('Cobalt Analytics'), { message: 'Company research is not available: No search key is saved.' });
  t.equal(modelCalls, 0, 'the model is not asked to invent a dossier from its own knowledge');
  t.same(db.dossiers, [], 'nothing is cached');
});

t.test('Company research returns the real parse failure instead of a stand-in dossier', async t => {
  const db = database();
  const engine = new CompanyResearchEngine(async () => 'not a dossier', db);
  engine.setSearchProvider({ search: async () => [{ title: 'Invented result', content: 'Invented overview' }] });
  await t.rejects(engine.researchCompany('Cobalt Analytics'), { message: 'Failed to parse LLM response as JSON' });
  t.same(db.dossiers, [], 'no dossier with a made-up rating is cached');
});

t.test('a dossier without a culture rating keeps it unknown instead of reporting 3', async t => {
  const db = database();
  const engine = new CompanyResearchEngine(async () => JSON.stringify({
    company: 'Cobalt Analytics', overview: 'Invented overview', products: [],
    culture_ratings: { data_sources: ['Invented source'] },
  }), db);
  engine.setSearchProvider({ search: async () => [{ title: 'Invented result' }] });
  const dossier = await engine.researchCompany('Cobalt Analytics');
  t.equal(dossier.culture_ratings.overall, undefined, 'no rating was computed, so none is shown');
  t.same(db.dossiers.length, 1);
});
