import t from 'tap';
import * as ReactQuery from '@tanstack/react-query';
import { speechHost } from '../helpers/speechSettingsHost';


t.test('Add speech provider starts with Service and changes credential fields, never the transcription service', async t => {
    let selectionWrites = 0;
    const host = speechHost({ setSttProvider: async () => { selectionWrites++; } });
    t.teardown(host.unmount);
    host.click('Add provider');
    let html = host.html();
    t.match(html, '>Add speech provider</h4>');
    t.match(html, /Service<select/);
    t.equal(host.control('select', 'Service').props.value, 'google');
    t.match(html, 'Service account file');
    t.notMatch(html, 'type="password"');
    host.change('select', 'Service', 'deepgram');
    html = host.html();
    t.match(html, /API key<input/);
    t.match(html, '○ No key');
    t.notMatch(html, 'Region<input');
    t.notMatch(html, 'Service account file');
    t.ok(html.indexOf('Service<select') < html.indexOf('API key<input'));
    host.change('select', 'Service', 'azure');
    t.match(host.html(), /Region<input/);
    t.equal(host.control('input', 'Region').props.value, 'eastus');
    host.change('select', 'Service', 'ibmwatson');
    t.notMatch(host.html(), 'Region<input', 'Watson has no existing region-save IPC');
    host.click('Cancel');
    t.notMatch(host.html(), '>Add speech provider</h4>');
    await host.settle();
    t.equal(selectionWrites, 0);
});

t.test('each key service validates before saving its trimmed key through its original IPC, with Azure region separate', async t => {
    const slots = [
        ['soniox', 'Soniox', 'setSonioxApiKey', 'hasSonioxKey'],
        ['deepgram', 'Deepgram', 'setDeepgramApiKey', 'hasDeepgramKey'],
        ['elevenlabs', 'ElevenLabs Scribe', 'setElevenLabsApiKey', 'hasElevenLabsKey'],
        ['openai', 'OpenAI', 'setOpenAiSttApiKey', 'hasSttOpenaiKey'],
        ['groq', 'Groq Whisper', 'setGroqSttApiKey', 'hasSttGroqKey'],
        ['azure', 'Azure Speech', 'setAzureApiKey', 'hasAzureKey'],
        ['ibmwatson', 'IBM Watson', 'setIbmWatsonApiKey', 'hasIbmWatsonKey'],
    ];
    for (const [service, name, setter, flag] of slots) {
        const calls: Array<{ name: string; args: unknown[] }> = [];
        const credentials = { [flag]: false };
        const host = speechHost({
            testSttConnection: async (...args: unknown[]) => { calls.push({ name: 'test', args }); return { success: true }; },
            [setter]: async (...args: unknown[]) => { calls.push({ name: setter, args }); credentials[flag] = true; return { success: true }; },
            setAzureRegion: async (...args: unknown[]) => { calls.push({ name: 'region', args }); return { success: true }; },
        }, credentials);
        t.teardown(host.unmount);
        host.click('Add provider');
        host.change('select', 'Service', service);
        t.equal(host.control('button', 'Save').props.disabled, true, `${service}: empty key cannot save`);
        host.change('input', 'API key', '  invented-key  ');
        t.equal(host.control('input', 'API key').props.value, '  invented-key  ', `${service}: field holds the typed key`);
        t.equal(host.control('button', 'Save').props.disabled, false, `${service}: typed key enables Save`);
        if (service === 'azure') host.change('input', 'Region', ' westeurope ');
        host.click('Save');
        await host.settle();
        // Boolean assertions avoid printing credential values even if this test fails.
        t.ok(calls[0]?.name === 'test' && calls[0].args[0] === service && calls[0].args[1] === 'invented-key' && calls[0].args[2] === (service === 'azure' ? ' westeurope ' : undefined), `${service}: same validation payload`);
        t.ok(calls[1]?.name === setter && calls[1].args.length === 1 && calls[1].args[0] === 'invented-key', `${service}: same key setter and payload`);
        t.equal(calls.length, service === 'azure' ? 3 : 2);
        if (service === 'azure') t.same(calls[2], { name: 'region', args: ['westeurope'] });
        t.notMatch(host.html(), '>Add speech provider</h4>', `${service}: successful Save closes the editor`);
        t.match(host.html(), `Edit ${name}`, `${service}: saved service appears in the list`);
        t.match(host.html(), 'Key saved');
        host.click(`Edit ${name}`);
        t.equal(host.control('input', 'API key').props.value, '', `${service}: reopening never exposes the saved key`);
    }
});

