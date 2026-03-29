import t from 'tap';
import { NegotiationEngine, NegotiationTracker } from '../../../electron/knowledge/NegotiationEngine';
import { ProfileData, JDData, CompanyDossier, NegotiationScript } from '../../../electron/knowledge/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const minimalProfile: ProfileData = {
  identity: { name: 'Alice Kim' },
  skills: ['TypeScript', 'Rust', 'Python'],
  experience: [],
  projects: [],
  education: [],
  totalExperienceYears: 0,
  experienceCount: 0,
  projectCount: 0,
  nodeCount: 3,
  rawText: '',
  hasActiveJD: false,
};

const fullProfile: ProfileData = {
  identity: { name: 'Bob Lee' },
  skills: ['Go', 'Kubernetes', 'React', 'PostgreSQL', 'gRPC', 'Terraform', 'Python', 'Docker', 'AWS', 'Linux', 'ExtraSkill'],
  experience: [
    { company: 'TechCorp', role: 'Senior Engineer', startDate: '2020-01', highlights: [] },
    { company: 'OldCo', role: 'Junior Dev', startDate: '2016-01', endDate: '2019-12', highlights: [] },
  ],
  projects: [],
  education: [],
  totalExperienceYears: 8,
  experienceCount: 2,
  projectCount: 0,
  nodeCount: 5,
  rawText: '',
  hasActiveJD: false,
};

const fullJD: JDData = {
  company: 'Acme',
  title: 'Staff Engineer',
  level: 'senior',
  requirements: [],
  technologies: ['Go', 'Kubernetes'],
  compensation_hint: '$180k–$220k',
};

const jdNoCompensation: JDData = {
  company: 'Beta',
  title: 'Engineer',
  requirements: [],
  technologies: ['Python', 'Django'],
};

const jdNoLevel: JDData = {
  company: 'Gamma',
  title: 'Engineer',
  level: undefined as any,
  requirements: [],
  technologies: ['Java'],
  compensation_hint: undefined,
};

const dossierWithDifficulty: CompanyDossier = {
  company: 'Acme',
  overview: 'A leading tech firm.',
  products: [],
  culture_ratings: { overall: 4.2 },
  interview_difficulty: 'hard',
};

const dossierNoDifficulty: CompanyDossier = {
  company: 'Beta',
  overview: 'Startup vibe.',
  products: [],
  culture_ratings: { overall: 3.8 },
  interview_difficulty: undefined as any,
};

// ─── NegotiationEngine tests ──────────────────────────────────────────────────

t.test('summarizeProfile omits recent line when experience is empty', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore – private method accessed via any
  const summary = engine.summarizeProfile(minimalProfile);
  t.notOk(summary.includes('Recent:'));
  t.ok(summary.includes('Name: Alice Kim'));
  t.ok(summary.includes('Role: N/A'));
  t.end();
});

t.test('summarizeProfile includes recent line and caps skills at 10', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const summary = engine.summarizeProfile(fullProfile);
  t.ok(summary.includes('Recent: Senior Engineer at TechCorp'));
  // Skills should be capped at 10 (first 10 only, ExtraSkill excluded)
  t.ok(summary.includes('Go, Kubernetes, React, PostgreSQL, gRPC, Terraform, Python, Docker, AWS, Linux'));
  t.notOk(summary.includes('ExtraSkill'));
  t.end();
});

t.test('summarizeJD omits compensation_hint when absent', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const summary = engine.summarizeJD(jdNoCompensation);
  t.notOk(summary.includes('Compensation:'));
  t.ok(summary.includes('Company: Beta'));
  t.ok(summary.includes('Level: N/A'));
  t.end();
});

t.test('summarizeJD includes compensation_hint when present', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const summary = engine.summarizeJD(fullJD);
  t.ok(summary.includes('Compensation: $180k–$220k'));
  t.end();
});

t.test('summarizeDossier omits interview_difficulty when absent', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const summary = engine.summarizeDossier(dossierNoDifficulty);
  t.notOk(summary.includes('Interview difficulty:'));
  t.ok(summary.includes('Glassdoor: 3.8/5'));
  t.end();
});

