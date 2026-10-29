import t, { type Test } from 'tap';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AppState as State } from '../../electron/main';

const file = (name: string) => path.resolve(`electron/${name}.ts`);

function settingsStore(t: Test, isUndetectable = false) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-identity-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const settingsPath = path.join(dir, 'settings.json');
    const stored = { disguiseMode: 'terminal', isUndetectable, privateBuildOption: { enabled: true } };
    writeFileSync(settingsPath, JSON.stringify(stored));
    const { SettingsManager } = mockRequire(file('services/SettingsManager'), {
        [file('services/configPaths')]: { getSettingsJsonPath: () => settingsPath },
    }) as typeof import('../../electron/services/SettingsManager');
    return { SettingsManager, settingsPath, stored };
}

t.test('stealth keeps protection but exports no process disguise API', t => {
    const stealth = mockRequire(file('helpers/stealth'), {
        electron: { app: {} },
        [file('services/SettingsManager')]: {},
        [file('lib/tray-menu')]: {},
    }) as typeof import('../../electron/helpers/stealth');
    t.type(stealth.setUndetectable, 'function');
    t.type(stealth.getUndetectable, 'function');
    for (const name of ['setDisguise', '_applyDisguise', 'applyInitialDisguise', 'getDisguise']) {
        t.notOk(name in stealth, `${name} is not exported`);
    }
    t.end();
});

t.test('saving another setting preserves the dormant disguise value and unknown keys on reload', t => {
    const { SettingsManager, settingsPath, stored } = settingsStore(t);
    SettingsManager.getInstance().set('verboseLogging', true);
    t.same(JSON.parse(readFileSync(settingsPath, 'utf8')), { ...stored, verboseLogging: true });
    Reflect.set(SettingsManager, 'instance', undefined);
    t.equal(SettingsManager.getInstance().get('verboseLogging'), true, 'the saved setting is read back');
    SettingsManager.getInstance().set('verboseLogging', false);
    t.same(JSON.parse(readFileSync(settingsPath, 'utf8')), { ...stored, verboseLogging: false });
    t.end();
});

