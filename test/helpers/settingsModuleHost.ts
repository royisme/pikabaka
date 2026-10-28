import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver, MutationObserver } from 'react-query';
import type { UseMutationOptions } from 'react-query';
import * as ReactQuery from 'react-query';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;

/**
 * Renders one settings module windowless: real query and mutation observers, only the browser boundary
 * (`window.electronAPI`) and React's local state are substituted, as in speechSettingsHost.
 */
export function settingsModuleHost(file: string, electronAPI: object, seed: Array<[unknown[], unknown]> = []) {
    const client = new QueryClient({ defaultOptions: { queries: { cacheTime: Infinity, staleTime: Infinity, retry: false } } });
    for (const [queryKey, data] of seed) client.setQueryData(queryKey, data);
    const noop = () => {};
    const state: unknown[] = [];
    const queries: QueryObserver<unknown, Error>[] = [];
    const mutations: MutationObserver<unknown, Error, unknown>[] = [];
    const unsubscribes: Array<() => void> = [];
    let stateIndex = 0;
    let queryIndex = 0;
    let mutationIndex = 0;
    const { default: Component } = mockRequire(path.resolve(file), {
        react: { ...React, useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in state)) state[index] = initial;
            return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
        } },
        'react-query': {
            ...ReactQuery,
            useQueryClient: () => client,
            useQuery: (queryKey: unknown[], queryFn: () => Promise<unknown>, options: Record<string, unknown> = {}) => {
                const index = queryIndex++;
                if (!queries[index]) {
                    queries[index] = new QueryObserver(client, { queryKey, queryFn, ...options });
                    unsubscribes.push(queries[index].subscribe(noop));
                } else queries[index].setOptions({ queryKey, queryFn, ...options });
                return queries[index].getCurrentResult();
            },
            useMutation: (mutationFn: (value: unknown) => Promise<unknown>, options: UseMutationOptions<unknown, Error, unknown> = {}) => {
                const index = mutationIndex++;
                if (!mutations[index]) {
                    mutations[index] = new MutationObserver(client, { ...options, mutationFn });
                    unsubscribes.push(mutations[index].subscribe(noop));
                } else mutations[index].setOptions({ ...options, mutationFn });
                const observer = mutations[index];
                return { ...observer.getCurrentResult(), mutate: (value?: unknown) => { void observer.mutate(value).catch(noop); } };
            },
        },
    }) as { default: (props: Record<string, unknown>) => React.ReactNode };
    let props: Record<string, unknown> = {};
    const draw = () => {
        Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI } });
        stateIndex = 0; queryIndex = 0; mutationIndex = 0;
        return Component(props);
    };
    const elements = (tree: React.ReactNode): Element[] => React.isValidElement<Element['props']>(tree)
        ? [tree as Element, ...React.Children.toArray(tree.props.children).flatMap(elements)]
        : [];
    const text = (tree: React.ReactNode): string => {
        if (typeof tree === 'string') return tree;
        if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return '';
        return React.Children.toArray(tree.props.children).map(text).join('');
    };
    const control = (type: string, label: string) => {
        const found = elements(draw()).find(c => c.type === type && (c.props['aria-label'] === label || c.props.id === label || c.props.placeholder === label || text(c) === label));
        if (!found) throw new Error(`Missing ${type}: ${label}`);
        return found;
    };
    return {
        render: (next: Record<string, unknown>) => { props = next; },
        html: () => renderToStaticMarkup(draw()),
        component: (name: string) => {
            const found = elements(draw()).find(element => typeof element.type === 'function' && element.type.name === name);
            if (!found) throw new Error(`Missing component: ${name}`);
            return found;
        },
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
