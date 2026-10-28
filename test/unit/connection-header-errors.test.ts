import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { Connection } from '../../electron/services/aiConnections';

const connection: Connection = { id: 'gateway', name: 'Invented gateway', type: 'openai', baseUrl: 'http://127.0.0.1:1234', apiKey: 'fake-key', builtin: false, headers: { 'X-Gateway': 'fake-header-secret' } };
const echoed = 'Provider echoed fake-key and fake-header-secret';

t.test('agent Test redacts both returned provider errors and thrown errors', async t => {
    for (const throwing of [false, true]) {
        const models = { getModel: () => ({}), complete: async () => {
            if (throwing) throw new Error(echoed);
            return { stopReason: 'error', errorMessage: echoed };
        } };
        const { testAgentModel } = mockRequire(path.resolve('electron/agent/agentTest.ts'), {
            [path.resolve('electron/agent/loader.ts')]: { loadAgentRuntime: async () => ({}) },
            [path.resolve('electron/agent/models.ts')]: { buildAgentModel: async () => ({ models, ref: { provider: 'gateway', modelId: 'example' } }) },
        }) as typeof import('../../electron/agent/agentTest');
        const result = await testAgentModel(connection, 'example', false);
        t.match(result, { success: false, error: 'other: Provider echoed [redacted] and [redacted]' });
        t.notMatch(JSON.stringify(result), /fake-key|fake-header-secret/);
    }
});

for (const title of ['Processing...', 'Invented provided title']) {
    t.test(`recovery summary logs redact echoed header/key secrets (${title})`, async t => {
        const logs: unknown[][] = [];
        const warn = console.warn;
        const error = console.error;
        console.warn = (...args: unknown[]) => logs.push(args);
        console.error = (...args: unknown[]) => logs.push(args);
        t.teardown(() => { console.warn = warn; console.error = error; });
        const completions: unknown[] = [];
        const db = {
            getUnprocessedMeetings: () => [{ id: 'invented-meeting' }],
            getMeetingDetails: () => ({ title, date: '2020-01-01T00:00:00.000Z', duration: '1:00', transcript: [1, 2, 3].map(i => ({ speaker: 'user', text: `Invented segment ${i}. ` + 'Invented context. '.repeat(300), timestamp: i * 1000 })) }),
            completeMeeting: (_id: string, data: unknown) => { completions.push(data); return true; },
        };
        const { MeetingPersistence } = mockRequire(path.resolve('electron/core/MeetingPersistence.ts'), {
            electron: { BrowserWindow: { getAllWindows: () => [] } },
            [path.resolve('electron/db/DatabaseManager.ts')]: { DatabaseManager: { getInstance: () => db } },
            [path.resolve('electron/core/LLMHelper.ts')]: {},
            [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => ({ resolveModelUse: () => ({ connection, model: 'example' }) }) } },
            [path.resolve('electron/agent/workspace.ts')]: { renameMeetingFolder: async () => {} },
        }) as typeof import('../../electron/core/MeetingPersistence');
        const persistence = new MeetingPersistence({ getMeetingId: () => null, setUsageRecorder: () => {} } as never, { generateMeetingSummary: async () => { throw new Error(echoed); } } as never);
        await persistence.recoverUnprocessedMeetings();
        t.equal(completions.length, 1, 'recovery still completes the existing record');
        t.ok(logs.length > 0, 'failure reached the real logging path');
        const output = JSON.stringify(logs);
        t.match(output, /Provider echoed \[redacted\] and \[redacted\]/);
        t.notMatch(output, /fake-key|fake-header-secret|Invented context/);
    });
}
