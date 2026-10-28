import t from 'tap';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { speechHost } from '../helpers/speechSettingsHost';

const invented = {
    openaiApiKey: 'sec1-invented-language-secret', deepgramApiKey: 'sec1-invented-speech-secret',
    agentGateApiKey: 'sec1-invented-decision-secret', tavilyApiKey: 'tvly-sec1-invented-search-secret',
    openaiCompatibleProviders: [{ id: 'gateway', name: 'Invented gateway', type: 'openai', baseUrl: 'http://localhost:1234', apiKey: 'sec1-invented-custom-secret', headers: { 'X-Gateway': 'sec1-invented-header-secret' } }],
    sttModels: { deepgram: 'invented-model' }, connectionBaseUrls: { openai: 'http://localhost:4321' },
    chatConnectionId: 'gateway', chatModel: 'invented-chat', transcriptTranslationEnabled: true, agentGateMode: 'on',
};
const secrets = [invented.openaiApiKey, invented.deepgramApiKey, invented.agentGateApiKey, invented.tavilyApiKey, invented.openaiCompatibleProviders[0].apiKey, invented.openaiCompatibleProviders[0].headers['X-Gateway']];
const containsSecret = (text: string) => secrets.some(secret => text.includes(secret));
const encode = (text: string) => Buffer.from([...Buffer.from(text)].map(byte => byte ^ 0xa5));