for (const platform of ['darwin', 'win32'] as const) for (const protectedStartup of [false, true]) {
    t.test(`${platform}: lifecycle ignores stored Terminal disguise${protectedStartup ? ' while protected' : ''}`, async t => {
        const { SettingsManager } = settingsStore(t, protectedStartup);
        const reads: string[] = [];
        const settings = SettingsManager.getInstance();
        const get = settings.get.bind(settings);
        settings.get = key => { reads.push(key); return get(key); };
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        const originalTitle = Object.getOwnPropertyDescriptor(process, 'title')!;
        const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
        const originalBundleName = process.env.CFBundleName;
        const titles: string[] = [];
        Object.defineProperty(process, 'platform', { configurable: true, value: platform });
        Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/synthetic-pika-resources' });
        Object.defineProperty(process, 'title', { configurable: true, get: () => originalTitle.value, set: (value: string) => titles.push(value) });
        t.teardown(() => {
            Object.defineProperty(process, 'platform', originalPlatform);
            Object.defineProperty(process, 'title', originalTitle);
            if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
            else Reflect.deleteProperty(process, 'resourcesPath');
            if (originalBundleName === undefined) delete process.env.CFBundleName;
            else process.env.CFBundleName = originalBundleName;
        });
        const names: string[] = [];
        const aumids: string[] = [];
        let created = 0;
        const noop = () => {};
        const app = {
            isPackaged: true, requestSingleInstanceLock: () => true, whenReady: async () => {},
            on: noop, quit: noop, commandLine: { appendSwitch: noop },
            setName: (name: string) => names.push(name), setAppUserModelId: (id: string) => aumids.push(id),
            dock: { hide: noop, show: noop, setIcon: noop },
        };
        class WindowHelper {
            setContentProtection = noop;
            setWindowHelper = noop;
            preload = noop;
            preloadWindow = noop;
            createWindow = () => { created++; };
            getMainWindow = () => null;
            getLauncherWindow = () => null;
            getOverlayWindow = () => null;
            getSettingsWindow = () => null;
        }
        const keybinds = { setWindowHelper: noop, setupIpcHandlers: noop, onUpdate: noop, onShortcutTriggered: noop, registerGlobalShortcuts: noop };
        const credentials = { init: noop, getGoogleServiceAccountPath: () => null };
        const electron = { app, BrowserWindow: { getAllWindows: () => [] } };
        const stealth = mockRequire(file('helpers/stealth'), {
            electron, [file('services/SettingsManager')]: { SettingsManager }, [file('lib/tray-menu')]: {},
        });
        const modules = [
            'audio/SystemAudioCapture', 'audio/MicrophoneCapture', 'rag/RAGManager', 'rag/embeddingConfig',
            'db/DatabaseManager', 'agent/MeetingAgent', 'lib/auto-updater', 'lib/transcript-assembler',
            'lib/audio-pipeline', 'knowledge/KnowledgeOrchestrator', 'knowledge/KnowledgeDatabaseManager',
        ];
        const events = ['uncaughtException', 'unhandledRejection'] as const;
        const previous = events.map(event => process.listeners(event));
        const { AppState } = mockRequire(file('main'), {
            ...Object.fromEntries(modules.map(name => [file(name), {}])), electron,
            [file('helpers/WindowHelper')]: { WindowHelper },
            [file('helpers/SettingsWindowHelper')]: { SettingsWindowHelper: WindowHelper },
            [file('helpers/ModelSelectorWindowHelper')]: { ModelSelectorWindowHelper: WindowHelper },
            [file('helpers/CropperWindowHelper')]: { CropperWindowHelper: WindowHelper },
            [file('helpers/ScreenshotHelper')]: { ScreenshotHelper: class {} },
            [file('helpers/ProcessingHelper')]: { ProcessingHelper: class { loadStoredCredentials = noop; getLLMHelper = noop; } },
            [file('IntelligenceManager')]: { IntelligenceManager: class { recoverUnprocessedMeetings = async () => {}; } },
            [file('helpers/ThemeManager')]: { ThemeManager: { getInstance: noop } },
            [file('services/KeybindManager')]: { KeybindManager: { getInstance: () => keybinds } },
            [file('services/CredentialsManager')]: { CredentialsManager: { getInstance: () => credentials } },
            [file('services/SettingsManager')]: { SettingsManager },
            [file('services/OllamaManager')]: {}, [file('llm/index')]: { warmupIntentClassifier: noop },
            [file('lib/logging')]: { setupConsoleOverrides: noop }, [file('lib/verboseLog')]: { setVerboseLoggingFlag: noop },
            [file('lib/transcript-assembler')]: { isTranscriptAssemblerProfile: () => false, DEFAULT_TRANSCRIPT_ASSEMBLER_PROFILE: 'sentence_bias' },
            [file('lib/tray-menu')]: { showTray: noop }, [file('helpers/stealth')]: stealth,
            [file('lib/lifecycle')]: { initializeApp: async () => {} }, [file('agent/instance')]: {},
        }) as { AppState: typeof State };
        t.teardown(() => events.forEach((event, i) => {
            for (const listener of process.listeners(event)) if (!previous[i].includes(listener)) process.removeListener(event, listener);
        }));
        for (const name of ['initializeRAGManager', 'bootstrapOllamaEmbeddings', 'setupIntelligenceEvents', 'setupOllamaIpcHandlers', 'setupAutoUpdater']) {
            Reflect.set(AppState.prototype, name, noop);
        }
        t.teardown(() => {
            const timers = Reflect.get(AppState.getInstance(), '_disguiseTimers') as NodeJS.Timeout[] | undefined;
            timers?.forEach(clearTimeout);
        });
        const { initializeApp } = mockRequire(file('lib/lifecycle'), {
            electron, [file('main')]: { AppState }, [path.resolve('electron/ipc/index.ts')]: { initializeIpcHandlers: noop },
            [file('services/SettingsManager')]: { SettingsManager },
            [file('services/CredentialsManager')]: { CredentialsManager: { getInstance: () => credentials } },
            [file('services/KeybindManager')]: { KeybindManager: { getInstance: () => keybinds } },
            [file('services/OllamaManager')]: { OllamaManager: { getInstance: () => ({ init: async () => {} }) } },
            [file('agent/MeetingAgent')]: {},
        }) as typeof import('../../electron/lib/lifecycle');
        await initializeApp();
        t.equal(created, 1, 'startup actually creates the launcher');
        t.same(names, ['Pika'], 'only Pika is set, once, regardless of protection');
        t.same(titles, [], 'startup never assigns process.title');
        t.same(aumids, platform === 'win32' ? ['com.pika.assistant.none'] : [], 'Windows keeps default pin grouping');
        t.notOk(reads.includes('disguiseMode'), 'the dormant key is not read by AppState');
        t.equal(process.env.CFBundleName, originalBundleName, 'startup does not rewrite CFBundleName');
    });
}
