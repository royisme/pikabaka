import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import * as FramerMotion from 'framer-motion';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
const elements = (tree: React.ReactNode): Element[] => React.isValidElement<Element['props']>(tree)
    ? [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)] : [];
const noop = () => {};

async function settings(credentials: Record<string, unknown>, api = {}) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {
        getStoredCredentials: async () => ({ ...credentials }),
        getRecognitionLanguages: async () => ({ 'english-us': { label: 'English (US)', group: 'English' } }),
        getSttLanguage: async () => 'english-us',
        startAudioTest: async () => ({ success: true }), stopAudioTest: async () => ({ success: true }), ...api,
    } } });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: noop } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { getAttribute: () => 'dark' } } });
    const client = new QueryClient();
    const state: unknown[] = [];
    const effects: Array<() => void | (() => void)> = [];
    let index = 0;
    let mounted = false;
    const { default: Overlay } = mockRequire(path.resolve('src/components/SettingsOverlay.tsx'), {
        react: { ...React,
            useState: (initial: unknown) => {
                const slot = index++;
                if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
                return [state[slot], (next: unknown) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
            },
            useEffect: (effect: () => void | (() => void)) => { if (!mounted) effects.push(effect); },
            useRef: (value: unknown) => ({ current: value }), useMemo: (fn: () => unknown) => fn(),
        },
        '@tanstack/react-query': { ...ReactQuery, useQueryClient: () => client, useQuery: ({ queryKey: key }: { queryKey: readonly unknown[] }) => key[0] === 'speech-credentials' ? { data: credentials } : {} },
        'framer-motion': FramerMotion,
        [path.resolve('src/hooks/useShortcuts.ts')]: { useShortcuts: () => ({ shortcuts: {}, updateShortcut: noop, resetShortcuts: noop }) },
        [path.resolve('src/hooks/useMainEvent.ts')]: { useMainEvent: noop },
        [path.resolve('src/hooks/useWindowEvent.ts')]: { useWindowEvent: noop },
        [path.resolve('src/hooks/useResolvedTheme.ts')]: { useResolvedTheme: () => 'dark' },
        [path.resolve('src/hooks/useLocalStorageValue.ts')]: { useLocalStorageValue: () => [null, noop] },
        [path.resolve('src/utils/platformUtils.ts')]: { isMac: true, isWindows: false },
    }) as typeof import('../../src/components/SettingsOverlay');
    const draw = () => { index = 0; return Overlay({ isOpen: true, initialTab: 'audio', onClose: noop }); };
    const speech = () => elements(draw()).find(element => element.type === 'div' && React.Children.toArray(element.props.children).some(child => React.isValidElement<{ children: string }>(child) && child.type === 'h3' && child.props.children === 'Speech recognition'))!;
    draw(); mounted = true;
    const cleanups = effects.map(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    const picker = () => elements(speech()).find(element => typeof element.type === 'function' && element.type.name === 'ProviderSelect');
    const button = (label: string) => elements(speech()).find(element => element.type === 'button' && element.props.children === label)!;
    return {
        draw, speech, picker, button,
        html: () => renderToStaticMarkup(speech()),
        select: (id: string) => (picker()!.props.onChange as (id: string) => void)(id),
        close: () => { cleanups.forEach(cleanup => cleanup?.()); client.clear(); },
    };
}

t.test('Audio lists only configured speech services and never selects a replacement for a stale saved choice', async t => {
    const host = await settings({ sttProvider: 'deepgram', hasSonioxKey: true, hasAzureKey: true });
    t.teardown(host.close);
    t.same((host.picker()!.props.options as Array<{ id: string }>).map(option => option.id), ['azure', 'soniox']);
    t.equal(host.picker()!.props.value, 'deepgram', 'the saved choice is not reassigned');
    t.match(host.html(), 'Deepgram: not configured');
    t.match(host.html(), '✕');
    t.equal(host.button('Save speech settings').props.disabled, true, 'a stale choice cannot be saved as working');
    t.notOk(elements(host.speech()).some(element => 'apiKey' in element.props), 'no model Fetch for the missing service');
    const link = host.button('Provider setup');
    (link.props.onClick as () => void)();
    t.ok(elements(host.draw()).some(element => typeof element.type === 'function' && element.type.name === 'ProviderSetupSettings'), 'repair opens the real setup page');
});

t.test('Audio with no configured service shows setup, not a working Google default or an empty selector', async t => {
    const host = await settings({ sttProvider: 'google' });
    t.teardown(host.close);
    t.notOk(host.picker());
    t.match(host.html(), 'No speech services configured.');
    t.match(host.html(), 'Google Cloud: not configured');
    t.ok(host.button('Provider setup'));
    t.equal(host.button('Save speech settings').props.disabled, true);
});

t.test('removing a selected key refreshes Audio into not configured without changing the saved service', async t => {
    const credentials = { sttProvider: 'soniox', hasSonioxKey: true, hasDeepgramKey: true };
    const host = await settings(credentials);
    t.teardown(host.close);
    t.notMatch(host.html(), 'not configured');
    credentials.hasSonioxKey = false;
    t.same((host.picker()!.props.options as Array<{ id: string }>).map(option => option.id), ['deepgram']);
    t.match(host.html(), 'Soniox: not configured');
    t.equal(host.picker()!.props.value, 'soniox');
    t.equal(host.button('Save speech settings').props.disabled, true);
});

t.test('choosing a configured service saves that service, its model and languages even when the old selection lacks a key', async t => {
    const credentials: Record<string, unknown> = { sttProvider: 'google', hasDeepgramKey: true, sttModels: { deepgram: 'invented-model' } };
    const calls: string[] = [];
    const host = await settings(credentials, {
        setSttProvider: async (id: string) => { credentials.sttProvider = id; calls.push(`service:${id}`); return { success: true }; },
        setSttModel: async (id: string, model: string) => {
            if (credentials.sttProvider === 'google') return { success: false, error: 'Google Cloud is not configured: choose its service-account file in Provider setup.' };
            calls.push(`model:${id}:${model}`); return { success: true };
        },
        setRecognitionLanguage: async (language: string, speaker: string) => { calls.push(`${speaker}:${language}`); return { success: true }; },
        getMeetingActive: async () => false,
    });
    t.teardown(host.close);
    await host.select('deepgram');
    t.notMatch(host.html(), 'not configured');
    t.equal(host.button('Save speech settings').props.disabled, false);
    await (host.button('Save speech settings').props.onClick as () => Promise<void>)();
    t.same(calls, ['service:deepgram', 'model:deepgram:invented-model', 'them:english-us', 'user:english-us']);
    t.match(host.html(), 'Saved: deepgram');
    t.notMatch(host.html(), 'Google Cloud is not configured');
});
