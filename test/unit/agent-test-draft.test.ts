import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AppState } from '../../electron/main';

t.test('the Agent Test uses only the draft on screen and names what is missing', async t => {
    let agentTest: ((_event: unknown, draft: { connectionId: string; model: string; supportsImages?: boolean }) => Promise<unknown>) | undefined;
    const calls: Array<{ connectionId: string; model: string; supportsImages: boolean }> = [];
    let usedSaved = false;
    const connection = { id: 'draft-connection', name: 'Invented draft provider', type: 'openai', baseUrl: 'http://127.0.0.1:5044/v1', apiKey: 'invented-key', headers: {} };
    const credentials = {
        resolveModelUse: () => { usedSaved = true; return { connection, model: 'saved-model' }; },
        resolveConnection: (id: string) => id === connection.id ? connection : undefined,
        isConnectionReady: () => true,
    };
    const { registerAgentHandlers } = mockRequire(path.resolve('electron/ipc/agent.ts'), {
        electron: { BrowserWindow: { getAllWindows: () => [] } },
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (channel: string, handler: typeof agentTest) => {
            if (channel === 'agent-test') agentTest = handler;
        } },
        [path.resolve('electron/agent/MeetingAgent.ts')]: { reportAgentError: () => {} },
        [path.resolve('electron/agent/agentTest.ts')]: { testAgentModel: async (chosen: typeof connection, model: string, supportsImages: boolean) => {
            calls.push({ connectionId: chosen.id, model, supportsImages });
            return { success: true, reply: 'ready', toolCalls: true, totalMs: 12 };
        } },
        [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => credentials } },
    }) as { registerAgentHandlers: typeof import('../../electron/ipc/agent').registerAgentHandlers };
    registerAgentHandlers({ getMeetingAgent: () => ({ onEvent: () => {} }) } as unknown as AppState);
    if (!agentTest) throw new Error('The Agent Test handler was not registered');

    t.same(await agentTest(undefined, { connectionId: '', model: '' }), { success: false, error: 'Choose a connection and enter a model before testing.' });
    t.same(await agentTest(undefined, { connectionId: connection.id, model: '   ' }), { success: false, error: 'Enter a model before testing.' });
    t.same(await agentTest(undefined, { connectionId: '  ', model: 'invented-draft-model' }), { success: false, error: 'Choose a connection before testing.' });
    t.same(calls, [], 'an incomplete draft sends no request');
    t.equal(usedSaved, false, 'the saved settings are never substituted');

    t.same(await agentTest(undefined, { connectionId: connection.id, model: 'invented-draft-model', supportsImages: true }), {
        success: true, reply: 'ready', toolCalls: true, totalMs: 12,
    });
    t.same(calls, [{ connectionId: connection.id, model: 'invented-draft-model', supportsImages: true }], 'the complete draft is tested as shown');
});
