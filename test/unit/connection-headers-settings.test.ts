import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, MutationObserver } from 'react-query';
import * as ReactQuery from 'react-query';
import type { AiConnectionView, HeaderState } from '../../src/types/electron';
import { BUILTIN_CONNECTIONS } from '../../electron/services/aiConnections';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

const noop = () => {};
const builtins: AiConnectionView[] = BUILTIN_CONNECTIONS.map(c => ({
    ...c, baseUrl: c.defaultBaseUrl, builtin: true, customBaseUrl: false, hasApiKey: false,
}));
const gateway = (headers?: HeaderState[]): AiConnectionView => ({
    id: 'invented-gateway', name: 'Invented gateway', type: 'openai', baseUrl: 'http://127.0.0.1:1234/v1',
    builtin: false, customBaseUrl: true, hasApiKey: false, ...(headers ? { headers } : {}),
});
const savedHeaders: HeaderState[] = [{ name: 'X-Invented-Gateway', set: true }];

// A windowless host for the real editor: real mutation observers, window.electronAPI replaced per test.
function editorHost(connection: AiConnectionView | undefined, api: object) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: api } });
    const client = new QueryClient({ logger: { log: noop, warn: noop, error: noop } });
    const state: unknown[] = [];
    const observers: MutationObserver[] = [];
    const unsubscribes: Array<() => void> = [];
    let stateIndex = 0;
    let mutationIndex = 0;
    let closed = 0;
    let saved = 0;
    const hooks = {
        ...React,
        useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in state)) state[index] = initial;
            return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(state[index]) : next; }];
        },
    };
    const queryHooks = {
        ...ReactQuery,
        useQueryClient: () => client,
        useMutation: (mutationFn: () => Promise<unknown>, options: object = {}) => {
            const index = mutationIndex++;
            if (!observers[index]) {
                observers[index] = new MutationObserver(client, { ...options, mutationFn });
                unsubscribes.push(observers[index].subscribe(noop));
            } else observers[index].setOptions({ ...options, mutationFn });
            const observer = observers[index];
            return { ...observer.getCurrentResult(), mutate: (variables: undefined, options: object) => observer.mutate(variables, options).catch(noop) };
        },
    };
    const { ProviderEditor: Editor } = mockRequire(path.resolve('src/components/settings/ConnectionsSettings.tsx'), {
        react: hooks, 'react-query': queryHooks,
    }) as typeof import('../../src/components/settings/ConnectionsSettings');
    const draw = () => {
        stateIndex = 0;
        mutationIndex = 0;
        return Editor({ connection, onClose: () => closed++, onSaved: () => saved++, onBusy: noop, onTest: noop });
    };
    const elements = (tree: React.ReactNode): React.ReactElement<Record<string, unknown>>[] => {
        if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
        return [tree as React.ReactElement<Record<string, unknown>>, ...React.Children.toArray(tree.props.children).flatMap(elements)];
    };
    const text = (tree: React.ReactNode): string => {
        if (typeof tree === 'string') return tree;
        if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return '';
        return React.Children.toArray(tree.props.children).map(text).join('');
    };
    const control = (type: string, label: string) => {
        const found = elements(draw()).find(c => c.type === type && (c.props['aria-label'] === label || text(c) === label));
        if (!found) throw new Error(`Missing ${type}: ${label}`);
        return found;
    };
    return {
        html: () => renderToStaticMarkup(draw()),
        control,
        click: (label: string) => {
            const button = control('button', label);
            if (button.props.disabled) throw new Error(`Disabled button: ${label}`);
            (button.props.onClick as () => void)();
        },
        change: (label: string, value: string) => {
            (control('input', label).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
        },
        closed: () => closed,
        saved: () => saved,
        settle: async () => { await new Promise(resolve => setImmediate(resolve)); },
        unmount: () => { unsubscribes.forEach(unsubscribe => unsubscribe()); client.clear(); },
    };
}

