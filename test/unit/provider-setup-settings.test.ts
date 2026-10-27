import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from 'react-query';
import * as ReactQuery from 'react-query';
import * as FramerMotion from 'framer-motion';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

// Only browser stores are stubbed; the Settings pages and their children render for real.
Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { electronAPI: {}, addEventListener: () => {}, removeEventListener: () => {} },
});
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { getAttribute: () => 'dark' } },
});
const { default: SettingsOverlay } = mockRequire(path.resolve('src/components/SettingsOverlay.tsx'), {
    react: React,
    'react-query': ReactQuery,
    'framer-motion': FramerMotion,
    [path.resolve('src/hooks/useResolvedTheme.ts')]: { useResolvedTheme: () => 'dark' },
    [path.resolve('src/hooks/useLocalStorageValue.ts')]: { useLocalStorageValue: () => [null, () => {}] },
    [path.resolve('src/utils/platformUtils.ts')]: { isMac: true, isWindows: false },
}) as typeof import('../../src/components/SettingsOverlay');

function renderSettings(initialTab: string) {
    const client = new QueryClient({ defaultOptions: { queries: { cacheTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['ai-connections'], []);
    const html = renderToStaticMarkup(React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(SettingsOverlay, { isOpen: true, onClose: () => {}, initialTab })
    ));
    client.clear();
    return html;
}

function sidebarButtons(html: string) {
    const nav = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
    return Array.from(nav.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g), match => ({
        attributes: match[1],
        label: match[2].replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').trim(),
    }));
}

t.test('Settings preserves the sidebar order and every initialTab id', t => {
    const tabs = [
        ['general', 'General'],
        ['audio', 'Audio & Translation'],
        ['ai-providers', 'Models & Agent'],
        ['providers', 'Provider setup'],
        ['keybinds', 'Shortcuts'],
        ['profile', 'Knowledge'],
        ['about', 'About'],
    ];
    for (const [id, label] of tabs) {
        const buttons = sidebarButtons(renderSettings(id));
        t.same(buttons.map(button => button.label), tabs.map(tab => tab[1]), `${id}: sidebar order`);
        t.same(buttons.filter(button => button.attributes.includes('bg-bg-item-active text-text-primary')).map(button => button.label), [label], `${id}: selects the expected tab`);
    }
    t.end();
});

t.test('Provider setup alone renders the existing Connections with presets and a model-jobs link', t => {
    const html = renderSettings('providers');
    t.match(html, /<h3[^>]*>Provider setup<\/h3>/);
    t.match(html, /<h3[^>]*>Connections<\/h3>/);
    t.match(html, /The services Pika connects to\. Which model does which job is set under <button\b[^>]*>Models &amp; Agent<\/button>\./);
    t.match(html, 'Choose which connection and model each job uses under Models &amp; Agent.');
    t.match(html, '>Ollama (local)</button>', 'the existing presets remain available');
    t.match(html, '>LM Studio</button>');
    t.notMatch(html, '>Where models are used</h3>');
    t.notMatch(html, '>Search index</h3>', 'the search index is not moved here');
    t.end();
});

t.test('Models & Agent renders its job rows and a real Provider setup button, not Connections', t => {
    const html = renderSettings('ai-providers');
    t.notMatch(html, /<h3[^>]*>Connections<\/h3>/);
    t.match(html, /Connections and keys are in <button\b[^>]*type="button"[^>]*>Provider setup<\/button>\./);
    for (const label of ['Quick answers', 'Summaries', 'Agent', 'Proactive help']) {
        t.match(html, new RegExp(`<h[34][^>]*>${label}</h[34]>`));
    }
    t.match(html, 'The search index is under Knowledge.');
    t.end();
});