t.test('saved-key Test uses the saved slot and retains the real failed result on its row', async t => {
    let mode = 'failure';
    let calls = 0;
    const host = speechHost({ testSttConnection: async (...args: unknown[]) => {
        calls++;
        t.ok(args[0] === 'soniox' && args[1] === '' && args[2] === undefined, 'blank draft tests the saved speech key');
        if (mode === 'reject') throw new Error('Invented Test rejection');
        return mode === 'ok' ? { success: true } : { success: false, error: 'Invented service refused Test (403)' };
    } }, { hasSonioxKey: true });
    t.teardown(host.unmount);
    host.click('Edit Soniox');
    t.match(host.html(), '● Key saved');
    t.equal(host.control('input', 'API key').props.value, '', 'saved keys remain write-only');
    host.click('Test'); await host.settle();
    t.match(host.html(), '✕ Test failed: Invented service refused Test (403)');
    host.click('Cancel');
    t.match(host.html(), '✕ Test failed: Invented service refused Test (403)', 'last result stays on its row');
    host.click('Edit Soniox');
    mode = 'reject'; host.click('Test'); await host.settle();
    t.match(host.html(), '✕ Test failed: Invented Test rejection');
    mode = 'ok'; host.click('Test'); await host.settle();
    t.match(host.html(), '● The key is accepted');
    t.notMatch(host.html(), 'Test failed:');
    t.equal(calls, 3);
});

t.test('Remove requires a second press, uses each original empty-key setter, and removes only that row', async t => {
    const slots = [
        ['soniox', 'Soniox', 'hasSonioxKey', 'setSonioxApiKey'],
        ['deepgram', 'Deepgram', 'hasDeepgramKey', 'setDeepgramApiKey'],
        ['elevenlabs', 'ElevenLabs Scribe', 'hasElevenLabsKey', 'setElevenLabsApiKey'],
        ['openai', 'OpenAI', 'hasSttOpenaiKey', 'setOpenAiSttApiKey'],
        ['groq', 'Groq Whisper', 'hasSttGroqKey', 'setGroqSttApiKey'],
        ['azure', 'Azure Speech', 'hasAzureKey', 'setAzureApiKey'],
        ['ibmwatson', 'IBM Watson', 'hasIbmWatsonKey', 'setIbmWatsonApiKey'],
    ];
    for (const [, name, flag, setter] of slots) {
        const credentials = { [flag]: true, googleServiceAccountPath: '/synthetic/account.json' };
        let writes = 0;
        const host = speechHost({ [setter]: async (key: string) => {
            t.ok(key === '', `${name}: clears only its credential slot`);
            writes++;
            credentials[flag] = false;
            return { success: true };
        } }, credentials);
        t.teardown(host.unmount);
        host.click(`Remove ${name}`);
        t.equal(writes, 0);
        t.match(host.html(), `Remove ${name}?`);
        host.click('Keep');
        t.equal(writes, 0);
        host.click(`Remove ${name}`);
        host.click('Remove'); await host.settle();
        t.equal(writes, 1);
        t.notMatch(host.html(), `Edit ${name}`);
        t.match(host.html(), 'Edit Google Cloud', 'another configured service stays');
    }
});

