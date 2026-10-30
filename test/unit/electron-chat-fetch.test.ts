import t from 'tap';
import { DefaultChatTransport } from 'ai';
import type { UIMessageChunk } from 'ai';
import { electronChatFetch } from '../../src/lib/electronChatFetch';

// The adapter's contract is what the installed SDK parses, not a format we invent: this feeds the
// real DefaultChatTransport synthetic IPC events and reads the chunks it produces.
type Listeners = {
    chunk: Array<(data: { requestId: string; chunk: string }) => void>;
    complete: Array<(data: { requestId: string }) => void>;
    error: Array<(data: { requestId: string; error: string }) => void>;
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type SendArgs = { requestId: string; meetingId: string; context: string; messages: Array<{ role: string; content: string }> };

t.test('the real SDK transport turns synthetic IPC text into message chunks', async t => {
    const listeners: Listeners = { chunk: [], complete: [], error: [] };
    let sent: SendArgs | undefined;
    const cancelled: string[] = [];

    const electronAPI = {
        onChatStreamChunk: (fn: Listeners['chunk'][number]) => { listeners.chunk.push(fn); return () => { listeners.chunk = listeners.chunk.filter((l) => l !== fn); }; },
        onChatStreamComplete: (fn: Listeners['complete'][number]) => { listeners.complete.push(fn); return () => { listeners.complete = listeners.complete.filter((l) => l !== fn); }; },
        onChatStreamError: (fn: Listeners['error'][number]) => { listeners.error.push(fn); return () => { listeners.error = listeners.error.filter((l) => l !== fn); }; },
        chatStreamMeeting: (args: SendArgs) => { sent = args; },
        chatCancelStream: (requestId: string) => { cancelled.push(requestId); },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI } });
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });

    const transport = new DefaultChatTransport({ fetch: electronChatFetch });
    const stream = await transport.sendMessages({
        trigger: 'submit-message',
        chatId: 'invented-chat',
        messageId: undefined,
        abortSignal: undefined,
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Invented question.' }] }],
    });

    // Deliver the main-process events once the request is in flight.
    const requestId = sent?.requestId;
    t.ok(requestId, 'the request reached the main process over IPC');

    const chunks: UIMessageChunk[] = [];
    const reader = stream.getReader();
    const readAll = (async () => {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            chunks.push(value);
        }
    })();

    listeners.chunk.forEach((fn) => fn({ requestId: requestId as string, chunk: 'Invented answer.' }));
    listeners.complete.forEach((fn) => fn({ requestId: requestId as string }));
    await readAll;

    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => (chunk as { delta: string }).delta).join('');
    t.equal(text, 'Invented answer.', 'the assistant text survives the SDK parser');
    t.ok(chunks.some((chunk) => chunk.type === 'start'), 'the message starts');
    t.ok(chunks.some((chunk) => chunk.type === 'text-start'), 'a text part starts');
    t.ok(chunks.some((chunk) => chunk.type === 'text-end'), 'the text part ends');
    t.ok(chunks.some((chunk) => chunk.type === 'finish'), 'the message finishes');
    t.equal(cancelled.length, 0, 'a completed stream is not cancelled');
    t.end();
});

t.test('a main-process error arrives as an error chunk and stops the listeners', async t => {
    const listeners: Listeners = { chunk: [], complete: [], error: [] };
    let sent: SendArgs | undefined;
    const electronAPI = {
        onChatStreamChunk: (fn: Listeners['chunk'][number]) => { listeners.chunk.push(fn); return () => { listeners.chunk = listeners.chunk.filter((l) => l !== fn); }; },
        onChatStreamComplete: (fn: Listeners['complete'][number]) => { listeners.complete.push(fn); return () => { listeners.complete = listeners.complete.filter((l) => l !== fn); }; },
        onChatStreamError: (fn: Listeners['error'][number]) => { listeners.error.push(fn); return () => { listeners.error = listeners.error.filter((l) => l !== fn); }; },
        chatStreamMeeting: (args: SendArgs) => { sent = args; },
        chatCancelStream: () => {},
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI } });
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });

    const transport = new DefaultChatTransport({ fetch: electronChatFetch });
    const stream = await transport.sendMessages({
        trigger: 'submit-message',
        chatId: 'invented-chat',
        messageId: undefined,
        abortSignal: undefined,
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Invented question.' }] }],
    });

    const chunks: UIMessageChunk[] = [];
    const reader = stream.getReader();
    const readAll = (async () => {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            chunks.push(value);
        }
    })();

    listeners.error.forEach((fn) => fn({ requestId: (sent?.requestId as string), error: 'Invented stream failure.' }));
    await readAll;

    const error = chunks.find((chunk) => chunk.type === 'error') as { errorText: string } | undefined;
    t.equal(error?.errorText, 'Invented stream failure.', 'the real error text reaches the message');
    t.equal(listeners.chunk.length, 0, 'the chunk listener is disposed once the stream ended');
    t.end();
});

