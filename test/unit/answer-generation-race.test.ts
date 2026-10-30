import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { IntelligenceEngine as Engine } from '../../electron/core/IntelligenceEngine';

/**
 * An answer that was asked in one meeting must not be written, emitted or used to reset the mode after the
 * user ended that meeting or started a newer answer. These run the real engine against synthetic LLMs whose
 * promises settle late, on purpose.
 */

const at = (name: string) => path.resolve(name);

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function session() {
    const written: string[] = [];
    const usage: string[] = [];
    return {
        written,
        usage,
        getFormattedContext: () => 'Them: invented transcript line.',
        getContext: () => [{ role: 'them', text: 'invented transcript line', timestamp: 1 }],
        getLastThemTurn: () => ({ speaker: 'them', text: 'invented transcript line', timestamp: 1 }),
        getAssistantResponseHistory: () => [],
        getLastInterimThem: () => null,
        getLastAssistantMessage: () => 'Invented previous answer.',
        getDetectedCodingQuestion: () => ({ question: null, source: null }),
        setRecapLLM: () => {},
        addAssistantMessage: (text: string) => { written.push(text); },
        pushUsage: (entry: { type: string }) => { usage.push(entry.type); },
    };
}

// A stream that only produces what the test releases, and otherwise stays open.
const gated = (gate: Promise<void>, token?: string) => (async function* () {
    await gate;
    if (token !== undefined) yield token;
})();
const hang = () => gated(new Promise(() => {}));
type Settlement = { generate?: Promise<string>; tokens?: (call: number) => AsyncGenerator<string> };

/** One engine per test, with synthetic LLMs whose results the test settles by hand. */
function host(settlement: Settlement) {
    const classify = deferred<{ intent: string; confidence: number }>();
    let streamCalls = 0;
    class StubLLM {
        constructor(_helper: unknown) {}
        generate(): Promise<string> { return settlement.generate ?? Promise.resolve('Invented model answer.'); }
        generateStream(): AsyncGenerator<string> {
            // Call 1 is the run under test; later calls are the newer run, which must stay in flight.
            streamCalls += 1;
            return settlement.tokens?.(streamCalls) ?? hang();
        }
    }
    const stub = () => StubLLM;
    const { IntelligenceEngine } = mockRequire(at('electron/core/IntelligenceEngine.ts'), {
        [at('electron/llm/index.ts')]: {
            AnswerLLM: stub(), AssistLLM: stub(), ClarifyLLM: stub(), FollowUpLLM: stub(), RecapLLM: stub(),
            FollowUpQuestionsLLM: stub(), WhatToAnswerLLM: stub(), CodeHintLLM: stub(), BrainstormLLM: stub(),
            classifyIntent: () => classify.promise,
            prepareTranscriptForWhatToAnswer: () => 'Invented transcript.',
            buildTemporalContext: () => ({ previousResponses: [], toneSignals: [] }),
        },
    }) as { IntelligenceEngine: typeof Engine };

    const tracker = session();
    const engine = new IntelligenceEngine({} as never, tracker as never);
    const events: string[] = [];
    for (const name of [
        'suggested_answer', 'suggested_answer_token', 'refined_answer', 'recap', 'clarify',
        'assist_update', 'manual_answer_result', 'error', 'mode_changed',
    ]) {
        engine.on(name as never, (...args: unknown[]) => events.push(`${name}:${String(args[0] instanceof Error ? args[0].message : args[0] ?? '')}`));
    }
    return { engine, classify, tracker, events };
}

t.test('a classification that settles after a newer run started answers nothing', async t => {
    // The newer run's stream stays open (call 1). A run that wrongly entered streaming after the late
    // classification would take call 2, which ends by itself, so the wrong answer fails assertions
    // instead of hanging the test.
    const h = host({
        tokens: call => call === 1 ? hang() : gated(Promise.resolve(), 'Invented late token.'),
    });
    const run = h.engine.runWhatShouldISay('Invented question.');
    await tick();
    const newer = h.engine.runClarify();
    h.classify.resolve({ intent: 'answer', confidence: 0.9 });
    t.equal(await run, null, 'the superseded classification returns nothing');

    t.equal(h.events.some(event => event.startsWith('suggested_answer')), false, 'no token and no answer are emitted');
    t.equal(h.events.includes('mode_changed:idle'), false, 'and it does not idle the newer run');
    t.equal(h.engine.getActiveMode(), 'clarify', 'the newer mode is still the active one');
    void newer;
});

t.test('a fallback answer that fails after a newer run started reports nothing', async t => {
    const failure = deferred<string>();
    const h = host({ generate: failure.promise });
    Reflect.set(h.engine, 'whatToAnswerLLM', null);
    const run = h.engine.runWhatShouldISay('Invented question.');
    await tick();
    const newer = h.engine.runClarify();
    failure.reject(new Error('Synthetic provider failure'));
    t.equal(await run, null);

    t.equal(h.events.some(event => event === 'error:Synthetic provider failure'), false, 'the stale failure is not reported');
    t.equal(h.tracker.written.length, 0, 'and nothing is written to the session');
    t.equal(h.engine.getActiveMode(), 'clarify', 'the newer mode is untouched');
    void newer;
});