t.test('Google chooses and immediately saves the account via the existing no-argument IPC, with honest cancellation and errors', async t => {
    let mode = 'cancel';
    let calls = 0;
    const credentials = { googleServiceAccountPath: null as string | null };
    const host = speechHost({ selectServiceAccount: async (...args: unknown[]) => {
        calls++;
        t.equal(args.length, 0);
        if (mode === 'cancel') return { success: false, cancelled: true };
        if (mode === 'failure') return { success: false, error: 'Invented file selection failure' };
        if (mode === 'reject') throw new Error('Invented file IPC rejection');
        credentials.googleServiceAccountPath = '/synthetic/account.json';
        return { success: true, path: credentials.googleServiceAccountPath };
    } }, credentials);
    t.teardown(host.unmount);
    host.click('Add provider');
    t.match(host.html(), 'Choosing a file saves it immediately.');
    t.notMatch(host.html(), '>Save</button>');
    t.notMatch(host.html(), '>Test</button>');
    host.click('Choose file'); await host.settle();
    t.match(host.html(), 'No file selected');
    t.notMatch(host.html(), 'role="alert"');
    mode = 'failure'; host.click('Choose file'); await host.settle();
    t.match(host.html(), 'Invented file selection failure');
    mode = 'reject'; host.click('Choose file'); await host.settle();
    t.match(host.html(), 'Invented file IPC rejection');
    mode = 'ok'; host.click('Choose file'); await host.settle();
    t.match(host.html(), 'Edit Google Cloud');
    t.match(host.html(), 'File chosen');
    t.notMatch(host.html(), '>Add speech provider</h4>');
    t.equal(calls, 4);
});

t.test('refused and rejected Saves retain the key draft and real message; failed validation never writes', async t => {
    for (const mode of ['validation', 'failure', 'reject']) {
        let writes = 0;
        const message = `Invented ${mode} save error`;
        const host = speechHost({
            testSttConnection: async () => mode === 'validation' ? { success: false, error: message } : { success: true },
            setSonioxApiKey: async () => {
                writes++;
                if (mode === 'reject') throw new Error(message);
                return { success: false, error: message };
            },
        });
        t.teardown(host.unmount);
        host.click('Add provider'); host.change('select', 'Service', 'soniox');
        host.change('input', 'API key', 'invented-key'); host.click('Save'); await host.settle();
        t.match(host.html(), message);
        t.match(host.html(), 'role="alert"');
        t.match(host.html(), '>Add speech provider</h4>');
        t.ok(host.control('input', 'API key').props.value === 'invented-key', 'failed Save retains the draft');
        t.equal(writes, mode === 'validation' ? 0 : 1);
        host.change('select', 'Service', 'deepgram');
        t.equal(host.control('input', 'API key').props.value, '', 'another service never inherits the draft');
        t.notMatch(host.html(), message, 'another service never inherits its save error');
    }
});

t.test('failed and rejected Removes retain the row, editor and confirmation with the real message', async t => {
    for (const rejected of [false, true]) {
        const message = rejected ? 'Invented remove rejection' : 'Invented remove refusal';
        const host = speechHost({ setDeepgramApiKey: async () => {
            if (rejected) throw new Error(message);
            return { success: false, error: message };
        } }, { hasDeepgramKey: true });
        t.teardown(host.unmount);
        host.click('Edit Deepgram'); host.click('Remove Deepgram'); host.click('Remove'); await host.settle();
        t.match(host.html(), message);
        t.match(host.html(), 'role="alert"');
        t.match(host.html(), '>Edit Deepgram</h4>');
        t.match(host.html(), 'Remove Deepgram?');
        t.match(host.html(), 'Key saved');
    }
});

t.test('Azure can save only its nonempty trimmed region without erasing or retesting the saved key', async t => {
    const regions: string[] = [];
    let keyCalls = 0;
    let refused = true;
    const host = speechHost({
        setAzureRegion: async (region: string) => { regions.push(region); return refused ? { success: false, error: 'Invented region refusal' } : { success: true }; },
        setAzureApiKey: async () => { keyCalls++; return { success: true }; },
        testSttConnection: async () => { keyCalls++; return { success: true }; },
    }, { hasAzureKey: true, azureRegion: 'eastus' });
    t.teardown(host.unmount);
    host.click('Edit Azure Speech');
    host.change('input', 'Region', '   ');
    t.equal(host.control('button', 'Save').props.disabled, true);
    host.change('input', 'Region', ' westeurope '); host.click('Save'); await host.settle();
    t.match(host.html(), 'Invented region refusal');
    t.equal(host.control('input', 'Region').props.value, ' westeurope ');
    refused = false; host.click('Save'); await host.settle();
    t.same(regions, ['westeurope', 'westeurope']);
    t.equal(keyCalls, 0);
    t.notMatch(host.html(), '>Edit Azure Speech</h4>');
});