function fixture(test: typeof t, plaintext: unknown = invented) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pika-sec1-'));
    const json = path.join(directory, 'credentials.json');
    const enc = path.join(directory, 'credentials.enc');
    if (plaintext !== undefined) fs.writeFileSync(json, JSON.stringify(plaintext));
    const faults = { available: true, availabilityError: false, write: false, rename: false, read: false, mismatch: false, decrypt: false, encrypt: false, remove: false };
    const events: string[] = [];
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
        const original = console[level];
        console[level] = (...args: unknown[]) => logs.push(args.map(arg => arg instanceof Error ? arg.message : String(arg)).join(' '));
        test.teardown(() => { console[level] = original; });
    }
    test.teardown(() => {
        if (logs.some(containsSecret)) throw new Error('A credential appeared in a log');
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const safeStorage = {
        isEncryptionAvailable: () => { if (faults.availabilityError) throw new Error('Invented availability refusal'); return faults.available; },
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (text: string) => { if (faults.encrypt) throw new Error('Invented encryption refusal'); return encode(text); },
        decryptString: (bytes: Buffer) => {
            if (faults.decrypt) throw new Error('Invented keychain refusal');
            events.push('decrypt');
            return faults.mismatch ? '{}' : Buffer.from([...bytes].map(byte => byte ^ 0xa5)).toString();
        },
    };
    const fakeFs = { ...fs,
        writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => { if (faults.write) throw new Error('ENOSPC: invented disk full'); events.push('write'); return fs.writeFileSync(...args); },
        renameSync: (...args: Parameters<typeof fs.renameSync>) => { if (faults.rename) throw new Error('EACCES: invented rename denied'); events.push('rename'); return fs.renameSync(...args); },
        readFileSync: (...args: Parameters<typeof fs.readFileSync>) => { if (String(args[0]) !== json && faults.read) throw new Error('EIO: invented read failure'); events.push(String(args[0]) === json ? 'read-json' : 'read-encrypted'); return fs.readFileSync(...args); },
        unlinkSync: (file: fs.PathLike) => { if (String(file) === json) { events.push('delete-json'); if (faults.remove) throw new Error('EACCES: invented delete denied'); } return fs.unlinkSync(file); },
    };
    const module = mockRequire(path.resolve('electron/services/CredentialsManager.ts'), {
        electron: { safeStorage }, fs: fakeFs,
        [path.resolve('electron/services/configPaths.ts')]: { getCredentialsJsonPath: () => json },
    }) as typeof import('../../electron/services/CredentialsManager');
    const start = () => {
        Reflect.set(module.CredentialsManager, 'instance', undefined);
        const manager = module.CredentialsManager.getInstance();
        manager.init();
        return manager;
    };
    return { json, enc, faults, events, logs, start, module, safeStorage };
}

t.test('first start verifies the complete object before deleting plaintext; encrypted saves survive restart', t => {
    const f = fixture(t);
    const manager = f.start();
    t.ok(isDeepStrictEqual(manager.getAllCredentials(), invented), 'every credential, connection, header and setting survives');
    t.notOk(fs.existsSync(f.json), 'verified migration deletes plaintext');
    t.ok(fs.existsSync(f.enc), 'encrypted file exists');
    t.ok(fs.readFileSync(f.enc).equals(encode(JSON.stringify(invented))), 'file contains exactly the encryptString bytes');
    t.ok(f.events.indexOf('delete-json') > f.events.indexOf('decrypt'), 'deletion follows the round trip');
    t.notOk(containsSecret(fs.readFileSync(f.enc).toString()), 'disk bytes do not contain credentials');
    manager.setSttModel('deepgram', 'invented-replacement');
    t.notOk(fs.existsSync(f.json), 'a later save never recreates plaintext');
    const expected = { ...invented, sttModels: { deepgram: 'invented-replacement' } };
    t.ok(isDeepStrictEqual(f.start().getAllCredentials(), expected), 'restart reads encrypted values unchanged');
    t.end();
});

for (const fault of ['write', 'rename', 'read', 'mismatch', 'encrypt', 'remove'] as const) {
    t.test(`migration ${fault} failure keeps plaintext and retries on next start`, t => {
        const f = fixture(t);
        const original = fs.readFileSync(f.json);
        f.faults[fault] = true;
        const manager = f.start();
        t.ok(fs.readFileSync(f.json).equals(original), 'plaintext remains intact');
        t.ok(isDeepStrictEqual(manager.getAllCredentials(), invented), 'loaded credentials remain usable');
        t.match(manager.getStorageStatus(), { mode: 'plaintext', reason: /.+/ });
        if (fault !== 'remove') t.notOk(fs.existsSync(f.enc), 'failed verification never publishes an encrypted file');
        f.faults[fault] = false;
        const restarted = f.start();
        t.ok(isDeepStrictEqual(restarted.getAllCredentials(), invented), 'retry retains every value');
        t.same(restarted.getStorageStatus(), { mode: 'encrypted' });
        t.notOk(fs.existsSync(f.json), 'retry finishes cleanup');
        t.end();
    });
}

t.test('unavailable encryption keeps plaintext with a reason and saves atomically in the old format', t => {
    const f = fixture(t);
    f.faults.available = false;
    const manager = f.start();
    t.match(manager.getStorageStatus(), { mode: 'plaintext', reason: /secure storage.*available/i });
    t.ok(isDeepStrictEqual(manager.getAllCredentials(), invented), 'plaintext object is unchanged');
    manager.setSttModel('deepgram', 'invented-plain-model');
    t.equal(f.start().getSttModel('deepgram'), 'invented-plain-model');
    t.notOk(fs.existsSync(f.enc));
    t.notOk(fs.existsSync(f.json + '.tmp'));
    t.end();
});

t.test('unreadable encrypted credentials lock an empty store, never fall back or overwrite either file', t => {
    const f = fixture(t);
    fs.writeFileSync(f.enc, encode(JSON.stringify(invented)));
    const original = fs.readFileSync(f.enc);
    const plain = fs.readFileSync(f.json);
    f.faults.decrypt = true;
    const manager = f.start();
    t.ok(isDeepStrictEqual(manager.getAllCredentials(), {}), 'credentials start empty');
    t.match(manager.getStorageStatus(), { mode: 'locked', reason: /cannot be decrypted/i });
    t.throws(() => manager.setDeepgramApiKey(invented.deepgramApiKey), /cannot be decrypted/);
    t.ok(isDeepStrictEqual(manager.getAllCredentials(), {}), 'a refused setter does not advertise an unsaved key');
    t.ok(fs.readFileSync(f.enc).equals(original));
    t.ok(fs.readFileSync(f.json).equals(plain));
    f.faults.decrypt = false;
    t.ok(isDeepStrictEqual(f.start().getAllCredentials(), invented), 'unlock and restart restore access');
    t.end();
});

for (const failure of ['availabilityError', 'corrupt'] as const) {
    t.test(`${failure} locks encrypted saves even without a plaintext fallback`, t => {
        const f = fixture(t);
        const manager = f.start();
        if (failure === 'corrupt') fs.writeFileSync(f.enc, encode('not-json'));
        else f.faults.availabilityError = true;
        const original = fs.readFileSync(f.enc);
        manager.init();
        t.match(manager.getStorageStatus(), { mode: 'locked', reason: /cannot be decrypted/i });
        t.ok(isDeepStrictEqual(manager.getAllCredentials(), {}), 'no credentials are loaded');
        t.throws(() => manager.setDeepgramApiKey(invented.deepgramApiKey), /cannot be decrypted/);
        t.ok(isDeepStrictEqual(manager.getAllCredentials(), {}), 'refused save stays empty');
        t.ok(fs.readFileSync(f.enc).equals(original));
        t.notOk(fs.existsSync(f.json));
        t.end();
    });
}

t.test('Linux basic_text is treated as unavailable, not advertised as OS encryption', t => {
    const f = fixture(t);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    t.teardown(() => Object.defineProperty(process, 'platform', platform));
    f.safeStorage.getSelectedStorageBackend = () => 'basic_text';
    const manager = f.start();
    t.match(manager.getStorageStatus(), { mode: 'plaintext', reason: /secure storage.*available/i });
    t.ok(fs.existsSync(f.json));
    t.notOk(fs.existsSync(f.enc));
    t.end();
});

t.test('write and encryption errors reach setters with no secrets; empty-store and quit guards throw', t => {
    const f = fixture(t);
    const manager = f.start();
    const original = fs.readFileSync(f.enc);
    f.faults.write = true;
    t.throws(() => manager.setDeepgramApiKey(invented.openaiApiKey), /ENOSPC: invented disk full/);
    t.ok(isDeepStrictEqual(manager.getAllCredentials(), invented), 'failed writes restore the saved in-memory state');
    t.ok(fs.readFileSync(f.enc).equals(original));
    f.faults.write = false;
    f.safeStorage.encryptString = () => { throw new Error(`Invented encryption failure ${invented.openaiApiKey} ${invented.openaiCompatibleProviders[0].headers['X-Gateway']}`); };
    let message = '';
    try { manager.setDeepgramApiKey(invented.deepgramApiKey); } catch (error) { message = (error as Error).message; }
    t.match(message, /Invented encryption failure/);
    t.notOk(containsSecret(message), 'error redacts keys and header values');
    Reflect.set(manager, 'credentials', {});
    t.throws(() => manager.setTavilyApiKey(''), /Refusing to overwrite/);
    manager.scrubMemory();
    t.throws(() => manager.setDeepgramApiKey(invented.deepgramApiKey), /scrubbed/);
    t.ok(isDeepStrictEqual(manager.getAllCredentials(), {}), 'a failed quit-time save cannot restore scrubbed credentials');
    t.ok(fs.readFileSync(f.enc).equals(original));
    t.end();
});

t.test('clearAll removes both formats, including locked files', t => {
    const f = fixture(t);
    fs.writeFileSync(f.enc, 'invented-corrupted-ciphertext');
    f.faults.decrypt = true;
    const manager = f.start();
    manager.clearAll();
    t.notOk(fs.existsSync(f.json));
    t.notOk(fs.existsSync(f.enc));
    t.ok(isDeepStrictEqual(manager.getAllCredentials(), {}), 'credentials are cleared');
    t.end();
});

function ipc(f: ReturnType<typeof fixture>, manager: ReturnType<ReturnType<typeof fixture>['start']>, file: string, register: string) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const loaded = mockRequire(path.resolve(`electron/ipc/${file}.ts`), {
        electron: { safeStorage: f.safeStorage, app: {}, BrowserWindow: { getAllWindows: () => [] }, ipcMain: {
            removeHandler: () => {}, handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
        } },
        [path.resolve('electron/services/CredentialsManager.ts')]: { CredentialsManager: { getInstance: () => manager } },
        [path.resolve('electron/main.ts')]: {},
        [path.resolve('electron/lib/auto-updater.ts')]: {},
        [path.resolve('electron/services/SettingsManager.ts')]: {},
        [path.resolve('electron/db/DatabaseManager.ts')]: {},
        [path.resolve('electron/ipc/rag.ts')]: {},
        [path.resolve('electron/audio/AudioDevices.ts')]: {},
        [path.resolve('electron/lib/transcript-assembler.ts')]: {},
    }) as Record<string, (state: unknown) => void>;
    loaded[register]({ reconfigureSttProvider: async () => {} });
    return (name: string, ...args: unknown[]) => handlers.get(name)!(null, ...args);
}

