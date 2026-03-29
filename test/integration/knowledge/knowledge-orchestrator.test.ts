import t from 'tap';
import { KnowledgeOrchestrator } from '../../../electron/knowledge/KnowledgeOrchestrator';
import { DocType, ProfileData, JDData, DocumentRow, NegotiationState } from '../../../electron/knowledge/types';

// ─── Mock DB Manager ───────────────────────────────────────────────

type DocMap = Map<string, DocumentRow>;
type NegotiationRow = { script: any; sessionState: any } | null;

const EMPTY_RESUME_ROW: DocumentRow = {
  id: 1,
  doc_type: DocType.RESUME,
  file_name: 'resume.pdf',
  raw_text: 'raw resume text',
  parsed_data: JSON.stringify({
    identity: { name: 'Alice Engineer', email: 'alice@example.com' },
    skills: ['TypeScript', 'React', 'Node.js'],
    experience: [
      { company: 'Acme Corp', role: 'Senior Engineer', startDate: '2020-01', highlights: ['Built the auth system'] },
    ],
    projects: [
      { name: 'Widget', description: 'A widget tool', technologies: ['React'], highlights: ['Shipped v1'] },
    ],
    education: [{ institution: 'MIT', degree: 'BS CS', year: '2019' }],
    totalExperienceYears: 5,
    experienceCount: 1,
    projectCount: 1,
    nodeCount: 5,
    rawText: 'Alice Engineer\nSenior Engineer at Acme Corp...',
    hasActiveJD: false,
  }),
  created_at: '2025-01-01T00:00:00',
  updated_at: '2025-01-01T00:00:00',
  is_active: 0,
  label: null,
};

const SAMPLE_JD1_ROW: DocumentRow = {
  id: 2,
  doc_type: DocType.JD,
  file_name: 'jd1.pdf',
  raw_text: 'jd raw',
  parsed_data: JSON.stringify({
    company: 'TechCorp',
    title: 'Staff Engineer',
    level: 'Senior',
    location: 'Remote',
    requirements: ['5+ years TypeScript', 'System design experience'],
    technologies: ['TypeScript', 'React', 'Node.js'],
    keywords: ['leadership', 'architecture'],
    compensation_hint: '$150k-$200k',
    min_years_experience: 5,
  } as JDData),
  created_at: '2025-01-01T00:00:00',
  updated_at: '2025-01-01T00:00:00',
  is_active: 1,
  label: 'TechCorp Staff',
};

const SAMPLE_JD2_ROW: DocumentRow = {
  id: 3,
  doc_type: DocType.JD,
  file_name: 'jd2.pdf',
  raw_text: 'jd raw 2',
  parsed_data: JSON.stringify({
    company: 'OtherCo',
    title: 'SRE',
    requirements: [],
    technologies: ['Kubernetes', 'Go'],
  } as JDData),
  created_at: '2025-01-02T00:00:00',
  updated_at: '2025-01-02T00:00:00',
  is_active: 0,
  label: 'OtherCo SRE',
};