function fakeApi(reply: { success?: boolean; error?: string } = { success: true }) {
    const listeners: Listeners = { chunk: [], complete: [], error: [] };
    const calls = { started: 0, cancelled: 0 };
    let lastId = '';
    const api = {
        onChatStreamChunk: (fn: Listeners['chunk'][number]) => { listeners.chunk.push(fn); return () => { listeners.chunk = listeners.chunk.filter((l) => l !== fn); }; },
        onChatStreamComplete: (fn: Listeners['complete'][number]) => { listeners.complete.push(fn); return () => { listeners.complete = listeners.complete.filter((l) => l !== fn); }; },
        onChatStreamError: (fn: Listeners['error'][number]) => { listeners.error.push(fn); return () => { listeners.error = listeners.error.filter((l) => l !== fn); }; },
        chatStreamMeeting: (args: { requestId: string }) => { calls.started += 1; lastId = args.requestId; return Promise.resolve(reply); },
        chatCancelStream: () => { calls.cancelled += 1; return Promise.resolve({ success: true }); },
    };
    return { api, listeners, calls, id: () => lastId };
}

async function readRawText(stream: ReadableStream<Uint8Array>) {
    const bytes: number[] = [];
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return new TextDecoder().decode(new Uint8Array(bytes));
        bytes.push(...value);
    }
}

async function readAll(stream: ReadableStream<UIMessageChunk>) {
    const chunks: UIMessageChunk[] = [];
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return chunks;
        chunks.push(value);
    }
}

t.test('an already aborted request never starts the main-process stream', async t => {
    const fake = fakeApi();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: fake.api } });
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });

    const transport = new DefaultChatTransport({ fetch: electronChatFetch });
    const stream = await transport.sendMessages({
        trigger: 'submit-message', chatId: 'invented-chat', messageId: undefined,
        abortSignal: AbortSignal.abort(),
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Invented question.' }] }],
    });
    const chunks = await readAll(stream);

    t.equal(fake.calls.started, 0, 'no IPC request was made');
    t.equal(fake.calls.cancelled, 0, 'nothing was started, so nothing is cancelled');
    t.ok(chunks.some((chunk) => chunk.type === 'abort'), 'the response reports the abort');
    t.equal(fake.listeners.chunk.length, 0, 'no listener outlives the aborted request');
    t.end();
});

t.test('an abort mid-stream cancels the main-process stream once', async t => {
    const fake = fakeApi();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: fake.api } });
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });

    const controller = new AbortController();
    const transport = new DefaultChatTransport({ fetch: electronChatFetch });
    const stream = await transport.sendMessages({
        trigger: 'submit-message', chatId: 'invented-chat', messageId: undefined,
        abortSignal: controller.signal,
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Invented question.' }] }],
    });
    t.equal(fake.calls.started, 1, 'the request reached the main process first');

    const reading = readAll(stream);
    controller.abort();
    const chunks = await reading;

    t.equal(fake.calls.cancelled, 1, 'the main-process stream is cancelled exactly once');
    t.ok(chunks.some((chunk) => chunk.type === 'abort'), 'the response reports the abort');
    t.equal(fake.listeners.chunk.length, 0, 'listeners are disposed on abort');
    t.end();
});

