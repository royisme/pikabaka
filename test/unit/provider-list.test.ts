import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider, MutationObserver } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AiConnectionView } from '../../src/types/electron';
import type { AppState } from '../../electron/main';
import { CredentialsManager } from '../../electron/services/CredentialsManager';
import { BUILTIN_CONNECTIONS } from '../../electron/services/aiConnections';

const pickerModule = mockRequire(path.resolve('src/components/settings/ConnectionModelPicker.tsx'), {
    react: React, '@tanstack/react-query': ReactQuery,
}) as typeof import('../../src/components/settings/ConnectionModelPicker');
const { default: Picker, ProviderNavigation } = pickerModule;
const { default: ConnectionsSettings, ProviderList, ProviderEditor } = mockRequire(path.resolve('src/components/settings/ConnectionsSettings.tsx'), {
    react: React, '@tanstack/react-query': ReactQuery,
    [path.resolve('src/components/settings/ConnectionModelPicker.tsx')]: pickerModule,
}) as typeof import('../../src/components/settings/ConnectionsSettings');

const builtins: AiConnectionView[] = BUILTIN_CONNECTIONS.map(c => ({
    ...c, baseUrl: c.defaultBaseUrl, builtin: true, customBaseUrl: false, hasApiKey: false,
}));
const custom = (id: string, baseUrl: string): AiConnectionView => ({
    id, name: 'Invented gateway', type: 'openai', baseUrl, builtin: false, customBaseUrl: false, hasApiKey: false,
});
const noop = () => {};
const list = (connections: AiConnectionView[], extra = {}) => renderToStaticMarkup(React.createElement(ProviderList, {
    connections, uses: [], results: {}, onEdit: noop, onRemove: noop, onConfirm: noop, ...extra,
}));
function render(element: React.ReactElement, connections: AiConnectionView[] = []) {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['ai-connections'], connections);
    const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, element));
    client.clear();
    return html;
}

t.test('fresh list has no fixed companies and one honest empty line', t => {
    const html = list(builtins);
    t.match(html, 'No providers yet. Add one to use a model.');
    for (const c of builtins) t.notMatch(html, c.name);
    t.end();
});

t.test('configured built-ins include keys and host-only overrides', t => {
    const html = list([
        { ...builtins[1], hasApiKey: true },
        { ...builtins[2], customBaseUrl: true, baseUrl: 'https://invented.example/anthropic' },
        builtins[0],
    ]);
    t.match(html, 'OpenAI compatible · api.openai.com/v1');
    t.match(html, 'Key saved');
    t.match(html, 'Anthropic compatible · invented.example/anthropic');
    t.match(html, 'No key');
    t.equal((html.match(/Remove key and reset host/g) ?? []).length, 2);
    t.notMatch(html, '>Delete</button>');
    t.notMatch(html, 'Google Gemini');
    t.notMatch(html, 'https://');
    t.end();
});

t.test('keyless local and duplicate names remain distinct by host and interface', t => {
    const html = list([
        custom('local-a', 'http://localhost:11434/v1'),
        { ...custom('remote-b', 'https://invented.example'), type: 'gemini' },
    ]);
    t.equal((html.match(/>Invented gateway</g) ?? []).length, 2);
    t.match(html, 'OpenAI compatible · localhost:11434/v1');
    t.match(html, 'Gemini compatible · invented.example');
    t.match(html, 'No key needed');
    t.match(html, 'No key');
    t.end();
});

t.test('failed Test shows the real failure and named uses block row deletion', t => {
    const c = custom('used', 'http://localhost:1234/v1');
    const html = list([c], {
        results: { used: { success: false, message: 'Invented host refused the request (429)' } },
        uses: [{ name: 'Quick answers', connectionId: 'used' }, { name: 'Agent', connectionId: 'used' }],
    });
    t.match(html, '✕ Test failed: Invented host refused the request (429)');
    t.match(html, 'Used by Quick answers, Agent');
    t.match(html, /aria-label="Delete Invented gateway" disabled=""/);
    const confirm = list([c], { confirmId: c.id });
    t.match(confirm, 'Delete Invented gateway?');
    t.match(confirm, '>Delete</button>');
    t.match(confirm, '>Keep</button>');
    t.end();
});

t.test('add editor starts with Interface, real default URL and blank name; no delete or presets', t => {
    const html = render(React.createElement(ProviderEditor, { onClose: noop, onSaved: noop, onTest: noop, onBusy: noop }));
    t.match(html, /Interface<select/);
    t.match(html, 'value="https://api.openai.com/v1"');
    t.match(html, /Name<input[^>]*value=""/);
    t.ok(html.indexOf('Interface') < html.indexOf('Name<input'));
    t.ok(html.indexOf('Name<input') < html.indexOf('Base URL<input'));
    t.ok(html.indexOf('Base URL<input') < html.indexOf('API key<input'));
    t.match(html, 'Ollama and LM Studio speak this interface.');
    t.match(html, 'Asks the host for its model list. It does not check a model, images or tools.');
    t.notMatch(html, '>Delete</button>');
    t.match(html, 'Custom headers (optional)');
    t.end();
});

