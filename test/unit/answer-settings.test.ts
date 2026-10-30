import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

const noop = () => {};

// Windowless rendering, with real query/mutation observers and only React's local state hosted here.
function componentHost(file: string, api: object) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: api } });
    const client = new QueryClient({
        defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false } },
    });
    const state: unknown[] = [];
    const queries: QueryObserver<unknown, Error>[] = [];
    const mutations: MutationObserver<unknown, Error, string>[] = [];
    const unsubscribes: Array<() => void> = [];
    let stateIndex = 0;
    let queryIndex = 0;
    let mutationIndex = 0;
    const { default: Component } = mockRequire(path.resolve(`src/components/settings/${file}.tsx`), {
        react: {
            ...React,
            useState: (initial: unknown) => {
                const index = stateIndex++;
                if (!(index in state)) state[index] = initial;
                return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
            },
        },
        '@tanstack/react-query': {
            ...ReactQuery,
            useQueryClient: () => client,
            useQuery: ({ queryKey, queryFn }: { queryKey: readonly unknown[]; queryFn?: () => Promise<unknown> }) => {
                const index = queryIndex++;
                if (!queries[index]) {
                    queries[index] = new QueryObserver(client, { queryKey, queryFn });
                    unsubscribes.push(queries[index].subscribe(noop));
                } else queries[index].setOptions({ queryKey, queryFn });
                return queries[index].getCurrentResult();
            },
            useMutation: ({ mutationFn, ...options }: { mutationFn: (value: string) => Promise<unknown> } & UseMutationOptions<unknown, Error, string>) => {
                const index = mutationIndex++;
                if (!mutations[index]) {
                    mutations[index] = new MutationObserver(client, { ...options, mutationFn });
                    unsubscribes.push(mutations[index].subscribe(noop));
                } else mutations[index].setOptions({ ...options, mutationFn });
                const observer = mutations[index];
                return { ...observer.getCurrentResult(), mutate: (value: string) => { void observer.mutate(value).catch(noop); } };
            },
        },
    }) as { default: () => React.ReactNode };
    const draw = () => {
        stateIndex = 0; queryIndex = 0; mutationIndex = 0;
        return Component();
    };
    const controls = (tree: React.ReactNode, type: string): React.ReactElement<Record<string, unknown>>[] => {
        if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
        return [
            ...(tree.type === type ? [tree as React.ReactElement<Record<string, unknown>>] : []),
            ...React.Children.toArray(tree.props.children).flatMap(child => controls(child, type)),
        ];
    };
    return {
        draw,
        html: () => renderToStaticMarkup(draw()),
        control: (type: string, index = 0) => controls(draw(), type)[index],
        settle: async () => { await new Promise(resolve => setImmediate(resolve)); },
        unmount: () => { unsubscribes.forEach(unsubscribe => unsubscribe()); queries.forEach(query => query.destroy()); client.clear(); },
    };
}

const languages = [
    { label: 'Spanish', code: 'Spanish' },
    { label: 'English', code: 'English' },
    { label: 'Chinese', code: 'Chinese' },
];

t.test('language queries the saved value, keeps labels/order, and saves the selected code exactly once', async t => {
    const writes: string[] = [];
    const reads: string[] = [];
    const host = componentHost('AnswerLanguageSetting', {
        getAiResponseLanguages: async () => { reads.push('list'); return languages; },
        getAiResponseLanguage: async () => { reads.push('saved'); return 'Chinese'; },
        setAiResponseLanguage: async (code: string) => { writes.push(code); return { success: true }; },
    });
    t.teardown(host.unmount);
    host.draw(); await host.settle();
    let html = host.html();
    t.match(html, '<option value="Chinese" selected="">Chinese</option>');
    t.match(html, 'AI Response Language</label>');
    t.match(html, 'Reading language for quick answers and proactive cards; adds a translation when it differs from your speaking-language setting.');
    t.ok(html.indexOf('>English</option>') < html.indexOf('>Chinese</option>'));
    t.ok(html.indexOf('>Chinese</option>') < html.indexOf('>Spanish</option>'));
    t.same(reads, ['list', 'saved']);
    const select = host.control('select');
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Spanish' } });
    t.equal(host.control('select').props.value, 'Spanish', 'selection is optimistic as before');
    await host.settle();
    html = host.html();
    t.same(writes, ['Spanish']);
    t.match(html, '<option value="Spanish" selected="">Spanish</option>');
    t.notMatch(html, 'role="alert"');
});

t.test('failed and rejected language saves show the real message and restore the saved selection', async t => {
    for (const rejected of [false, true]) {
        const writes: string[] = [];
        const message = rejected ? 'Invented IPC save rejection' : 'Invented language save refusal';
        const host = componentHost('AnswerLanguageSetting', {
            getAiResponseLanguages: async () => languages,
            getAiResponseLanguage: async () => 'Chinese',
            setAiResponseLanguage: async (code: string) => {
                writes.push(code);
                if (rejected) throw new Error(message);
                return { success: false, error: message };
            },
        });
        t.teardown(host.unmount);
        host.draw(); await host.settle();
        (host.control('select').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Spanish' } });
        await host.settle();
        const html = host.html();
        t.same(writes, ['Spanish']);
        t.match(html, /role="alert"/);
        t.match(html, message);
        t.match(html, '<option value="Chinese" selected="">Chinese</option>');
    }
});

t.test('style is a plain native disclosure, collapsed by default, and retains its draft across presses', async t => {
    const host = componentHost('AnswerStyleSettings', {
        getAnswerStyle: async () => 'Invented saved voice',
    });
    t.teardown(host.unmount);
    host.draw(); await host.settle();
    let html = host.html();
    t.match(html, /type="button" aria-expanded="false" aria-controls="answer-style-settings"/);
    t.match(html, /id="answer-style-settings" hidden=""/);
    t.notMatch(html, '<svg');
    const press = () => (host.control('button').props.onClick as () => void)();
    press();
    html = host.html();
    t.match(html, 'aria-expanded="true"');
    t.notMatch(html, /id="answer-style-settings" hidden/);
    t.match(html, 'value="Invented saved voice"');
    t.equal(host.control('input').props.maxLength, 200);
    (host.control('input').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Invented draft voice' } });
    press();
    t.match(host.html(), 'aria-expanded="false"');
    press();
    t.match(host.html(), 'value="Invented draft voice"');
});
