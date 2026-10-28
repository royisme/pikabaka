import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { gateHost } from '../helpers/gateSettingsHost';
import { GateError } from '../../electron/agent/gate';
import type { testGateModel as TestGateModel } from '../../electron/agent/models';

for (const page of ['DecisionServiceSettings', 'ProactiveHelpSettings'] as const) {
    t.test(`${page} reports the measured time and whether the reply would have been too slow live`, async t => {
        let latencyMs = 3500;
        const host = gateHost(page, {
            agentGateTest: async () => ({ success: true, help: 0.9, kind: 'answer_question', latencyMs }),
        });
        t.teardown(host.unmount);
        host.click(page === 'DecisionServiceSettings' ? 'Test' : 'Test decision model');
        await host.settle();
        t.match(host.html(), /3500 ms/, 'shows the measured time');
        t.match(host.html(), /Live use allows 2 s/, 'states the live deadline');
        t.match(host.html(), /too slow live/, 'says the reply would have been too slow live');

        latencyMs = 800;
        host.click(page === 'DecisionServiceSettings' ? 'Test' : 'Test decision model');
        await host.settle();
        t.match(host.html(), /800 ms/, 'shows the faster measured time');
        t.match(host.html(), /fast enough live/, 'does not call a fast reply too slow');
        t.notMatch(host.html(), /too slow live/);
    });
}

t.test('a Test timeout reports the 5 s test limit and the live 2 s deadline', async t => {
    const { testGateModel } = mockRequire(path.resolve('electron/agent/models.ts'), {
        [path.resolve('electron/agent/gate.ts')]: { GateError },
        [path.resolve('electron/agent/loader.ts')]: {
            loadAgentRuntime: async () => ({
                models: {
                    createModels: () => ({
                        setProvider: () => {},
                        getModelOfType: () => ({}),
                        classify: async () => { throw new GateError('timeout'); },
                    }),
                },
                ai: { createProvider: () => ({}), envApiKeyAuth: () => ({}) },
                systemOne: { typesafeSystemOneApi: () => ({}) },
            }),
        },
    }) as { testGateModel: typeof TestGateModel };

    const result = await testGateModel({
        getAgentGateModel: () => 'invented-decision-model',
        getAgentGateBaseUrl: () => 'http://127.0.0.1:3425/v1',
        getAgentGateApiKey: () => 'invented-key',
    });
    t.equal(result.success, false);
    t.type(result.latencyMs, 'number', 'the measured time is reported');
    t.equal(result.error, 'The decision model did not answer within 5 seconds. Live use allows 2 seconds.');
});
