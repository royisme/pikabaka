import t from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from 'react-query';
import * as ReactQuery from 'react-query';
import * as FramerMotion from 'framer-motion';
import type { AiConnectionView } from '../../src/types/electron';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { gateHost, gateSettings } from '../helpers/gateSettingsHost';

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

function renderSettings(initialTab: string, connections: AiConnectionView[] = [], speechCredentials = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { cacheTime: Infinity, staleTime: Infinity, retry: false } } });
    client.setQueryData(['ai-connections'], connections);
    client.setQueryData(['speech-credentials'], speechCredentials);
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

t.test('Provider setup shows storage notices with words and marks, only for plaintext or locked', t => {
    const plaintext = renderSettings('providers', [], { storage: { mode: 'plaintext', reason: 'No keychain on this invented system.' } });
    t.match(plaintext, '▲ Keys are stored in a plain local file.');
    t.match(plaintext, 'No keychain on this invented system.');
    const locked = renderSettings('providers', [], { storage: { mode: 'locked', reason: 'Invented secure storage is locked.' } });
    t.match(locked, '✕ Stored credentials are locked.');
    t.match(locked, 'Invented secure storage is locked.');
    const encrypted = renderSettings('providers', [], { storage: { mode: 'encrypted' } });
    t.notMatch(encrypted, 'Keys are stored in a plain local file');
    t.notMatch(encrypted, 'Stored credentials are locked');
    t.notMatch(renderSettings('ai-providers', [], { storage: { mode: 'plaintext', reason: 'Invented notice reason' } }), 'Invented notice reason', 'notice belongs to Provider setup only');
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

t.test('Provider setup lists only speech services with a saved key or account below language models', t => {
    const html = renderSettings('providers', [], { hasSonioxKey: true, hasAzureKey: true, googleServiceAccountPath: '/synthetic/account.json' });
    const speech = html.slice(html.indexOf('>Speech-to-text providers</h3>'));
    t.ok(html.indexOf('>Language model providers</h3>') < html.indexOf('>Speech-to-text providers</h3>'));
    t.match(speech, '>Soniox</span>');
    t.match(speech, '>Azure Speech</span>');
    t.match(speech, '>Google Cloud</span>');
    t.equal((speech.match(/Key saved/g) ?? []).length, 2);
    t.match(speech, 'File chosen');
    for (const name of ['Groq Whisper', 'OpenAI', 'Deepgram', 'ElevenLabs Scribe', 'IBM Watson']) t.notMatch(speech, `>${name}</span>`);
    t.notMatch(speech, '/synthetic/account.json', 'the list does not expose the account path');
    t.end();
});

t.test('Provider setup places a separate Decision service section below speech, not a model provider', t => {
    const html = renderSettings('providers');
    t.match(html, /<h3[^>]*>Decision service<\/h3>/);
    t.ok(html.indexOf('>Speech-to-text providers</h3>') < html.indexOf('>Decision service</h3>'));
    t.match(html, 'A separate kind of service, not a language model provider.');
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

t.test('Audio keeps speech selection but replaces account/key fields with a plain Provider setup link', t => {
    const html = renderSettings('audio');
    const speech = html.slice(html.indexOf('>Speech recognition</h3>'), html.indexOf('>Translation</h3>'));
    t.match(speech, 'Speech Provider');
    t.match(speech, 'Their language');
    t.match(speech, 'You speak');
    t.match(speech, 'Save speech settings');
    t.match(speech, /Keys and accounts are in <button[^>]*type="button"[^>]*>Provider setup<\/button>/);
    t.notMatch(speech, 'Service Account JSON');
    t.notMatch(speech, 'Select File');
    t.notMatch(speech, 'type="password"');
    t.notMatch(speech, 'Test key');
    t.end();
});

t.test('Audio offers every configured service, uses saved keys for model Fetch, and its setup link opens Provider setup', t => {
    const state: unknown[] = [];
    let index = 0;
    const client = new QueryClient();
    t.teardown(() => client.clear());
    const noop = () => {};
    const { default: Overlay } = mockRequire(path.resolve('src/components/SettingsOverlay.tsx'), {
        react: { ...React,
            useState: (initial: unknown) => {
                const slot = index++;
                if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
                return [state[slot], (next: unknown) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
            },
            useEffect: noop, useRef: (value: unknown) => ({ current: value }), useMemo: (fn: () => unknown) => fn(),
        },
        'react-query': { ...ReactQuery, useQueryClient: () => client, useQuery: (key: string[]) => key[0] === 'speech-credentials' ? { data: {
            googleServiceAccountPath: '/synthetic/account.json', hasSttGroqKey: true, hasSttOpenaiKey: true,
            hasDeepgramKey: true, hasElevenLabsKey: true, hasAzureKey: true, hasIbmWatsonKey: true, hasSonioxKey: true,
        } } : {} },
        'framer-motion': FramerMotion,
        [path.resolve('src/hooks/useShortcuts.ts')]: { useShortcuts: () => ({ shortcuts: {}, updateShortcut: noop, resetShortcuts: noop }) },
        [path.resolve('src/hooks/useMainEvent.ts')]: { useMainEvent: noop },
        [path.resolve('src/hooks/useWindowEvent.ts')]: { useWindowEvent: noop },
        [path.resolve('src/hooks/useResolvedTheme.ts')]: { useResolvedTheme: () => 'dark' },
        [path.resolve('src/hooks/useLocalStorageValue.ts')]: { useLocalStorageValue: () => [null, noop] },
        [path.resolve('src/utils/platformUtils.ts')]: { isMac: true, isWindows: false },
    }) as typeof import('../../src/components/SettingsOverlay');
    const draw = () => { index = 0; return Overlay({ isOpen: true, initialTab: 'audio', onClose: noop }); };
    type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
    const elements = (tree: React.ReactNode): Element[] => React.isValidElement<Element['props']>(tree)
        ? [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)] : [];
    const speech = () => elements(draw()).find(element => element.type === 'div' && React.Children.toArray(element.props.children).some(child => React.isValidElement<{ children: string }>(child) && child.type === 'h3' && child.props.children === 'Speech recognition'))!;
    const picker = elements(speech()).find(element => Array.isArray(element.props.options) && element.props.value === 'google')!;
    const options = picker.props.options as Array<{ id: string }>;
    t.same(options.map(option => option.id), ['google', 'groq', 'openai', 'deepgram', 'elevenlabs', 'azure', 'ibmwatson', 'soniox']);
    for (const { id } of options) {
        (picker.props.onChange as (id: string) => void)(id);
        const section = speech();
        const html = renderToStaticMarkup(section);
        t.notMatch(html, 'type="password"', `${id}: no key field`);
        t.notMatch(html, 'Service Account JSON', `${id}: no account chooser`);
        t.match(html, 'Save speech settings');
        const model = elements(section).find(element => 'apiKey' in element.props);
        if (model) t.equal(model.props.apiKey, '', `${id}: model Fetch uses the saved key`);
    }
    const link = elements(speech()).find(element => element.type === 'button' && element.props.children === 'Provider setup')!;
    t.equal(link.props.type, 'button');
    (link.props.onClick as () => void)();
    t.ok(elements(draw()).some(element => typeof element.type === 'function' && element.type.name === 'ProviderSetupSettings'), 'the link changes the actual Settings page');
    const providerPage = elements(draw()).find(element => typeof element.type === 'function' && element.type.name === 'ProviderSetupSettings')!;
    (providerPage.props.onOpenModels as () => void)();
    const modelsPage = elements(draw()).find(element => typeof element.type === 'function' && element.type.name === 'AIProvidersSettings')!;
    const modelsTree = (modelsPage.type as (props: Element['props']) => React.ReactNode)(modelsPage.props);
    const proactive = elements(modelsTree).find(element => typeof element.type === 'function' && element.type.name === 'ProactiveHelpSettings')!;
    const host = gateHost('ProactiveHelpSettings', {}, gateSettings, proactive.props.onOpenProviders as () => void);
    t.teardown(host.unmount);
    host.click('Provider setup');
    t.ok(elements(draw()).some(element => typeof element.type === 'function' && element.type.name === 'ProviderSetupSettings'), 'Proactive help forwards navigation through its parent and opens the actual Provider setup page');
    t.end();
});

t.test('General no longer renders answer controls and keeps its other settings', t => {
    const html = renderSettings('general');
    t.notMatch(html, 'AI Response Language');
    t.notMatch(html, 'ai-response-language');
    t.notMatch(html, 'How answers sound');
    t.notMatch(html, 'answer-style-settings');
    for (const label of ['General settings', 'Theme', 'Live transcript', 'Overlay opacity']) {
        t.match(html, label);
    }
    for (const label of ['Process Disguise', 'Activity Monitor', 'System Settings']) {
        t.notMatch(html, label);
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