t.test('a custom editor places the headers section after the key with an empty state; built-ins have none', t => {
    const custom = editorHost(gateway(), {});
    const html = custom.html();
    t.match(html, 'Custom headers (optional)');
    t.match(html, 'No custom headers.');
    t.match(html, '>Add header</button>');
    t.ok(html.indexOf('API key<input') < html.indexOf('Custom headers (optional)'), 'headers sit under the API key');
    t.ok(html.indexOf('Custom headers (optional)') < html.indexOf('>Test</button>'), 'headers sit above Test and Save');
    custom.unmount();
    const builtin = editorHost({ ...builtins[1], hasApiKey: true }, {});
    t.notMatch(builtin.html(), 'Custom headers');
    t.notMatch(builtin.html(), 'Add header');
    t.notMatch(builtin.html(), 'No custom headers.');
    builtin.unmount();
    t.end();
});

t.test('a typed row is saved and tested as a set edit; an incomplete row is never sent', async t => {
    const saves: Array<Record<string, unknown>> = [];
    const tests: Array<Record<string, unknown>> = [];
    const host = editorHost(gateway(), {
        aiConnectionSave: async (input: Record<string, unknown>) => { saves.push(input); return { success: true }; },
        aiConnectionModels: async (input: Record<string, unknown>) => { tests.push(input); return { success: true, models: [] }; },
    });
    t.teardown(host.unmount);
    host.click('Add header');
    t.equal(host.control('button', 'Save').props.disabled, true, 'a row without a value cannot be saved');
    host.change('Header 1 name', 'X-Invented-Token');
    t.equal(host.control('button', 'Save').props.disabled, true);
    host.change('Header 1 value', 'invented-typed-value');
    t.equal(host.control('button', 'Save').props.disabled, false);
    host.click('Test'); await host.settle();
    t.same(tests[0].headerEdits, [{ op: 'set', name: 'X-Invented-Token', value: 'invented-typed-value' }], 'Test sends the draft edit, not a saved one');
    host.click('Add header');
    host.change('Header 2 name', 'X-Invented-Incomplete');
    t.equal(host.control('button', 'Test').props.disabled, true, 'a row with a name but no value blocks Test as well as Save');
    t.equal(tests.length, 1, 'the incomplete draft is never tested');
    t.equal(host.control('input', 'Header 1 value').props.type, 'password', 'header values are secrets and are masked');
    host.change('Header 2 value', 'invented-second-value');
    host.click('Save'); await host.settle();
    t.same(saves[0].headerEdits, [
        { op: 'set', name: 'X-Invented-Token', value: 'invented-typed-value' },
        { op: 'set', name: 'X-Invented-Incomplete', value: 'invented-second-value' },
    ]);
    t.equal(host.saved(), 1, 'a successful Save closes the editor through its parent');
});

t.test('an existing header shows its name and a set mark; its value field starts empty and blank keeps it', async t => {
    const saves: Array<Record<string, unknown>> = [];
    const host = editorHost(gateway(savedHeaders), {
        aiConnectionSave: async (input: Record<string, unknown>) => { saves.push(input); return { success: true }; },
    });
    t.teardown(host.unmount);
    const html = host.html();
    t.match(html, 'X-Invented-Gateway');
    t.match(html, />set</);
    t.match(html, /bg-state-success/);
    t.match(html, 'Saved. Type to replace.');
    t.equal(host.control('input', 'Header 1 value').props.value, '', 'a saved value never reaches the field');
    t.notMatch(host.html(), 'aria-label="Header 1 name"', 'the saved name is shown, not offered for editing');
    t.notMatch(html, 'No custom headers.');
    host.click('Save'); await host.settle();
    t.same(saves[0].headerEdits, [{ op: 'keep', name: 'X-Invented-Gateway' }], 'blank keeps without carrying a value');
    saves.length = 0;
    host.change('Header 1 value', 'invented-replacement-value');
    host.click('Save'); await host.settle();
    t.same(saves[0].headerEdits, [{ op: 'set', name: 'X-Invented-Gateway', value: 'invented-replacement-value' }]);
});

