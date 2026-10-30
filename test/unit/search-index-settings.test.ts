import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

const noop = () => {};

function host(api: object) {
    const previous = globalThis.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: api } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    const states: unknown[] = [];
    const queries: QueryObserver<unknown, Error>[] = [];
    const mutations: MutationObserver<unknown, Error, unknown>[] = [];
    const unsubscribes: Array<() => void> = [];
    let stateIndex = 0, queryIndex = 0, mutationIndex = 0;
    const { default: Component } = mockRequire(path.resolve('src/components/settings/SearchIndexSettings.tsx'), {
        [path.resolve('src/components/settings/ConnectionModelPicker.tsx')]: () => null,
        react: { ...React, useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in states)) states[index] = initial;
            return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
        } },
        '@tanstack/react-query': {
            ...ReactQuery, useQueryClient: () => client,
            useQuery: ({ queryKey, queryFn }: { queryKey: readonly unknown[]; queryFn?: () => Promise<unknown> }) => {
                const index = queryIndex++;
                if (!queries[index]) {
                    queries[index] = new QueryObserver(client, { queryKey, queryFn });
                    unsubscribes.push(queries[index].subscribe(noop));
                } else queries[index].setOptions({ queryKey, queryFn });
                return queries[index].getCurrentResult();
            },
            useMutation: ({ mutationFn, ...options }: { mutationFn: (value: unknown) => Promise<unknown> } & UseMutationOptions<unknown, Error, unknown>) => {
                const index = mutationIndex++;
                if (!mutations[index]) {
                    mutations[index] = new MutationObserver(client, { ...options, mutationFn });
                    unsubscribes.push(mutations[index].subscribe(noop));
                } else mutations[index].setOptions({ ...options, mutationFn });
                const observer = mutations[index];
                return { ...observer.getCurrentResult(), mutate: (value: unknown) => { void observer.mutate(value).catch(noop); } };
            },
        },
    }) as { default: () => React.ReactNode };
    const draw = () => { stateIndex = 0; queryIndex = 0; mutationIndex = 0; return Component(); };
    const buttons = (tree: React.ReactNode): React.ReactElement<Record<string, unknown>>[] => {
        if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
        return [...(tree.type === 'button' ? [tree as React.ReactElement<Record<string, unknown>>] : []),
            ...React.Children.toArray(tree.props.children).flatMap(buttons)];
    };
    return {
        draw, html: () => renderToStaticMarkup(draw()),
        button: (label: string) => buttons(draw()).find(button => button.props.children === label),
        click: (label: string) => {
            const button = buttons(draw()).find(button => button.props.children === label);
            if (!button) throw new Error(`Missing button: ${label}`);
            (button.props.onClick as () => void)();
        },
        settle: async () => { await new Promise(resolve => setImmediate(resolve)); },
        close: () => {
            unsubscribes.forEach(unsubscribe => unsubscribe()); queries.forEach(query => query.destroy()); client.clear();
            Object.defineProperty(globalThis, 'window', { configurable: true, value: previous });
        },
    };
}

t.test('preload forwards recovery actions and status to the registered channels without a payload', async t => {
    let api!: Pick<Window['electronAPI'], 'ragRetryEmbeddings' | 'reindexAllMeetings' | 'embeddingStatus' | 'ragGetQueueStatus'>;
    const calls: unknown[][] = [];
    mockRequire(path.resolve('electron/preload.ts'), {
        electron: {
            contextBridge: { exposeInMainWorld: (_name: string, exposed: typeof api) => { api = exposed; } },
            ipcRenderer: { invoke: async (...args: unknown[]) => { calls.push(args); return { success: false, error: 'Synthetic IPC refusal' }; } },
        },
    });
    t.same(await api.ragRetryEmbeddings(), { success: false, error: 'Synthetic IPC refusal' });
    t.same(await api.reindexAllMeetings(), { success: false, error: 'Synthetic IPC refusal' });
    await api.embeddingStatus(); await api.ragGetQueueStatus();
    t.same(calls, [['rag:retry-embeddings'], ['rag:reindex-all'], ['embedding-status'], ['rag:get-queue-status']]);
});

function api() {
    return {
        embeddingUseGet: async () => ({ connectionId: '', model: '' }),
        embeddingStatus: async () => ({ providerName: 'example:active', dimensions: 3, usingSelected: true,
            selectedLabel: null, incompatible: 0, meetingCount: 73, failedMeetings: 2, firstError: 'Synthetic embedding quota exceeded' }),
        ragGetQueueStatus: async () => ({ pending: 3, processing: 1, completed: 5, failed: 4 }),
        ragRetryEmbeddings: async () => ({ success: true, error: undefined as string | undefined }),
        reindexAllMeetings: async () => ({ success: true, error: undefined as string | undefined }),
    };
}

t.test('Search index shows failed meetings and the real error, distinguishes all job states, and retries through IPC', async t => {
    const backend = api();
    let calls = 0;
    backend.ragRetryEmbeddings = async () => { calls++; return { success: true, error: undefined }; };
    const page = host(backend);
    t.teardown(page.close);
    page.draw(); await page.settle();
    const html = page.html();
    t.match(html, '✕ 2 meetings failed');
    t.match(html, 'Synthetic embedding quota exceeded');
    t.match(html, '3 pending'); t.match(html, '1 processing'); t.match(html, '5 completed'); t.match(html, '4 failed');
    t.notMatch(html, 'animate-spin');
    t.ok(page.button('Retry failed'));
    page.click('Retry failed'); await page.settle();
    t.equal(calls, 1);
    t.match(page.html(), 'Retry requested');
});

t.test('Re-index all requires a second press with the actual count and never reports queued work as done', async t => {
    const backend = api();
    let calls = 0;
    let finish!: () => void;
    backend.reindexAllMeetings = async () => {
        calls++;
        await new Promise<void>(resolve => { finish = resolve; });
        return { success: true, error: undefined };
    };
    const page = host(backend);
    t.teardown(page.close);
    page.draw(); await page.settle();
    page.click('Re-index all');
    t.equal(calls, 0);
    t.ok(page.button('Re-index 73 meetings?'), 'not the capped recent-meeting list');
    page.click('Re-index 73 meetings?'); await page.settle();
    t.equal(calls, 1);
    t.match(page.html(), 'Re-indexing…');
    t.equal(page.button('Re-indexing…')?.props.disabled, true);
    finish(); await page.settle();
    t.match(page.html(), 'Re-index requested');
    t.notMatch(page.html(), 'Re-index complete');
});

for (const operation of ['retry', 'reindex'] as const) {
    for (const rejects of [false, true]) {
        t.test(`${operation} shows the real ${rejects ? 'rejected' : 'refused'} IPC error`, async t => {
            const backend = api();
            const error = `Synthetic ${operation} storage unavailable`;
            backend[operation === 'retry' ? 'ragRetryEmbeddings' : 'reindexAllMeetings'] = async () => {
                if (rejects) throw new Error(error);
                return { success: false, error };
            };
            const page = host(backend);
            t.teardown(page.close);
            page.draw(); await page.settle();
            if (operation === 'retry') page.click('Retry failed');
            else { page.click('Re-index all'); page.click('Re-index 73 meetings?'); }
            await page.settle();
            t.match(page.html(), `✕ ${error}`);
            t.notMatch(page.html(), operation === 'retry' ? 'Retry requested' : 'Re-index requested');
        });
    }
}
