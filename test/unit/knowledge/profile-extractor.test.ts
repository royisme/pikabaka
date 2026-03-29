import t from 'tap';
import { ProfileExtractor } from '../../../electron/knowledge/ProfileExtractor';
import { GenerateContentFn } from '../../../electron/knowledge/types';

// Helper to create a ProfileExtractor with a mock generateContentFn
function makeExtractor(mockFn: GenerateContentFn): ProfileExtractor {
  return new ProfileExtractor(mockFn);
}

t.test('ProfileExtractor.parseResponse applies identity defaults', async (t) => {
  const extractor = makeExtractor(async () => '{"identity":{}}');
  const result = await extractor.extract('raw text');

  t.equal(result.identity.name, 'Unknown', 'name defaults to Unknown');
  t.equal(result.identity.email, undefined, 'email is undefined when missing');
  t.equal(result.identity.phone, undefined, 'phone is undefined when missing');
  t.equal(result.identity.location, undefined, 'location is undefined when missing');
  t.equal(result.identity.linkedin, undefined, 'linkedin is undefined when missing');
  t.equal(result.identity.github, undefined, 'github is undefined when missing');
  t.end();
});

t.test('ProfileExtractor.parseResponse preserves provided identity fields', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({
      identity: {
        name: 'Alice Chen',
        email: 'alice@example.com',
        phone: '555-1234',
        location: 'San Francisco',
        linkedin: 'linkedin.com/in/alice',
        github: 'github.com/alice',
      },
    }),
  );
  const result = await extractor.extract('raw text');

  t.equal(result.identity.name, 'Alice Chen');
  t.equal(result.identity.email, 'alice@example.com');
  t.equal(result.identity.phone, '555-1234');
  t.equal(result.identity.location, 'San Francisco');
  t.equal(result.identity.linkedin, 'linkedin.com/in/alice');
  t.equal(result.identity.github, 'github.com/alice');
  t.end();
});

t.test('ProfileExtractor.parseResponse normalizes skills to array', async (t) => {
  const extractor = makeExtractor(async () => '{"skills":"not-an-array"}');
  const result = await extractor.extract('raw text');
  t.same(result.skills, [], 'skills defaults to empty array when not array');
  t.end();
});

t.test('ProfileExtractor.parseResponse keeps skills array when valid', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({ skills: ['TypeScript', 'React', 'Node.js'] }),
  );
  const result = await extractor.extract('raw text');
  t.same(result.skills, ['TypeScript', 'React', 'Node.js']);
  t.end();
});

t.test('ProfileExtractor.parseResponse applies experience defaults', async (t) => {
  const extractor = makeExtractor(async () => '{"experience":[{}]}');
  const result = await extractor.extract('raw text');

  t.equal(result.experience.length, 1);
  t.equal(result.experience[0].company, 'Unknown', 'company defaults to Unknown');
  t.equal(result.experience[0].role, 'Unknown', 'role defaults to Unknown');
  t.equal(result.experience[0].startDate, '', 'startDate defaults to empty string');
  t.equal(result.experience[0].endDate, undefined, 'endDate defaults to undefined');
  t.same(result.experience[0].highlights, [], 'highlights normalizes to empty array');
  t.end();
});

t.test('ProfileExtractor.parseResponse preserves provided experience fields', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({
      experience: [
        {
          company: 'Google',
          role: 'Senior Engineer',
          startDate: '2020-01',
          endDate: '2023-06',
          highlights: ['Led team of 5', 'Improved latency by 40%'],
        },
      ],
    }),
  );
  const result = await extractor.extract('raw text');

  t.equal(result.experience[0].company, 'Google');
  t.equal(result.experience[0].role, 'Senior Engineer');
  t.equal(result.experience[0].startDate, '2020-01');
  t.equal(result.experience[0].endDate, '2023-06');
  t.same(result.experience[0].highlights, ['Led team of 5', 'Improved latency by 40%']);
  t.end();
});

t.test('ProfileExtractor.parseResponse normalizes highlights to array', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({
      experience: [{ company: 'Acme', role: 'Dev', highlights: 'not-an-array' }],
    }),
  );
  const result = await extractor.extract('raw text');
  t.same(result.experience[0].highlights, [], 'highlights normalizes to empty array when not array');
  t.end();
});

t.test('ProfileExtractor.parseResponse applies project defaults', async (t) => {
  const extractor = makeExtractor(async () => '{"projects":[{}]}');
  const result = await extractor.extract('raw text');

  t.equal(result.projects.length, 1);
  t.equal(result.projects[0].name, 'Unknown', 'name defaults to Unknown');
  t.equal(result.projects[0].description, '', 'description defaults to empty string');
  t.same(result.projects[0].technologies, [], 'technologies normalizes to empty array');
  t.same(result.projects[0].highlights, [], 'highlights normalizes to empty array');
  t.end();
});

