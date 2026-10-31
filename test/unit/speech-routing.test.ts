import t, { type Test } from 'tap';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TranscriptPanel from '../../src/components/meeting/TranscriptPanel';
import { audioStatus } from '../../src/lib/audioStatus';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AppState } from '../../electron/main';

const file = (name: string) => path.resolve(`electron/${name}.ts`);
const services = [
    ['deepgram', 'Deepgram', 'getDeepgramApiKey', 'DeepgramStreamingSTT'],
    ['soniox', 'Soniox', 'getSonioxApiKey', 'SonioxStreamingSTT'],
    ['elevenlabs', 'ElevenLabs', 'getElevenLabsApiKey', 'ElevenLabsStreamingSTT'],
    ['openai', 'OpenAI', 'getOpenAiSttApiKey', 'OpenAIStreamingSTT'],
    ['groq', 'Groq', 'getGroqSttApiKey', 'RestSTT'],
    ['azure', 'Azure', 'getAzureApiKey', 'RestSTT'],
    ['ibmwatson', 'IBM Watson', 'getIbmWatsonApiKey', 'RestSTT'],
];

function pipeline(service: string | undefined, credential?: string) {
    const constructed: string[] = [];
    const argumentsByProvider: unknown[][] = [];
    const started: string[] = [];
    const credentials = {
        getSttProvider: () => service || 'google',
        getSttLanguage: () => 'english-us', getSttLanguageUser: () => 'japanese',
        getSttModel: () => 'invented-model', getGroqSttModel: () => 'invented-groq-model',
        getAzureRegion: () => 'westeurope', getIbmWatsonRegion: () => 'us-south',
        getGoogleServiceAccountPath: () => credential,
        ...Object.fromEntries(services.map(([, , getter]) => [getter, () => credential])),
    };
    const modules = ['GoogleSTT', 'RestSTT', 'DeepgramStreamingSTT', 'SonioxStreamingSTT', 'ElevenLabsStreamingSTT', 'OpenAIStreamingSTT', 'SystemAudioCapture', 'MicrophoneCapture'];
    const mocks = Object.fromEntries(modules.map(name => [file(`audio/${name}`), { [name]: class extends EventEmitter {
        model?: string;
        language?: string;
        constructor(...args: unknown[]) { super(); constructed.push(name); argumentsByProvider.push(args); }
        setModel(model: string) { this.model = model; }
        setRecognitionLanguage(language: string) { this.language = language; }
        setSampleRate() {}
        setAudioChannelCount() {}
        getSampleRate() { return 48000; }
        start() { started.push(name); }
    } }]));
    const audio = mockRequire(file('lib/audio-pipeline'), {
        ...mocks,
        electron: {},
        [file('services/CredentialsManager')]: { CredentialsManager: { getInstance: () => credentials } },
        [file('lib/transcript-assembler')]: {},
    }) as typeof import('../../electron/lib/audio-pipeline');
    const captures = Object.fromEntries(['SystemAudioCapture', 'MicrophoneCapture'].map(name => [file(`audio/${name}`), mocks[file(`audio/${name}`)]]));
    return { audio, captures, constructed, argumentsByProvider, started };
}

for (const [id, name, , provider] of services) {
    t.test(`${name}: a missing key refuses the selected service, never constructing Google`, t => {
        for (const key of [undefined, '', '   ']) {
            const f = pipeline(id, key);
            for (const speaker of ['them', 'user'] as const) {
                t.throws(() => f.audio.createSTTProvider({} as AppState, speaker), {
                    message: `${name} is not configured: add its key in Provider setup.`,
                });
            }
            t.same(f.constructed, [], 'no provider is constructed');
        }
        t.end();
    });
    t.test(`${name}: a saved key constructs only its own provider with the existing model and speaker languages`, t => {
        const f = pipeline(id, 'invented-key');
        const theirs = f.audio.createSTTProvider({} as AppState, 'them');
        const yours = f.audio.createSTTProvider({} as AppState, 'user');
        t.same(f.constructed, [provider, provider]);
        const expected = provider === 'RestSTT'
            ? [id, 'invented-key', id === 'groq' ? 'invented-groq-model' : undefined, id === 'groq' ? undefined : id === 'azure' ? 'westeurope' : 'us-south']
            : ['invented-key'];
        t.ok(f.argumentsByProvider.every(args => JSON.stringify(args) === JSON.stringify(expected)), 'the original credential/model/region arguments reach only the chosen service');
        t.equal(Reflect.get(theirs, 'model'), 'invented-model');
        t.equal(Reflect.get(yours, 'model'), 'invented-model');
        t.equal(Reflect.get(theirs, 'language'), 'english-us');
        t.equal(Reflect.get(yours, 'language'), 'japanese');
        t.end();
    });
}

