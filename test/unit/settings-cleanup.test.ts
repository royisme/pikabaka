import t from 'tap';
import path from 'node:path';
import { speechHost } from '../helpers/speechSettingsHost';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AppState } from '../../electron/main';

t.test('Soniox field, Save enablement and submit share the typed key', async t => {
    let submitted = false;
    const host = speechHost({
        testSttConnection: async () => ({ success: true }),
        setSonioxApiKey: async (key: string) => { submitted = key === 'invented-soniox-key'; return { success: true }; },
    });
    t.teardown(host.unmount);
    host.click('Add provider'); host.change('select', 'Service', 'soniox');
    t.equal(host.control('button', 'Save').props.disabled, true, 'Save checks the empty shared key');
    host.change('input', 'API key', 'invented-soniox-key');
    t.ok(host.control('input', 'API key').props.value === 'invented-soniox-key', 'the field displays the shared key');
    t.equal(host.control('button', 'Save').props.disabled, false, 'Save checks the typed shared key');
    host.click('Save'); await host.settle();
    t.ok(submitted, 'Save submits the same key');
});

t.test('ElevenLabs key test requires a successful response and returns real failures', async t => {
    type Result = { success: boolean; error?: string };
    let testKey: ((_event: unknown, provider: string, apiKey: string) => Promise<Result>) | undefined;
    let failure: unknown;
    let requests = 0;
    const { registerSttHandlers } = mockRequire(path.resolve('electron/ipc/stt.ts'), {
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (channel: string, listener: typeof testKey) => {
            if (channel === 'test-stt-connection') testKey = listener;
        } },
        [path.resolve('electron/audio/AudioDevices.ts')]: { AudioDevices: {} },
        [path.resolve('electron/lib/transcript-assembler.ts')]: {},
        [path.resolve('electron/services/SettingsManager.ts')]: {},
        axios: { get: async (url: string) => {
            requests++;
            t.equal(url, 'https://api.elevenlabs.io/v1/voices');
            if (failure) throw failure;
            return { status: 200, data: { voices: [] } };
        } },
    }) as typeof import('../../electron/ipc/stt');
    registerSttHandlers({} as AppState);
    if (!testKey) throw new Error('Speech key test handler was not registered');
    t.same(await testKey(undefined, 'elevenlabs', 'invented-test-key'), { success: true });
    const failures = [
        { message: 'Network unavailable' },
        { message: 'Request timed out' },
        { message: 'Request failed', response: { data: { detail: { status: 'invalid_api_key', message: 'Key refused' } } } },
        { message: 'Request failed', response: { data: { detail: { status: 'missing_permissions', message: 'Voices permission required' } } } },
        { message: 'Request failed', response: { data: { message: 'Service unavailable' } } },
    ];
    const messages = ['Network unavailable', 'Request timed out', 'Key refused', 'Voices permission required', 'Service unavailable'];
    for (const [index, error] of failures.entries()) {
        failure = error;
        t.same(await testKey(undefined, 'elevenlabs', 'invented-test-key'), { success: false, error: messages[index] });
    }
    t.equal(requests, 6, 'every result comes from the mocked service request');
});
