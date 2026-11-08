import t from 'tap';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoiceCloner, type CloneDeps } from '../../electron/interpreting/voiceClone';
import { VoiceProviderError, type VoiceProvider } from '../../electron/interpreting/voiceProviders';
import type { AudioMessage } from '../../electron/interpreting/InterpretingSession';
import type { InterpretingSettings } from '../../electron/services/interpretingSettings';
import VoiceCloneDialog, { CONSENT_TEXT, ReviewActions } from '../../src/components/settings/VoiceCloneDialog';
import { inputDeviceId, isVirtualInput, preferredInputName } from '../../src/lib/micRecorder';

// A fake provider and an in-memory settings object: no real service, no real key, no audio.
function setup(opts: { deleteStatus?: number; verify?: boolean; saved?: InterpretingSettings['voices'] } = {}) {
    const state: InterpretingSettings = { enabled: true, provider: 'fishaudio', voices: opts.saved ?? {}, outputLabel: 'BlackHole 2ch' };
    const calls: string[] = [];
    const provider: VoiceProvider = {
        async synthesize(text, voiceId) { calls.push(`speak:${voiceId}`); return new Uint8Array([1]); },
        async cloneVoice(sample) { calls.push(`clone:${sample.length}`); return { voiceId: 'v-new', needsVerification: !!opts.verify }; },
        async deleteVoice(voiceId) {
            calls.push(`delete:${voiceId}`);
            if (opts.deleteStatus) throw new VoiceProviderError('Fish Audio is unavailable right now.', opts.deleteStatus);
        },
    };
    const deps: CloneDeps = {
        settings: () => state,
        apiKey: () => 'test-key',
        provider: () => provider,
        saveVoices: (voices) => { state.voices = voices; },
        targetLanguage: () => 'english',
        log: (line) => calls.push(`log:${line}`),
    };
    return { cloner: new VoiceCloner(deps), state, calls };
}
const SAMPLE = new Uint8Array(100);
const SAVED = { fishaudio: { voiceId: 'v-old', cloned: true, consentAt: '2026-11-08T00:00:00.000Z' } };

t.test('delete keeps the record on a 500 and shows the error', async (t) => {
    const { cloner, state } = setup({ deleteStatus: 500, saved: SAVED });
    await t.rejects(cloner.delete('fishaudio'), { message: 'Fish Audio is unavailable right now.' });
    t.same(state.voices, SAVED);
});

t.test('delete clears the record on a 404', async (t) => {
    const { cloner, state, calls } = setup({ deleteStatus: 404, saved: SAVED });
    await cloner.delete('fishaudio');
    t.same(state.voices, {});
    t.ok(calls.includes('delete:v-old'));
});

t.test('delete without a cloned voice is refused and a pasted id is never deleted', async (t) => {
    const { cloner, calls } = setup({ saved: { fishaudio: { voiceId: 'pasted', cloned: false } } });
    await t.rejects(cloner.delete('fishaudio'), { message: 'There is no cloned voice.' });
    t.notOk(calls.some((c) => c.startsWith('delete:')));
});

t.test('discard deletes the fresh clone and the saved record is untouched', async (t) => {
    const { cloner, state, calls } = setup({ saved: { fishaudio: { voiceId: 'pasted', cloned: false } } });
    t.same(await cloner.clone('fishaudio', SAMPLE), { voiceId: 'v-new', needsVerification: false });
    await cloner.delete('fishaudio');
    t.ok(calls.includes('delete:v-new'));
    t.same(state.voices, { fishaudio: { voiceId: 'pasted', cloned: false } });
});

t.test('a failed discard keeps the pending clone so Retry deletes the same voice', async (t) => {
    const { cloner, calls } = setup({ deleteStatus: 500 });
    await cloner.clone('elevenlabs', SAMPLE);
    await t.rejects(cloner.delete('elevenlabs'));
    await t.rejects(cloner.delete('elevenlabs'));
    t.equal(calls.filter((c) => c === 'delete:v-new').length, 2);
});

t.test('preview speaks the fresh clone to the caller on the default speakers', async (t) => {
    const { cloner, calls } = setup();
    await cloner.clone('fishaudio', SAMPLE);
    const sent: AudioMessage[] = [];
    await cloner.preview('fishaudio', (m) => sent.push(m));
    t.equal(sent.length, 1);
    t.equal(sent[0].sink, 'default');
    t.ok(calls.includes('speak:v-new'));
});

t.test('clone checks its input and logs neither the sample nor the voice id', async (t) => {
    const { cloner, calls } = setup({ verify: true });
    await t.rejects(cloner.clone('nope', SAMPLE), /Unknown voice service/);
    await t.rejects(cloner.clone('fishaudio', 'text'), /voice sample/);
    await t.rejects(cloner.clone('fishaudio', new Uint8Array(10)), /voice sample/);
    t.same(await cloner.clone('elevenlabs', SAMPLE), { voiceId: '', needsVerification: true });
    t.notOk(calls.filter((c) => c.startsWith('log:')).some((c) => c.includes('v-new')));
});

t.test('consent gates Start and the dialog shows the provider', async (t) => {
    const html = renderToStaticMarkup(React.createElement(VoiceCloneDialog, { provider: 'fishaudio', providerName: 'Fish Audio', outputLabel: 'BlackHole 2ch', onKeep: () => undefined, onClose: () => undefined }));
    t.match(html, CONSENT_TEXT);
    t.match(html, /<button[^>]*disabled=""[^>]*>Start recording<\/button>/);
    t.match(html, /sent once to Fish Audio/);
});

t.test('the virtual device is refused as input', async (t) => {
    t.ok(isVirtualInput('BlackHole 2ch', 'BlackHole 2ch'));
    t.ok(isVirtualInput('CABLE Output (VB-Audio Virtual Cable)', ''));
    t.notOk(isVirtualInput('Studio Microphone', 'BlackHole 2ch'));
    t.equal(preferredInputName([{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }], 'b'), 'Second');
    t.equal(preferredInputName([{ id: 'a', name: 'First' }], 'gone'), 'First');
    t.equal(preferredInputName([], null), null);
    t.same(inputDeviceId([{ deviceId: 'x1', label: 'Studio Microphone' }], 'studio microphone'), { ok: true, deviceId: 'x1' });
    t.equal(inputDeviceId([{ deviceId: 'x1', label: 'Other' }], 'Studio Microphone').ok, false);
});

t.test('a voice that needs verification is never handed back or saved, and Discard deletes it', async (t) => {
    const { cloner, calls } = setup({ verify: true });
    t.same(await cloner.clone('elevenlabs', SAMPLE), { voiceId: '', needsVerification: true });
    await cloner.delete('elevenlabs');
    t.ok(calls.some((c) => c.startsWith('delete')));
    t.notOk(calls.some((c) => c.startsWith('save')));
});

t.test('review offers Keep only for a usable voice; a voice to verify offers Discard only', async (t) => {
    const render = (needsVerification: boolean) => renderToStaticMarkup(React.createElement(ReviewActions, { needsVerification, busy: false, retry: false, onListen: () => undefined, onDiscard: () => undefined, onKeep: () => undefined }));
    const usable = render(false);
    t.match(usable, />Keep</);
    t.match(usable, />Listen</);
    const verify = render(true);
    t.match(verify, />Discard</);
    t.notMatch(verify, />Keep</);
    t.notMatch(verify, />Listen</);
});
