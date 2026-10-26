import t from 'tap';
import { createServer } from 'node:http';
import { fetchConnectionModels } from '../../electron/utils/connectionModels';
import { CredentialsManager } from '../../electron/services/CredentialsManager';
import { BUILTIN_CONNECTIONS, CONNECTION_TYPES, connectionNeedsKey, openAiRoot } from '../../electron/services/aiConnections';
import { createConnectionCredentialStore, resolveAgentModel } from '../../electron/agent/models';

// Exercise storage readers without loading or writing the user's credentials file.
function credentials(values: Record<string, unknown> = {}): CredentialsManager {
    const manager = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(manager, 'credentials', values);
    return manager;
}

const notChosen = { error: 'Choose the quick answers model in Settings, AI Providers' };

t.test('no default id or model prefix chooses a connection', t => {
    for (const defaultModel of ['gemini-example', 'claude-example', 'gpt-example', 'ollama-example', 'custom-example']) {
        const manager = credentials({ defaultModel });
        for (const job of ['chat', 'summary', 'agent'] as const) t.same(manager.resolveModelUse(job), notChosen);
    }
    t.same(credentials({ chatConnectionId: 'openai' }).resolveModelUse('chat'), notChosen);
    t.same(credentials({ chatModel: 'gpt-example' }).resolveModelUse('chat'), notChosen);
    t.end();
});

t.test('summaries and agent inherit the exact quick-answers row, not a prefix guess', t => {
    const manager = credentials({
        chatConnectionId: 'local-example', chatModel: 'claude-example',
        openaiCompatibleProviders: [{ id: 'local-example', name: 'Local example', type: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: '' }],
    });
    const chat = manager.resolveModelUse('chat');
    t.ok('connection' in chat);
    if ('connection' in chat) {
        t.equal(chat.connection.id, 'local-example');
        t.equal(chat.connection.type, 'openai');
        t.equal(chat.model, 'claude-example');
    }
    t.same(manager.resolveModelUse('summary'), chat);
    t.same(manager.resolveModelUse('agent'), chat);
    const own = credentials({
        ...manager.getAllCredentials(), summaryConnectionId: 'gemini', summaryModel: 'summary-example', geminiApiKey: 'invented-test-key',
        agentConnectionId: 'local-example', agentModel: 'agent-example',
    });
    t.match(own.resolveModelUse('summary'), { connection: { id: 'gemini' }, model: 'summary-example' });
    t.match(own.resolveModelUse('agent'), { connection: { id: 'local-example' }, model: 'agent-example' });
    t.same(credentials({ ...manager.getAllCredentials(), summaryConnectionId: 'gemini' }).resolveModelUse('summary'), notChosen);
    t.same(credentials({ ...manager.getAllCredentials(), agentConnectionId: 'gemini' }).resolveModelUse('agent'), notChosen);
    t.end();
});

t.test('removed connections are dropped and missing credentials stay errors', t => {
    const manager = credentials({
        openaiCompatibleProviders: [
            { id: 'old-local', type: 'ollama', name: 'Old local', baseUrl: 'http://localhost:11434', apiKey: '' },
            { id: 'local-example', type: 'openai', name: 'Local example', baseUrl: 'http://localhost:11434/v1', apiKey: '' },
            { id: 'untyped-example', name: 'Untyped example', baseUrl: 'http://localhost:1234/v1', apiKey: '' },
        ],
    });
    t.same(CONNECTION_TYPES, ['openai', 'anthropic', 'gemini']);
    t.same(BUILTIN_CONNECTIONS.map(c => c.id), ['gemini', 'openai', 'claude', 'groq']);
    t.same(manager.listConnections().map(c => c.id), ['gemini', 'openai', 'claude', 'groq', 'local-example', 'untyped-example']);
    t.equal(manager.resolveConnection('ollama'), undefined);
    t.equal(manager.resolveConnection('old-local'), undefined);
    t.match(manager.resolveConnection('untyped-example'), { type: 'openai' });
    t.same(credentials({ chatConnectionId: 'missing', chatModel: 'example' }).resolveModelUse('chat'), { error: 'The connection chosen for this job no longer exists' });
    t.same(credentials({ chatConnectionId: 'openai', chatModel: 'example' }).resolveModelUse('chat'), { error: 'No API key is saved for OpenAI' });
    t.end();
});

t.test('local OpenAI-compatible hosts need no key and keep their version root', async t => {
    for (const base of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080/v1']) {
        t.equal(connectionNeedsKey(base), false);
        t.equal(openAiRoot(base), base);
    }
    t.equal(connectionNeedsKey('https://api.example.com/v1'), true);
    t.equal(openAiRoot('http://localhost:11434'), 'http://localhost:11434/v1');
    const connection = { id: 'local-example', name: 'Local example', type: 'openai' as const, baseUrl: 'http://localhost:11434/v1', apiKey: '', builtin: false };
    const store = createConnectionCredentialStore(connection);
    t.match(await store.read(connection.id), { type: 'api_key' });
    t.equal(await store.read('other-example'), undefined);
});

t.test('an unchosen agent returns the quick-answers setup error without loading a provider', async t => {
    t.same(await resolveAgentModel(credentials()), { ok: false, reason: notChosen.error });
});

t.test('local model discovery uses the ordinary OpenAI models endpoint without authorization', async t => {
    const requests: Array<{ url?: string; authorization?: string }> = [];
    const server = createServer((request, response) => {
        requests.push({ url: request.url, authorization: request.headers.authorization });
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ data: [{ id: 'local-example' }] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.teardown(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    t.same(await fetchConnectionModels({ type: 'openai', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: '' }), [{ id: 'local-example', label: 'local-example' }]);
    t.same(requests, [{ url: '/v1/models', authorization: undefined }]);
});