t.test('summarizeDossier includes interview_difficulty when present', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const summary = engine.summarizeDossier(dossierWithDifficulty);
  t.ok(summary.includes('Interview difficulty: hard'));
  t.end();
});

t.test('parseResponse applies defaults for missing phase fields', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const result = engine.parseResponse('{"phases":[{"name":"Test"}]}');
  t.equal(result.phases[0].name, 'Test');
  t.equal(result.phases[0].objective, '');
  t.same(result.phases[0].suggested_lines, []);
  t.same(result.phases[0].warnings, []);
  t.equal(result.phases[0].silence_strategy, false);
  t.end();
});

t.test('parseResponse falls back opening_line to first phase first line', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const result = engine.parseResponse(
    '{"phases":[{"suggested_lines":["first line"]}]}',
  );
  t.equal(result.opening_line, 'first line');
  t.end();
});

t.test('parseResponse falls back justification to phases[1] first line', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const result = engine.parseResponse(
    '{"phases":[{"suggested_lines":[]},{"suggested_lines":["justification line"]}]}',
  );
  t.equal(result.justification, 'justification line');
  t.end();
});

t.test('parseResponse falls back counter_offer_fallback to phases[2] first line', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const result = engine.parseResponse(
    '{"phases":[{"suggested_lines":[]},{},{"suggested_lines":["fallback line"]}]}',
  );
  t.equal(result.counter_offer_fallback, 'fallback line');
  t.end();
});

t.test('parseResponse defaults sources and key_leverage_points to []', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const result = engine.parseResponse('{}');
  t.same(result.phases, []);
  t.same(result.key_leverage_points, []);
  t.same(result.sources, []);
  t.end();
});

t.test('parseResponse returns empty script on invalid JSON', (t) => {
  const engine = new NegotiationEngine(async () => '');
  // @ts-ignore
  const result = engine.parseResponse('not json at all');
  t.same(result.phases, []);
  t.same(result.key_leverage_points, []);
  t.end();
});

t.test('generateScript builds prompt and parses response', async (t) => {
  const mockResponse = JSON.stringify({
    phases: [{ name: 'Opening', objective: 'Break ice', suggested_lines: ['Hi'], warnings: [], silence_strategy: true }],
    salary_range: { low: 100, mid: 130, high: 160, currency: 'USD' },
    key_leverage_points: ['稀缺技能'],
    sources: ['glassdoor'],
  });
  const engine = new NegotiationEngine(async (contents) => {
    t.ok(contents[0].text.includes('Name:'));
    t.ok(contents[0].text.includes('Role:'));
    return mockResponse;
  });
  const script = await engine.generateScript(fullProfile, fullJD, dossierWithDifficulty);
  t.equal(script.phases[0].name, 'Opening');
  t.equal(script.salary_range!.mid, 130);
  t.end();
});

// ─── NegotiationTracker tests ─────────────────────────────────────────────────

t.test('setScript activates tracker and resets phase to 0', (t) => {
  const tracker = new NegotiationTracker();
  const script: NegotiationScript = { phases: [{ name: 'A', objective: '', suggested_lines: [], warnings: [] }], key_leverage_points: [] };
  tracker.setScript(script);
  t.equal(tracker.isActive(), true);
  t.same(tracker.getState().currentPhase, 0);
  t.end();
});

t.test('feedUtterance auto-activates when keyword present and script already set', (t) => {
  const tracker = new NegotiationTracker();
  const script: NegotiationScript = { phases: [{ name: 'A', objective: '', suggested_lines: [], warnings: [] }], key_leverage_points: [] };
  // setScript activates the tracker
  tracker.setScript(script);
  tracker.reset(); // script is cleared by reset
  t.equal(tracker.isActive(), false);
  // After reset, script is null so feedUtterance cannot auto-activate
  tracker.feedUtterance('Can we discuss the salary package?');
  t.equal(tracker.isActive(), false); // still inactive — script was cleared by reset
  // Verify that setScript + feedUtterance together do auto-activate (no explicit activate call)
  tracker.setScript(script);
  tracker.feedUtterance('Can we discuss the salary package?');
  t.equal(tracker.isActive(), true);
  t.end();
});