t.test('ProfileExtractor.parseResponse preserves provided project fields', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({
      projects: [
        {
          name: 'AI Dashboard',
          description: 'Real-time analytics dashboard',
          technologies: ['React', 'D3.js'],
          highlights: ['Reduced load time by 60%'],
        },
      ],
    }),
  );
  const result = await extractor.extract('raw text');

  t.equal(result.projects[0].name, 'AI Dashboard');
  t.equal(result.projects[0].description, 'Real-time analytics dashboard');
  t.same(result.projects[0].technologies, ['React', 'D3.js']);
  t.same(result.projects[0].highlights, ['Reduced load time by 60%']);
  t.end();
});

t.test('ProfileExtractor.parseResponse normalizes project technologies to array', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({
      projects: [{ name: 'Test', technologies: 'not-an-array' }],
    }),
  );
  const result = await extractor.extract('raw text');
  t.same(result.projects[0].technologies, [], 'technologies normalizes to empty array when not array');
  t.end();
});

t.test('ProfileExtractor.parseResponse applies education defaults', async (t) => {
  const extractor = makeExtractor(async () => '{"education":[{}]}');
  const result = await extractor.extract('raw text');

  t.equal(result.education.length, 1);
  t.equal(result.education[0].institution, 'Unknown', 'institution defaults to Unknown');
  t.equal(result.education[0].degree, '', 'degree defaults to empty string');
  t.equal(result.education[0].year, undefined, 'year defaults to undefined');
  t.end();
});

t.test('ProfileExtractor.parseResponse preserves provided education fields', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({
      education: [
        {
          institution: 'MIT',
          degree: 'BS Computer Science',
          year: '2018',
        },
      ],
    }),
  );
  const result = await extractor.extract('raw text');

  t.equal(result.education[0].institution, 'MIT');
  t.equal(result.education[0].degree, 'BS Computer Science');
  t.equal(result.education[0].year, '2018');
  t.end();
});

t.test('ProfileExtractor.parseResponse derives experienceCount correctly', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({
      experience: [
        { company: 'A' },
        { company: 'B' },
        { company: 'C' },
      ],
    }),
  );
  const result = await extractor.extract('raw text');
  t.equal(result.experienceCount, 3, 'experienceCount matches experience array length');
  t.end();
});

t.test('ProfileExtractor.parseResponse derives projectCount correctly', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({
      projects: [{ name: 'P1' }, { name: 'P2' }],
    }),
  );
  const result = await extractor.extract('raw text');
  t.equal(result.projectCount, 2, 'projectCount matches projects array length');
  t.end();
});

t.test('ProfileExtractor.parseResponse derives nodeCount correctly', async (t) => {
  const extractor = makeExtractor(async () =>
    JSON.stringify({
      skills: ['JS', 'TS'],
      experience: [{ company: 'A' }],
      projects: [{ name: 'P1' }],
    }),
  );
  const result = await extractor.extract('raw text');
  t.equal(result.nodeCount, 4, 'nodeCount = skills.length + experience.length + projects.length');
  t.end();
});

t.test('ProfileExtractor.parseResponse defaults totalExperienceYears to 0 when missing', async (t) => {
  const extractor = makeExtractor(async () => '{}');
  const result = await extractor.extract('raw text');
  t.equal(result.totalExperienceYears, 0, 'totalExperienceYears defaults to 0');
  t.end();
});

t.test('ProfileExtractor.parseResponse preserves valid totalExperienceYears', async (t) => {
  const extractor = makeExtractor(async () => '{"totalExperienceYears":5}');
  const result = await extractor.extract('raw text');
  t.equal(result.totalExperienceYears, 5);
  t.end();
});

t.test('ProfileExtractor.parseResponse ignores non-numeric totalExperienceYears', async (t) => {
  const extractor = makeExtractor(async () => '{"totalExperienceYears":"five years"}');
  const result = await extractor.extract('raw text');
  t.equal(result.totalExperienceYears, 0, 'non-numeric value defaults to 0');
  t.end();
});

t.test('ProfileExtractor.parseResponse handles empty arrays gracefully', async (t) => {
  const extractor = makeExtractor(async () => '{}');
  const result = await extractor.extract('raw text');

  t.same(result.experience, []);
  t.same(result.projects, []);
  t.same(result.education, []);
  t.same(result.skills, []);
  t.equal(result.experienceCount, 0);
  t.equal(result.projectCount, 0);
  t.equal(result.nodeCount, 0);
  t.end();
});

t.test('ProfileExtractor.parseResponse preserves rawText in output', async (t) => {
  const extractor = makeExtractor(async () => '{}');
  const result = await extractor.extract('my resume text here');
  t.equal(result.rawText, 'my resume text here');
  t.end();
});

t.test('ProfileExtractor.parseResponse sets hasActiveJD to false', async (t) => {
  const extractor = makeExtractor(async () => '{}');
  const result = await extractor.extract('raw');
  t.equal(result.hasActiveJD, false);
  t.end();
});
