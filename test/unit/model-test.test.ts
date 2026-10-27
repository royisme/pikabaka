import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { runModelTest, type ModelTestResult } from '../../electron/llm/modelTest';
import { CredentialsManager } from '../../electron/services/CredentialsManager';
import type { AppState } from '../../electron/main';
import type { Connection } from '../../electron/services/aiConnections';

// A deterministic clock checks first-text timing separately from completion, without sleeping.
t.test('collects the whole reply and times the first nonempty chunk only', async t => {
    const originalNow = Date.now;
    let now = 100;
    let result: ModelTestResult;
    Date.now = () => now;
    try {
        result = await runModelTest((async function* () {
            now = 110; yield '';
            now = 120; yield 'rea';
            now = 150; yield 'dy';
            now = 190;
        })(), '');
    } finally {
        Date.now = originalNow;
    }
    t.same(result!, { success: true, reply: 'ready', firstTokenMs: 20, totalMs: 90 });
});

t.test('empty text is a failure, not an invented success reply', async t => {
    const result = await runModelTest((async function* () { yield '  '; })(), '');
    t.equal(result.success, false);
    t.equal(result.reply, undefined);
    t.equal(result.error, 'other: The model returned no text');
    t.type(result.totalMs, 'number');
});

t.test('shows the real error class, HTTP status and at most 300 message characters', async t => {
    const result = await runModelTest((async function* () {
        yield 'partial invented reply';
        throw Object.assign(new Error('Invented rate limit\n' + 'x'.repeat(350)), { status: 429 });
    })(), '');
    t.equal(result.success, false);
    t.equal(result.reply, undefined, 'a failed stream is never presented as a complete reply');
    t.type(result.firstTokenMs, 'number');
    t.type(result.totalMs, 'number');
    t.equal(result.error, 'rate-limit (HTTP 429): ' + ('Invented rate limit ' + 'x'.repeat(350)).slice(0, 300));
    const failures: Array<[unknown, RegExp]> = [
        [{ statusCode: 401, message: 'Invented authentication failure' }, /^auth \(HTTP 401\):/],
        [{ response: { status: 403 }, message: 'Invented forbidden request' }, /^auth \(HTTP 403\):/],
        [{ code: 'ECONNREFUSED', message: 'Invented network failure' }, /^network:/],
        [{ name: 'TimeoutError', message: 'Invented timeout' }, /^timeout:/],
    ];
    for (const [error, expected] of failures) {
        const failed = await runModelTest((async function* () { throw error; })(), '');
        t.match(failed.error, expected);
    }
});

t.test('authentication errors cannot expose the chosen connection key', async t => {
    const result = await runModelTest((async function* () {
        throw new Error('Invalid API key: invented-test-key');
    })(), 'invented-test-key');
    t.equal(result.error, 'auth: Invalid API key: [redacted]');
});

t.test('model-test uses the unsaved row or inherits the exact saved Quick answers row without writing', async t => {
    const manager = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(manager, 'credentials', {
        chatConnectionId: 'draft-host', chatModel: 'saved-chat-id',
        summaryConnectionId: 'summary-host', summaryModel: 'saved-summary-id',
        openaiCompatibleProviders: [
            { id: 'draft-host', name: 'Invented local host', type: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: '' },
            { id: 'summary-host', name: 'Invented summary host', type: 'anthropic', baseUrl: 'https://example.invalid', apiKey: 'invented-test-key' },
            { id: 'no-key', name: 'Invented remote host', type: 'gemini', baseUrl: 'https://example.invalid', apiKey: '' },
        ],
    });
    const before = structuredClone(manager.getAllCredentials());
    let handler: ((_event: unknown, draft: unknown) => Promise<ModelTestResult>) | undefined;
    const { registerConnectionHandlers } = mockRequire(path.resolve('electron/ipc/connections.ts'), {
        electron: { BrowserWindow: { getAllWindows: () => [] } },
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (channel: string, listener: typeof handler) => { if (channel === 'model-test') handler = listener; } },
        [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => manager } },
    }) as typeof import('../../electron/ipc/connections');
    const calls: Array<{ connection: Connection; model: string }> = [];
    registerConnectionHandlers({ processingHelper: { getLLMHelper: () => ({ testModel: async (connection: Connection, model: string) => {
        calls.push({ connection, model });
        return { success: true, reply: 'ready' };
    } }) } } as unknown as AppState);
    if (!handler) throw new Error('model-test was not registered');
    t.same(await handler(undefined, { job: 'chat', connectionId: 'draft-host', model: 'unsaved-exact-id' }), { success: true, reply: 'ready' });
    t.match(calls[0], { connection: { id: 'draft-host', type: 'openai', baseUrl: 'http://localhost:1234/v1' }, model: 'unsaved-exact-id' });
    await handler(undefined, { job: 'summary', connectionId: 'summary-host', model: 'unsaved-summary-id' });
    t.match(calls[1], { connection: { id: 'summary-host', type: 'anthropic' }, model: 'unsaved-summary-id' });
    await handler(undefined, { job: 'summary', connectionId: '', model: 'ignored-because-inherited' });
    t.match(calls[2], { connection: { id: 'draft-host' }, model: 'saved-chat-id' });
    for (const draft of [
        { job: 'chat', connectionId: '', model: 'must-not-use-saved-chat' },
        { job: 'chat', connectionId: 'draft-host', model: '' },
        { job: 'summary', connectionId: 'summary-host', model: '' },
        { job: 'chat', connectionId: 'missing', model: 'invented' },
        { job: 'summary', connectionId: 'no-key', model: 'invented' },
        null, {}, { job: 'agent', connectionId: 'draft-host', model: 'invented' },
        { job: 'chat', connectionId: 'draft-host', model: 'x'.repeat(513) },
    ]) t.equal((await handler(undefined, draft)).success, false);
    t.equal(calls.length, 3, 'invalid drafts never reach a model');
    t.same(manager.getAllCredentials(), before, 'testing writes no setting');
});
