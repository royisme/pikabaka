import t from 'tap';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { AppState } from '../../electron/main';

t.test('Soniox field, Save enablement and submit share the typed key', t => {
    const source = readFileSync('src/components/SettingsOverlay.tsx', 'utf8');
    const file = ts.createSourceFile('SettingsOverlay.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let lookup: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'sttKey') lookup = node.initializer;
        ts.forEachChild(node, visit);
    };
    visit(file);
    if (!lookup) throw new Error('The shared speech key lookup is missing');
    const key = runInNewContext(`(${lookup.getText(file)})`, {
        sttProvider: 'soniox', sttSonioxKey: 'invented-soniox-key',
        sttGroqKey: '', sttOpenaiKey: '', sttDeepgramKey: '',
        sttElevenLabsKey: '', sttAzureKey: '', sttIbmKey: '',
    });
    t.equal(key, 'invented-soniox-key');
    t.match(source, /value=\{sttKey\}/, 'the field displays the shared key');
    t.match(source, /disabled=\{sttSaving \|\| !sttKey\.trim\(\)\}/, 'Save checks the shared key');
    t.match(source, /handleSttKeySubmit\(sttProvider, sttKey\)/, 'Save submits the same key');
    t.end();
});

t.test('ElevenLabs key test requires a successful response and returns real failures', async t => {
    type Result = { success: boolean; error?: string };
    let testKey: ((_event: unknown, provider: string, apiKey: string) => Promise<Result>) | undefined;
    let failure: unknown;
    let requests = 0;
    const { registerSttHandlers } = mockRequire(path.resolve('electron/ipc/stt.ts'), {
        [path.resolve('electron/ipc/safeHandle.ts')]: { safeHandle: (channel: string, listener: typeof testKey) => {
            if (channel === 'test-stt-connection') testKey = listener;
        } },
        [path.resolve('electron/audio/AudioDevices.ts')]: { AudioDevices: {} },
        [path.resolve('electron/lib/transcript-assembler.ts')]: {},
        [path.resolve('electron/services/SettingsManager.ts')]: {},
        axios: { get: async (url: string) => {
            requests++;
            t.equal(url, 'https://api.elevenlabs.io/v1/voices');
            if (failure) throw failure;
            return { status: 200, data: { voices: [] } };
        } },
    }) as typeof import('../../electron/ipc/stt');
    registerSttHandlers({} as AppState);
    if (!testKey) throw new Error('Speech key test handler was not registered');
    t.same(await testKey(undefined, 'elevenlabs', 'invented-test-key'), { success: true });
    const failures = [
        { message: 'Network unavailable' },
        { message: 'Request timed out' },
        { message: 'Request failed', response: { data: { detail: { status: 'invalid_api_key', message: 'Key refused' } } } },
        { message: 'Request failed', response: { data: { detail: { status: 'missing_permissions', message: 'Voices permission required' } } } },
        { message: 'Request failed', response: { data: { message: 'Service unavailable' } } },
    ];
    const messages = ['Network unavailable', 'Request timed out', 'Key refused', 'Voices permission required', 'Service unavailable'];
    for (const [index, error] of failures.entries()) {
        failure = error;
        t.same(await testKey(undefined, 'elevenlabs', 'invented-test-key'), { success: false, error: messages[index] });
    }
    t.equal(requests, 6, 'every result comes from the mocked service request');
});