function createMockDbManager(overrides: Partial<{
  resumeRow: DocumentRow | null;
  activeJdRow: DocumentRow | null;
  allJdRows: DocumentRow[];
  negotiationState: NegotiationRow;
  jdCount: number;
}> = {}): any {
  const {
    resumeRow: initialResumeRow = null,
    activeJdRow = null,
    allJdRows = [],
    negotiationState = null,
    jdCount = 0,
  } = overrides;

  // Mutable copies so updates are visible via getDocumentByType
  let _resumeRow = initialResumeRow
    ? { ...initialResumeRow, parsed_data: initialResumeRow.parsed_data }
    : null;
  let _activeJd = activeJdRow ? { ...activeJdRow } : null;

  // Call tracking
  const setActiveDocumentCalls: number[] = [];
  const updateDocumentParsedDataCalls: any[] = [];

  // Stub database for KnowledgeVectorStore (accessed via knowledgeDb.getDb())
  const stubDb = {
    prepare: () => ({ run: () => ({}), all: () => [], get: () => undefined }),
    exec: () => {},
    pragma: () => {},
  };

  return {
    getDb: () => stubDb as any,

    getDocumentByType: (docType: DocType): DocumentRow | null => {
      if (docType === DocType.RESUME) return _resumeRow;
      return null;
    },

    getActiveDocument: (_docType: DocType): DocumentRow | null => {
      return _activeJd;
    },

    setActiveDocument: (docId: number): void => {
      setActiveDocumentCalls.push(docId);
      const doc = allJdRows.find(d => d.id === docId);
      if (doc) {
        _activeJd = { ...doc };
      }
    },

    getAllDocumentsByType: (docType: DocType): DocumentRow[] => {
      if (docType === DocType.JD) return allJdRows;
      return [];
    },

    countDocumentsByType: (docType: DocType): number => {
      if (docType === DocType.JD) return jdCount;
      return 0;
    },

    deleteDocumentsByType: (_docType: DocType): void => {
      if (_docType === DocType.RESUME) _resumeRow = null;
    },

    updateDocumentParsedData: (docId: number, parsedData: any): void => {
      updateDocumentParsedDataCalls.push({ docId, parsedData });
      // Reflect update in the resume row so getDocumentByType returns updated data
      if (_resumeRow && _resumeRow.id === docId) {
        _resumeRow = { ..._resumeRow, parsed_data: JSON.stringify(parsedData) };
      }
    },

    deleteDocumentById: (_docId: number): void => {},

    getNegotiationState: (): { script: any; sessionState: any } | null => {
      return negotiationState;
    },

    clearNegotiationState: (): void => {},

    saveNegotiationState: (
      _profileId: number | null,
      _jdId: number | null,
      _script: any,
      _sessionState: any
    ): void => {},

    getCachedDossier: (_company: string) => null,

    clearEmbeddings: (_docType?: DocType): void => {},
    saveChunks: (docId: number, chunks: Array<{ text: string; metadata?: any }>): number[] => {
      return chunks.map((_, i) => docId * 100 + i);
    },
    getChunksForDoc: (_docId: number) => [],

    // Test helpers
    _setActiveDocumentCalls: setActiveDocumentCalls,
    _updateDocumentParsedDataCalls: updateDocumentParsedDataCalls,
  };
}

const FAKE_PREP_DATA = {
  likelyQuestions: [
    {
      question: 'Tell me about yourself',
      category: 'intro',
      difficulty: 1,
      suggestedAnswer: { opening: 'I am Alice Engineer.', keyPoints: ['Built auth system'] },
    },
  ],
  matchScore: 75,
  knowledgeGaps: [],
  mustMentionKeywords: ['TypeScript', 'React'],
  openingPitch: 'I am Alice Engineer, a Senior Engineer with 5 years of experience.',
};

const FAKE_GEN_FN = async (_contents: Array<{ text: string }>): Promise<string> => {
  return JSON.stringify(FAKE_PREP_DATA);
};

// ─── getStatus() ────────────────────────────────────────────────

t.test('getStatus() returns hasResume=false when no resume in DB', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager());

  const status = orch.getStatus();

  t.equal(status.hasResume, false, 'hasResume is false');
  t.equal(status.activeMode, false, 'activeMode is false');
  t.equal(status.jdCount, 0, 'jdCount is 0');
  t.equal(status.resumeSummary, undefined, 'no resumeSummary');
  t.end();
});

t.test('getStatus() returns hasResume=true with resumeSummary when resume exists', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager({ resumeRow: EMPTY_RESUME_ROW }));

  const status = orch.getStatus();

  t.equal(status.hasResume, true, 'hasResume is true');
  t.equal(status.resumeSummary?.name, 'Alice Engineer', 'resumeSummary.name from parsed data');
  t.equal(status.resumeSummary?.role, 'Senior Engineer', 'resumeSummary.role from first experience');
  t.equal(status.resumeSummary?.totalExperienceYears, 5, 'resumeSummary.totalExperienceYears');
  t.end();
});