t.test('builtin editor exposes read-only name and interface, editable URL and write-only key', t => {
    const html = render(React.createElement(ProviderEditor, {
        connection: { ...builtins[1], hasApiKey: true }, onClose: noop, onSaved: noop, onTest: noop, onBusy: noop,
    }));
    t.match(html, /Interface<input readonly=""[^>]*value="OpenAI compatible"/i);
    t.match(html, /Name<input readonly=""[^>]*value="OpenAI"/i);
    t.notMatch(html, '<select');
    t.match(html, 'Saved. Leave empty to keep it.');
    t.notMatch(html, '>Delete</button>');
    t.end();
});

t.test('pickers show configured providers plus their named unconfigured id, even outside a type filter', t => {
    const connections = [
        ...builtins, custom('first', 'http://localhost:1234/v1'),
        custom('second', 'https://invented.example'),
    ];
    const html = render(React.createElement(ProviderNavigation.Provider, { value: { open: noop } },
        React.createElement(Picker, { id: 'embedding', connectionId: 'claude', model: 'invented-id', types: ['openai', 'gemini'], onChange: noop })
    ), connections);
    t.match(html, '<option value="claude" selected="">');
    t.match(html, 'Edit Anthropic Claude in Provider setup');
    t.match(html, 'value="first"');
    t.match(html, 'value="second"');
    for (const id of ['gemini', 'openai', 'groq']) t.notMatch(html, `value="${id}"`);
    const missing = render(React.createElement(Picker, { id: 'chat', connectionId: 'missing', model: 'kept-id', onChange: noop }), connections);
    t.match(missing, '<option value="missing" selected="">missing (unavailable)</option>');
    t.match(missing, 'value="kept-id"');
    t.end();
});

t.test('floating picker repair sends the provider id through the existing section string', t => {
    let section = '';
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {
        openSettingsSection: (next: string) => { section = next; },
    } } });
    const { default: FloatingPicker } = mockRequire(path.resolve('src/components/settings/ConnectionModelPicker.tsx'), {
        react: { ...React, useContext: () => null },
        '@tanstack/react-query': { ...ReactQuery, useQuery: ({ queryKey: key }: { queryKey: readonly unknown[] }) => key[0] === 'ai-connections' ? { data: builtins } : {} },
    }) as typeof import('../../src/components/settings/ConnectionModelPicker');
    const tree = FloatingPicker({ id: 'quick-answers', connectionId: 'openai', model: 'kept-model', onChange: noop });
    if (!React.isValidElement<{ children: React.ReactNode }>(tree)) throw new Error('Picker did not render');
    const link = React.Children.toArray(tree.props.children).find(child => React.isValidElement(child) && child.type === 'button');
    if (!React.isValidElement<{ onClick: () => void; children: string }>(link)) throw new Error('Repair link missing');
    t.equal(link.props.children, 'Edit OpenAI in Provider setup');
    link.props.onClick();
    t.equal(section, 'providers:openai');
    t.end();
});

t.test('repair navigation opens an unconfigured built-in editor without adding it to the list', t => {
    const html = render(React.createElement(ProviderNavigation.Provider, { value: { editorId: 'openai', open: noop } },
        React.createElement(ConnectionsSettings)
    ), builtins);
    t.match(html, 'No providers yet. Add one to use a model.');
    t.match(html, '>Edit OpenAI</h4>');
    t.match(html, /Interface<input readonly=""/i);
    t.match(html, /Name<input readonly=""/i);
    t.equal((html.match(/>Add provider<\/button>/g) ?? []).length, 1);
    t.end();
});

t.test('renaming a custom provider retains its stored identity and key', t => {
    const manager = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(manager, 'credentials', { openaiCompatibleProviders: [{
        id: 'stable-id', name: 'Invented original', type: 'openai', baseUrl: 'https://invented.example', apiKey: 'synthetic-marker',
    }] });
    Reflect.set(manager, 'saveCredentials', noop);
    t.same(manager.saveConnection({ id: 'stable-id', name: 'Invented renamed', type: 'openai', baseUrl: 'https://invented.example' }), { id: 'stable-id' });
    t.equal(manager.resolveConnection('stable-id')?.name, 'Invented renamed');
    t.ok(manager.resolveConnection('stable-id')?.apiKey === 'synthetic-marker', 'the untouched key stays stored');
    t.end();
});

