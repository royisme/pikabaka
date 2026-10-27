import t from 'tap';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AppState } from '../../electron/main';

t.test('automatic checks respect the live setting and update state survives deferred notices', async t => {
    let autoCheck: boolean | undefined;
    let checks = 0;
    let meetingActive = false;
    const broadcasts: string[] = [];
    const updater = Object.assign(new EventEmitter(), {
        checkForUpdates: async () => { checks++; },
    });
    const { setupAutoUpdater, getUpdateState, checkForUpdates, flushPendingUpdateNotice } = mockRequire(
        path.resolve('electron/lib/auto-updater.ts'),
        {
            electron: { app: { isPackaged: true } },
            'electron-updater': { autoUpdater: updater },
            [path.resolve('electron/services/SettingsManager.ts')]: {
                SettingsManager: { getInstance: () => ({ get: () => autoCheck }) },
            },
            [path.resolve('electron/update/ReleaseNotesManager.ts')]: {
                ReleaseNotesManager: { getInstance: () => ({ fetchReleaseNotes: async () => null }) },
            },
        }
    ) as typeof import('../../electron/lib/auto-updater');
    const appState = {
        broadcast: (channel: string) => { broadcasts.push(channel); },
        getIsMeetingActive: () => meetingActive,
    } as unknown as AppState;
    const originalTimeout = global.setTimeout;
    const originalInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    const originalNow = Date.now;
    let startupCheck: () => void = () => { throw new Error('Startup check not scheduled'); };
    let periodicCheck: () => void = () => { throw new Error('Periodic check not scheduled'); };
    let intervalStopped = false;
    let now = 1000;
    global.setTimeout = ((callback: () => void, delay: number) => {
        t.equal(delay, 10000, 'startup check waits ten seconds');
        startupCheck = callback;
    }) as unknown as typeof setTimeout;
    global.setInterval = ((callback: () => void, delay: number) => {
        t.equal(delay, 4 * 60 * 60 * 1000, 'periodic check waits four hours');
        periodicCheck = callback;
    }) as unknown as typeof setInterval;
    global.clearInterval = (() => { intervalStopped = true; }) as typeof clearInterval;
    Date.now = () => now;
    try {
        setupAutoUpdater(appState);
        t.same(getUpdateState(), {
            autoCheck: true, checking: false, lastCheckedAt: null,
            availableVersion: null, downloadedVersion: null,
        }, 'missing setting defaults on, no check is invented');
        autoCheck = false;
        startupCheck();
        periodicCheck();
        t.equal(checks, 0, 'both automatic checks skip when disabled');
        t.equal(getUpdateState().autoCheck, false);
        await checkForUpdates(appState);
        t.equal(checks, 1, 'manual checks still run while disabled');
        autoCheck = true;
        startupCheck();
        periodicCheck();
        t.equal(checks, 3, 'both timers read the changed setting without restart');

        updater.emit('checking-for-update');
        t.equal(getUpdateState().checking, true);
        updater.emit('update-available', { version: '9.0.0' });
        await Promise.resolve();
        t.match(getUpdateState(), { checking: false, lastCheckedAt: 1000, availableVersion: '9.0.0' });
        t.ok(broadcasts.includes('update-available'));
        updater.emit('checking-for-update');
        updater.emit('error', new Error('Invented update failure'));
        t.equal(getUpdateState().checking, false, 'an error ends checking');
        t.equal(getUpdateState().lastCheckedAt, 1000, 'an error is not a completed check');
        now = 2000;
        updater.emit('checking-for-update');
        updater.emit('update-not-available', { version: '8.0.0' });
        t.match(getUpdateState(), { checking: false, lastCheckedAt: 2000, availableVersion: null });

        meetingActive = true;
        updater.emit('update-available', { version: '9.0.0' });
        await Promise.resolve();
        updater.emit('update-downloaded', { version: '9.0.0' });
        t.equal(getUpdateState().downloadedVersion, '9.0.0', 'ready state is kept during a meeting');
        t.notOk(broadcasts.includes('update-downloaded'), 'the notice still waits for the meeting');
        t.ok(intervalStopped, 'a completed download stops periodic checks');
        meetingActive = false;
        flushPendingUpdateNotice(appState);
        t.equal(broadcasts.filter(channel => channel === 'update-downloaded').length, 1);
        flushPendingUpdateNotice(appState);
        t.equal(broadcasts.filter(channel => channel === 'update-downloaded').length, 1, 'notice flushes once');
    } finally {
        global.setTimeout = originalTimeout;
        global.setInterval = originalInterval;
        global.clearInterval = originalClearInterval;
        Date.now = originalNow;
    }
});
