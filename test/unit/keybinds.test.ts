import t from 'tap';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

function fixture(saved: { id: string; accelerator: string }[] = []) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pika-keybinds-'));
    const file = path.join(directory, 'keybinds.json');
    fs.writeFileSync(file, JSON.stringify(saved));
    const registered = new Map<string, () => void>();
    const refused = new Set<string>();
    const throwing = new Set<string>();
    const attempts: string[] = [];
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const updates: { channel: string; data: unknown }[] = [];
    const { KeybindManager, DEFAULT_KEYBINDS } = mockRequire(
        path.resolve('electron/services/KeybindManager.ts'),
        {
            electron: {
                app: { name: 'Pika', getPath: () => directory },
                globalShortcut: {
                    register: (accelerator: string, callback: () => void) => {
                        attempts.push(accelerator);
                        if (throwing.has(accelerator)) throw new Error('Invented registration failure');
                        if (refused.has(accelerator) || registered.has(accelerator)) return false;
                        registered.set(accelerator, callback);
                        return true;
                    },
                    isRegistered: (accelerator: string) => registered.has(accelerator),
                    unregister: (accelerator: string) => registered.delete(accelerator),
                    unregisterAll: () => registered.clear(),
                },
                Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
                BrowserWindow: {
                    getAllWindows: () => [{
                        isDestroyed: () => false,
                        webContents: { send: (channel: string, data: unknown) => updates.push({ channel, data }) },
                    }],
                },
                ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
            },
        }
    ) as typeof import('../../electron/services/KeybindManager');
    return {
        manager: KeybindManager.getInstance(), defaults: DEFAULT_KEYBINDS,
        registered, refused, throwing, attempts, handlers, updates, file,
        cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
    };
}

t.test('the default table has exactly six bound globals and five optional unbound globals', t => {
    const f = fixture();
    t.teardown(f.cleanup);
    t.same(f.defaults.filter(kb => kb.accelerator).map(kb => kb.id), [
        'general:toggle-visibility', 'general:toggle-mouse-passthrough', 'chat:whatToAnswer',
        'general:selective-screenshot', 'translation:toggle', 'general:reset-cancel',
    ]);
    t.same(f.defaults.filter(kb => !kb.accelerator).map(kb => kb.id), [
        'translation:toggle-original', 'window:move-up', 'window:move-down', 'window:move-left', 'window:move-right',
    ]);
    t.ok(f.defaults.every(kb => kb.isGlobal && kb.accelerator === kb.defaultAccelerator));
    t.same(f.defaults.slice(0, 4).map(kb => kb.accelerator), [
        'CommandOrControl+B', 'CommandOrControl+Shift+B', 'CommandOrControl+1', 'CommandOrControl+Shift+H',
    ]);
    t.equal(f.defaults[4].accelerator, process.platform === 'win32' ? 'Control+Shift+F9' : 'CommandOrControl+Alt+T');
    t.equal(f.defaults[5].accelerator, 'CommandOrControl+R');
    t.equal(f.defaults[3].label, 'Capture Selected Area');
    t.equal(f.defaults[5].label, 'Stop Generation');
    f.manager.setMode('overlay');
    t.equal(f.registered.size, 6);
    t.ok(f.manager.getAllKeybinds().filter(kb => kb.accelerator).every(kb => kb.registered));
    t.end();
});

t.test('saved unknown and removed ids are ignored, without aliases or a migration', t => {
    const saved = [
        { id: 'invented:unknown', accelerator: 'CommandOrControl+9' },
        { id: 'chat:recap', accelerator: 'CommandOrControl+8' },
        { id: 'chat:followup', accelerator: 'CommandOrControl+7' },
        { id: 'general:process-screenshots', accelerator: 'CommandOrControl+Enter' },
        { id: 'translation:toggle-original', accelerator: 'CommandOrControl+Alt+O' },
    ];
    const f = fixture(saved);
    t.teardown(f.cleanup);
    t.equal(f.manager.getAllKeybinds().length, 11);
    for (const { id } of saved.slice(0, 4)) t.equal(f.manager.getKeybind(id), undefined);
    t.equal(f.manager.getKeybind('translation:toggle-original'), 'CommandOrControl+Alt+O');
    t.same(JSON.parse(fs.readFileSync(f.file, 'utf8')), saved, 'loading does not rewrite the saved file');
    t.end();
});

t.test('a conflicting Pika shortcut is refused without swapping, registering or saving', t => {
    const f = fixture();
    t.teardown(f.cleanup);
    f.manager.setMode('overlay');
    const before = f.manager.getAllKeybinds();
    const disk = fs.readFileSync(f.file, 'utf8');
    f.attempts.length = 0;
    t.same(f.manager.setKeybind('chat:whatToAnswer', 'shift+commandorcontrol+b'), {
        success: false, error: 'Already used by Toggle Mouse Passthrough',
    });
    const explicitMod = process.platform === 'darwin' ? 'Command' : 'Ctrl';
    t.same(f.manager.setKeybind('chat:whatToAnswer', `${explicitMod}+B`), {
        success: false, error: 'Already used by Toggle Visibility',
    });
    t.same(f.manager.getAllKeybinds(), before);
    t.equal(fs.readFileSync(f.file, 'utf8'), disk);
    t.same(f.attempts, []);
    t.end();
});

