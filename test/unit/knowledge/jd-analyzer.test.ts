import t from 'tap';
import { JDAnalyzer } from '../../../electron/knowledge/JDAnalyzer';
import { GenerateContentFn } from '../../../electron/knowledge/types';

// Helper to create a JDAnalyzer with a mock generateContentFn
function makeAnalyzer(mockFn: GenerateContentFn): JDAnalyzer {
  return new JDAnalyzer(mockFn);
}

t.test('JDAnalyzer.parseResponse applies company default', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"company":null}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.company, 'Unknown', 'null company defaults to Unknown');
  t.end();
});

t.test('JDAnalyzer.parseResponse applies company default when missing', async (t) => {
  const analyzer = makeAnalyzer(async () => '{}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.company, 'Unknown', 'missing company defaults to Unknown');
  t.end();
});

t.test('JDAnalyzer.parseResponse preserves provided company', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"company":"Stripe"}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.company, 'Stripe');
  t.end();
});

t.test('JDAnalyzer.parseResponse applies title default', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"title":null}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.title, 'Unknown', 'null title defaults to Unknown');
  t.end();
});

t.test('JDAnalyzer.parseResponse applies title default when missing', async (t) => {
  const analyzer = makeAnalyzer(async () => '{}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.title, 'Unknown', 'missing title defaults to Unknown');
  t.end();
});

t.test('JDAnalyzer.parseResponse preserves provided title', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"title":"Senior Software Engineer"}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.title, 'Senior Software Engineer');
  t.end();
});

t.test('JDAnalyzer.parseResponse normalizes requirements to array', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"requirements":"not-an-array"}');
  const result = await analyzer.analyze('jd raw text');
  t.same(result.requirements, [], 'requirements defaults to empty array when not array');
  t.end();
});

t.test('JDAnalyzer.parseResponse preserves valid requirements array', async (t) => {
  const analyzer = makeAnalyzer(async () =>
    JSON.stringify({
      requirements: ['5+ years experience', 'Strong CS fundamentals', 'React expertise'],
    }),
  );
  const result = await analyzer.analyze('jd raw text');
  t.same(result.requirements, ['5+ years experience', 'Strong CS fundamentals', 'React expertise']);
  t.end();
});

t.test('JDAnalyzer.parseResponse normalizes technologies to array', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"technologies":123}');
  const result = await analyzer.analyze('jd raw text');
  t.same(result.technologies, [], 'technologies defaults to empty array when not array');
  t.end();
});

t.test('JDAnalyzer.parseResponse preserves valid technologies array', async (t) => {
  const analyzer = makeAnalyzer(async () =>
    JSON.stringify({
      technologies: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
    }),
  );
  const result = await analyzer.analyze('jd raw text');
  t.same(result.technologies, ['TypeScript', 'React', 'Node.js', 'PostgreSQL']);
  t.end();
});

t.test('JDAnalyzer.parseResponse normalizes keywords to array', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"keywords":{"not":"an array"}}');
  const result = await analyzer.analyze('jd raw text');
  t.same(result.keywords, [], 'keywords defaults to empty array when not array');
  t.end();
});

t.test('JDAnalyzer.parseResponse preserves valid keywords array', async (t) => {
  const analyzer = makeAnalyzer(async () =>
    JSON.stringify({
      keywords: ['startup', 'fast-paced', 'remote-friendly'],
    }),
  );
  const result = await analyzer.analyze('jd raw text');
  t.same(result.keywords, ['startup', 'fast-paced', 'remote-friendly']);
  t.end();
});

t.test('JDAnalyzer.parseResponse accepts valid min_years_experience number', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"min_years_experience":5}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.min_years_experience, 5, 'numeric min_years_experience is preserved');
  t.end();
});

t.test('JDAnalyzer.parseResponse accepts zero min_years_experience', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"min_years_experience":0}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.min_years_experience, 0, 'zero min_years_experience is preserved');
  t.end();
});

t.test('JDAnalyzer.parseResponse ignores non-numeric min_years_experience string', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"min_years_experience":"5 years"}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.min_years_experience, undefined, 'string min_years_experience becomes undefined');
  t.end();
});

t.test('JDAnalyzer.parseResponse ignores non-numeric min_years_experience object', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"min_years_experience":{"value":5}}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.min_years_experience, undefined, 'object min_years_experience becomes undefined');
  t.end();
});

t.test('JDAnalyzer.parseResponse ignores null min_years_experience', async (t) => {
  const analyzer = makeAnalyzer(async () => '{"min_years_experience":null}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.min_years_experience, undefined, 'null min_years_experience becomes undefined');
  t.end();
});

t.test('JDAnalyzer.parseResponse ignores missing min_years_experience', async (t) => {
  const analyzer = makeAnalyzer(async () => '{}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.min_years_experience, undefined, 'missing min_years_experience is undefined');
  t.end();
});

t.test('JDAnalyzer.parseResponse handles negative min_years_experience', async (t) => {
  // The implementation uses typeof check which passes for negative numbers
  const analyzer = makeAnalyzer(async () => '{"min_years_experience":-2}');
  const result = await analyzer.analyze('jd raw text');
  t.equal(result.min_years_experience, -2, 'negative number is preserved (typeof check passes)');
  t.end();
});

t.test('JDAnalyzer.parseResponse preserves optional fields when provided', async (t) => {
  const analyzer = makeAnalyzer(async () =>
    JSON.stringify({
      company: 'Meta',
      title: 'ML Engineer',
      level: 'Senior',
      location: 'Remote',
      compensation_hint: '$150k-$200k',
    }),
  );
  const result = await analyzer.analyze('jd raw text');

  t.equal(result.company, 'Meta');
  t.equal(result.title, 'ML Engineer');
  t.equal(result.level, 'Senior');
  t.equal(result.location, 'Remote');
  t.equal(result.compensation_hint, '$150k-$200k');
  t.end();
});

t.test('JDAnalyzer.parseResponse returns empty arrays when no array fields provided', async (t) => {
  const analyzer = makeAnalyzer(async () =>
    JSON.stringify({
      company: 'Acme',
      title: 'Engineer',
    }),
  );
  const result = await analyzer.analyze('jd raw text');

  t.same(result.requirements, []);
  t.same(result.technologies, []);
  t.same(result.keywords, []);
  t.end();
});

t.test('JDAnalyzer.parseResponse handles fully empty response', async (t) => {
  const analyzer = makeAnalyzer(async () => '{}');
  const result = await analyzer.analyze('jd raw text');

  t.equal(result.company, 'Unknown');
  t.equal(result.title, 'Unknown');
  t.equal(result.level, undefined);
  t.equal(result.location, undefined);
  t.equal(result.compensation_hint, undefined);
  t.equal(result.min_years_experience, undefined);
  t.same(result.requirements, []);
  t.same(result.technologies, []);
  t.same(result.keywords, []);
  t.end();
});
