import t from 'tap';
import { InterviewPrepService } from '../../../electron/knowledge/InterviewPrepService';
import type { GenerateContentFn, JDData, ProfileData } from '../../../electron/knowledge/types';

const buildProfile = (): ProfileData => ({
  identity: {
    name: 'Avery Stone',
    email: 'avery@example.com',
  },
  skills: ['React', 'TypeScript', 'Node.js', 'GraphQL'],
  experience: [
    {
      company: 'Northstar Labs',
      role: 'Senior Frontend Engineer',
      startDate: '2022-01',
      endDate: 'Present',
      highlights: [
        'Built scalable React design systems for enterprise dashboards',
        'Improved GraphQL API integration quality across product teams',
        'Partnered with backend teams on authentication and platform migrations',
      ],
    },
  ],
  projects: [
    {
      name: 'Interview Copilot',
      description: 'Desktop interview assistant',
      technologies: ['Electron', 'React', 'TypeScript'],
      highlights: ['Shipped personalized interview prep and live prompts'],
    },
  ],
  education: [],
  totalExperienceYears: 6,
  experienceCount: 1,
  projectCount: 1,
  nodeCount: 6,
  rawText: 'resume text',
  hasActiveJD: true,
});

const buildJD = (): JDData => ({
  company: 'Pika',
  title: 'Staff Frontend Engineer',
  level: 'staff',
  requirements: ['React', 'TypeScript', 'system design', 'leadership'],
  technologies: ['GraphQL', 'Node.js'],
  keywords: ['customer empathy', 'cross-functional leadership'],
});

t.test('InterviewPrepService parses valid JSON and caches by profile + JD', async (t) => {
  let calls = 0;
  const generateContent: GenerateContentFn = async () => {
    calls += 1;
    return JSON.stringify({
      likelyQuestions: [
        {
          question: 'How do you lead frontend architecture decisions?',
          category: 'technical',
          difficulty: 2,
          relatedJDRequirement: 'system design',
          suggestedAnswer: {
            opening: 'I align architecture choices with product constraints.',
            keyPoints: ['Explain trade-offs', 'Bring evidence', 'Show alignment'],
            evidence: 'Led design system modernization at Northstar Labs',
          },
        },
      ],
      knowledgeGaps: [],
      mustMentionKeywords: ['customer empathy'],
      openingPitch: 'I build product-focused frontend systems.',
    });
  };

  const service = new InterviewPrepService(generateContent);
  const profile = buildProfile();
  const jd = buildJD();

  const first = await service.generatePrep(profile, jd);
  const second = await service.generatePrep(profile, jd);

  t.equal(calls, 1, 'uses cache for repeated requests');
  t.equal(first.matchScore, 75, 'injects analyzed match score into parsed response');
  t.same(second, first, 'returns cached prep payload');
});

t.test('InterviewPrepService falls back when model output is invalid', async (t) => {
  const service = new InterviewPrepService(async () => 'not valid json');
  const prep = await service.generatePrep(buildProfile(), buildJD());

  t.ok(prep.likelyQuestions.length >= 2, 'creates fallback questions');
  t.equal(prep.likelyQuestions[0].category, 'intro', 'starts with intro fallback question');
  t.ok(prep.likelyQuestions.some((question) => question.category === 'technical'), 'adds technical questions from JD requirements');
  t.same(
    prep.knowledgeGaps.map((gap) => gap.skill),
    ['leadership'],
    'only fully missing skills become knowledge gaps',
  );
  t.same(prep.mustMentionKeywords, ['customer empathy', 'cross-functional leadership']);
});

t.test('InterviewPrepService buildPrepPrompt includes profile, JD, and match sections', async (t) => {
  let capturedPrompt = '';
  const service = new InterviewPrepService(async (contents) => {
    capturedPrompt = contents[0]?.text || '';
    return 'not valid json';
  });

  await service.generatePrep(buildProfile(), buildJD());

  t.match(capturedPrompt, /## Candidate Profile/);
  t.match(capturedPrompt, /Avery Stone/);
  t.match(capturedPrompt, /## Target Position/);
  t.match(capturedPrompt, /Staff Frontend Engineer/);
  t.match(capturedPrompt, /## Skill Match Analysis/);
  t.match(capturedPrompt, /Matched skills: react, typescript, graphql, node\.js/i);
  t.match(capturedPrompt, /Weak\/partial matches: system design/i);
  t.match(capturedPrompt, /Missing skills: leadership/i);
});

t.test('InterviewPrepService clearCache forces regeneration', async (t) => {
  let calls = 0;
  const service = new InterviewPrepService(async () => {
    calls += 1;
    return JSON.stringify({
      likelyQuestions: [],
      knowledgeGaps: [],
      mustMentionKeywords: [],
      openingPitch: 'Pitch',
    });
  });

  const profile = buildProfile();
  const jd = buildJD();

  await service.generatePrep(profile, jd);
  service.clearCache();
  await service.generatePrep(profile, jd);

  t.equal(calls, 2, 'regenerates after cache clear');
});
