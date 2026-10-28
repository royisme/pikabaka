import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver, MutationObserver } from 'react-query';
import type { UseMutationOptions } from 'react-query';
import * as ReactQuery from 'react-query';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

export const gateSettings = {
    mode: 'log' as const, model: 'invented-decision-model', baseUrl: 'http://localhost:3425/v1',
    hasApiKey: true, threshold: 0.7, cooldownSeconds: 120,
};

// Like speechSettingsHost: real query/mutation observers with a windowless React state host.
export function gateHost(page: 'DecisionServiceSettings' | 'ProactiveHelpSettings', api: object = {}, settings = gateSettings, onOpenProviders = () => {}) {
    const electronAPI = {
        agentGateGetSettings: async () => ({ ...settings }),
        agentGateStatus: async () => ({ state: 'ok' }), agentGateLog: async () => [],
        ...api,
    };
    const client = new QueryClient({ defaultOptions: { queries: { cacheTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['agent-gate-settings'], { ...settings });
    client.setQueryData(['agent-gate-status'], { state: 'ok' });
    client.setQueryData(['agent-gate-log'], []);
    const noop = () => {};
    const state: unknown[] = [];
    const queries: QueryObserver<unknown, Error>[] = [];
    const mutations: MutationObserver<unknown, Error, void>[] = [];
    const unsubscribes: Array<() => void> = [];
    let stateIndex = 0;
    let queryIndex = 0;
    let mutationIndex = 0;
    const { default: Component } = mockRequire(path.resolve(`src/components/settings/${page}.tsx`), {
        react: { ...React, useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in state)) state[index] = initial;
            return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
        } },
        'react-query': {
            ...ReactQuery, useQueryClient: () => client,
            useQuery: (queryKey: string[], queryFn: () => Promise<unknown>) => {
                const index = queryIndex++;
                if (!queries[index]) {
                    queries[index] = new QueryObserver(client, { queryKey, queryFn });
                    unsubscribes.push(queries[index].subscribe(noop));
                } else queries[index].setOptions({ queryKey, queryFn });
                return queries[index].getCurrentResult();
            },
            useMutation: (mutationFn: () => Promise<unknown>, options: UseMutationOptions<unknown, Error, void> = {}) => {
                const index = mutationIndex++;
                if (!mutations[index]) {
                    mutations[index] = new MutationObserver(client, { ...options, mutationFn });
                    unsubscribes.push(mutations[index].subscribe(noop));
                } else mutations[index].setOptions({ ...options, mutationFn });
                const observer = mutations[index];
                return { ...observer.getCurrentResult(), mutate: () => { void observer.mutate().catch(noop); } };
            },
        },
    }) as { default: (props: { onOpenProviders: () => void }) => React.ReactNode };
    const draw = () => {
        Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI } });
        stateIndex = 0; queryIndex = 0; mutationIndex = 0;
        return Component({ onOpenProviders });
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
        const found = elements(draw()).find(c => c.type === type && (c.props['aria-label'] === label || c.props.placeholder === label || text(c) === label));
        if (!found) throw new Error(`Missing ${type}: ${label}`);
        return found;
    };
    return {
        html: () => renderToStaticMarkup(draw()), control,
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
