import t, { type Test } from 'tap';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AppState } from '../../electron/main';

const file = (name: string) => path.resolve(`electron/${name}.ts`);

function platform(t: Test, value: string) {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { configurable: true, value });
    t.teardown(() => Object.defineProperty(process, 'platform', original));
}

t.test('protection toggles persist and broadcast without changing the dock, tray or focus', async t => {
    platform(t, 'darwin');
    const dock: string[] = [];
    const tray: string[] = [];
    const focus: number[] = [];
    const blur: boolean[] = [];
    const writes: Array<[string, boolean]> = [];
    const windows = [1, 2, 3, 4].map(id => ({
        id, isDestroyed: () => false, isVisible: () => true, isFocused: () => true,
        focus: () => focus.push(id),
        messages: [] as unknown[][],
        webContents: { send: (...args: unknown[]) => { windows[id - 1].messages.push(args); } },
    }));
    const protection = Array.from({ length: 4 }, () => [] as boolean[]);
    const state = {
        isUndetectable: false,
        windowHelper: {
            setContentProtection: (value: boolean) => protection[0].push(value),
            getMainWindow: () => windows[0], getLauncherWindow: () => windows[0], getOverlayWindow: () => windows[1],
        },
        settingsWindowHelper: {
            setContentProtection: (value: boolean) => protection[1].push(value),
            getSettingsWindow: () => windows[2], setIgnoreBlur: (value: boolean) => blur.push(value),
        },
        modelSelectorWindowHelper: {
            setContentProtection: (value: boolean) => protection[2].push(value),
            getWindow: () => windows[3], setIgnoreBlur: (value: boolean) => blur.push(value),
        },
        cropperWindowHelper: { setContentProtection: (value: boolean) => protection[3].push(value) },
    } as unknown as AppState;
    const { setUndetectable, getUndetectable } = mockRequire(file('helpers/stealth'), {
        electron: { app: { dock: { hide: () => dock.push('hide'), show: () => dock.push('show') } } },
        [file('lib/tray-menu')]: { hideTray: () => tray.push('hide'), showTray: () => tray.push('show') },
        [file('services/SettingsManager')]: { SettingsManager: { getInstance: () => ({
            set: (key: string, value: boolean) => writes.push([key, value]),
        }) } },
    }) as typeof import('../../electron/helpers/stealth');

    for (const value of [true, false]) {
        setUndetectable(state, value);
        t.equal(getUndetectable(state), value, 'the public getter reflects the changed state');
        const expected = value ? [true] : [true, false];
        t.same(protection, Array.from({ length: 4 }, () => expected), 'all four helpers receive protection immediately');
        t.same(writes, expected.map(value => ['isUndetectable', value]), 'the existing setting is persisted');
        for (const win of windows) {
            t.same(win.messages, expected.map(value => ['undetectable-changed', value]), 'each distinct window receives one event');
        }
        setUndetectable(state, value);
        // Observe the old debounce too, so a delayed hide cannot pass this regression test.
        await delay(200);
        t.same(protection, Array.from({ length: 4 }, () => expected), 'a repeated state does not reapply protection');
        t.same(writes, expected.map(value => ['isUndetectable', value]), 'a repeated state does not save again');
        for (const win of windows) {
            t.same(win.messages, expected.map(value => ['undetectable-changed', value]), 'a repeated state does not broadcast again');
        }
        t.same(dock, [], 'neither dock.hide nor dock.show is called');
        t.same(tray, [], 'neither hideTray nor showTray is called');
        t.same(focus, [], 'toggling does not restore or steal focus');
        t.same(blur, [], 'toggling does not change blur handling');
    }
});

for (const os of ['darwin', 'win32', 'linux']) {
    t.test(`${os}: protected startup shows the tray and Pika identity; activation only restores windows`, async t => {
        platform(t, os);
        const stored = { isUndetectable: true };
        const settings = { get: (key: keyof typeof stored) => stored[key] };
        const dock: string[] = [];
        const tray: string[] = [];
        const names: string[] = [];
        const handlers = new Map<string, () => void>();
        let mainWindow: object | null = null;
        let visible = false;
        let meeting = false;
        let created = 0;
        let restored = 0;
        let preloaded = 0;
        let registered = 0;
        const noop = () => {};
        const trayMenu = { showTray: () => tray.push('show'), hideTray: () => tray.push('hide') };
        const state = {
            getUndetectable: () => settings.get('isUndetectable'), getIsMeetingActive: () => meeting,
            processingHelper: { loadStoredCredentials: noop },
            settingsWindowHelper: { preloadWindow: () => { preloaded++; } },
            createWindow: () => { created++; mainWindow = {}; visible = true; },
            showTray: () => trayMenu.showTray(),
            getIntelligenceManager: () => ({ recoverUnprocessedMeetings: async () => {} }),
            getMainWindow: () => mainWindow, isVisible: () => visible,
            toggleMainWindow: () => { restored++; visible = true; },
        };
        const { initializeApp } = mockRequire(file('lib/lifecycle'), {
            electron: {
                app: {
                    requestSingleInstanceLock: () => true, whenReady: async () => {}, quit: noop,
                    on: (event: string, handler: () => void) => handlers.set(event, handler),
                    setName: (name: string) => names.push(name), setAppUserModelId: noop,
                    dock: { hide: () => dock.push('hide'), show: () => dock.push('show') },
                    commandLine: { appendSwitch: noop },
                },
                BrowserWindow: { getAllWindows: () => [] },
            },
            [file('main')]: { AppState: { getInstance: () => state } },
            [path.resolve('electron/ipc/index.ts')]: { initializeIpcHandlers: noop },
            [file('services/SettingsManager')]: { SettingsManager: { getInstance: () => settings } },
            [file('services/CredentialsManager')]: { CredentialsManager: { getInstance: () => ({ init: noop, getGoogleServiceAccountPath: () => null }) } },
            [file('services/KeybindManager')]: { KeybindManager: { getInstance: () => ({ registerGlobalShortcuts: () => { registered++; } }) } },
            [file('services/OllamaManager')]: { OllamaManager: { getInstance: () => ({ init: async () => {} }) } },
            [file('lib/tray-menu')]: trayMenu,
            [file('agent/MeetingAgent')]: {},
        }) as typeof import('../../electron/lib/lifecycle');

        await initializeApp();
        t.equal(created, 1, 'startup creates the window');
        t.equal(preloaded, 1, 'Settings is still preloaded');
        t.equal(registered, 1, 'global shortcuts are still registered');
        t.same(names, ['Pika'], 'the name is set even with stored protection on');
        t.same(tray, ['show'], 'the tray is shown once even with stored protection on');
        t.same(dock, [], 'startup never touches the dock');
        const activate = handlers.get('activate')!;
        t.type(activate, 'function', 'the activation handler is registered');
        for (const protectedState of [true, false]) for (const activeMeeting of [false, true]) {
            stored.isUndetectable = protectedState;
            meeting = activeMeeting;
            const before = { created, restored };
            mainWindow = null;
            activate();
            t.equal(created, before.created + 1, 'activate recreates a missing window');
            visible = false;
            activate();
            t.equal(restored, before.restored + 1, 'activate restores a hidden window');
            activate();
            t.equal(restored, before.restored + 1, 'activate leaves an already visible window alone');
            t.same(dock, [], 'activate never touches the dock, regardless of protection or meeting state');
        }
        t.same(tray, ['show'], 'activation does not recreate or hide the tray');
    });
}
