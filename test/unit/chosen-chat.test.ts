import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { LLMHelper as Helper } from '../../electron/core/LLMHelper';
import { CredentialsManager } from '../../electron/services/CredentialsManager';
import type { Connection } from '../../electron/services/aiConnections';

// Provider SDKs are mocked; Google's auth dependency cannot load on Node 26 (removed SlowBuffer).
const originalGetInstance = CredentialsManager.getInstance;
t.afterEach(() => { CredentialsManager.getInstance = originalGetInstance; });

const { LLMHelper } = mockRequire(path.resolve('electron/core/LLMHelper.ts'), {
    '@google/genai': { GoogleGenAI: class {}, ThinkingLevel: { LOW: 'LOW', MINIMAL: 'MINIMAL' } },
    [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager },
}) as { LLMHelper: typeof Helper };

function helper(): Helper {
    const llm = Object.create(LLMHelper.prototype) as Helper;
    Reflect.set(llm, 'aiResponseLanguage', 'English');
    return llm;
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
    let text = '';
    for await (const part of stream) text += part;
    return text;
}

t.test('interactive generation resolves the quick-answers row, including screenshots and structured results', async t => {
    const manager = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(manager, 'credentials', {});
    const connection: Connection = { id: 'invented-host', name: 'Invented host', type: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: '', builtin: false };
    CredentialsManager.getInstance = () => manager;
    const jobs: string[] = [];
    manager.resolveModelUse = job => {
        jobs.push(job);
        return { connection, model: 'exact-unprefixed-id' };
    };
    const llm = helper();
    const requests: unknown[][] = [];
    Reflect.set(llm, 'streamViaConnectionChat', async function* (...args: unknown[]) {
        requests.push(args);
        yield '{"solution":';
        yield '{"code":"invented"}}';
    });
    t.same(await llm.generateSolution({ problem: 'Invented puzzle' }), { solution: { code: 'invented' } });
    t.same(await llm.extractProblemFromImages(['invented.png']), { solution: { code: 'invented' } });
    t.equal(await llm.generateContentStructured('Invented JSON request'), '{"solution":{"code":"invented"}}');
    await llm.generateSuggestion('Invented context', 'Invented question');
    await llm.chatWithGemini('Invented question');
    t.same(jobs, ['chat', 'chat', 'chat', 'chat', 'chat', 'chat']);
    t.ok(requests.every(args => args[0] === connection && args[1] === 'exact-unprefixed-id'));
    t.same(requests[1][4], ['invented.png']);
});

t.test('missing selections and provider failures are not replaced with another model or an apology', async t => {
    const manager = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(manager, 'credentials', {});
    CredentialsManager.getInstance = () => manager;
    const llm = helper();
    await t.rejects(llm.generateContentStructured('Invented request'), { message: 'Choose the quick answers model in Settings, AI Providers' });
    manager.resolveModelUse = () => ({ connection: {} as Connection, model: 'invented' });
    let calls = 0;
    const failure = new Error('Invented host rejected images: HTTP 400');
    Reflect.set(llm, 'streamViaConnectionChat', async function* () {
        calls++;
        throw failure;
    });
    await t.rejects(llm.analyzeImageFiles(['invented.png']), failure);
    t.equal(calls, 1);
});

t.test('each connection protocol preserves role history and receives the abort signal', async t => {
    const manager = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(manager, 'credentials', {});
    CredentialsManager.getInstance = () => manager;
    const history = [{ role: 'user' as const, content: 'Invented earlier question' }, { role: 'assistant' as const, content: 'Invented earlier reply' }];
    for (const type of ['openai', 'anthropic', 'gemini'] as const) {
        const llm = helper();
        const controller = new AbortController();
        const connection: Connection = { id: 'invented', name: 'Invented', type, baseUrl: 'http://localhost:1234', apiKey: '', builtin: false };
        manager.resolveModelUse = () => ({ connection, model: 'exact-id' });
        let request: Record<string, unknown> = {};
        let signal: AbortSignal | undefined;
        const openai = async function* () { yield { choices: [{ delta: { content: 'ready' } }] }; };
        const anthropic = async function* () { yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ready' } }; };
        const gemini = async function* () { yield { text: 'ready' }; };
        Reflect.set(llm, 'connectionClients', () => ({
            openai: () => ({ chat: { completions: { create: (body: Record<string, unknown>, options: { signal: AbortSignal }) => { request = body; signal = options.signal; return openai(); } } } }),
            anthropic: () => ({ messages: { stream: (body: Record<string, unknown>, options: { signal: AbortSignal }) => { request = body; signal = options.signal; return anthropic(); } } }),
            gemini: () => ({ models: { generateContentStream: (body: Record<string, unknown> & { config: { abortSignal: AbortSignal } }) => { request = body; signal = body.config.abortSignal; return gemini(); } } }),
        }));
        t.equal(await collect(llm.streamChat('Invented final question', undefined, undefined, 'Invented system', { history, signal: controller.signal, verbatimPrompt: true })), 'ready');
        t.equal(request.model, 'exact-id');
        t.equal(signal, controller.signal);
        if (type === 'gemini') t.same(request.contents, [
            { role: 'user', parts: [{ text: history[0].content }] },
            { role: 'model', parts: [{ text: history[1].content }] },
            { role: 'user', parts: [{ text: 'Invented final question' }] },
        ]);
        else {
            const messages = request.messages as Array<{ role: string; content: unknown }>;
            t.same(messages.slice(type === 'openai' ? 1 : 0, -1), history);
            t.equal(messages[messages.length - 1].role, 'user');
        }
        await collect(llm.streamChat(undefined, undefined, undefined, 'Invented system', { history, verbatimPrompt: true }));
        t.equal((request.messages as unknown[] | undefined)?.length ?? (request.contents as unknown[]).length, history.length + (type === 'openai' ? 1 : 0), 'no invented user turn after assistant history');
        controller.abort();
        await t.rejects(collect(llm.streamChat('Invented final question', undefined, undefined, '', { signal: controller.signal })), { name: 'AbortError' });
    }
});