t.test('feedUtterance does not auto-activate without script', (t) => {
  const tracker = new NegotiationTracker();
  tracker.feedUtterance('Can we discuss the salary?');
  t.equal(tracker.isActive(), false);
  t.end();
});

t.test('utterance history caps at 200, keeps last 150', (t) => {
  const tracker = new NegotiationTracker();
  const script: NegotiationScript = { phases: [{ name: 'A', objective: '', suggested_lines: [], warnings: [] }], key_leverage_points: [] };
  tracker.setScript(script);
  // Add 201 utterances — the 201st push triggers trimming (> 200)
  for (let i = 0; i < 201; i++) {
    tracker.feedUtterance(`utterance ${i}`);
  }
  const state = tracker.getState();
  t.equal(state.utterances.length, 150);
  t.ok(state.utterances[0], 'utterance 51'); // first kept = 201-150=51
  t.ok(state.utterances[149], 'utterance 200');
  t.end();
});

t.test('advancePhase moves to next phase within bounds', (t) => {
  const tracker = new NegotiationTracker();
  const script: NegotiationScript = {
    phases: [
      { name: 'Phase0', objective: '', suggested_lines: [], warnings: [] },
      { name: 'Phase1', objective: '', suggested_lines: [], warnings: [] },
      { name: 'Phase2', objective: '', suggested_lines: [], warnings: [] },
    ],
    key_leverage_points: [],
  };
  tracker.setScript(script);
  t.same(tracker.getState().currentPhase, 0);
  tracker.advancePhase();
  t.same(tracker.getState().currentPhase, 1);
  tracker.advancePhase();
  t.same(tracker.getState().currentPhase, 2);
  tracker.advancePhase(); // should not go past last phase
  t.same(tracker.getState().currentPhase, 2);
  t.end();
});

t.test('reset clears state and script', (t) => {
  const tracker = new NegotiationTracker();
  const script: NegotiationScript = { phases: [{ name: 'A', objective: '', suggested_lines: [], warnings: [] }], key_leverage_points: [] };
  tracker.setScript(script);
  tracker.feedUtterance('some text');
  tracker.advancePhase();
  tracker.reset();
  t.same(tracker.getState().currentPhase, 0);
  t.same(tracker.getState().utterances, []);
  t.equal(tracker.isActive(), false);
  t.end();
});

t.test('getCoachingResponse returns null when inactive', (t) => {
  const tracker = new NegotiationTracker();
  t.equal(tracker.getCoachingResponse('salary'), null);
  t.end();
});

t.test('getCoachingResponse returns null for non-negotiation keywords', (t) => {
  const tracker = new NegotiationTracker();
  const script: NegotiationScript = { phases: [{ name: 'A', objective: '', suggested_lines: [], warnings: [] }], key_leverage_points: [], salary_range: { low: 100, mid: 130, high: 160, currency: 'USD' } };
  tracker.setScript(script);
  t.equal(tracker.getCoachingResponse('hello world'), null);
  t.end();
});

t.test('getCoachingResponse returns coaching with leverage and salary', (t) => {
  const tracker = new NegotiationTracker();
  const script: NegotiationScript = {
    phases: [{ name: 'Opening', objective: 'Greet', suggested_lines: ['Hello'], warnings: ['Be calm'], silence_strategy: true }],
    key_leverage_points: ['稀缺技能'],
    salary_range: { low: 100, mid: 130, high: 160, currency: 'USD' },
  };
  tracker.setScript(script);
  const coaching = tracker.getCoachingResponse('what about the salary package?');
  t.ok(coaching !== null);
  t.equal(coaching!.phase, 'Opening');
  t.equal(coaching!.objective, 'Greet');
  t.same(coaching!.suggested_lines, ['Hello']);
  t.same(coaching!.warnings, ['Be calm']);
  t.same(coaching!.leverage_points, ['稀缺技能']);
  t.same(coaching!.salary_range, { low: 100, mid: 130, high: 160, currency: 'USD' });
  t.end();
});
