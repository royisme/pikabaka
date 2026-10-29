import t, { type Test } from 'tap';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type * as Settings from '../../electron/services/SettingsManager';

const file = (name: string) => path.resolve(`electron/${name}.ts`);

type AnswerSources = { meetings: boolean; materials: boolean };

function handlers(t: Test) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pika-answer-source-switches-'));
    t.teardown(() => rmSync(dir, { recursive: true, force: true }));
    const settingsPath = path.join(dir, 'settings.json');
    const s = mockRequire(file('services/SettingsManager'), {
        [file('services/configPaths')]: { getSettingsJsonPath: () => settingsPath },
    }) as typeof Settings;
    const registered = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const { registerKnowledgeHandlers } = mockRequire(file('ipc/knowledge'), {
        electron: { dialog: {} },
        [file('main')]: {},
        [file('services/SettingsManager')]: s,
        [file('services/CredentialsManager')]: { CredentialsManager: { getInstance: () => ({}) } },
        [file('ipc/safeHandle')]: {
            safeHandle: (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => registered.set(channel, handler),
        },
    }) as typeof import('../../electron/ipc/knowledge');
    registerKnowledgeHandlers({} as never);
    return {
        ...s,
        manager: s.SettingsManager.getInstance(),
        settingsPath,
        invoke: (channel: string, payload?: unknown) => registered.get(channel)!({}, payload),
    };
}

t.test('the answer-source IPC pair reads the approved defaults and round-trips only the two booleans', async t => {
    const f = handlers(t);
    t.same(await f.invoke('answer-sources:get'), { meetings: true, materials: false }, 'the profile source is gone from the reply');
    t.same(await f.invoke('answer-sources:set', { materials: true }), { success: true });
    t.same(await f.invoke('answer-sources:get'), { meetings: true, materials: true });
    t.same(JSON.parse(readFileSync(f.settingsPath, 'utf8')), { answerUsesMaterials: true });
    t.same(await f.invoke('answer-sources:set', { meetings: false, materials: false }), { success: true });
    t.same(await f.invoke('answer-sources:get'), { meetings: false, materials: false });
    t.end();
});

t.test('the setter rejects a non-boolean, an unknown key and a non-object payload without writing anything', async t => {
    const f = handlers(t);
    t.same(await f.invoke('answer-sources:set', { profile: true }), { success: false, error: 'Unknown setting: profile' }, 'the removed profile source is an unknown setting now');
    for (const payload of [
        { profile: 'yes' },
        { profile: false, everything: true },
        { everything: true },
        'meetings',
        null,
        [],
        { materials: 1 },
    ]) {
        const reply = await f.invoke('answer-sources:set', payload) as { success: boolean; error?: string };
        t.equal(reply.success, false, `${JSON.stringify(payload)} is rejected`);
        t.ok(reply.error, 'the real reason is returned');
        t.same(await f.invoke('answer-sources:get'), { meetings: true, materials: false }, 'a rejected payload changes nothing');
    }
    t.end();
});