t.test('Remove sends a remove edit; Keep restores the saved header before Save', async t => {
    const saves: Array<Record<string, unknown>> = [];
    const host = editorHost(gateway(savedHeaders), {
        aiConnectionSave: async (input: Record<string, unknown>) => { saves.push(input); return { success: true }; },
    });
    t.teardown(host.unmount);
    host.click('Remove X-Invented-Gateway');
    t.match(host.html(), 'Removing on Save.');
    t.notMatch(host.html(), 'aria-label="Header 1 value"', 'the removed row has no value field');
    host.click('Keep X-Invented-Gateway');
    t.notMatch(host.html(), 'Removing on Save.');
    host.click('Save'); await host.settle();
    t.same(saves[0].headerEdits, [{ op: 'keep', name: 'X-Invented-Gateway' }], 'Keep leaves the saved value alone');
    host.click('Remove X-Invented-Gateway');
    host.click('Save'); await host.settle();
    t.same(saves[1].headerEdits, [{ op: 'remove', name: 'X-Invented-Gateway' }]);
});

t.test('a new row Remove drops it locally without any request; Cancel sends nothing', async t => {
    let requests = 0;
    const host = editorHost(gateway(), {
        aiConnectionSave: async () => { requests++; return { success: true }; },
        aiConnectionModels: async () => { requests++; return { success: true, models: [] }; },
    });
    t.teardown(host.unmount);
    host.click('Add header');
    host.click('Remove header');
    t.match(host.html(), 'No custom headers.');
    host.click('Add header');
    host.change('Header 1 name', 'X-Invented-Cancelled');
    host.change('Header 1 value', 'invented-cancelled-value');
    host.click('Cancel');
    await host.settle();
    t.equal(requests, 0, 'Cancel makes no request');
    t.equal(host.closed(), 1);
    t.equal(host.saved(), 0);
});

t.test('missing names, invalid names and case-insensitive duplicates block Save with the rule in words', t => {
    const host = editorHost(gateway(savedHeaders), {});
    t.teardown(host.unmount);
    host.click('Add header');
    // The saved header is row 1, so the new row is row 2.
    host.change('Header 2 value', 'invented-value');
    t.equal(host.control('button', 'Save').props.disabled, true);
    t.equal(host.control('button', 'Test').props.disabled, true, 'the same rules block Test');
    t.match(host.html(), 'Give the header a name.');
    host.change('Header 2 name', 'X-Bad Name');
    t.match(host.html(), 'A header name uses letters, digits and');
    t.equal(host.control('button', 'Save').props.disabled, true);
    host.change('Header 2 name', 'x-invented-gateway');
    t.match(host.html(), 'names ignore case');
    t.equal(host.control('button', 'Save').props.disabled, true);
    host.change('Header 2 name', 'X-Invented-Separate');
    t.notMatch(host.html(), 'names ignore case');
    t.match(host.html(), 'X-Invented-Gateway', 'the saved header keeps its name');
    t.equal(host.control('button', 'Save').props.disabled, false);
    t.end();
});

t.test('a refused Save and a failed Test show the real returned message in a readable alert', async t => {
    const host = editorHost(gateway(savedHeaders), {
        aiConnectionSave: async () => ({ success: false, error: 'Invented refusal: the header is reserved for the HTTP client' }),
        aiConnectionModels: async () => ({ success: false, error: 'Invented Test failure: the host refused the request' }),
    });
    t.teardown(host.unmount);
    host.click('Save'); await host.settle();
    const html = host.html();
    t.match(html, 'Invented refusal: the header is reserved for the HTTP client');
    t.match(html, 'role="alert"');
    t.notMatch(html, '● Saved');
    t.match(html, '>Edit Invented gateway</h4>', 'a refused Save keeps the editor open with its fields');
    host.click('Test'); await host.settle();
    t.match(host.html(), '✕ Test failed: Invented Test failure: the host refused the request');
});

t.test('a built-in editor sends no header edits at all', async t => {
    const saves: Array<Record<string, unknown>> = [];
    const tests: Array<Record<string, unknown>> = [];
    const host = editorHost({ ...builtins[1], hasApiKey: true }, {
        aiConnectionSave: async (input: Record<string, unknown>) => { saves.push(input); return { success: true }; },
        aiConnectionModels: async (input: Record<string, unknown>) => { tests.push(input); return { success: true, models: [] }; },
    });
    t.teardown(host.unmount);
    host.click('Save'); await host.settle();
    host.click('Test'); await host.settle();
    t.equal('headerEdits' in saves[0], false);
    t.equal('headerEdits' in tests[0], false);
});