t.test('a consumer that stops reading disposes listeners and cancels once', async t => {
    const fake = fakeApi();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: fake.api } });
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });

    const response = await electronChatFetch('invented://chat', {
        method: 'POST',
        body: JSON.stringify({ meetingId: 'invented-meeting', messages: [{ role: 'user', content: 'Invented question.' }] }),
    });
    const reader = response.body!.getReader();
    await reader.read();
    // Captured before cancelling: a handler that is already in flight must not reach the controller.
    const inFlight = fake.listeners.chunk[0];
    await reader.cancel();

    t.equal(fake.calls.cancelled, 1, 'the main-process stream is cancelled once');
    t.equal(fake.listeners.chunk.length, 0, 'listeners are disposed when the consumer cancels');
    t.doesNotThrow(() => inFlight?.({ requestId: fake.id(), chunk: 'late' }), 'a late main-process event cannot enqueue after a cancel');
    t.equal(fake.calls.cancelled, 1, 'a late event does not cancel again');
    t.end();
});

t.test('events for another request never reach this stream', async t => {
    const fake = fakeApi();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: fake.api } });
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });

    const response = await electronChatFetch('invented://chat', {
        method: 'POST',
        body: JSON.stringify({ meetingId: 'invented-meeting', messages: [{ role: 'user', content: 'Invented question.' }] }),
    });
    const reader = response.body!.getReader();
    await reader.read();
    const foreign = 'invented-other-request';

    // Another meeting's stream must not paint text into this answer, end it, or error it.
    fake.listeners.chunk.forEach((fn) => fn({ requestId: foreign, chunk: 'foreign text' }));
    fake.listeners.complete.forEach((fn) => fn({ requestId: foreign }));
    fake.listeners.error.forEach((fn) => fn({ requestId: foreign, error: 'foreign failure' }));

    const ownId = fake.id();
    fake.listeners.chunk.forEach((fn) => fn({ requestId: ownId, chunk: 'own text' }));
    fake.listeners.complete.forEach((fn) => fn({ requestId: ownId }));

    const rest: number[] = [];
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest.push(...value);
    }
    const body = new TextDecoder().decode(new Uint8Array(rest));
    t.equal(body.includes('foreign text'), false, 'foreign text is dropped');
    t.equal(body.includes('foreign failure'), false, 'a foreign error cannot end this stream');
    t.match(body, 'own text');
    t.match(body, '"finish"', 'only this request completes the response');
    t.end();
});

t.test('a completed stream detaches its abort listener', async t => {
    const fake = fakeApi();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: fake.api } });
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });

    const added: string[] = [];
    const removed: string[] = [];
    const signal = {
        aborted: false,
        addEventListener: (type: string) => { added.push(type); },
        removeEventListener: (type: string) => { removed.push(type); },
    } as unknown as AbortSignal;

    const response = await electronChatFetch('invented://chat', {
        method: 'POST', body: '{}', signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    fake.listeners.complete.forEach((fn) => fn({ requestId: fake.id() }));
    await reader.cancel();

    t.same(added, ['abort'], 'the abort listener is attached once');
    t.same(removed, ['abort'], 'and removed when the stream ends, so it cannot fire later');
    t.end();
});

t.test('a failed request without a message still ends with the default failure', async t => {
    const fake = fakeApi({ success: false });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: fake.api } });
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });

    const response = await electronChatFetch('invented://chat', {
        method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Invented question.' }] }),
    });
    const text = await readRawText(response.body!);
    t.match(text, 'The chat request failed.', 'the failure is reported with the default message');
    t.equal(fake.listeners.chunk.length, 0, 'the listeners are disposed too');
    t.end();
});

t.test('a failed request with a message keeps that exact message through the SDK parser', async t => {
    const fake = fakeApi({ success: false, error: 'Invented validation failure' });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: fake.api } });
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });

    const transport = new DefaultChatTransport({ fetch: electronChatFetch });
    const stream = await transport.sendMessages({
        trigger: 'submit-message', chatId: 'invented-chat', messageId: undefined, abortSignal: undefined,
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Invented question.' }] }],
    });
    const chunks = await readAll(stream);

    const failure = chunks.find((chunk) => chunk.type === 'error');
    t.equal(failure && 'errorText' in failure ? failure.errorText : '', 'Invented validation failure', 'the main-process message is passed through unchanged');
    t.end();
});