t.test('Google, explicit or legacy default, requires the saved service-account file', t => {
    for (const selected of ['google', undefined]) {
        const missing = pipeline(selected);
        t.throws(() => missing.audio.createSTTProvider({} as AppState, 'them'), {
            message: 'Google Cloud is not configured: choose its service-account file in Provider setup.',
        });
        t.same(missing.constructed, []);
        const configured = pipeline(selected, '/synthetic/account.json');
        const stt = configured.audio.createSTTProvider({} as AppState, 'them');
        t.same(configured.constructed, ['GoogleSTT']);
        t.equal(Reflect.get(stt, 'language'), 'english-us');
    }
    t.end();
});

function meeting(t: Test, f: ReturnType<typeof pipeline>) {
    const modules = [
        'helpers/WindowHelper', 'helpers/SettingsWindowHelper', 'helpers/ModelSelectorWindowHelper',
        'helpers/CropperWindowHelper', 'helpers/ScreenshotHelper', 'services/KeybindManager', 'helpers/ProcessingHelper',
        'IntelligenceManager', 'audio/SystemAudioCapture', 'audio/MicrophoneCapture', 'helpers/ThemeManager',
        'rag/RAGManager', 'rag/embeddingConfig', 'db/DatabaseManager', 'agent/MeetingAgent', 'llm/index',
        'lib/auto-updater', 'lib/transcript-assembler', 'lib/tray-menu', 'helpers/stealth',
        'knowledge/KnowledgeOrchestrator', 'knowledge/KnowledgeDatabaseManager', 'services/CredentialsManager',
        'services/SettingsManager', 'lib/verboseLog', 'services/OllamaManager',
    ];
    const events = ['uncaughtException', 'unhandledRejection'] as const;
    const previous = events.map(event => process.listeners(event));
    const { AppState: State } = mockRequire(file('main'), {
        ...Object.fromEntries(modules.map(name => [file(name), {}])),
        electron: { app: { isPackaged: true } },
        ...f.captures,
        [file('lib/audio-pipeline')]: f.audio,
        [file('lib/logging')]: { setupConsoleOverrides: () => {}, ensureMacMicrophoneAccess: async () => true },
        [file('lib/lifecycle')]: { initializeApp: async () => {} },
        [file('agent/instance')]: { refreshGate: async () => {} },
    }) as typeof import('../../electron/main');
    t.teardown(() => events.forEach((event, i) => {
        for (const listener of process.listeners(event)) if (!previous[i].includes(listener)) process.removeListener(event, listener);
    }));
    const state = Object.create(State.prototype) as AppState;
    const broadcasts: Array<{ channel: string; payload: unknown }> = [];
    Reflect.set(state, 'broadcast', (channel: string, payload: unknown) => broadcasts.push({ channel, payload }));
    Reflect.set(state, 'intelligenceManager', { startMeeting: () => null, setMeetingMetadata: () => {} });
    Reflect.set(state, 'getWindowHelper', () => ({ getOverlayWindow: () => undefined, getLauncherWindow: () => undefined }));
    for (const name of ['setMicrophoneMuted', 'resetBufferedTranscriptTurns', 'broadcastMeetingState']) Reflect.set(state, name, () => {});
    return { state, broadcasts };
}

