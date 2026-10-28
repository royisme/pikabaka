import t from 'tap';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { CredentialsManager } from '../../electron/services/CredentialsManager';

const set = (name: string, value: string) => ({ op: 'set' as const, name, value });
const draft = { name: 'Invented gateway', type: 'openai' as const, baseUrl: 'http://127.0.0.1:1234', apiKey: 'fake-key' };

function store(test: typeof t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pika-header-test-'));
    test.teardown(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'credentials.json');
    const { CredentialsManager: Manager } = mockRequire(path.resolve('electron/services/CredentialsManager.ts'), {
        electron: { safeStorage: { isEncryptionAvailable: () => false } },
        [path.resolve('electron/services/configPaths.ts')]: { getCredentialsJsonPath: () => file },
    }) as typeof import('../../electron/services/CredentialsManager');
    const manager = Object.create(Manager.prototype) as CredentialsManager;
    Reflect.set(manager, 'credentials', {});
    return { manager, file, restart: () => { const next = Object.create(Manager.prototype) as CredentialsManager; next.init(); return next; } };
}

t.test('header edits survive unrelated saves and restart; views are write-only; built-ins get none', t => {
    const { manager, file, restart } = store(t);
    const saved = manager.saveConnection({ ...draft, headerEdits: [set('X-Gateway', 'fake-header-secret')] });
    if ('error' in saved) throw new Error(saved.error);
    const { id } = saved;
    t.same(manager.resolveConnection(id)?.headers, { 'X-Gateway': 'fake-header-secret' }, 'resolved main-process connection owns the value');
    t.same(manager.listConnections().find(c => c.id === id)?.headers, [{ name: 'X-Gateway', set: true }]);
    t.notMatch(JSON.stringify(manager.listConnections()), /fake-header-secret|fake-key/);
    manager.saveConnection({ ...draft, id, name: 'Renamed gateway', apiKey: undefined });
    t.same(restart().resolveConnection(id)?.headers, { 'X-Gateway': 'fake-header-secret' }, 'omitted edits survive disk read/write');
    t.equal(JSON.parse(fs.readFileSync(file, 'utf8')).openaiCompatibleProviders[0].name, 'Renamed gateway');
    manager.saveConnection({ ...draft, id, headerEdits: [{ op: 'keep', name: 'x-gateway' }, set('X-Other', 'fake-other-secret')] });
    t.same(manager.resolveConnection(id)?.headers, { 'X-Gateway': 'fake-header-secret', 'X-Other': 'fake-other-secret' });
    manager.saveConnection({ ...draft, id, headerEdits: [set('x-gateway', '  ')] });
    t.same(manager.resolveConnection(id)?.headers, { 'X-Gateway': 'fake-header-secret', 'X-Other': 'fake-other-secret' }, 'blank never erases');
    manager.saveConnection({ ...draft, id, headerEdits: [set('x-gateway', 'fake-replacement'), { op: 'remove', name: 'X-OTHER' }] });
    t.same(manager.resolveConnection(id)?.headers, { 'x-gateway': 'fake-replacement' }, 'set replaces case-insensitively, remove is explicit');
    manager.saveConnection({ ...draft, id, headerEdits: [{ op: 'remove', name: 'x-gateway' }] });
    t.equal(restart().resolveConnection(id)?.headers, undefined, 'last removal persists');
    t.match(manager.saveConnection({ id: 'openai', headerEdits: [set('X-Gateway', 'fake-header-secret')] }), { error: /built-in/i });
    for (const builtin of ['openai', 'groq', 'gemini', 'claude']) t.equal(manager.resolveConnection(builtin)?.headers, undefined);
    t.end();
});

t.test('corrupt credential JSON cannot leak a header secret in a parse-error log', t => {
    const { manager, file } = store(t);
    fs.writeFileSync(file, 'fake-header-secret');
    const original = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => errors.push(args.map(value => value instanceof Error ? value.message : value));
    try { manager.init(); } finally { console.error = original; }
    t.equal(errors.length, 1);
    t.notMatch(JSON.stringify(errors), /fake-header-secret/);
    t.same(manager.getAllCredentials(), {});
    t.end();
});

t.test('invalid headers are rejected atomically without including values in the error', t => {
    const { manager } = store(t);
    const saved = manager.saveConnection(draft);
    if ('error' in saved) throw new Error(saved.error);
    const attempts = [
        { edits: [set('Bad Name', 'fake-secret')], name: 'Bad Name' },
        ...['\r', '\n', '\t', '\0', '\x7f', '\u0085'].map(control => ({ edits: [set('X-Bad', `fake-secret${control}`)], name: 'X-Bad' })),
        { edits: [set('X-Duplicate', 'fake-secret'), set('x-duplicate', 'fake-secret')], name: 'x-duplicate' },
        ...['Host', 'Content-Length', 'Transfer-Encoding', 'Connection', 'Authorization', 'x-api-key', 'X-Goog-Api-Key', 'Content-Type', 'Accept', 'anthropic-version', 'anthropic-beta', 'OpenAI-Organization', 'OpenAI-Project', 'User-Agent', 'X-Stainless-Retry-Count'].map(name => ({ edits: [set(name, 'fake-secret')], name })),
        { edits: [set('X-Large', 'fake-secret'.repeat(1000))], name: 'X-Large' },
        { edits: Array.from({ length: 33 }, (_, i) => set(`X-Count-${i}`, 'fake-secret')), name: 'X-Count-32' },
    ];
    for (const { edits, name } of attempts) {
        const before = structuredClone(manager.getAllCredentials());
        const result = manager.saveConnection({ ...draft, id: saved.id, headerEdits: edits });
        t.ok('error' in result, `rejects ${JSON.stringify(name)}`);
        if ('error' in result) {
            t.ok(result.error.includes(name), 'error names the header');
            t.notMatch(result.error, /fake-secret/);
        }
        t.same(manager.getAllCredentials(), before, 'rejection changes nothing');
    }
    for (const headerEdits of [null, {}, [null], [{ op: 'unknown', name: 'X-Bad' }], [{ op: 'set', name: 'X-Bad', value: 1 }]]) {
        t.ok('error' in manager.saveConnection({ ...draft, id: saved.id, headerEdits } as never), 'malformed IPC edits rejected');
    }
    Reflect.set(manager, 'credentials', { openaiCompatibleProviders: [{ ...draft, id: 'invalid-on-disk', headers: { 'Bad Name': 'fake-secret' } }] });
    t.equal(manager.resolveConnection('invalid-on-disk'), undefined, 'invalid stored headers fail closed');
    t.end();
});
