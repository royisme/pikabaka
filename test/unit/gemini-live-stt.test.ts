import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

interface Callbacks { onmessage(message: unknown): void }
type Adapter = { notifySpeechEnded(): void; setSampleRate(rate: number): void; setRecognitionLanguage(key: string): void; start(): void; write(chunk: Buffer): void; stop(): void; on(event: string, fn: (value: never) => void): void };

function load() {
    const connects: Array<{ model: string; config: { inputAudioTranscription: { languageCodes: string[] } }; callbacks: Callbacks }> = [];
    const sent: Array<{ audio: { data: string; mimeType: string } }> = [];
    const { GeminiLiveSTT } = mockRequire(path.resolve('electron/audio/GeminiLiveSTT.ts'), {
        '@google/genai': {
            Modality: { TEXT: 'TEXT' },
            GoogleGenAI: class { live = { connect: async (args: (typeof connects)[number]) => { connects.push(args); return { sendRealtimeInput: (input: (typeof sent)[number]) => sent.push(input), close() {} }; } }; },
        },
    }) as { GeminiLiveSTT: new (key: string) => Adapter };
    return { stt: new GeminiLiveSTT('invented-key'), connects, sent };
}
import { fetchSttModels } from '../../electron/utils/sttModels';

const ready = () => new Promise<void>(resolve => setImmediate(resolve));

t.test('interim text is not final, the turn text is final with a boundary', async t => {
    const { stt, connects } = load();
    const seen: Array<{ text: string; isFinal: boolean; boundary?: boolean }> = [];
    stt.on('transcript', (value: never) => seen.push(value));
    stt.start();
    await ready();
    connects[0].callbacks.onmessage({ serverContent: { interimInputTranscription: { text: 'Invented line so' } } });
    connects[0].callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Invented line so far.' } } });
    connects[0].callbacks.onmessage({ serverContent: {} });
    t.same(seen.map(s => [s.text, s.isFinal, !!s.boundary]), [['Invented line so', false, false], ['Invented line so far.', true, true]]);
    stt.stop();
});

t.test('48 kHz audio is sent as 16 kHz in 100 ms pieces and the language is a hint', async t => {
    const { stt, connects, sent } = load();
    stt.setSampleRate(48000);
    stt.setRecognitionLanguage('french');
    stt.start();
    await ready();
    t.equal(connects[0].model, 'gemini-3.5-transcribe-live');
    t.same(connects[0].config.inputAudioTranscription.languageCodes, ['fr']);
    const tone = Buffer.alloc(4800 * 2);
    for (let i = 0; i < 4800; i++) tone.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2);
    stt.write(tone);
    t.equal(sent.length, 1);
    t.equal(sent[0].audio.mimeType, 'audio/pcm;rate=16000');
    t.equal(Buffer.from(sent[0].audio.data, 'base64').length, 1600 * 2, '4800 samples at 48 kHz become 1600 at 16 kHz');
    stt.stop();
});

t.test('the Gemini model list is its one live transcription model, without asking another service', async t => {
    t.same(await fetchSttModels('gemini', 'invented-key'), [{ id: 'gemini-3.5-transcribe-live', label: 'gemini-3.5-transcribe-live' }]);
});

t.test('the end of speech closes the turn once, and only when speech was sent', async t => {
    const { stt, sent } = load();
    const streamEnds = () => (sent as unknown as Array<{ audioStreamEnd?: boolean }>).filter(input => input.audioStreamEnd).length;
    stt.start();
    await ready();
    stt.notifySpeechEnded();
    t.equal(streamEnds(), 0, 'nothing was said yet');
    const tone = Buffer.alloc(320 * 2);
    for (let i = 0; i < 320; i++) tone.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2);
    stt.write(tone);
    stt.notifySpeechEnded();
    stt.notifySpeechEnded();
    t.equal(streamEnds(), 1, 'one signal per stretch of speech');
    t.equal(sent.filter(input => (input as { audio?: unknown }).audio).length, 1, 'the unsent audio goes out first');
    stt.stop();
});
