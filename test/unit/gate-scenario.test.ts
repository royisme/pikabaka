import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { Gate, GateError } from '../../electron/agent/gate';
import type { GateInput } from '../../electron/agent/gate';
import type { createGateClassify as CreateGateClassify } from '../../electron/agent/models';

const credentials = {
    getAgentGateModel: () => 'invented-decision-model',
    getAgentGateBaseUrl: () => 'http://127.0.0.1:3425/v1',
    getAgentGateApiKey: () => 'invented-key',
};

async function classifyWith(scenario: string | undefined): Promise<Record<string, unknown>> {
    let request: Record<string, unknown> = {};
    const { createGateClassify } = mockRequire(path.resolve('electron/agent/models.ts'), {
        [path.resolve('electron/agent/gate.ts')]: { GateError },
        [path.resolve('electron/agent/loader.ts')]: {
            loadAgentRuntime: async () => ({
                models: {
                    createModels: () => ({
                        setProvider: () => {},
                        getModelOfType: () => ({}),
                        classify: async (_model: unknown, req: Record<string, unknown>) => {
                            request = req;
                            return {
                                stopReason: 'stop',
                                answers: {
                                    help: { type: 'bool', probability: 0.9 },
                                    kind: { type: 'choice', choice: 'nothing', probabilities: { nothing: 0.8 }, confidence: 0.8 },
                                },
                            };
                        },
                    }),
                },
                ai: { createProvider: () => ({}), envApiKeyAuth: () => ({}) },
                systemOne: { typesafeSystemOneApi: () => ({}) },
            }),
        },
    }) as { createGateClassify: typeof CreateGateClassify };
    const classify = await createGateClassify(credentials);
    await classify!(
        { lines: [{ speaker: 'Them', text: 'An invented question?' }], userLanguage: 'english-us', secondsSinceCard: 0, scenario },
        { signal: new AbortController().signal, timeoutMs: 1000 },
    );
    return request;
}

t.test('the classifier state carries the scenario brief when one is set', async t => {
    const request = await classifyWith('An invented weekly class.');
    const state = request.state as Record<string, unknown>;
    t.equal(state.scenario, 'An invented weekly class.');
    const questions = request.questions as { help: { instructions: string } };
    t.match(questions.help.instructions, /scenario/);
});

t.test('the classifier state has no scenario key without a brief', async t => {
    const request = await classifyWith(undefined);
    t.notOk('scenario' in (request.state as object));
});

for (const [name, brief] of [['a brief', 'An invented weekly class.'], ['no brief', undefined]] as const) {
    t.test(`the Gate passes ${name} into the classifier input`, async t => {
        const seen: GateInput[] = [];
        const done = new Promise<void>(resolve => {
            const gate = new Gate({
                getClassifier: () => async input => { seen.push(input); return { help: 0.1, kind: 'nothing', kindProbability: 0.9 }; },
                getSettings: () => ({ mode: 'log', threshold: 0.5, cooldownSeconds: 0, model: 'invented' }),
                now: () => Date.now(),
                getSegmentRevision: () => 1,
                isMeetingActive: () => true,
                getLines: () => [{ speaker: 'Them', text: 'An invented question?' }],
                getUserLanguage: () => 'english-us',
                getScenario: () => brief,
                log: () => resolve(),
            });
            gate.onSegment({ meetingId: 'm1', segmentId: 's1', revision: 1 });
        });
        await done;
        t.equal(seen.length, 1);
        t.equal(seen[0].scenario, brief);
    });
}