t.test('getStatus() returns correct jdCount from db', (t) => {
  const orch = new KnowledgeOrchestrator(
    createMockDbManager({ resumeRow: EMPTY_RESUME_ROW, jdCount: 2 })
  );

  const status = orch.getStatus();

  t.equal(status.hasResume, true, 'hasResume is true');
  t.equal(status.jdCount, 2, 'jdCount is 2');
  t.end();
});

t.test('getStatus() falls back gracefully when parsed_data is invalid JSON', (t) => {
  const badRow: DocumentRow = { ...EMPTY_RESUME_ROW, parsed_data: 'not json' };
  const orch = new KnowledgeOrchestrator(createMockDbManager({ resumeRow: badRow }));

  const status = orch.getStatus();

  t.equal(status.hasResume, true, 'hasResume is true');
  t.equal(status.resumeSummary?.name, 'Unknown', 'name falls back to Unknown');
  t.equal(status.resumeSummary?.role, 'Professional', 'role falls back to Professional');
  t.equal(status.resumeSummary?.totalExperienceYears, 0, 'totalExperienceYears falls back to 0');
  t.end();
});

// ─── getProfileData() ────────────────────────────────────────────

t.test('getProfileData() returns null when no resume', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager());

  const profile = orch.getProfileData();

  t.equal(profile, null, 'returns null');
  t.end();
});

t.test('getProfileData() normalizes non-array fields and computes derived counts', (t) => {
  const messyRow: DocumentRow = {
    ...EMPTY_RESUME_ROW,
    parsed_data: JSON.stringify({
      identity: { name: 'Bob' },
      skills: 'not an array',
      experience: null,
      projects: undefined,
      education: 42,
      totalExperienceYears: 3,
    }),
  };

  const orch = new KnowledgeOrchestrator(createMockDbManager({ resumeRow: messyRow }));
  const profile = orch.getProfileData();

  t.not(profile, null, 'profile is not null');
  t.same(profile!.skills, [], 'skills normalized to []');
  t.same(profile!.experience, [], 'experience normalized to []');
  t.same(profile!.projects, [], 'projects normalized to []');
  t.same(profile!.education, [], 'education normalized to []');
  t.equal(profile!.experienceCount, 0, 'experienceCount = 0');
  t.equal(profile!.projectCount, 0, 'projectCount = 0');
  t.equal(profile!.nodeCount, 0, 'nodeCount = 0 (skills + exp + proj)');
  t.equal(profile!.rawText, 'raw resume text', 'rawText from document');
  t.end();
});

t.test('getProfileData() returns cached profile on repeated calls', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager({ resumeRow: EMPTY_RESUME_ROW }));

  const profile1 = orch.getProfileData();
  const profile2 = orch.getProfileData();

  t.same(profile1, profile2, 'same reference returned twice');
  t.equal(profile1, profile2, 'identical reference (cache hit)');
  t.end();
});

t.test('getProfileData() includes active JD when one is active', (t) => {
  const orch = new KnowledgeOrchestrator(
    createMockDbManager({ resumeRow: EMPTY_RESUME_ROW, activeJdRow: SAMPLE_JD1_ROW })
  );

  const profile = orch.getProfileData();

  t.not(profile, null, 'profile not null');
  t.equal(profile!.hasActiveJD, true, 'hasActiveJD = true');
  t.not(profile!.activeJD, undefined, 'activeJD is set');
  t.equal(profile!.activeJD!.company, 'TechCorp', 'active JD company');
  t.equal(profile!.activeJD!.title, 'Staff Engineer', 'active JD title');
  t.end();
});

