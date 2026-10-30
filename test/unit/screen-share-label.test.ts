import t from 'tap';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import type { QueryObserverOptions } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import * as FramerMotion from 'framer-motion';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

const label = 'Hide from screen share';
const description = "Asks macOS and Windows to keep Pika's windows out of screen sharing and recording. Not guaranteed: macOS apps that record with ScreenCaptureKit can still capture them. Not supported on Linux.";
type Page = 'SettingsOverlay' | 'Launcher' | 'SettingsPopup';
type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;

function elements(tree: React.ReactNode): Element[] {
    return React.isValidElement<Element['props']>(tree)
        ? [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)] : [];
}

function visibleText(html: string) {
    return html.replace(/<[^>]*>/g, '').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

// Real query observers and renderer trees, with only the windowless React/browser host stubbed.
function host(page: Page, initial: boolean, theme: 'light' | 'dark') {
    const noop = () => {};
    const calls: boolean[] = [];
    const storage = new Map<string, string>();
    const electronAPI = {
        getUndetectable: async () => initial,
        setUndetectable: async (state: boolean) => { calls.push(state); return { success: true }; },
        getRecentMeetings: async () => [], getMeetingActive: async () => false,
        profileGetProfile: async () => null, profileGetStatus: async () => ({ hasProfile: false }),
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI, atob, btoa, addEventListener: noop, removeEventListener: noop } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { compatMode: 'CSS1Compat', documentElement: { getAttribute: () => theme }, addEventListener: noop, removeEventListener: noop } });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    } });
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false } } });
    const queries = new Map<string, QueryObserver>();
    const unsubscribes: Array<() => void> = [];
    const state: unknown[] = [];
    let stateIndex = 0;
    const { default: Component } = mockRequire(path.resolve(`src/components/${page}.tsx`), {
        react: { ...React,
            useState: (initialValue: unknown) => {
                const slot = stateIndex++;
                if (!(slot in state)) state[slot] = typeof initialValue === 'function' ? initialValue() : initialValue;
                return [state[slot], (next: unknown) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
            },
            useEffect: noop, useLayoutEffect: noop,
            useRef: (value: unknown) => ({ current: value }), useMemo: (fn: () => unknown) => fn(),
        },
        '@tanstack/react-query': { ...ReactQuery, useQueryClient: () => client,
            useQuery: ({ queryKey, queryFn, ...options }: { queryKey: readonly unknown[]; queryFn?: () => Promise<unknown> } & QueryObserverOptions) => {
                const key = JSON.stringify(queryKey);
                let observer = queries.get(key);
                if (!observer) {
                    observer = new QueryObserver(client, { ...options, queryKey, queryFn });
                    queries.set(key, observer);
                    unsubscribes.push(observer.subscribe(noop));
                }
                return observer.getCurrentResult();
            },
        },
        'framer-motion': FramerMotion,
        'react-dom': { createPortal: (children: React.ReactNode) => children },
        [path.resolve('assets/icon.png')]: 'synthetic-icon.png',
        'katex/dist/katex.min.css': {},
        [path.resolve('src/hooks/useShortcuts.ts')]: { useShortcuts: () => ({ shortcuts: {}, updateShortcut: noop, resetShortcuts: noop, isShortcutPressed: () => false }) },
        [path.resolve('src/hooks/useMainEvent.ts')]: { useMainEvent: noop },
        [path.resolve('src/hooks/useWindowEvent.ts')]: { useWindowEvent: noop },
        [path.resolve('src/hooks/useResolvedTheme.ts')]: { useResolvedTheme: () => theme },
        [path.resolve('src/hooks/useLocalStorageValue.ts')]: { useLocalStorageValue: () => [null, noop] },
        [path.resolve('src/utils/platformUtils.ts')]: { isMac: true, isWindows: false },
    }) as { default: (props: object) => React.ReactNode };
    const draw = () => {
        stateIndex = 0;
        return Component({ isOpen: true, initialTab: 'general', onClose: noop, onStartMeeting: noop, onOpenSettings: noop });
    };
    return {
        calls, draw,
        html: () => renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, draw())),
        control: () => elements(draw()).find(element => element.props['aria-label'] === label),
        settle: async () => { draw(); await new Promise(resolve => setImmediate(resolve)); },
        unmount: () => { unsubscribes.forEach(unsubscribe => unsubscribe()); queries.forEach(query => query.destroy()); client.clear(); },
    };
}

for (const page of ['SettingsOverlay', 'Launcher', 'SettingsPopup'] as const) {
    for (const theme of ['dark', 'light'] as const) {
        t.test(`${page}, ${theme}: honest screen-share label and accessible two-way toggle`, async t => {
            const initial = theme === 'light';
            const view = host(page, initial, theme);
            t.teardown(view.unmount);
            await view.settle();
            const text = visibleText(view.html());
            t.match(text, label);
            t.notMatch(text, /undetectable|detectable/i, 'no old name in visible text');
            if (page === 'SettingsOverlay') {
                t.match(text, description, 'Settings explains the request and its limits');
                t.match(text, 'ScreenCaptureKit');
                t.match(text, 'Linux');
                t.match(view.html(), /<h3\b[^>]*>Hide from screen share<\/h3>/, 'heading is static');
            } else {
                t.notMatch(text, 'ScreenCaptureKit', 'the long explanation stays in Settings');
            }
            const control = view.control();
            t.ok(control, 'control has the new accessible name');
            if (!control) return;
            t.equal(control.type, 'button', 'native button provides keyboard activation');
            t.equal(control.props.type, 'button');
            t.equal(control.props.role, 'switch');
            t.equal(control.props['aria-pressed'], initial, 'reflects the fetched state');
            t.equal(control.props['aria-checked'], initial, 'switch semantics match the state');
            for (const next of [!initial, initial]) {
                (view.control()!.props.onClick as () => void)();
                t.equal(view.control()!.props['aria-pressed'], next, 'pressed state follows the toggle');
                t.equal(view.control()!.props['aria-checked'], next);
                t.match(visibleText(view.html()), label, 'name stays the same in both states');
            }
            t.same(view.calls, [!initial, initial], 'both toggles call the existing setter with the new state');
        });
    }
}

t.test('shipped README and PRODUCT name screen-share privacy without undetectable or guaranteed claims', t => {
    for (const file of ['README.md', 'PRODUCT.md']) {
        const text = readFileSync(path.resolve(file), 'utf8');
        t.match(text, label, `${file}: new feature name`);
        t.notMatch(text, /undetectable|detectable|guaranteed/i, `${file}: no undetectable or guaranteed claim`);
        t.notMatch(text, /ensures stealth|stealth (mode|overlay)/i, `${file}: no stealth claim`);
    }
    const readme = readFileSync(path.resolve('README.md'), 'utf8');
    t.match(readme, '**Window content protection ("Hide from screen share")**');
    t.match(readme, '**Why "Hide from screen share"?**');
    t.match(readme, 'is not a total guarantee: macOS screen recorders that use ScreenCaptureKit can still capture protected windows, and Linux is not supported');
    const product = readFileSync(path.resolve('PRODUCT.md'), 'utf8');
    t.match(product, '**Hide from screen share**: `evidenced` in code (`setContentProtection` in the window helpers); real-device behaviour is the owner\'s check.');
    t.match(product, 'pending a content-protection review');
    t.match(product, 'macOS recorders that use ScreenCaptureKit can still capture it, and Linux is not supported');
    t.end();
});
