import t from 'tap';
import { InterpretingSession, type AudioMessage, type SessionDeps } from '../../electron/interpreting/InterpretingSession';
import { GRACE_MS } from '../../electron/interpreting/talkWindow';
import type { InterpretingSettings } from '../../electron/services/interpretingSettings';
import { CredentialsManager } from '../../electron/services/CredentialsManager';
import { translateForInterpreting } from '../../electron/lib/transcript-translation';

const SENTENCE = 'Please move the invented review to Thursday afternoon.';
const TRANSLATED = 'Veuillez deplacer la revue inventee a jeudi apres-midi.';

const ready: InterpretingSettings = {
    enabled: true, provider: 'fishaudio', outputLabel: 'Invented Cable',
    voices: { fishaudio: { voiceId: 'voice-1', cloned: false } },
};

function setup(over: Partial<SessionDeps> = {}, settings: InterpretingSettings = ready) {
    let clock = 1000;
    const log: string[] = [];
    const sleeps: number[] = [];
    const calls = { translate: [] as string[], synth: [] as Array<[string, string, string]>, audio: [] as AudioMessage[], spoken: [] as string[], shown: [] as Array<[number, string, string]>, finalize: 0, flush: 0, seal: 0, stop: 0 };
    const states: string[] = [];
    let session!: InterpretingSession;
    const deps: SessionDeps = {
        now: () => clock,
        sleep: (ms) => { sleeps.push(ms); clock += ms; return ms === GRACE_MS ? Promise.resolve() : new Promise<void>(() => {}); },
        settings: () => settings,
        apiKey: () => 'invented-key',
        isMeetingActive: () => true,
        isMuted: () => false,
        micDeviceName: () => 'Invented Microphone',
        targetLanguage: () => 'fr',
        translationReady: () => true,
        flushOwn: async () => { calls.flush++; },
        sealOwn: () => { calls.seal++; },
        finalizeMic: () => { calls.finalize++; },
        translate: async (text) => { calls.translate.push(text); return TRANSLATED; },
        provider: () => ({
            synthesize: async (text, voice, lang) => { calls.synth.push([text, voice, lang]); return new Uint8Array([0x49, 0x44, 0x33]); },
            cloneVoice: async () => { throw new Error('not used'); },
            deleteVoice: async () => { throw new Error('not used'); },
        }),
        noteSpoken: (text) => { calls.spoken.push(text); },
        sendAudio: (m) => { calls.audio.push(m); session.played({ id: m.id, ok: true }); return true; },
        sendStop: () => { calls.stop++; },
        broadcastState: (s) => { states.push(s.phase); },
        showTranslation: (turn, text) => { calls.shown.push([turn.revision, turn.text, text]); },
        log: (line) => { log.push(line); },
        ...over,
    };
    session = new InterpretingSession(deps);
    return { session, calls, log, states, sleeps, tick: (ms: number) => { clock += ms; }, now: () => clock };
}

t.test('one window makes one translation and one synthesis, sent once to the overlay', async t => {
    const s = setup();
    t.equal((await s.session.toggleTalk()).phase, 'listening');
    t.equal(s.calls.seal, 1, 'earlier own speech is sealed before the window opens');
    s.tick(10);
    s.session.noteOwnTurn({ segmentId: 'a', revision: 1, text: 'Please move the invented', startedAt: s.now() });
    s.session.noteOwnTurn({ segmentId: 'a', revision: 2, text: 'Please move the invented review', startedAt: s.now() - 0 });
    s.tick(10);
    s.session.noteOwnTurn({ segmentId: 'b', revision: 1, text: 'to Thursday afternoon.', startedAt: s.now() });
    t.equal((await s.session.toggleTalk()).phase, 'idle', 'the press itself returns at once');
    await s.session.settled();
    t.equal(s.calls.finalize, 1, 'mic STT is finalized');
    t.same(s.sleeps.slice(0, 1), [GRACE_MS], 'waits the grace period');
    t.same(s.calls.translate, ['Please move the invented review to Thursday afternoon.'], 'one translation of the joined latest texts');
    t.same(s.calls.synth, [[TRANSLATED, 'voice-1', 'fr']], 'one synthesis, in the other party language');
    t.equal(s.calls.audio.length, 1);
    t.same(s.calls.spoken, [TRANSLATED], 'the spoken text is noted for the echo guard');
    t.equal(s.calls.audio[0].sink, 'virtual');
    t.same(s.calls.shown, [[1, 'to Thursday afternoon.', TRANSLATED]], 'the last Me row gets the spoken translation');
    t.equal(s.session.getState().phase, 'idle');
    t.same(s.states.filter((p, i, a) => a.indexOf(p) === i), ['listening', 'idle', 'translating', 'voicing', 'speaking']);
});

