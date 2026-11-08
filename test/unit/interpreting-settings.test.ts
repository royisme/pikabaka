import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { CredentialsManager } from '../../electron/services/CredentialsManager';

function setup() {
    const cm = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(cm, 'credentials', {});
    let saves = 0;
    Reflect.set(cm, 'saveCredentials', () => { saves++; });
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const { registerInterpretingHandlers } = mockRequire(path.resolve('electron/ipc/interpreting.ts'), {
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
        [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => cm } },
    }) as typeof import('../../electron/ipc/interpreting');
    registerInterpretingHandlers();
    const invoke = (name: string, input?: unknown) => handlers.get(name)!(undefined, input);
    return { cm, invoke, saves: () => saves };
}

t.test('Interpreting is off by default and a saved setting reads back', async t => {
    const { invoke } = setup();
    t.same(await invoke('interpreting:get-settings'), { enabled: false, noticeAcceptedAt: undefined, provider: 'fishaudio', voices: {}, outputLabel: '' });
    const next = {
        enabled: true, noticeAcceptedAt: '2026-01-02T03:04:05.000Z', provider: 'elevenlabs',
        voices: { fishaudio: { voiceId: 'invented-voice', cloned: false }, elevenlabs: { voiceId: 'invented-clone', cloned: true, consentAt: '2026-01-02T03:04:05.000Z' } },
        outputLabel: 'Invented Virtual Cable',
    };
    t.same(await invoke('interpreting:set-settings', next), { success: true });
    t.same(await invoke('interpreting:get-settings'), next);
});

t.test('set changes only the fields it carries', async t => {
    const { invoke } = setup();
    await invoke('interpreting:set-settings', { provider: 'elevenlabs', outputLabel: 'Invented Cable' });
    await invoke('interpreting:set-settings', { enabled: true });
    t.match(await invoke('interpreting:get-settings'), { enabled: true, provider: 'elevenlabs', outputLabel: 'Invented Cable' });
});

t.test('set rejects bad input with a real error and stores nothing', async t => {
    const { invoke, saves } = setup();
    await t.rejects(invoke('interpreting:set-settings', { provider: 'invented-service' }), /Unknown voice service: invented-service/);
    await t.rejects(invoke('interpreting:set-settings', { outputLabel: 42 }), /outputLabel.*string/);
    await t.rejects(invoke('interpreting:set-settings', { enabled: 'yes' }), /enabled/);
    await t.rejects(invoke('interpreting:set-settings', { voices: { other: { voiceId: 'x', cloned: false } } }), /Unknown voice service: other/);
    await t.rejects(invoke('interpreting:set-settings', { voices: { fishaudio: { voiceId: 7, cloned: false } } }), /voiceId/);
    await t.rejects(invoke('interpreting:set-settings', { enabled: true, outputLabel: 42 }), /outputLabel/);
    t.equal(saves(), 0, 'nothing was saved');
    t.match(await invoke('interpreting:get-settings'), { enabled: false, outputLabel: '' }, 'a mixed payload applies none of it');
});

t.test('the Fish Audio key is stored but never returned to the renderer', async t => {
    const { cm, invoke } = setup();
    t.same(await invoke('set-fish-audio-api-key', '  invented-fish-secret  '), { success: true });
    t.equal(cm.getAllCredentials().fishAudioApiKey, 'invented-fish-secret');
    t.notMatch(JSON.stringify(await invoke('interpreting:get-settings')), /invented-fish-secret|fishAudioApiKey/);
    await t.rejects(invoke('set-fish-audio-api-key', 42), /string/);
});
