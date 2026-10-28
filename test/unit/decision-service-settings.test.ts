import t from 'tap';
import { isDeepStrictEqual } from 'node:util';
import * as ReactQuery from 'react-query';
import { gateHost, gateSettings } from '../helpers/gateSettingsHost';

type Payload = Parameters<Window['electronAPI']['agentGateSetSettings']>[0];
const noop = () => {};
ReactQuery.setLogger({ log: noop, warn: noop, error: noop });
t.teardown(() => ReactQuery.setLogger(console));

t.test('Proactive help has a plain setup link, keeps its Test, and saves exactly its behaviour fields', async t => {
    const writes: Payload[] = [];
    const tests: unknown[] = [];
    let opened = 0;
    const host = gateHost('ProactiveHelpSettings', {
        agentGateSetSettings: async (payload: Payload) => { writes.push(payload); return { success: true }; },
        agentGateTest: async (payload: unknown) => { tests.push(payload); return { success: true, help: 0.8, kind: 'answer_question', latencyMs: 12 }; },
    }, gateSettings, () => { opened++; });
    t.teardown(host.unmount);
    t.notMatch(host.html(), 'type="password"');
    t.notMatch(host.html(), '>Base URL</label>');
    t.notMatch(host.html(), '>Remove</button>');
    host.click('Provider setup');
    t.equal(opened, 1, 'the link calls Settings navigation');
    t.equal(host.control('button', 'Provider setup').props.type, 'button');
    host.change('input', 'Model id', 'invented-new-model');
    host.click('Test decision model'); await host.settle();
    t.ok(isDeepStrictEqual(tests, [{ model: 'invented-new-model', baseUrl: gateSettings.baseUrl }]), 'existing Test uses the saved endpoint/key and draft model');
    t.match(host.html(), 'It decided help is 80% likely');
    host.click('Save proactive help settings'); await host.settle();
    t.ok(isDeepStrictEqual(writes, [{ mode: 'log', model: 'invented-new-model', threshold: 0.7, cooldownSeconds: 120 }]), 'exact behaviour-only payload');
    t.match(host.html(), 'Latest decisions');
});

t.test('two independently cached stale pages preserve each other in either save order with exact partial payloads', async t => {
    for (const providerFirst of [true, false]) {
        const writes: Payload[] = [];
        let stored = { ...gateSettings, apiKey: 'invented-original-key' };
        const api = {
            agentGateGetSettings: async () => ({ ...gateSettings, model: stored.model, baseUrl: stored.baseUrl, hasApiKey: !!stored.apiKey }),
            agentGateSetSettings: async (payload: Payload) => { writes.push(payload); stored = { ...stored, ...payload }; return { success: true }; },
        };
        const provider = gateHost('DecisionServiceSettings', api);
        const proactive = gateHost('ProactiveHelpSettings', api);
        t.teardown(provider.unmount); t.teardown(proactive.unmount);
        provider.change('input', 'Base URL', 'http://localhost:4321/v1');
        provider.change('input', 'API key', 'invented-replacement-key');
        proactive.change('input', 'Model id', 'invented-new-model');
        const saveProvider = async () => { provider.click('Save'); await provider.settle(); };
        const saveProactive = async () => { proactive.click('Save proactive help settings'); await proactive.settle(); };
        if (providerFirst) { await saveProvider(); await saveProactive(); }
        else { await saveProactive(); await saveProvider(); }
        const endpoint = { baseUrl: 'http://localhost:4321/v1', apiKey: 'invented-replacement-key' };
        const behaviour = { mode: 'log', model: 'invented-new-model', threshold: 0.7, cooldownSeconds: 120 };
        t.ok(isDeepStrictEqual(writes, providerFirst ? [endpoint, behaviour] : [behaviour, endpoint]), 'both saves send exactly their owned fields, even from a stale cache');
        t.ok(isDeepStrictEqual(stored, { ...gateSettings, ...endpoint, ...behaviour }), 'both edits survive, including the replacement key');
    }
});

t.test('Decision service Test uses the existing gate call with draft endpoint fields, saved-model fallback, and real results', async t => {
    const calls: unknown[] = [];
    let result: { success: boolean; error?: string; latencyMs?: number } = { success: false, error: 'Invented endpoint refused Test (403)' };
    let reject = false;
    const host = gateHost('DecisionServiceSettings', { agentGateTest: async (payload: unknown) => {
        calls.push(payload);
        if (reject) throw new Error('Invented Test IPC rejection');
        return result;
    } });
    t.teardown(host.unmount);
    t.match(host.html(), 'saved decision model');
    t.match(host.html(), 'not an endpoint-only check');
    host.change('input', 'Base URL', 'http://localhost:4321/v1');
    host.change('input', 'API key', 'invented-test-key');
    host.click('Test'); await host.settle();
    t.ok(isDeepStrictEqual(calls, [{ baseUrl: 'http://localhost:4321/v1', apiKey: 'invented-test-key' }]), 'exact draft fields, without overwriting or supplying a model');
    t.match(host.html(), '✕ Test failed: Invented endpoint refused Test (403)');
    t.match(host.html(), 'role="alert"');
    t.ok(host.control('input', 'API key').props.value === 'invented-test-key', 'failed Test retains the draft');
    host.change('input', 'API key', '');
    reject = true; host.click('Test'); await host.settle();
    t.ok(isDeepStrictEqual(calls[1], { baseUrl: 'http://localhost:4321/v1' }), 'blank draft leaves the existing saved-key fallback intact');
    t.match(host.html(), '✕ Test failed: Invented Test IPC rejection');
    reject = false; result = { success: true, latencyMs: 17 };
    host.click('Test'); await host.settle();
    t.match(host.html(), '● Test passed in 17 ms');
    t.notMatch(host.html(), 'Test failed:');
});

