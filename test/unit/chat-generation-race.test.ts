import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

/**
 * The chat handlers' own stream id says "newest request", not "same meeting". These run the real handlers
 * with a synthetic model whose answer arrives after the meeting ended, and check nothing is written.
 */

const at = (name: string) => path.resolve(name);

type Sender = { sender: { send: (channel: string, data?: unknown) => void } };
type Handler = (event: Sender, ...args: unknown[]) => Promise<unknown>;

function load(state: unknown) {
    const handlers: Record<string, Handler> = {};
    const { registerCoreHandlers } = mockRequire(at('electron/ipc/core.ts'), {
        electron: { app: { getPath: () => '/invented', quit: () => {}, isPackaged: false } },
        [at('electron/main.ts')]: { AppState: class {} },
        [at('electron/ipc/safeHandle.ts')]: {
            safeHandle: (channel: string, listener: unknown) => { handlers[channel] = listener as Handler; },
        },
        [at('electron/ipc/rag.ts')]: { cancelActiveRagQueries: () => {} },
        [at('electron/lib/auto-updater.ts')]: { getUpdateState: () => ({}) },
        [at('electron/services/SettingsManager.ts')]: { SettingsManager: class {} },
        [at('electron/db/DatabaseManager.ts')]: { DatabaseManager: class {} },
    }) as { registerCoreHandlers: (appState: unknown) => void };
    registerCoreHandlers(state);
    return handlers;
}

function appState(options: { active: () => boolean; answer: () => Promise<string>; tokens: () => AsyncGenerator<string> }) {
    const writes: string[] = [];
    const state = {
        writes,
        getCurrentMeetingId: () => 'real-1',
        getIsMeetingActive: options.active,
        getIntelligenceManager: () => ({
            addTranscript: (entry: { text: string }) => { writes.push(`transcript:${entry.text}`); },
            addAssistantMessage: (text: string) => { writes.push(`assistant:${text}`); },
            logUsage: () => { writes.push('usage'); },
            getFormattedContext: () => '',
        }),
        processingHelper: {
            getLLMHelper: () => ({
                streamChat: options.tokens,
                chatWithGemini: options.answer,
            }),
        },
    };
    return state;
}

t.test('a stream whose meeting ended sends no further token and no done', async t => {
    let active = true;
    const state = appState({
        active: () => active,
        answer: async () => 'Invented answer.',
        tokens: async function* () {
            yield 'Invented first token.';
            active = false; // the user ends the meeting while the model is still talking
            yield 'Invented second token.';
        },
    });
    const sent: unknown[] = [];
    const event = { sender: { send: (channel: string, data?: unknown) => sent.push({ channel, data }) } };
    const handlers = load(state);

    await handlers['gemini-chat-stream'](event, 'Invented question.');

    t.same(sent, [
        { channel: 'gemini-stream-token', data: 'Invented first token.' },
    ], 'only the token from before the end reaches the renderer');
    t.same(state.writes.filter(write => write.startsWith('assistant:') || write === 'usage'), [], 'the answer and its usage stay out of the ended meeting');
});

t.test('a non-stream answer that arrives after the meeting ended writes nothing', async t => {
    let active = true;
    const state = appState({
        active: () => active,
        answer: async () => { active = false; return 'Invented late answer.'; },
        tokens: async function* () {},
    });
    const handlers = load(state);

    const result = await handlers['gemini-chat']({ sender: { send: () => {} } }, 'Invented question.');

    t.equal(result, 'Invented late answer.', 'the caller still gets its text');
    t.same(state.writes, [], 'no transcript row, no assistant message and no usage are written');
});

t.test('a stream that ends naturally after the meeting ended sends no done and writes nothing', async t => {
    let active = true;
    const state = appState({
        active: () => active,
        answer: async () => 'Invented answer.',
        tokens: async function* () {
            yield 'Invented only token.';
            active = false; // the meeting ends, then the provider finishes without another token
        },
    });
    const sent: unknown[] = [];
    const event = { sender: { send: (channel: string, data?: unknown) => sent.push({ channel, data }) } };
    const handlers = load(state);

    await handlers['gemini-chat-stream'](event, 'Invented question.');

    t.same(sent, [
        { channel: 'gemini-stream-token', data: 'Invented only token.' },
    ], 'only the token from before the end is sent, and no done follows');
    t.same(state.writes.filter(write => write.startsWith('assistant:') || write === 'usage'), [], 'no answer and no usage are written');
});