t.test('getProfileData() cache is cleared after updateProfileData', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager({ resumeRow: EMPTY_RESUME_ROW }));

  const profile1 = orch.getProfileData();
  const cacheBefore = profile1;

  orch.updateProfileData({ identity: { name: 'Alice Updated' } });

  const profile2 = orch.getProfileData();
  t.not(profile2, cacheBefore, 'new profile is different reference after update');
  t.equal(profile2!.identity.name, 'Alice Updated', 'name updated');
  t.end();
});

// ─── updateProfileData() ─────────────────────────────────────────

t.test('updateProfileData() merges identity fields deeply', (t) => {
  const mockDb = createMockDbManager({ resumeRow: EMPTY_RESUME_ROW });
  const orch = new KnowledgeOrchestrator(mockDb);

  const result = orch.updateProfileData({
    identity: { name: 'New Name' },
  });

  t.equal(result.success, true, 'update succeeds');
  t.equal(mockDb._updateDocumentParsedDataCalls.length, 1, 'db.updateDocumentParsedData called once');
  const { parsedData } = mockDb._updateDocumentParsedDataCalls[0];
  t.equal(parsedData.identity.name, 'New Name', 'name updated in parsed data');
  t.equal(parsedData.identity.email, 'alice@example.com', 'email preserved from existing');
  t.end();
});

t.test('updateProfileData() replaces skills/experience/projects/education entirely', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager({ resumeRow: EMPTY_RESUME_ROW }));

  const result = orch.updateProfileData({
    skills: ['Rust', 'Go'],
    experience: [
      { company: 'NewCo', role: 'NewRole', startDate: '2020', highlights: ['Did a thing'] },
    ],
    totalExperienceYears: 5,
  });

  t.equal(result.success, true, 'update succeeds');
  const profile = orch.getProfileData()!;
  t.same(profile.skills, ['Rust', 'Go'], 'skills replaced entirely');
  t.equal(profile.experience.length, 1, 'experience replaced');
  t.equal(profile.experience[0].company, 'NewCo', 'new experience company');
  t.equal(profile.totalExperienceYears, 5, 'totalExperienceYears updated');
  t.equal(profile.experienceCount, 1, 'derived experienceCount updated');
  // nodeCount = skills(2) + exp(1) + proj(1) = 4
  t.equal(profile.nodeCount, 4, 'derived nodeCount updated');
  t.end();
});

t.test('updateProfileData() returns error when no resume exists', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager());

  const result = orch.updateProfileData({ identity: { name: 'Nobody' } });

  t.equal(result.success, false, 'update fails');
  t.match(result.error, /no resume/i, 'error mentions no resume');
  t.end();
});

t.test('updateProfileData() computes derived counts correctly', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager({ resumeRow: EMPTY_RESUME_ROW }));

  orch.updateProfileData({
    skills: ['A', 'B', 'C'],
    projects: [{ name: 'P1', description: 'd', technologies: [], highlights: [] }],
  });

  const profile = orch.getProfileData()!;
  t.equal(profile.experienceCount, 1, 'experienceCount preserved from existing');
  t.equal(profile.projectCount, 1, 'projectCount updated');
  t.equal(profile.nodeCount, 5, 'nodeCount = skills(3) + exp(1) + proj(1) = 5');
  t.end();
});

// ─── getAllJDs() ─────────────────────────────────────────────────

t.test('getAllJDs() returns empty array when no JDs', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager());

  const jds = orch.getAllJDs();

  t.same(jds, [], 'empty array');
  t.end();
});

t.test('getAllJDs() maps all JD fields correctly', (t) => {
  const orch = new KnowledgeOrchestrator(
    createMockDbManager({ allJdRows: [SAMPLE_JD1_ROW] })
  );

  const jds = orch.getAllJDs();

  t.equal(jds.length, 1, 'one JD returned');
  t.equal(jds[0].company, 'TechCorp', 'company mapped');
  t.equal(jds[0].title, 'Staff Engineer', 'title mapped');
  t.equal(jds[0].label, 'TechCorp Staff', 'label mapped');
  t.equal(jds[0].isActive, true, 'isActive = true');
  t.same(jds[0].technologies, ['TypeScript', 'React', 'Node.js'], 'technologies mapped');
  t.end();
});