t.test('a revision that arrives after the window closed is never spoken', async t => {
    const s = setup();
    await s.session.toggleTalk();
    s.tick(5);
    s.session.noteOwnTurn({ segmentId: 'a', revision: 1, text: SENTENCE, startedAt: s.now() });
    await s.session.toggleTalk();
    await s.session.settled();
    s.session.noteOwnTurn({ segmentId: 'a', revision: 2, text: SENTENCE + ' Corrected.', startedAt: s.now() - 100 });
    await s.session.settled();
    t.equal(s.calls.translate.length, 1);
    t.equal(s.calls.synth.length, 1);
    t.equal(s.calls.audio.length, 1);
});

t.test('a window with no speech says nothing', async t => {
    const s = setup();
    await s.session.toggleTalk();
    await s.session.toggleTalk();
    await s.session.settled();
    t.equal(s.calls.translate.length, 0);
    t.equal(s.calls.audio.length, 0);
    t.equal(s.session.getState().phase, 'idle');
});

t.test('toggle-on is refused with the setup reason and opens no window', async t => {
    const cases: Array<[string, Partial<SessionDeps>, InterpretingSettings, RegExp]> = [
        ['disabled', {}, { ...ready, enabled: false }, /turned off/],
        ['muted', { isMuted: () => true }, ready, /Unmute the microphone/],
        ['no voice', {}, { ...ready, voices: {} }, /Choose or clone a voice for Fish Audio/],
        ['no key', { apiKey: () => undefined }, ready, /Add your Fish Audio key/],
        ['no device label', {}, { ...ready, outputLabel: '' }, /Choose the virtual microphone/],
        ['mic is the device', { micDeviceName: () => 'invented cable (virtual)' }, ready, /Pika's microphone is the virtual microphone/],
        ['no model', { translationReady: () => false }, ready, /Choose a translation model/],
        ['no meeting', { isMeetingActive: () => false }, ready, /Start a meeting/],
    ];
    for (const [name, over, settings, message] of cases) {
        const s = setup(over, settings);
        const state = await s.session.toggleTalk();
        if (name === 'disabled') t.equal(state.phase, 'off', name);
        else { t.equal(state.phase, 'error', name); t.match(state.error, message, name); }
        t.equal(s.calls.seal, 0, `${name}: nothing was flushed`);
    }
    const s = setup({}, { ...ready, enabled: false });
    t.match(await s.session.toggleTalk(), { phase: 'off' });
});

t.test('a provider failure shows the real reason and speaks nothing', async t => {
    const s = setup({ provider: () => ({ synthesize: async () => { throw new Error('The Fish Audio credits are used up.'); }, cloneVoice: async () => { throw new Error('x'); }, deleteVoice: async () => { throw new Error('x'); } }) });
    await s.session.toggleTalk();
    s.tick(5);
    s.session.noteOwnTurn({ segmentId: 'a', revision: 1, text: SENTENCE, startedAt: s.now() });
    await s.session.toggleTalk();
    await s.session.settled();
    t.same(s.session.getState(), { phase: 'error', error: 'The Fish Audio credits are used up.' });
    t.equal(s.calls.audio.length, 0);
    t.equal(s.calls.shown.length, 0);
});

t.test('reset closes the window without speaking and stops playback', async t => {
    const s = setup();
    await s.session.toggleTalk();
    s.tick(5);
    s.session.noteOwnTurn({ segmentId: 'a', revision: 1, text: SENTENCE, startedAt: s.now() });
    s.session.reset();
    t.equal(s.calls.stop, 1);
    t.equal(s.session.getState().phase, 'idle');
    await s.session.settled();
    t.equal(s.calls.translate.length, 0);
});

t.test('a press during the grace period queues a second window behind the first', async t => {
    const s = setup();
    await s.session.toggleTalk();
    s.tick(5);
    s.session.noteOwnTurn({ segmentId: 'a', revision: 1, text: 'First invented sentence.', startedAt: s.now() });
    await s.session.toggleTalk();
    s.tick(5);
    await s.session.toggleTalk();
    s.tick(5);
    s.session.noteOwnTurn({ segmentId: 'b', revision: 1, text: 'Second invented sentence.', startedAt: s.now() });
    await s.session.toggleTalk();
    await s.session.settled();
    t.same(s.calls.translate, ['First invented sentence.', 'Second invented sentence.']);
    t.equal(s.calls.audio.length, 2);
    t.not(s.calls.audio[0].id, s.calls.audio[1].id);
});

t.test('test voice speaks the fixed sentence to the caller only', async t => {
    const s = setup();
    const sent: AudioMessage[] = [];
    await s.session.testVoice((m) => sent.push(m));
    t.equal(sent.length, 1);
    t.equal(s.calls.audio.length, 0, 'not the overlay');
    t.equal(s.calls.synth[0][1], 'voice-1');
    await t.rejects(setup({}, { ...ready, voices: {} }).session.testVoice(() => {}), /Choose or clone a voice/);
});

t.test('logs carry counts and durations, never the text', async t => {
    const s = setup();
    await s.session.toggleTalk();
    s.tick(5);
    s.session.noteOwnTurn({ segmentId: 'a', revision: 1, text: SENTENCE, startedAt: s.now() });
    await s.session.toggleTalk();
    await s.session.settled();
    t.ok(s.log.length > 0);
    t.match(s.log[0], /^\[Interpreting\] voiced provider=fishaudio model=s2\.1-pro chars=\d+ bytes=3 translateMs=\d+ synthMs=\d+/);
    for (const line of s.log) {
        t.notMatch(line, /invented review|Thursday|jeudi|voice-1|invented-key/);
    }
    const bad = setup({ translate: async () => { throw new Error(`failed on: ${SENTENCE}`); } });
    await bad.session.toggleTalk();
    bad.tick(5);
    bad.session.noteOwnTurn({ segmentId: 'a', revision: 1, text: SENTENCE, startedAt: bad.now() });
    await bad.session.toggleTalk();
    await bad.session.settled();
    t.match(bad.log[0], /^\[Interpreting\] failed stage=translate provider=fishaudio status=none class=Error$/);
    t.notMatch(JSON.stringify(bad.session.getState()), /Thursday/);
});

t.test('translateForInterpreting goes from the user language to the other party language with no context', async t => {
    const original = CredentialsManager.getInstance;
    t.teardown(() => { CredentialsManager.getInstance = original; });
    const cm = Object.create(CredentialsManager.prototype) as CredentialsManager;
    Object.assign(cm, {
        getSttLanguage: () => 'fr', getSttLanguageUser: () => 'en',
        getTranscriptTranslationProvider: () => 'invented-gateway', getTranscriptTranslationModel: () => 'invented-model',
        getTranscriptTranslationPrompt: () => 'Translate faithfully.', getTranscriptTranslationEnabled: () => false,
        getTranscriptTranslationDisplayMode: () => 'both', getTranscriptTranslationSourceLanguage: () => 'fr',
        getTranscriptTranslationTargetLanguage: () => 'en',
        resolveConnection: () => ({ type: 'openai-compatible', baseUrl: 'http://localhost:1/v1', apiKey: 'k' }),
        isConnectionReady: () => true,
    });
    CredentialsManager.getInstance = () => cm;
    const requests: Array<Record<string, unknown>> = [];
    const appState = {
        recentTranslatedTurns: [{ segmentId: 'x', source: 'Bonjour', translation: 'Hello' }],
        processingHelper: { getLLMHelper: () => ({ translateTranscriptText: async (req: Record<string, unknown>) => { requests.push(req); return 'ok'; } }) },
    };
    t.equal(await translateForInterpreting(appState as never, SENTENCE), 'ok');
    t.equal(requests.length, 1);
    t.equal(requests[0].targetLanguageKey, 'fr', 'target = the other party language');
    t.equal(requests[0].sourceLanguageKey, 'en', 'source hint = the user language');
    t.equal(requests[0].context, undefined, 'no context');
});
