import t from 'tap';
import { createServer, type IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

// The installed Google auth dependency still imports SlowBuffer, removed in Node 26; direct API-key requests never use it.
const buffer = createRequire(import.meta.url)('node:buffer');
buffer.SlowBuffer ??= buffer.Buffer;
const { LLMHelper } = mockRequire(path.resolve('electron/core/LLMHelper.ts'), {}) as typeof import('../../electron/core/LLMHelper');
import { fetchConnectionModels } from '../../electron/utils/connectionModels';
import { buildAgentModel } from '../../electron/agent/models';
import { ConnectionEmbeddingProvider } from '../../electron/rag/providers/ConnectionEmbeddingProvider';
import type { Connection } from '../../electron/services/aiConnections';

async function gateway(test: typeof t) {
    const requests: Array<{ url: string; headers: IncomingMessage['headers'] }> = [];
    const server = createServer(async (request, response) => {
        requests.push({ url: request.url!, headers: request.headers });
        let body = '';
        for await (const chunk of request) body += chunk;
        const input = body ? JSON.parse(body) : {};
        const url = request.url!;
        response.setHeader('Content-Type', 'application/json');
        if (input.model === 'echo-error' || url.includes('echo-error:')) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', type: 'invalid_request_error', message: 'Echo fake-api-key fake-header-value' } }));
            return;
        }
        if (request.method === 'GET') {
            response.end(JSON.stringify(url.includes('/gemini/') ? { models: [{ name: 'models/example' }] } : { data: [{ id: 'example' }] }));
        } else if (url.includes('embedContent')) {
            response.end(JSON.stringify({ embedding: { values: [1, 2] } }));
        } else if (url.includes('/embeddings')) {
            response.end(JSON.stringify({ data: (Array.isArray(input.input) ? input.input : [input.input]).map((_: unknown, index: number) => ({ index, embedding: [1, 2] })) }));
        } else if (url.includes('/anthropic/')) {
            const message = { id: 'msg_example', type: 'message', role: 'assistant', model: 'example', content: [{ type: 'text', text: 'ready' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
            if (input.stream) {
                response.setHeader('Content-Type', 'text/event-stream');
                const events = [
                    { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
                    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
                    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ready' } },
                    { type: 'content_block_stop', index: 0 },
                    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
                    { type: 'message_stop' },
                ];
                response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
            } else response.end(JSON.stringify(message));
        } else if (url.includes('/gemini/')) {
            const message = { candidates: [{ content: { role: 'model', parts: [{ text: 'ready' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
            if (url.includes('streamGenerateContent')) {
                response.setHeader('Content-Type', 'text/event-stream');
                response.end(`data: ${JSON.stringify(message)}\n\n`);
            } else response.end(JSON.stringify(message));
        } else if (input.stream) {
            response.setHeader('Content-Type', 'text/event-stream');
            const message = { id: 'example', object: 'chat.completion.chunk', model: 'example', choices: [{ index: 0, delta: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }] };
            response.end(`data: ${JSON.stringify(message)}\n\ndata: [DONE]\n\n`);
        } else response.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    test.teardown(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const connection = (type: Connection['type'], headers = true): Connection => ({
        id: `test-${type}`, name: 'Invented gateway', type, baseUrl: `http://127.0.0.1:${address.port}/${type}`,
        apiKey: 'fake-api-key', builtin: false, ...(headers ? { headers: { 'X-Gateway': 'fake-header-value' } } : {}),
    });
    return { requests, connection };
}

for (const type of ['openai', 'anthropic', 'gemini'] as const) {
    t.test(`${type}: SDK translation, chat/test, discovery and pi-ai send only the owning connection's headers`, async t => {
        const { requests, connection } = await gateway(t);
        const c = connection(type);
        const llm = new LLMHelper();
        t.equal(await llm.translateTranscriptText({ provider: 'connection', connection: c, model: 'example', prompt: 'Translate.', sourceText: 'Invented sample.' }), 'ready');
        t.equal(requests.at(-1)?.headers['x-gateway'], 'fake-header-value', 'nonstream SDK request');
        t.match(await llm.testModel(c, 'example'), { success: true, reply: 'ready' });
        t.equal(requests.at(-1)?.headers['x-gateway'], 'fake-header-value', 'stream SDK request');
        t.same(await fetchConnectionModels(c), [{ id: 'example', label: 'example' }]);
        t.equal(requests.at(-1)?.headers['x-gateway'], 'fake-header-value', 'model-list HTTP request');
        const { models, ref } = await buildAgentModel(c, 'example', false);
        const model = models.getModel(ref.provider, ref.modelId)!;
        const result = await models.complete(model, { messages: [{ role: 'user', content: 'Invented sample.', timestamp: 1 }] });
        t.equal(result.stopReason, 'stop', result.errorMessage);
        t.match(result.content, [{ type: 'text', text: 'ready' }]);
        t.equal(requests.at(-1)?.headers['x-gateway'], 'fake-header-value', 'pi-ai model headers reach the actual request');
        await llm.translateTranscriptText({ provider: 'connection', connection: connection(type, false), model: 'example', prompt: 'Translate.', sourceText: 'Invented sample.' });
        t.equal(requests.at(-1)?.headers['x-gateway'], undefined, 'no leakage into another connection');
        const failed = await llm.testModel(c, 'echo-error');
        t.equal(failed.success, false);
        t.match(failed.error, /\[redacted\]/);
        t.notMatch(failed.error, /fake-api-key|fake-header-value/);
        await llm.translateTranscriptText({ provider: 'connection', connection: c, model: 'echo-error', prompt: 'Translate.', sourceText: 'Invented sample.' }).then(() => t.fail('Expected translation failure'), (error: Error) => {
            t.match(error.message, /\[redacted\]/);
            t.notMatch(error.message, /fake-api-key|fake-header-value/);
        });
    });
}

for (const type of ['openai', 'gemini'] as const) {
    t.test(`${type}: embedding probe, document, query and batch send custom headers`, async t => {
        const { requests, connection } = await gateway(t);
        const provider = new ConnectionEmbeddingProvider(connection(type), 'example');
        t.equal(await provider.isAvailable(), true);
        t.same(await provider.embed('Invented document.'), [1, 2]);
        t.same(await provider.embedQuery('Invented query.'), [1, 2]);
        t.same(await provider.embedBatch(['Invented first.', 'Invented second.']), [[1, 2], [1, 2]]);
        t.equal(requests.length, type === 'openai' ? 4 : 5);
        for (const request of requests) t.equal(request.headers['x-gateway'], 'fake-header-value');
    });
}