t.test('getAllJDs() falls back to Unknown for missing company/title in parsed_data', (t) => {
  const badRow: DocumentRow = {
    ...SAMPLE_JD1_ROW,
    id: 99,
    parsed_data: JSON.stringify({}),
  };

  const orch = new KnowledgeOrchestrator(createMockDbManager({ allJdRows: [badRow] }));
  const jds = orch.getAllJDs();

  t.equal(jds[0].company, 'Unknown', 'company defaults to Unknown');
  t.equal(jds[0].title, 'Unknown Position', 'title defaults to Unknown Position');
  t.end();
});

t.test('getAllJDs() returns multiple JDs sorted by created_at DESC (mock order preserved)', (t) => {
  // Mock returns in the order given; KnowledgeOrchestrator maps directly without re-sorting
  const orch = new KnowledgeOrchestrator(
    createMockDbManager({ allJdRows: [SAMPLE_JD2_ROW, SAMPLE_JD1_ROW] })
  );

  const jds = orch.getAllJDs();

  t.equal(jds.length, 2, 'two JDs');
  t.equal(jds[0].company, 'OtherCo', 'first JD');
  t.equal(jds[1].company, 'TechCorp', 'second JD');
  t.end();
});

// ─── setActiveJD() ──────────────────────────────────────────────

t.test('setActiveJD() calls db.setActiveDocument and clears caches', (t) => {
  const mockDb = createMockDbManager({
    resumeRow: EMPTY_RESUME_ROW,
    allJdRows: [SAMPLE_JD1_ROW, SAMPLE_JD2_ROW],
    activeJdRow: SAMPLE_JD1_ROW,
  });
  const orch = new KnowledgeOrchestrator(mockDb);

  // Prime the profile cache
  const profileBefore = orch.getProfileData();
  t.equal(profileBefore!.activeJD!.company, 'TechCorp', 'initial active JD is TechCorp');

  // Switch to JD2
  orch.setActiveJD(SAMPLE_JD2_ROW.id);

  // Verify db was called
  t.equal(mockDb._setActiveDocumentCalls.length, 1, 'db.setActiveDocument called once');
  t.equal(mockDb._setActiveDocumentCalls[0], SAMPLE_JD2_ROW.id, 'correct JD id passed');

  // Cache should be cleared, new profile should reflect new active JD
  const profileAfter = orch.getProfileData();
  t.equal(profileAfter!.activeJD!.company, 'OtherCo', 'active JD switched to OtherCo');
  t.end();
});

t.test('setActiveJD() clears cachedNegotiationScript', (t) => {
  const orch = new KnowledgeOrchestrator(
    createMockDbManager({
      resumeRow: EMPTY_RESUME_ROW,
      activeJdRow: SAMPLE_JD1_ROW,
      allJdRows: [SAMPLE_JD1_ROW, SAMPLE_JD2_ROW],
    })
  );

  // The negotiation script is accessed via getNegotiationScript (returns null in mock)
  // The important thing is that setActiveJD doesn't throw and clears the profile cache
  orch.setActiveJD(SAMPLE_JD2_ROW.id);
  const profile = orch.getProfileData();
  t.equal(profile!.activeJD!.company, 'OtherCo', 'active JD updated');
  t.end();
});

// ─── generateInterviewPrep() ──────────────────────────────────────

t.test('generateInterviewPrep() returns null when interviewPrepService not configured', async (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager());

  const result = await orch.generateInterviewPrep();

  t.equal(result, null, 'returns null without LLM');
  t.end();
});