function host(t: Test, electronAPI: Record<string, unknown>) {
    let query: { data?: AnswerSources; error?: Error; isLoading: boolean } = { isLoading: true };
    let mutationError: Error | undefined;
    const { default: Component } = mockRequire(path.resolve('src/components/settings/AnswerSourcesSettings.tsx'), {
        'react-query': {
            useQueryClient: () => ({ invalidateQueries: async () => {} }),
            useQuery: () => query,
            useMutation: (fn: (payload: unknown) => Promise<void>, options: { onSuccess?: () => void } = {}) => ({
                isLoading: false,
                error: mutationError,
                reset: () => { mutationError = undefined; },
                mutate: (payload: unknown) => {
                    void fn(payload).then(() => { mutationError = undefined; options.onSuccess?.(); }, (error: Error) => { mutationError = error; });
                },
            }),
        },
    }) as { default: React.FC };
    t.teardown(() => { Reflect.deleteProperty(globalThis, 'window'); });
    const draw = () => {
        Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI } });
        return Component({});
    };
    const elements = (node: React.ReactNode): Array<React.ReactElement<Record<string, unknown>>> => {
        if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
        return [node as React.ReactElement<Record<string, unknown>>, ...React.Children.toArray(node.props.children).flatMap(elements)];
    };
    const switches = () => elements(draw()).filter(element => element.props.role === 'switch');
    const toggle = (label: string) => {
        const found = switches().find(element => element.props['aria-label'] === label);
        if (!found) throw new Error(`Missing switch: ${label}`);
        return found;
    };
    return {
        loaded: (reply: AnswerSources) => { query = { data: reply, isLoading: false }; },
        html: () => renderToStaticMarkup(draw() as React.ReactElement),
        switches,
        toggle,
        click: (label: string) => {
            const found = toggle(label);
            if (found.props.disabled) throw new Error(`Disabled switch: ${label}`);
            (found.props.onClick as () => void)();
        },
        settle: async () => { await new Promise(resolve => setImmediate(resolve)); },
    };
}

t.test('the Sources rows show the backend reply, not hard-coded defaults', t => {
    const sent: unknown[] = [];
    const f = host(t, {
        getAnswerSources: async () => ({ meetings: true, materials: false }),
        setAnswerSources: async (input: unknown) => { sent.push(input); return { success: true }; },
    });
    f.loaded({ meetings: false, materials: true });
    const switches = f.switches();
    t.equal(switches.length, 2, 'meetings and materials only');
    t.same(switches.map(element => element.props['aria-label']), [
        'Use Past meetings when answering', 'Use Materials (notes and documents) when answering',
    ]);
    t.same(switches.map(element => element.props['aria-checked']), [false, true]);
    const html = f.html();
    for (const words of [
        'Use when answering', 'Past meetings', 'Materials (notes and documents)',
        'Pika may search your recorded meetings when you ask a question.',
        'Pika may search your notes and imported documents when you ask a question. Off until you turn it on.',
    ]) t.match(html, words);
    t.notMatch(html, /interview profile/i);
    t.same(sent, [], 'rendering sends nothing');
    t.end();
});

t.test('no switch reads On before the reply arrives', t => {
    const f = host(t, {
        getAnswerSources: async () => ({ meetings: true, materials: false }),
        setAnswerSources: async () => ({ success: true }),
    });
    const switches = f.switches();
    t.equal(switches.length, 2);
    for (const element of switches) {
        t.equal(element.props['aria-checked'], false);
        t.notMatch(String(element.props.children), /On/);
        t.equal(element.props.disabled, true);
    }
    t.notMatch(f.html(), '● On');
    t.end();
});

t.test('toggling sends exactly the changed key and shows the new state after the reply', async t => {
    const sent: unknown[] = [];
    const f = host(t, {
        getAnswerSources: async () => ({ meetings: true, materials: false }),
        setAnswerSources: async (input: unknown) => { sent.push(input); return { success: true }; },
    });
    f.loaded({ meetings: true, materials: false });
    t.equal(String(f.toggle('Use Materials (notes and documents) when answering').props.children), '○ Off');
    f.click('Use Materials (notes and documents) when answering');
    await f.settle();
    t.same(sent, [{ materials: true }]);
    t.notMatch(f.html(), 'Could not save');
    t.end();
});

t.test('a failed save shows the real error and leaves the switch in its previous state', async t => {
    const f = host(t, {
        getAnswerSources: async () => ({ meetings: true, materials: false }),
        setAnswerSources: async () => ({ success: false, error: 'The settings file is read-only.' }),
    });
    f.loaded({ meetings: true, materials: false });
    f.click('Use Materials (notes and documents) when answering');
    await f.settle();
    t.match(f.html(), 'The settings file is read-only.');
    t.equal(f.toggle('Use Materials (notes and documents) when answering').props['aria-checked'], false);
    t.equal(String(f.toggle('Use Materials (notes and documents) when answering').props.children), '○ Off');
    t.end();
});
