import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AppState } from '../../electron/main';
import type { LLMHelper } from '../../electron/core/LLMHelper';

t.test('live query captures the real active id and keeps its existing IPC payloads', async t => {
    type Event = { sender: { send: (channel: string, data: unknown) => void } };
    let queryLive!: (event: Event, params: { query: string }) => Promise<unknown>;
    const { registerRagHandlers } = mockRequire(path.resolve('electron/ipc/rag.ts'), {
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (channel: string, listener: unknown) => {
            if (channel === 'rag:query-live') queryLive = listener as typeof queryLive;
        } },
        [path.resolve('electron/db/DatabaseManager.ts')]: { DatabaseManager: {} },
    }) as typeof import('../../electron/ipc/rag');
    let activeId: string | null = 'real-meeting-a';
    const ids: string[] = [];
    const rag = {
        isReady: () => true,
        getActiveLiveMeetingId: () => activeId,
        queryMeeting: async function* (id: string) {
            ids.push(id);
            activeId = 'real-meeting-b';
            yield 'Invented live reply';
        },
    };
    registerRagHandlers({ getRAGManager: () => rag } as unknown as AppState);
    const sent: unknown[] = [];
    const event = { sender: { send: (channel: string, data: unknown) => sent.push({ channel, data }) } };
    t.same(await queryLive(event, { query: 'Invented question' }), { success: true });
    t.same(ids, ['real-meeting-a'], 'query uses one captured indexer identity, never a provisional id');
    t.same(sent, [
        { channel: 'rag:stream-chunk', data: { live: true, chunk: 'Invented live reply' } },
        { channel: 'rag:stream-complete', data: { live: true } },
    ]);
    activeId = null;
    t.same(await queryLive(event, { query: 'Invented question' }), { fallback: true });
    t.same(ids, ['real-meeting-a'], 'no active identity means no live query');
});

t.test('meeting chat keeps role-separated turns, its exact context prompt and provider cancellation', async t => {
    type Params = { requestId: string; meetingId: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; context: string };
    type Event = { sender: { send: (channel: string, data: { chunk?: string; error?: string }) => void } };
    let chat: ((event: Event, params: Params) => Promise<{ success: boolean }>) | undefined;
    let cancel: ((_event: unknown, params: { requestId: string }) => Promise<{ success: boolean }>) | undefined;
    const { registerRagHandlers } = mockRequire(path.resolve('electron/ipc/rag.ts'), {
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (channel: string, listener: unknown) => {
            if (channel === 'chat:stream-meeting') chat = listener as typeof chat;
            if (channel === 'chat:cancel-stream') cancel = listener as typeof cancel;
        } },
        [path.resolve('electron/db/DatabaseManager.ts')]: { DatabaseManager: {} },
    }) as typeof import('../../electron/ipc/rag');
    const calls: Parameters<LLMHelper['streamChat']>[] = [];
    registerRagHandlers({ processingHelper: { getLLMHelper: () => ({ streamChat: async function* (...args: Parameters<LLMHelper['streamChat']>) {
        calls.push(args);
        yield 'invented first chunk';
        yield 'invented second chunk';
    } }) } } as unknown as AppState);
    if (!chat || !cancel) throw new Error('Meeting chat handlers were not registered');
    const sent: Array<{ channel: string; chunk?: string }> = [];
    const params: Params = {
        requestId: 'invented-request', meetingId: 'invented-meeting', context: 'Invented meeting context',
        messages: [{ role: 'user', content: 'Invented first question' }, { role: 'assistant', content: 'Invented first reply' }, { role: 'user', content: 'Invented follow-up' }],
    };
    t.same(await chat({ sender: { send: (channel, data) => { sent.push({ channel, chunk: data.chunk }); } } }, params), { success: true });
    t.equal(calls[0][0], 'Invented follow-up');
    t.same(calls[0][4]?.history, params.messages.slice(0, -1));
    t.equal(calls[0][4]?.verbatimPrompt, true);
    t.equal(calls[0][3], 'You are a helpful meeting assistant. Answer questions about this meeting based on the context provided. Be concise and accurate.\n\nInvented meeting context');
    t.ok(calls[0][4]?.signal instanceof AbortSignal);
    t.same(sent.map(message => message.channel), ['chat:stream-chunk', 'chat:stream-chunk', 'chat:stream-complete']);

    sent.length = 0;
    t.same(await chat({ sender: { send: (channel, data) => {
        sent.push({ channel, chunk: data.chunk });
        if (channel === 'chat:stream-chunk') void cancel!(undefined, { requestId: params.requestId });
    } } }, params), { success: true });
    t.equal(calls[1][4]?.signal?.aborted, true);
    t.same(sent, [{ channel: 'chat:stream-chunk', chunk: 'invented first chunk' }], 'no late token or completion after cancellation');

    const assistantEnding = params.messages.slice(0, -1);
    await chat({ sender: { send: () => {} } }, { ...params, messages: assistantEnding });
    t.equal(calls[2][0], undefined, 'no synthetic final user turn');
    t.same(calls[2][4]?.history, assistantEnding);
});
