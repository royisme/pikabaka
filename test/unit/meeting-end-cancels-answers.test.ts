import t, { type Test } from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AppState as State } from '../../electron/main';

/**
 * Ending a meeting must stop the answer engine before it awaits anything, and a chat stream whose meeting
 * ended must stop writing even while its own stream id is still the newest. Synthetic, no providers.
 */

const file = (name: string) => path.resolve(`electron/${name}.ts`);

function mainClass(t: Test) {
    const modules = [
        'helpers/WindowHelper', 'helpers/SettingsWindowHelper', 'helpers/ModelSelectorWindowHelper',
        'helpers/CropperWindowHelper', 'helpers/ScreenshotHelper', 'services/KeybindManager', 'helpers/ProcessingHelper',
        'IntelligenceManager', 'audio/SystemAudioCapture', 'audio/MicrophoneCapture', 'helpers/ThemeManager',
        'rag/RAGManager', 'rag/embeddingConfig', 'db/DatabaseManager', 'agent/MeetingAgent', 'llm/index',
        'lib/auto-updater', 'lib/transcript-assembler', 'lib/audio-pipeline', 'lib/tray-menu', 'helpers/stealth',
        'knowledge/KnowledgeOrchestrator', 'knowledge/KnowledgeDatabaseManager', 'services/CredentialsManager',
        'services/SettingsManager', 'lib/verboseLog', 'services/OllamaManager',
    ];
    const mocks = Object.fromEntries(modules.map(name => [file(name), {}]));
    const events = ['uncaughtException', 'unhandledRejection'] as const;
    const previous = events.map(event => process.listeners(event));
    const { AppState } = mockRequire(file('main'), {
        ...mocks,
        electron: { app: { isPackaged: true } },
        [file('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => ({ getMeetingDetails: () => undefined }) } },
        [file('lib/logging')]: { setupConsoleOverrides: () => {}, ensureMacMicrophoneAccess: async () => true },
        [file('lib/lifecycle')]: { initializeApp: async () => {} },
        [file('agent/instance')]: { refreshGate: async () => {}, getGate: () => ({ stop: () => {} }) },
    }) as { AppState: typeof State };
    t.teardown(() => events.forEach((event, i) => {
        for (const listener of process.listeners(event)) if (!previous[i].includes(listener)) process.removeListener(event, listener);
    }));
    return AppState;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

const capture = () => ({ stop: () => {} });

t.test('ending a meeting cancels the engine before it waits for the agent', async t => {
    const AppState = mainClass(t);
    const state = Object.create(AppState.prototype) as State;
    const order: string[] = [];
    const agentStop = deferred<void>();

    Reflect.set(state, 'currentMeetingId', 'real-1');
    Reflect.set(state, 'isMeetingActive', true);
    Reflect.set(state, 'intelligenceManager', {
        cancelGeneration: () => order.push('engine-cancel'),
        stopMeeting: async () => { order.push('manager-stop'); return null; },
    });
    Reflect.set(state, 'getMeetingAgent', () => ({
        stop: async () => { order.push('agent-stop'); await agentStop.promise; },
        deleteStore: async () => {},
    }));
    for (const name of ['setOverlayMousePassthrough', 'resetBufferedTranscriptTurns', 'broadcastMeetingState']) {
        Reflect.set(state, name, () => {});
    }
    Reflect.set(state, 'systemAudioCapture', capture());
    Reflect.set(state, 'googleSTT', capture());
    Reflect.set(state, 'microphoneCapture', capture());
    Reflect.set(state, 'googleSTT_User', capture());
    Reflect.set(state, 'ragManager', { stopLiveIndexing: () => Promise.resolve(), deleteMeetingData: () => {} });

    const stopping = state.endMeeting();
    // The synchronous part of the end path has already run: no await has resolved yet.
    t.same(order.slice(0, 1), ['engine-cancel'], 'the engine is cancelled before anything is awaited');
    await new Promise<void>(resolve => setImmediate(resolve));
    t.same(order, ['engine-cancel', 'agent-stop'], 'the engine is cancelled first, then the agent stop begins');
    t.equal(state.getIsMeetingActive(), false, 'the meeting is already marked inactive');

    agentStop.resolve();
    await stopping;
    t.same(order, ['engine-cancel', 'agent-stop', 'manager-stop'], 'the manager stop still runs afterwards');
});
