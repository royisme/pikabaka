import t from 'tap';
import {
  anthropicDeltas,
  formatTranslationTiming,
  geminiDeltas,
  ollamaDeltas,
  openAIDeltas,
  streamText,
} from '../electron/transcript/translationStream';

async function* from<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}
async function collect(deltas: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of deltas) out.push(delta);
  return out;
}

t.test('openAIDeltas reads delta.content and skips empty chunks', async (t) => {
  const chunks = [{ choices: [{ delta: { role: 'assistant' } }] }, { choices: [{ delta: { content: '你' } }] }, { choices: [] }, { choices: [{ delta: { content: '好' } }] }, { choices: [{ delta: { content: null } }] }];
  t.same(await collect(openAIDeltas(from(chunks))), ['你', '好']);
});

t.test('anthropicDeltas reads text_delta events only', async (t) => {
  const events = [
    { type: 'message_start' },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Bon' } },
    { type: 'content_block_delta', delta: { type: 'input_json_delta' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'jour' } },
    { type: 'message_stop' },
  ];
  t.same(await collect(anthropicDeltas(from(events))), ['Bon', 'jour']);
});

t.test('geminiDeltas reads text and skips empty chunks', async (t) => {
  t.same(await collect(geminiDeltas(from([{ text: 'Hola' }, { text: '' }, {}, { text: ' mundo' }]))), ['Hola', ' mundo']);
});

t.test('ollamaDeltas joins lines split across chunks and handles bytes', async (t) => {
  const enc = new TextEncoder();
  const body = from<Uint8Array | string>([
    enc.encode('{"response":"He'),
    enc.encode('llo","done":false}\n{"response":" 世'),
    // a multi-byte character split across two chunks
    new Uint8Array([...enc.encode('界')].slice(0, 2)),
    new Uint8Array([...enc.encode('界')].slice(2)),
    '","done":false}\n{"response":"","done":true}\n',
  ]);
  t.equal((await collect(ollamaDeltas(body))).join(''), 'Hello 世界');
});

t.test('ollamaDeltas reads a last line with no newline and rejects an error line', async (t) => {
  t.same(await collect(ollamaDeltas(from(['{"response":"a"}\n{"response":"b"}']))), ['a', 'b']);
  await t.rejects(collect(ollamaDeltas(from(['{"error":"model not found"}\n']))), /Ollama stream error/);
});

t.test('streamText reports at most once per interval, always the first delta, and returns the full text', async (t) => {
  let clock = 0;
  const seen: string[] = [];
  const times = [0, 10, 20, 100, 110, 200];
  const deltas = from(['a', 'b', 'c', 'd', 'e', 'f']);
  const result = await streamText(deltas, (text) => seen.push(text), { minIntervalMs: 80, now: () => times[clock++] });
  t.equal(result, 'abcdef');
  t.same(seen, ['a', 'abcd', 'abcdef'], 'reports at 0ms, 100ms and 200ms');
});

t.test('a failing stream rejects and keeps what was reported', async (t) => {
  async function* broken(): AsyncGenerator<string> {
    yield 'par';
    throw new Error('connection lost');
  }
  const seen: string[] = [];
  await t.rejects(streamText(broken(), (text) => seen.push(text)), /connection lost/);
  t.same(seen, ['par']);
});

t.test('the timing line carries numbers and names, never text', async (t) => {
  const line = formatTranslationTiming({ provider: 'openai', model: 'gpt-x', flushGapMs: 1200, firstTokenMs: null, totalMs: 900, sourceChars: 40, outputChars: 0, streamed: true, speculative: false, outcome: 'error' });
  t.equal(line, '[Translation] timing provider=openai model=gpt-x flushGapMs=1200 firstTokenMs=n/a totalMs=900 sourceChars=40 outputChars=0 streamed=true speculative=false outcome=error');
});