t.test('OS refusal or exception keeps the previous binding and its registration', t => {
    const f = fixture();
    t.teardown(f.cleanup);
    f.manager.setMode('overlay');
    const old = f.manager.getKeybind('chat:whatToAnswer')!;
    const before = f.manager.getAllKeybinds();
    const disk = fs.readFileSync(f.file, 'utf8');
    f.refused.add('CommandOrControl+9');
    f.throwing.add('CommandOrControl+8');
    for (const accelerator of ['CommandOrControl+9', 'CommandOrControl+8']) {
        t.match(f.manager.setKeybind('chat:whatToAnswer', accelerator), { success: false, error: /another app/i });
        t.equal(f.manager.getKeybind('chat:whatToAnswer'), old);
        t.ok(f.registered.has(old));
        t.same(f.manager.getAllKeybinds(), before);
        t.equal(fs.readFileSync(f.file, 'utf8'), disk);
    }
    t.end();
});

t.test('startup registration failures are returned to Settings and can be retried', t => {
    const f = fixture();
    t.teardown(f.cleanup);
    const accelerator = f.manager.getKeybind('chat:whatToAnswer')!;
    f.refused.add(accelerator);
    f.manager.setMode('overlay');
    t.match(f.manager.getAllKeybinds().find(kb => kb.id === 'chat:whatToAnswer'), { accelerator, registered: false });
    t.equal(f.manager.setKeybind('chat:whatToAnswer', accelerator).success, false);
    t.equal(f.manager.getKeybind('chat:whatToAnswer'), accelerator);
    f.refused.delete(accelerator);
    t.same(f.manager.setKeybind('chat:whatToAnswer', accelerator), { success: true });
    t.match(f.manager.getAllKeybinds().find(kb => kb.id === 'chat:whatToAnswer'), { registered: true });
    t.same(f.manager.setKeybind('chat:whatToAnswer', accelerator), { success: true }, 'saving the same active chord succeeds');
    t.end();
});

t.test('launcher registers only visibility, including when optional shortcuts have saved bindings', t => {
    const f = fixture([
        { id: 'translation:toggle-original', accelerator: 'CommandOrControl+Alt+O' },
        { id: 'window:move-up', accelerator: 'CommandOrControl+Shift+Up' },
    ]);
    t.teardown(f.cleanup);
    f.manager.registerGlobalShortcuts();
    t.same([...f.registered.keys()], ['CommandOrControl+B']);
    t.same(f.attempts, ['CommandOrControl+B']);
    f.manager.setMode('overlay');
    t.equal(f.registered.size, 8);
    f.attempts.length = 0;
    f.manager.setMode('launcher');
    t.same([...f.registered.keys()], ['CommandOrControl+B']);
    t.same(f.attempts, ['CommandOrControl+B']);
    t.ok(f.manager.getAllKeybinds().every(kb => kb.registered), 'bindings that launcher mode leaves inactive are not reported as failed');
    f.attempts.length = 0;
    t.same(f.manager.setKeybind('window:move-down', 'CommandOrControl+Shift+Down'), { success: true });
    t.same([...f.registered.keys()], ['CommandOrControl+B'], 'editing an overlay binding does not activate it in launcher mode');
    t.same(f.attempts, [], 'launcher never attempts to register an overlay-only shortcut');
    t.end();
});

t.test('set, clear, reset and IPC keep their contracts and persist only ids and accelerators', t => {
    const f = fixture();
    t.teardown(f.cleanup);
    f.manager.setMode('overlay');
    f.manager.setupIpcHandlers();
    t.same([...f.handlers.keys()], ['keybinds:get-all', 'keybinds:set', 'keybinds:reset']);
    const set = (id: string, accelerator: string) => f.handlers.get('keybinds:set')!(null, id, accelerator);
    t.same(set('translation:toggle-original', 'CommandOrControl+Alt+O'), { success: true });
    t.ok(f.registered.has('CommandOrControl+Alt+O'));
    t.same(set('translation:toggle-original', ''), { success: true });
    t.notOk(f.registered.has('CommandOrControl+Alt+O'));
    t.equal(f.manager.getKeybind('translation:toggle-original'), '');
    t.same(set('invented:unknown', 'CommandOrControl+9'), { success: false, error: 'Unknown shortcut' });
    t.same(f.handlers.get('keybinds:set')!(null, null, 42), { success: false, error: 'Invalid shortcut' });
    const stored = JSON.parse(fs.readFileSync(f.file, 'utf8')) as object[];
    t.equal(stored.length, 11);
    t.ok(stored.every(kb => Object.keys(kb).sort().join(',') === 'accelerator,id'));
    t.same(f.handlers.get('keybinds:get-all')!(), f.manager.getAllKeybinds());
    t.ok(f.updates.every(update => update.channel === 'keybinds:update'));
    t.same(f.updates.at(-1)?.data, f.manager.getAllKeybinds());
    const fired: string[] = [];
    f.manager.onShortcutTriggered(id => fired.push(id));
    f.registered.get('CommandOrControl+B')!();
    t.same(fired, ['general:toggle-visibility']);
    set('chat:whatToAnswer', '');
    const reset = f.handlers.get('keybinds:reset')!();
    t.same(reset, f.manager.getAllKeybinds());
    t.equal(f.manager.getKeybind('chat:whatToAnswer'), 'CommandOrControl+1');
    t.equal(f.registered.size, 6);
    t.end();
});