t.test('real IPC handlers return disk errors for speech, provider, Tavily and translation saves', async t => {
    const f = fixture(t);
    const manager = f.start();
    const stt = ipc(f, manager, 'stt', 'registerSttHandlers');
    const connections = ipc(f, manager, 'connections', 'registerConnectionHandlers');
    const knowledge = ipc(f, manager, 'knowledge', 'registerKnowledgeHandlers');
    const translation = ipc(f, manager, 'translation', 'registerTranslationHandlers');
    f.faults.write = true;
    for (const call of [
        () => stt('set-deepgram-api-key', invented.deepgramApiKey),
        () => stt('set-stt-model', 'deepgram', 'invented-model'),
        () => connections('ai-connection-save', { id: 'openai', apiKey: invented.openaiApiKey }),
        () => connections('chat-model-set', { connectionId: 'openai', model: 'invented-model' }),
        () => knowledge('set-tavily-api-key', invented.tavilyApiKey),
        () => translation('set-transcript-translation-settings', { enabled: true }),
    ]) {
        const result = await call();
        t.ok(isDeepStrictEqual(result, { success: false, error: 'ENOSPC: invented disk full' }), 'IPC returns the real disk error');
        t.notOk(containsSecret(JSON.stringify(result)), 'IPC does not expose credentials');
    }
});

