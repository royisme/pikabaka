import t, { type Test } from 'tap';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type * as Settings from '../../electron/services/SettingsManager';

const file = (name: string) => path.resolve(`electron/${name}.ts`);

/** The scenario handlers over the real SettingsManager and a temporary settings.json. */
function handlers(t: Test) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-scenario-settings-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const s = mockRequire(file('services/SettingsManager'), {
        [file('services/configPaths')]: { getSettingsJsonPath: () => path.join(dir, 'settings.json') },
    }) as typeof Settings;
    const registered = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const { registerScenarioHandlers } = mockRequire(file('ipc/scenario'), {
        [file('ipc/safeHandle')]: {
            safeHandle: (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => registered.set(channel, handler),
        },
        [file('services/SettingsManager')]: s,
    }) as typeof import('../../electron/ipc/scenario');
    registerScenarioHandlers();
    return {
        manager: s.SettingsManager.getInstance(),
        invoke: (channel: string, payload?: unknown) => registered.get(channel)!({}, payload),
    };
}

t.test('scenario:set trims and stores one scenario, scenario:get reads it, and empty fields clear it', async (t) => {
    const f = handlers(t);
    t.same(await f.invoke('scenario:get'), { brief: '', answerLanguage: '', maxLength: 600 });

    t.same(await f.invoke('scenario:set', { brief: '  An invented class.  ', answerLanguage: ' French ' }), { success: true });
    t.same(f.manager.get('scenario'), { brief: 'An invented class.', answerLanguage: 'French' });
    t.same(await f.invoke('scenario:get'), { brief: 'An invented class.', answerLanguage: 'French', maxLength: 600 });

    t.same(await f.invoke('scenario:set', { brief: 'Only a brief.', answerLanguage: '  ' }), { success: true });
    t.same(f.manager.get('scenario'), { brief: 'Only a brief.' }, 'a blank language is not stored');

    t.same(await f.invoke('scenario:set', { brief: '', answerLanguage: 'French' }), { success: true });
    t.same(f.manager.get('scenario'), { brief: '', answerLanguage: 'French' }, 'a language alone is a scenario');

    t.same(await f.invoke('scenario:set', { brief: '', answerLanguage: '' }), { success: true });
    t.equal(f.manager.get('scenario'), undefined, 'empty fields remove the key');
});

t.test('a brief of exactly 600 characters is saved; one more is refused', async (t) => {
    const f = handlers(t);
    t.same(await f.invoke('scenario:set', { brief: 'a'.repeat(600) }), { success: true });
    const refused = await f.invoke('scenario:set', { brief: 'a'.repeat(601) }) as { success: boolean; error?: string };
    t.equal(refused.success, false);
    t.match(refused.error, /600/);
});

t.test('scenario:set rejects a bad value and writes nothing', async (t) => {
    const f = handlers(t);
    await f.invoke('scenario:set', { brief: 'Kept.' });
    for (const bad of [null, [], 'text', {}, { brief: 3 }, { brief: 'ok', answerLanguage: 4 }]) {
        const reply = await f.invoke('scenario:set', bad) as { success: boolean; error?: string };
        t.equal(reply.success, false, JSON.stringify(bad));
        t.ok(reply.error);
    }
    t.same(f.manager.get('scenario'), { brief: 'Kept.' });
});
