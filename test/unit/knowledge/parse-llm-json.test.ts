import t from 'tap';
import { extractJsonCandidate, parseLLMJson } from '../../../electron/knowledge/parseLLMJson';

t.test('extractJsonCandidate returns trimmed raw JSON', (t) => {
  const result = extractJsonCandidate('  {"ok":true}  ');
  t.equal(result, '{"ok":true}');
  t.end();
});

t.test('parseLLMJson parses fenced json blocks', (t) => {
  const result = parseLLMJson<{ score: number }>('```json\n{"score":88}\n```');
  t.same(result, { score: 88 });
  t.end();
});

t.test('parseLLMJson extracts embedded json object from surrounding text', (t) => {
  const result = parseLLMJson<{ company: string; title: string }>(
    'Here is the analysis you requested:\n{"company":"Pika","title":"Engineer"}\nUse it well.',
  );

  t.same(result, { company: 'Pika', title: 'Engineer' });
  t.end();
});

t.test('parseLLMJson throws a stable error for invalid content', (t) => {
  t.throws(
    () => parseLLMJson('definitely not json'),
    { message: 'Failed to parse LLM response as JSON' },
  );
  t.end();
});
