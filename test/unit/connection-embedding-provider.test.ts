import t from 'tap';
import { ConnectionEmbeddingProvider } from '../../electron/rag/providers/ConnectionEmbeddingProvider';
import type { Connection } from '../../electron/services/aiConnections';

const connection: Connection = {
    id: 'local-example', name: 'Local example', type: 'openai',
    baseUrl: 'http://localhost:1234', apiKey: '', builtin: false,
};

t.test('OpenAI-type requests keep exact ids, learn dimensions once and send no prefixes', async t => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const original = globalThis.fetch;
    const timeout = AbortSignal.timeout;
    const deadlines: number[] = [];
    t.teardown(() => { globalThis.fetch = original; AbortSignal.timeout = timeout; });
    AbortSignal.timeout = milliseconds => { deadlines.push(milliseconds); return timeout(milliseconds); };
    globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), options: options! });
        const input = JSON.parse(options!.body as string).input;
        return Response.json({ data: Array.isArray(input)
            ? [{ index: 1, embedding: [3, 4, 5] }, { index: 0, embedding: [1, 2, 3] }]
            : [{ index: 0, embedding: [1, 2, 3] }] });
    };
    const provider = new ConnectionEmbeddingProvider(connection, 'embeddinggemma:example');
    t.equal(provider.name, 'local-example:embeddinggemma:example');
    t.equal(provider.dimensions, 0);
    t.same(await Promise.all([provider.isAvailable(), provider.isAvailable()]), [true, true]);
    t.equal(provider.dimensions, 3);
    t.equal(calls.length, 1, 'one fixed probe even for repeated availability checks');
    t.equal(calls[0].url, 'http://localhost:1234/v1/embeddings');
    t.equal(calls[0].options.method, 'POST');
    t.same(calls[0].options.headers, { 'Content-Type': 'application/json' });
    t.same(JSON.parse(calls[0].options.body as string), { model: 'embeddinggemma:example', input: 'Embedding availability probe.' });
    t.ok(calls[0].options.signal instanceof AbortSignal);
    t.same(await provider.embedQuery('Invented query.'), [1, 2, 3]);
    t.same(JSON.parse(calls[1].options.body as string).input, 'Invented query.');
    t.same(await provider.embedBatch(['Invented first.', 'Invented second.']), [[1, 2, 3], [3, 4, 5]], 'batch restored to input order');
    t.same(JSON.parse(calls[2].options.body as string), { model: 'embeddinggemma:example', input: ['Invented first.', 'Invented second.'] });

    const keyed = new ConnectionEmbeddingProvider({ ...connection, baseUrl: 'https://example.invalid/custom/v1/', apiKey: 'invented-key-marker' }, 'exact-id');
    await keyed.embed('Invented document.');
    t.equal(calls[3].url, 'https://example.invalid/custom/v1/embeddings');
    t.same(calls[3].options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer invented-key-marker' });
    t.same(deadlines, [30_000, 30_000, 30_000, 30_000]);
});

t.test('Gemini-type requests use the host, model path, header and per-text batch', async t => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const original = globalThis.fetch;
    t.teardown(() => { globalThis.fetch = original; });
    globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), options: options! });
        return Response.json({ embedding: { values: [0.5, 0.25] } });
    };
    const provider = new ConnectionEmbeddingProvider({ ...connection, type: 'gemini', baseUrl: 'https://example.invalid/gateway', apiKey: 'invented-gemini-marker' }, 'models/embedding-example');
    t.ok(await provider.isAvailable());
    t.equal(provider.dimensions, 2);
    t.same(await provider.embedBatch(['Invented first.', 'Invented second.']), [[0.5, 0.25], [0.5, 0.25]]);
    t.same(await provider.embedQuery('Invented query.'), [0.5, 0.25]);
    t.equal(calls.length, 4);
    for (const call of calls) {
        t.equal(call.url, 'https://example.invalid/gateway/v1beta/models/embedding-example:embedContent');
        t.equal(call.options.method, 'POST');
        t.same(call.options.headers, { 'Content-Type': 'application/json', 'x-goog-api-key': 'invented-gemini-marker' });
        t.ok(call.options.signal instanceof AbortSignal);
    }
    t.same(JSON.parse(calls[1].options.body as string), { content: { parts: [{ text: 'Invented first.' }] } });
    t.same(JSON.parse(calls[2].options.body as string), { content: { parts: [{ text: 'Invented second.' }] } });
    t.same(JSON.parse(calls[3].options.body as string), { content: { parts: [{ text: 'Invented query.' }] } });
});

t.test('empty probes fail, unsupported types are rejected and errors disclose no host content', async t => {
    const original = globalThis.fetch;
    t.teardown(() => { globalThis.fetch = original; });
    for (const type of ['openai', 'gemini'] as const) {
        const provider = new ConnectionEmbeddingProvider({ ...connection, type, apiKey: 'invented-secret-marker' }, 'example');
        globalThis.fetch = async () => new Response('invented-body-marker invented-secret-marker', { status: 401, statusText: 'invented-body-marker' });
        await provider.embed('invented-input-marker').then(
            () => t.fail('Expected an HTTP error'),
            (error: Error) => {
                t.equal(error.message, 'Embedding request failed (HTTP 401)');
                t.notMatch(error.message, /invented-secret-marker|invented-body-marker|invented-input-marker/);
            }
        );
        t.equal(await provider.isAvailable(), false);
        globalThis.fetch = async () => Response.json(type === 'openai' ? { data: [{ index: 0, embedding: [] }] } : { embedding: { values: [] } });
        const empty = new ConnectionEmbeddingProvider({ ...connection, type }, 'empty-example');
        t.equal(await empty.isAvailable(), false);
        t.equal(empty.dimensions, 0);
        globalThis.fetch = async () => { throw new Error('invented-secret-marker invented-input-marker'); };
        await t.rejects(provider.embed('invented-input-marker'), { message: 'Embedding request failed or timed out' });
        globalThis.fetch = async () => new Response('invented-body-marker', { status: 200 });
        await t.rejects(provider.embed('invented-input-marker'), { message: 'Embedding response is not valid JSON (HTTP 200)' });
    }
    t.throws(() => new ConnectionEmbeddingProvider({ ...connection, type: 'anthropic' }, 'example'), /OpenAI-type or Gemini-type/);
});
