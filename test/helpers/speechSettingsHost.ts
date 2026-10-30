import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/react-query';
import type { UseMutationOptions } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

// Real query/mutation observers; only the browser boundary and React's state host are substituted.
export function speechHost(api: object, credentials = {}) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: { getStoredCredentials: async () => ({ ...credentials }), ...api } } });
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['speech-credentials'], { ...credentials });
    const noop = () => {};
    const state: unknown[] = [];
    const queries: QueryObserver<unknown, Error>[] = [];
    const mutations: MutationObserver<unknown, Error, string>[] = [];
    const unsubscribes: Array<() => void> = [];
    let stateIndex = 0;
    let queryIndex = 0;
    let mutationIndex = 0;
    const { default: Component } = mockRequire(path.resolve('src/components/settings/SpeechProvidersSettings.tsx'), {
        react: { ...React, useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in state)) state[index] = initial;
            return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
        } },
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
    const draw = () => { stateIndex = 0; queryIndex = 0; mutationIndex = 0; return Component(); };
    const controls = (tree: React.ReactNode, type: string): React.ReactElement<Record<string, unknown>>[] => {
        if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
        return [
            ...(tree.type === type ? [tree as React.ReactElement<Record<string, unknown>>] : []),
            ...React.Children.toArray(tree.props.children).flatMap(child => controls(child, type)),
        ];
    };
    const text = (tree: React.ReactNode): string => {
        if (typeof tree === 'string') return tree;
        if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return '';
        return React.Children.toArray(tree.props.children).map(text).join('');
    };
    const control = (type: string, label: string) => {
        const found = controls(draw(), type).find(c => c.props['aria-label'] === label || text(c) === label);
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
        change: (type: string, label: string, value: string) => {
            (control(type, label).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
        },
        settle: async () => { await new Promise(resolve => setImmediate(resolve)); },
        unmount: () => { unsubscribes.forEach(unsubscribe => unsubscribe()); queries.forEach(query => query.destroy()); client.clear(); },
    };
}