t.test('a speech Save reports a real setter/IPC disk failure in the renderer, never Saved', async t => {
    const f = fixture(t);
    const manager = f.start();
    const invoke = ipc(f, manager, 'stt', 'registerSttHandlers');
    f.faults.write = true;
    const host = speechHost({
        testSttConnection: async () => ({ success: true }),
        setDeepgramApiKey: (key: string) => invoke('set-deepgram-api-key', key),
    });
    t.teardown(host.unmount);
    host.click('Add provider');
    host.change('select', 'Service', 'deepgram');
    host.change('input', 'API key', invented.deepgramApiKey);
    host.click('Save');
    await host.settle();
    const html = host.html();
    t.ok(html.includes('role="alert"') && html.includes('ENOSPC: invented disk full'), 'renderer shows the actual disk error');
    t.notOk(html.includes('Key saved') || html.includes('Saved'), 'renderer reports no save success');
    t.ok(host.control('input', 'API key').props.value === invented.deepgramApiKey, 'failed Save retains the editable draft');
});

t.test('fresh stores save encrypted; unrelated IPC errors keep rejecting', async t => {
    const f = fixture(t);
    fs.unlinkSync(f.json);
    const manager = f.start();
    manager.setDeepgramApiKey(invented.deepgramApiKey);
    t.ok(f.start().getDeepgramApiKey() === invented.deepgramApiKey, 'first key survives encrypted restart');
    t.notOk(fs.existsSync(f.json));
    const handlers = new Map<string, () => Promise<unknown>>();
    const { safeHandle } = mockRequire(path.resolve('electron/ipc/safeHandle.ts'), {
        electron: { ipcMain: { removeHandler: () => {}, handle: (name: string, handler: () => Promise<unknown>) => handlers.set(name, handler) } },
    }) as typeof import('../../electron/ipc/safeHandle');
    safeHandle('invented-unrelated', () => { throw new Error('Invented unrelated failure'); });
    await t.rejects(handlers.get('invented-unrelated')!(), /Invented unrelated failure/);
});

t.test('existing credentials status reply exposes storage state without credential values', async t => {
    const f = fixture(t);
    let manager = f.start();
    let invoke = ipc(f, manager, 'core', 'registerCoreHandlers');
    t.match(await invoke('get-stored-credentials'), { storage: { mode: 'encrypted' }, hasDeepgramKey: true });
    fs.writeFileSync(f.json, JSON.stringify(invented));
    fs.unlinkSync(f.enc);
    f.faults.available = false;
    manager = f.start();
    invoke = ipc(f, manager, 'core', 'registerCoreHandlers');
    t.match(await invoke('get-stored-credentials'), { storage: { mode: 'plaintext', reason: /.+/ } });
    fs.writeFileSync(f.enc, 'invented-corrupted-ciphertext');
    manager = f.start();
    invoke = ipc(f, manager, 'core', 'registerCoreHandlers');
    const result = await invoke('get-stored-credentials');
    t.match(result, { storage: { mode: 'locked', reason: /cannot be decrypted/i }, hasDeepgramKey: false });
    t.notOk(containsSecret(JSON.stringify(result)));
});

t.test('Linux with a real secret-store backend counts as encrypted storage', t => {
    const f = fixture(t);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    t.teardown(() => Object.defineProperty(process, 'platform', platform));
    const manager = f.start();
    t.same(manager.getStorageStatus(), { mode: 'encrypted' });
    t.ok(fs.existsSync(f.enc));
    t.notOk(fs.existsSync(f.json));
    t.end();
});

for (const content of [[], null, 'text', 5]) {
    t.test(`a credential file that holds ${JSON.stringify(content)} instead of an object is reported and left untouched`, t => {
        const f = fixture(t, content);
        const manager = f.start();
        t.same(manager.getStorageStatus(), { mode: 'plaintext', reason: 'The credential file must contain an object.' });
        t.equal(fs.readFileSync(f.json, 'utf8'), JSON.stringify(content), 'the file is not rewritten or deleted');
        t.notOk(fs.existsSync(f.enc));
        t.same(manager.getAllCredentials(), {});
        t.end();
    });
}

t.test('a stored file whose values are all empty does not block saving an empty store', t => {
    const f = fixture(t, { openaiApiKey: '' });
    const manager = f.start();
    t.ok(fs.existsSync(f.enc), 'the empty-valued file was migrated');
    Reflect.set(manager, 'credentials', {});
    t.doesNotThrow(() => (Reflect.get(manager, 'saveCredentials') as () => void).call(manager));
    t.end();
});
