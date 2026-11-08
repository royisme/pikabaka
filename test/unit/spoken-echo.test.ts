import t from 'tap';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { EchoFilter } from '../../electron/lib/echo-filter';
import type { AppState } from '../../electron/main';

const SPOKEN = 'Veuillez deplacer la revue inventee a jeudi apres-midi.';

t.test('the spoken-text filter: what Pika just said is dropped for 20 s, other text passes', t => {
    const cases: Array<[string, number, string, boolean]> = [
        ['the same text a moment later', 1_000, SPOKEN, true],
        ['the same text at the edge of the window', 20_000, SPOKEN, true],
        ['the same text after the window', 20_001, SPOKEN, false],
        ['a different sentence', 1_000, 'Le rapport invente arrive demain matin.', false],
        ['a short repeated phrase of two words', 1_000, 'jeudi apres-midi', true],
        ['one word is never an echo', 1_000, 'jeudi', false],
        ['most of the words, mixed with others', 1_000, 'Veuillez deplacer la revue inventee a jeudi', true],
        ['a few shared words in a long line', 1_000, 'La revue est un document que personne ne veut lire a jeudi', false],
    ];
    for (const [name, after, text, expected] of cases) {
        const filter = new EchoFilter(20_000, 2, 0.75);
        filter.noteOther(SPOKEN, 100_000);
        t.equal(filter.isEcho(text, 100_000 + after), expected, name);
    }
    t.end();
});

const file = (name: string) => path.resolve(`electron/${name}.ts`);

function pipeline() {
    const handled: string[] = [];
    const buffered: string[] = [];
    const dropped: boolean[] = [];
    const audio = mockRequire(file('lib/audio-pipeline'), {
        electron: {},
        [file('audio/SystemAudioCapture')]: { SystemAudioCapture: class {} },
        [file('audio/MicrophoneCapture')]: { MicrophoneCapture: class {} },
        [file('lib/audio-stats')]: { audioStats: { noteEchoDropped: (isFinal: boolean) => { dropped.push(isFinal); }, noteFinal: () => {} } },
        [file('services/CredentialsManager')]: { CredentialsManager: { getInstance: () => ({
            getSttProvider: () => 'google', getSttLanguage: () => 'english-us', getSttLanguageUser: () => 'english-us',
            getSttModel: () => '', getGoogleServiceAccountPath: () => 'invented.json',
            getTranscriptTranslationDisplayMode: () => 'both',
        }) } },
        [file('audio/GoogleSTT')]: { GoogleSTT: class extends EventEmitter { setRecognitionLanguage() {} } },
        [file('lib/transcript-assembler')]: {
            bufferFinalTranscriptChunk: (_s: unknown, _sp: string, text: string) => { buffered.push(text); },
            emitNativeAudioTranscript: (_s: unknown, row: { text: string }) => { buffered.push(row.text); },
            getBufferedTranscriptText: () => '', mergeTranscriptText: (_s: unknown, _a: string, b: string) => b,
            handleSpeakerSpeechEnded: () => {}, noteTranscriptActivity: () => {}, resetBufferedTranscriptTurns: () => {},
        },
        [file('lib/transcript-translation')]: {},
    }) as typeof import('../../electron/lib/audio-pipeline');
    const state = {
        getIsMeetingActive: () => true,
        getIntelligenceManager: () => ({ handleTranscript: (e: { text: string }) => { handled.push(e.text); } }),
        spokenEcho: new EchoFilter(20_000, 2, 0.75),
        echoFilter: null,
    } as unknown as AppState;
    const them = audio.createSTTProvider(state, 'them') as unknown as EventEmitter;
    const user = audio.createSTTProvider(state, 'user') as unknown as EventEmitter;
    const say = (stt: EventEmitter, text: string, isFinal: boolean) => stt.emit('transcript', { text, isFinal, confidence: 1 });
    return { state, them, user, say, handled, buffered, dropped };
}

t.test('a Them interim and final that repeat the spoken text are dropped and counted; other Them text passes', t => {
    const p = pipeline();
    p.state.spokenEcho.noteOther(SPOKEN, Date.now());
    p.say(p.them, SPOKEN, false);
    p.say(p.them, SPOKEN, true);
    t.same(p.handled, [], 'nothing reaches the gate');
    t.same(p.buffered, [], 'nothing reaches the assembler');
    t.same(p.dropped, [false, true], 'the interim and the final are counted in audioStats');
    p.say(p.them, 'The invented report arrives tomorrow morning.', true);
    t.same(p.handled, ['The invented report arrives tomorrow morning.'], 'different Them text passes');
    t.end();
});

t.test('the Me path is unchanged: spoken text on the microphone stream is not dropped by the spoken filter', t => {
    const p = pipeline();
    p.state.spokenEcho.noteOther(SPOKEN, Date.now());
    p.say(p.user, SPOKEN, true);
    t.same(p.handled, [SPOKEN]);
    t.end();
});