t.test('Remove key requires confirmation, calls the existing empty-key removal once, and refreshes key state', async t => {
    const writes: Payload[] = [];
    let hasApiKey = true;
    const host = gateHost('DecisionServiceSettings', {
        agentGateGetSettings: async () => ({ ...gateSettings, hasApiKey }),
        agentGateSetSettings: async (payload: Payload) => { writes.push(payload); hasApiKey = false; return { success: true }; },
    });
    t.teardown(host.unmount);
    host.change('input', 'API key', 'invented-unused-draft');
    host.click('Remove key');
    t.match(host.html(), 'Remove decision service key?');
    t.equal(writes.length, 0, 'first press never removes');
    host.click('Keep');
    t.equal(writes.length, 0, 'cancelling never removes');
    t.notMatch(host.html(), 'Remove decision service key?');
    host.click('Remove key'); host.click('Remove'); await host.settle();
    t.ok(isDeepStrictEqual(writes, [{ apiKey: '' }]), 'one removal, with only the existing apiKey empty-string field');
    t.match(host.html(), '○ No key');
    t.notMatch(host.html(), '>Remove key</button>');
    t.notMatch(host.html(), 'Remove decision service key?');
    t.equal(host.control('input', 'API key').props.value, '', 'a removed key is not silently replaced by an old draft');
});

t.test('refused and rejected saves on either page retain their drafts and show the real message', async t => {
    for (const page of ['DecisionServiceSettings', 'ProactiveHelpSettings'] as const) {
        for (const rejected of [false, true]) {
            let writes = 0;
            const message = `Invented ${page} ${rejected ? 'rejection' : 'save refusal'}`;
            const host = gateHost(page, { agentGateSetSettings: async () => {
                writes++;
                if (rejected) throw new Error(message);
                return { success: false, error: message };
            } });
            t.teardown(host.unmount);
            if (page === 'DecisionServiceSettings') {
                host.change('input', 'Base URL', 'http://localhost:4321/v1');
                host.change('input', 'API key', 'invented-retained-key');
                host.click('Save');
            } else {
                host.change('input', 'Model id', 'invented-retained-model');
                host.click('Save proactive help settings');
            }
            await host.settle();
            t.equal(writes, 1);
            t.match(host.html(), message);
            t.notMatch(host.html(), 'Saved!');
            t.notMatch(host.html(), '● Saved');
            if (page === 'DecisionServiceSettings') {
                t.match(host.html(), 'role="alert"');
                t.equal(host.control('input', 'Base URL').props.value, 'http://localhost:4321/v1');
                t.ok(host.control('input', 'API key').props.value === 'invented-retained-key', 'failed Save never drops a typed key');
            } else t.equal(host.control('input', 'Model id').props.value, 'invented-retained-model');
        }
    }
});

t.test('refused and rejected key removal keep the saved state and confirmation with the real error', async t => {
    for (const rejected of [false, true]) {
        const message = rejected ? 'Invented removal rejection' : 'Invented removal refusal';
        const host = gateHost('DecisionServiceSettings', { agentGateSetSettings: async () => {
            if (rejected) throw new Error(message);
            return { success: false, error: message };
        } });
        t.teardown(host.unmount);
        host.click('Remove key'); host.click('Remove'); await host.settle();
        t.match(host.html(), message);
        t.match(host.html(), 'role="alert"');
        t.match(host.html(), 'Key saved');
        t.match(host.html(), 'Remove decision service key?');
    }
});

t.test('Decision service edits its saved URL and write-only key and saves exactly its own fields', async t => {
    const writes: Payload[] = [];
    let saved = { ...gateSettings };
    const host = gateHost('DecisionServiceSettings', {
        agentGateGetSettings: async () => ({ ...saved }),
        agentGateSetSettings: async (payload: Payload) => {
            writes.push(payload);
            saved = { ...saved, baseUrl: payload.baseUrl ?? saved.baseUrl };
            return { success: true };
        },
    });
    t.teardown(host.unmount);
    t.match(host.html(), 'Key saved');
    t.equal(host.control('input', 'Base URL').props.value, gateSettings.baseUrl);
    t.equal(host.control('input', 'API key').props.value, '');
    t.equal(host.control('input', 'API key').props.type, 'password');
    host.change('input', 'Base URL', 'http://localhost:4321/v1');
    host.change('input', 'API key', 'invented-draft-key');
    host.click('Save'); await host.settle();
    t.ok(isDeepStrictEqual(writes, [{ baseUrl: 'http://localhost:4321/v1', apiKey: 'invented-draft-key' }]), 'exact URL/key payload, no behaviour fields');
    t.equal(host.control('input', 'API key').props.value, '', 'success clears the write-only draft');
    t.match(host.html(), '● Saved');
    host.click('Save'); await host.settle();
    t.ok(isDeepStrictEqual(writes[1], { baseUrl: 'http://localhost:4321/v1' }), 'an untouched blank key is omitted, never removed');
});