for (const [id, name] of [...services, ['google', 'Google Cloud']]) for (const devices of [false, true]) {
    t.test(`meeting start with unconfigured ${name}${devices ? ' and chosen devices' : ''} broadcasts the exact setup error once and starts nothing`, async t => {
        const f = pipeline(id);
        const { state, broadcasts } = meeting(t, f);
        await state.startMeeting(devices ? { audio: { inputDeviceId: 'synthetic-input', outputDeviceId: 'synthetic-output' } } : undefined);
        await new Promise(resolve => setTimeout(resolve, 20));
        const message = id === 'google'
            ? 'Google Cloud is not configured: choose its service-account file in Provider setup.'
            : `${name} is not configured: add its key in Provider setup.`;
        t.same(broadcasts, [{ channel: 'meeting-audio-error', payload: message }], 'one real error, no invented transcript');
        t.same(f.started, [], 'neither capture nor either speech stream starts');
        t.equal(state.getNativeAudioStatus().lastError, message, 'polling the existing status retains the exact error');
        t.equal(state.getNativeAudioStatus().connected, false);
        t.notOk(state.googleSTT);
        t.notOk(state.googleSTT_User);
    });
}

t.test('meeting start with a configured service starts both captures and only the selected speech streams', async t => {
    const f = pipeline('deepgram', 'invented-key');
    const { state, broadcasts } = meeting(t, f);
    await state.startMeeting();
    await new Promise(resolve => setTimeout(resolve, 20));
    t.same(f.started, ['SystemAudioCapture', 'DeepgramStreamingSTT', 'MicrophoneCapture', 'DeepgramStreamingSTT']);
    t.same(broadcasts, []);
    t.equal(state.getNativeAudioStatus().lastError, null);
    t.equal(state.getNativeAudioStatus().connected, true);
});

t.test('the meeting overlay polls the retained setup error and shows its real message with the existing repair action', async t => {
    const f = pipeline('deepgram');
    const { state } = meeting(t, f);
    await state.startMeeting();
    await new Promise(resolve => setTimeout(resolve, 20));
    const values: unknown[] = [];
    const effects: Array<() => void | (() => void)> = [];
    let index = 0;
    let mounted = false;
    let polls = 0;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        electronAPI: { getNativeAudioStatus: async () => { polls++; return state.getNativeAudioStatus(); } },
        setInterval: () => 1, clearInterval: () => {},
    } });
    const { useMeetingAudio } = mockRequire(path.resolve('src/hooks/useMeetingAudio.ts'), {
        react: {
            useState: (initial: unknown) => {
                const slot = index++;
                if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
                return [values[slot], (next: unknown) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
            },
            useRef: (current: unknown) => {
                const slot = index++;
                return values[slot] ??= { current };
            },
            useMemo: (fn: () => unknown) => fn(),
            useEffect: (effect: () => void | (() => void)) => { if (!mounted) effects.push(effect); },
        },
        [path.resolve('src/hooks/useMainEvent.ts')]: { useMainEvent: () => {} },
    }) as typeof import('../../src/hooks/useMeetingAudio');
    useMeetingAudio(); mounted = true;
    const cleanups = effects.map(effect => effect());
    t.teardown(() => cleanups.forEach(cleanup => cleanup?.()));
    await new Promise(resolve => setImmediate(resolve));
    index = 0;
    const audio = useMeetingAudio();
    const status = audioStatus(audio.audioStatusInput);
    t.equal(polls, 1, 'the existing status IPC is read, not a fabricated UI error');
    t.equal(status.detail, state.lastAudioPipelineError);
    const html = renderToStaticMarkup(React.createElement(TranscriptPanel, {
        transcriptSegments: [], livePartial: null,
        transcriptDisplayMode: 'original', translationEnabled: false, showTranscript: true,
        handleTranslateTranscriptSegment: () => {}, status, onFixAudio: () => {},
    }));
    t.match(html, 'Deepgram is not configured: add its key in Provider setup.');
    t.match(html, '✕');
    t.match(html, 'Fix audio');
});