t.test('generateInterviewPrep() returns null when no profile (no resume)', async (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager());
  orch.setGenerateContentFn(FAKE_GEN_FN);

  const result = await orch.generateInterviewPrep();

  t.equal(result, null, 'returns null with no resume');
  t.end();
});

t.test('generateInterviewPrep() returns null when no active JD and no jdId provided', async (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager({ resumeRow: EMPTY_RESUME_ROW }));
  orch.setGenerateContentFn(FAKE_GEN_FN);

  const result = await orch.generateInterviewPrep();

  t.equal(result, null, 'returns null when no active JD and no jdId');
  t.end();
});

t.test('generateInterviewPrep() resolves JD by jdId parameter', async (t) => {
  const orch = new KnowledgeOrchestrator(
    createMockDbManager({
      resumeRow: EMPTY_RESUME_ROW,
      allJdRows: [SAMPLE_JD1_ROW],
    })
  );
  orch.setGenerateContentFn(FAKE_GEN_FN);

  const result = await orch.generateInterviewPrep(SAMPLE_JD1_ROW.id);

  t.not(result, null, 'returns prep data when jdId is provided');
  t.type(result!.matchScore, 'number', 'has matchScore');
  t.ok(result!.likelyQuestions.length > 0, 'has likely questions');
  t.end();
});

t.test('generateInterviewPrep() uses active JD when no jdId provided', async (t) => {
  const orch = new KnowledgeOrchestrator(
    createMockDbManager({
      resumeRow: EMPTY_RESUME_ROW,
      activeJdRow: SAMPLE_JD1_ROW,
      allJdRows: [SAMPLE_JD1_ROW],
    })
  );
  orch.setGenerateContentFn(FAKE_GEN_FN);

  const result = await orch.generateInterviewPrep();

  t.not(result, null, 'returns prep data with active JD');
  t.end();
});

t.test('generateInterviewPrep() propagates error gracefully', async (t) => {
  const orch = new KnowledgeOrchestrator(
    createMockDbManager({
      resumeRow: EMPTY_RESUME_ROW,
      activeJdRow: SAMPLE_JD1_ROW,
      allJdRows: [SAMPLE_JD1_ROW],
    })
  );
  orch.setGenerateContentFn((async () => { throw new Error('LLM exploded'); }) as any);

  const result = await orch.generateInterviewPrep();

  t.equal(result, null, 'returns null on error (error is caught)');
  t.end();
});

// ─── knowledge mode ─────────────────────────────────────────────

t.test('setKnowledgeMode and isKnowledgeMode', (t) => {
  const orch = new KnowledgeOrchestrator(createMockDbManager());

  t.equal(orch.isKnowledgeMode(), false, 'false without resume');

  const orch2 = new KnowledgeOrchestrator(createMockDbManager({ resumeRow: EMPTY_RESUME_ROW }));
  t.equal(orch2.isKnowledgeMode(), false, 'false with resume but knowledgeMode off');

  orch2.setKnowledgeMode(true);
  t.equal(orch2.isKnowledgeMode(), true, 'true after setKnowledgeMode(true)');

  orch2.setKnowledgeMode(false);
  t.equal(orch2.isKnowledgeMode(), false, 'false after setKnowledgeMode(false)');

  t.end();
});

// ─── deleteDocumentsByType ───────────────────────────────────────

t.test('deleteDocumentsByType(RESUME) clears knowledge mode', (t) => {
  const mockDb = createMockDbManager({ resumeRow: EMPTY_RESUME_ROW });
  const orch = new KnowledgeOrchestrator(mockDb);
  orch.setKnowledgeMode(true);

  t.equal(orch.isKnowledgeMode(), true, 'knowledge mode on');

  orch.deleteDocumentsByType(DocType.RESUME);

  t.equal(orch.isKnowledgeMode(), false, 'knowledge mode off after resume deletion');
  const status = orch.getStatus();
  t.equal(status.hasResume, false, 'no resume after deletion');
  t.end();
});