t.test('a manual answer that fails after a newer run started reports nothing', async t => {
    const failure = deferred<string>();
    const h = host({ generate: failure.promise });
    const run = h.engine.runManualAnswer('Invented question.');
    await tick();
    const newer = h.engine.runClarify();
    failure.reject(new Error('Synthetic provider failure'));
    t.equal(await run, null);

    t.equal(h.events.some(event => event === 'error:Synthetic provider failure'), false);
    t.equal(h.tracker.written.length, 0);
    t.equal(h.engine.getActiveMode(), 'clarify');
    void newer;
});

t.test('an assist insight that fails after a newer run started reports nothing', async t => {
    const failure = deferred<string>();
    const h = host({ generate: failure.promise });
    Reflect.set(h.engine, 'activeMode', 'idle');
    const run = h.engine.runAssistMode();
    await tick();
    const newer = h.engine.runClarify();
    failure.reject(new Error('Synthetic provider failure'));
    t.equal(await run, null);

    t.equal(h.events.some(event => event === 'error:Synthetic provider failure'), false);
    t.equal(h.engine.getActiveMode(), 'clarify');
    void newer;
});

t.test('an old stream that ends without a token writes nothing and keeps the newer mode', async t => {
    const finish = deferred<void>();
    const h = host({
        // No token: the loop ends on its own, the way a provider can finish after the meeting ended.
        tokens: call => call === 1 ? gated(finish.promise) : hang(),
    });
    const run = h.engine.runRecap();
    await tick();
    const newer = h.engine.runClarify();
    finish.resolve();
    t.equal(await run, null, 'the old run ends without writing');

    t.equal(h.events.includes('recap:'), false, 'no recap is emitted');
    t.equal(h.tracker.usage.length, 0, 'no usage is recorded');
    t.equal(h.engine.getActiveMode(), 'clarify', 'the newer mode survives the old completion');
    void newer;
});

t.test('an old stream that completes late cannot idle a newer run', async t => {
    const finish = deferred<void>();
    const h = host({
        tokens: call => call === 1 ? gated(finish.promise, 'Invented late token.') : hang(),
    });
    const run = h.engine.runBrainstorm(undefined, 'Invented problem statement.');
    await tick();
    const newer = h.engine.runClarify();
    finish.resolve();
    t.equal(await run, null, 'a superseded stream returns nothing');

    t.equal(h.events.some(event => event.startsWith('suggested_answer')), false, 'no token reaches the overlay');
    t.equal(h.tracker.written.length, 0, 'the half answer stays out of the session');
    t.equal(h.engine.getActiveMode(), 'clarify', 'the newer mode is not switched to idle');
    void newer;
});

t.test('a cancelled stream that ends without a last token writes nothing', async t => {
    // The first token is consumed, then the terminal next() blocks; the run is superseded and only then done.
    const terminal = deferred<void>();
    const tokenConsumed = deferred<void>();
    const h = host({
        tokens: call => call === 1
            ? (async function* () {
                yield 'Invented first token.';
                // Reached only when the engine asks for the next token, so the first one has been handled.
                tokenConsumed.resolve();
                await terminal.promise;
            })()
            : hang(),
    });
    const run = h.engine.runWhatShouldISay('Invented question.');
    await tick();
    h.classify.resolve({ intent: 'answer', confidence: 0.9 });
    await tokenConsumed.promise;
    t.equal(h.events.some(event => event.startsWith('suggested_answer_token:')), true, 'the first token was seen before the newer run');
    const newer = h.engine.runClarify();
    terminal.resolve();
    t.equal(await run, null, 'the superseded run answers nothing');

    // The first token was emitted while the run was still current; the final answer must not follow.
    t.equal(h.events.some(event => event.startsWith('suggested_answer:')), false, 'no final answer is emitted');
    t.equal(h.tracker.written.length, 0, 'nothing reaches the session');
    t.equal(h.tracker.usage.length, 0, 'no usage is recorded');
    t.equal(h.engine.getActiveMode(), 'clarify', 'the newer mode is preserved');
    void newer;
});

for (const [name, start] of [
    ['manual', (engine: Engine) => engine.runManualAnswer('Invented question.')],
    ['fallback', (engine: Engine) => engine.runWhatShouldISay('Invented question.')],
    ['assist', (engine: Engine) => engine.runAssistMode()],
] as const) {
    t.test(`a ${name} answer that succeeds after a newer run started is not used`, async t => {
        const success = deferred<string>();
        const h = host({ generate: success.promise });
        Reflect.set(h.engine, 'whatToAnswerLLM', null);
        Reflect.set(h.engine, 'activeMode', 'idle');
        const run = start(h.engine);
        await tick();
        const newer = h.engine.runClarify();
        success.resolve('Invented late answer.');
        t.equal(await run, null, 'the superseded run returns nothing');

        t.equal(h.tracker.written.length, 0, 'no answer reaches the session');
        t.equal(h.tracker.usage.length, 0, 'no usage is recorded');
        t.equal(h.events.some(event => event.startsWith('suggested_answer:') || event.startsWith('manual_answer_result:') || event.startsWith('assist_update:')), false, 'nothing is emitted for the stale run');
        t.equal(h.engine.getActiveMode(), 'clarify', 'the newer mode is preserved');
        void newer;
    });
}
