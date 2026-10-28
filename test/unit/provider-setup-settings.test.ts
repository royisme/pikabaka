import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from 'react-query';
import * as ReactQuery from 'react-query';
import * as FramerMotion from 'framer-motion';
import type { AiConnectionView } from '../../src/types/electron';
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

function renderSettings(initialTab: string, connections: AiConnectionView[] = []) {
    const client = new QueryClient({ defaultOptions: { queries: { cacheTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['ai-connections'], connections);
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

t.test('Provider setup alone renders the provider list without presets and with a model-jobs link', t => {
    const html = renderSettings('providers');
    t.match(html, /<h3[^>]*>Provider setup<\/h3>/);
    t.match(html, /<h3[^>]*>Language model providers<\/h3>/);
    t.match(html, /The services Pika connects to\. Which model does which job is set under <button\b[^>]*>Models &amp; Agent<\/button>\./);
    t.match(html, 'No providers yet. Add one to use a model.');
    t.match(html, '>Add provider</button>');
    t.notMatch(html, '>Ollama (local)</button>', 'S1b removes presets');
    t.notMatch(html, '>LM Studio</button>');
    t.notMatch(html, '>Where models are used</h3>');
    t.notMatch(html, '>Search index</h3>', 'the search index is not moved here');
    t.end();
});

t.test('floating picker repair section opens the named hidden built-in editor', t => {
    const html = renderSettings('providers:openai', [{
        id: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1',
        builtin: true, customBaseUrl: false, hasApiKey: false,
    }]);
    t.match(html, '>Edit OpenAI</h4>');
    t.match(html, 'No providers yet. Add one to use a model.');
    t.same(sidebarButtons(html).filter(button => button.attributes.includes('bg-bg-item-active text-text-primary')).map(button => button.label), ['Provider setup']);
    t.end();
});

t.test('General no longer renders answer controls and keeps its other settings', t => {
    const html = renderSettings('general');
    t.notMatch(html, 'AI Response Language');
    t.notMatch(html, 'ai-response-language');
    t.notMatch(html, 'How answers sound');
    t.notMatch(html, 'answer-style-settings');
    for (const label of ['General settings', 'Theme', 'Live transcript', 'Overlay opacity', 'Process Disguise']) {
        t.match(html, label);
    }
    t.end();
});

t.test('answer language and collapsed style belong only to the Quick answers row', t => {
    const html = renderSettings('ai-providers');
    const quickAnswers = html.slice(html.indexOf('>Quick answers</h4>'), html.indexOf('>Summaries</h4>'));
    const laterRows = html.slice(html.indexOf('>Summaries</h4>'));
    t.match(quickAnswers, 'Answers in the overlay. The top-bar model selector switches this model.');
    t.match(quickAnswers, 'AI Response Language');
    t.match(quickAnswers, /aria-expanded="false" aria-controls="answer-style-settings"/);
    t.match(quickAnswers, '>How answers sound</button>');
    t.match(quickAnswers, /id="answer-style-settings" hidden=""/);
    t.notMatch(laterRows, 'AI Response Language');
    t.notMatch(laterRows, 'How answers sound');
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