// A windowless hook host, using the real mutation observer for rejected requests and unmount semantics.
function editorHost(connection?: AiConnectionView, settings = false) {
    const client = new QueryClient({ logger: { log: noop, warn: noop, error: noop } });
    const state: unknown[] = [];
    const observers: MutationObserver[] = [];
    const unsubscribes: Array<() => void> = [];
    let stateIndex = 0;
    let mutationIndex = 0;
    const hooks = {
        ...React,
        useContext: () => null,
        useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in state)) state[index] = initial;
            return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
        },
    };
    const queryHooks = {
        ...ReactQuery,
        useQueryClient: () => client,
        useQuery: ({ queryKey: key }: { queryKey: readonly unknown[] }) => ({ data: key[0] === 'ai-connections' ? [connection] : [], isSuccess: true }),
        useMutation: ({ mutationFn, ...options }: { mutationFn: () => Promise<unknown> } & object) => {
            const index = mutationIndex++;
            if (!observers[index]) {
                observers[index] = new MutationObserver(client, { ...options, mutationFn });
                unsubscribes.push(observers[index].subscribe(noop));
            } else observers[index].setOptions({ ...options, mutationFn });
            const observer = observers[index];
            return { ...observer.getCurrentResult(), mutate: (variables: undefined, options: object) => observer.mutate(variables, options).catch(noop) };
        },
    };
    const { default: Settings, ProviderList: List, ProviderEditor: Editor } = mockRequire(path.resolve('src/components/settings/ConnectionsSettings.tsx'), {
        react: hooks, '@tanstack/react-query': queryHooks,
    }) as typeof import('../../src/components/settings/ConnectionsSettings');
    let saved = 0;
    const results: unknown[] = [];
    const draw = () => {
        stateIndex = 0; mutationIndex = 0;
        return settings ? Settings({}) : Editor({ connection, onClose: noop, onSaved: () => saved++, onBusy: noop, onTest: result => results.push(result) });
    };
    const controls = (tree: React.ReactNode, type: React.ElementType): React.ReactElement<Record<string, unknown>>[] => {
        if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
        return [
            ...(tree.type === type ? [tree as React.ReactElement<Record<string, unknown>>] : []),
            ...React.Children.toArray(tree.props.children).flatMap(child => controls(child, type)),
        ];
    };
    return {
        draw, results, saved: () => saved,
        edit: () => (controls(draw(), List)[0].props.onEdit as (c?: AiConnectionView) => void)(connection),
        remove: () => (controls(draw(), List)[0].props.onRemove as (c?: AiConnectionView) => void)(connection),
        input: (index: number, value: string) => (controls(draw(), 'input')[index].props.onChange as (e: { target: { value: string } }) => void)({ target: { value } }),
        click: (label: string) => {
            const button = controls(draw(), 'button').find(c => c.props.children === label);
            if (!button) throw new Error(`Missing ${label}`);
            (button.props.onClick as () => void)();
        },
        settle: async () => { await new Promise(resolve => setImmediate(resolve)); },
        unmount: () => { unsubscribes.forEach(unsubscribe => unsubscribe()); client.clear(); },
    };
}

t.test('rejected and failed Saves retain draft and real error; successful rename keeps id and omits key', async t => {
    let input: unknown;
    let mode = 'reject';
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {
        aiConnectionSave: async (next: unknown) => {
            input = next;
            if (mode === 'reject') throw new Error('Invented IPC save rejection');
            return mode === 'failure' ? { success: false, error: 'Invented refused save' } : { success: true };
        },
    } } });
    const host = editorHost(custom('same-id', 'https://invented.example'));
    t.teardown(host.unmount);
    host.input(1, 'Renamed gateway');
    host.click('Save');
    t.match(renderToStaticMarkup(host.draw()), 'Saving…');
    await host.settle();
    t.match(renderToStaticMarkup(host.draw()), 'Invented IPC save rejection');
    t.match(renderToStaticMarkup(host.draw()), 'value="Renamed gateway"');
    t.equal(host.saved(), 0);
    mode = 'failure'; host.click('Save'); await host.settle();
    t.match(renderToStaticMarkup(host.draw()), 'Invented refused save');
    t.equal(host.saved(), 0);
    mode = 'ok'; host.click('Save'); await host.settle();
    t.match(input, { id: 'same-id', name: 'Renamed gateway', apiKey: undefined });
    t.equal(host.saved(), 1);
});

t.test('returned and rejected Deletes show real errors and retain the editor', async t => {
    let mode = 'failure';
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {
        aiConnectionDelete: async () => {
            if (mode === 'reject') throw new Error('Invented IPC delete rejection');
            return { success: false, error: 'Used by Agent' };
        },
    } } });
    const host = editorHost(custom('keep-id', 'https://invented.example'), true);
    t.teardown(host.unmount);
    host.edit();
    host.remove(); await host.settle();
    let html = renderToStaticMarkup(host.draw());
    t.match(html, 'Used by Agent');
    t.match(html, '>Edit Invented gateway</h4>');
    mode = 'reject'; host.remove(); await host.settle();
    html = renderToStaticMarkup(host.draw());
    t.match(html, 'Invented IPC delete rejection');
    t.match(html, '>Edit Invented gateway</h4>');
    t.equal(host.saved(), 0);
});

t.test('Test rejects honestly and a canceled editor cannot deliver a late result to another draft', async t => {
    let resolve: (value: unknown) => void = noop;
    let mode = 'reject';
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {
        aiConnectionModels: async () => {
            if (mode === 'reject') throw new Error('Invented IPC test rejection');
            if (mode === 'failure') return { success: false, error: 'Invented refused model list' };
            return new Promise(done => { resolve = done; });
        },
    } } });
    const host = editorHost(custom('first-draft', 'http://localhost:1234/v1'));
    host.click('Test'); await host.settle();
    t.match(renderToStaticMarkup(host.draw()), 'Test failed: Invented IPC test rejection');
    t.same(host.results, [{ success: false, message: 'Invented IPC test rejection' }]);
    mode = 'failure'; host.click('Test'); await host.settle();
    t.match(renderToStaticMarkup(host.draw()), 'Test failed: Invented refused model list');
    mode = 'delayed'; host.click('Test'); await host.settle();
    t.match(renderToStaticMarkup(host.draw()), 'Testing…');
    host.unmount();
    const next = editorHost(custom('second-draft', 'https://invented.example'));
    t.teardown(next.unmount);
    resolve({ success: false, error: 'Invented late failure' }); await host.settle();
    t.equal(host.results.length, 2, 'unmounted mutation callback does not update the row');
    t.notMatch(renderToStaticMarkup(next.draw()), 'Invented late failure');
});

t.test('IPC refuses every referenced custom with named jobs, allows unused, and refuses every built-in', async t => {
    const manager = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Reflect.set(manager, 'credentials', {
        chatConnectionId: 'used', summaryConnectionId: 'used', agentConnectionId: 'used',
        embeddingConnectionId: 'used', transcriptTranslationProvider: 'used', transcriptTranslationEnabled: false,
        openaiCompatibleProviders: [{ id: 'used', name: 'Invented used' }, { id: 'unused', name: 'Invented unused' }],
    });
    Reflect.set(manager, 'saveCredentials', noop); // Synthetic memory only, never the user's store.
    let handler: ((_event: unknown, id: unknown) => Promise<{ success: boolean; error?: string }>) | undefined;
    const { registerConnectionHandlers } = mockRequire(path.resolve('electron/ipc/connections.ts'), {
        electron: { BrowserWindow: { getAllWindows: () => [] } },
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (channel: string, listener: typeof handler) => { if (channel === 'ai-connection-delete') handler = listener; } },
        [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => manager } },
    }) as typeof import('../../electron/ipc/connections');
    registerConnectionHandlers({} as AppState);
    if (!handler) throw new Error('Delete handler not registered');
    const before = structuredClone(manager.getAllCredentials());
    t.same(await handler(undefined, 'used'), { success: false, error: 'Used by Quick answers, Summaries, Agent, Search index, Translation' });
    t.same(manager.getAllCredentials(), before, 'refusal changes no job or provider');
    for (const c of builtins) t.match(await handler(undefined, c.id), { success: false, error: /Built-in providers cannot be deleted/ });
    t.same(await handler(undefined, 'unused'), { success: true });
    t.equal(manager.getOpenAICompatibleProviders().some(c => c.id === 'unused'), false);
    t.equal(manager.getAgentUse().connectionId, 'used', 'other deletion does not clear the Agent choice');
    t.match(await handler(undefined, 'missing'), { success: false, error: 'That provider does not exist' });
    for (const [key, label] of [
        ['chatConnectionId', 'Quick answers'], ['summaryConnectionId', 'Summaries'], ['agentConnectionId', 'Agent'],
        ['embeddingConnectionId', 'Search index'], ['transcriptTranslationProvider', 'Translation'],
    ]) {
        Reflect.set(manager, 'credentials', {
            [key]: 'used', openaiCompatibleProviders: [{ id: 'used', name: 'Invented used' }],
        });
        t.same(await handler(undefined, 'used'), { success: false, error: `Used by ${label}` }, `${label} alone blocks deletion`);
    }
});
