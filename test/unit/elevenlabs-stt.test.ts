import t from 'tap';
import { EventEmitter } from 'node:events';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import path from 'node:path';
import { fetchSttModels } from '../../electron/utils/sttModels';

t.test('the ElevenLabs model list is the one realtime model, without asking the service', async t => {
    t.same(await fetchSttModels('elevenlabs', 'invented-key'), [{ id: 'scribe_v2_realtime', label: 'scribe_v2_realtime' }]);
});

t.test('the ElevenLabs connection asks for automatic commits, so lines become final', async t => {
    const urls: string[] = [];
    class FakeSocket extends EventEmitter {
        static OPEN = 1;
        readyState = 0;
        constructor(url: string) { super(); urls.push(url); }
        close() {}
    }
    const { ElevenLabsStreamingSTT } = mockRequire(path.resolve('electron/audio/ElevenLabsStreamingSTT.ts'), {
        ws: { __esModule: true, default: FakeSocket, WebSocket: FakeSocket },
    }) as { ElevenLabsStreamingSTT: new (key: string) => { start(): void; stop(): void } };
    const stt = new ElevenLabsStreamingSTT('invented-key');
    stt.start();
    stt.stop();
    t.equal(urls.length, 1);
    t.match(urls[0], 'commit_strategy=vad');
    t.match(urls[0], 'vad_silence_threshold_secs=0.8');
});

t.test('a silent chunk after a pause is sent as the time that really passed, capped at one second', async t => {
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventEmitter {
        static OPEN = 1;
        readyState = 0;
        sent: string[] = [];
        constructor() { super(); sockets.push(this); }
        close() {}
        send(data: string) { this.sent.push(data); }
    }
    const { ElevenLabsStreamingSTT } = mockRequire(path.resolve('electron/audio/ElevenLabsStreamingSTT.ts'), {
        ws: { __esModule: true, default: FakeSocket, WebSocket: FakeSocket },
    }) as {
        ElevenLabsStreamingSTT: new (key: string) => {
            setSampleRate(rate: number): void;
            start(): void;
            stop(): void;
            write(chunk: Buffer): void;
        };
    };

    // A deterministic clock, so a pause is the length this test says it is.
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    t.teardown(() => { Date.now = originalNow; });

    const stt = new ElevenLabsStreamingSTT('invented-key');
    stt.setSampleRate(16000);
    stt.start();
    const ws = sockets[0];
    ws.readyState = 1;
    ws.emit('open');
    ws.emit('message', JSON.stringify({ message_type: 'session_started', config: {} }));

    const sentAudio = (index: number): Int16Array => {
        const { audio_base_64 } = JSON.parse(ws.sent[index]) as { audio_base_64: string };
        const bytes = Buffer.from(audio_base_64, 'base64');
        return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    };
    const pcm = (samples: Int16Array): Buffer => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);

    // A 250ms speech chunk leaves the send buffer at once, unchanged.
    const speech = new Int16Array(4000);
    for (let i = 0; i < speech.length; i++) speech[i] = ((i * 37) % 2000) - 1000;
    stt.write(pcm(speech));
    t.equal(ws.sent.length, 1, 'the speech chunk is sent');
    t.same(Array.from(sentAudio(0)), Array.from(speech), 'and passed through unchanged');

    // The gate sends one 20ms silent chunk for a 400ms pause; the server must hear the 400ms.
    now += 400;
    stt.write(pcm(new Int16Array(320)));
    t.equal(ws.sent.length, 2, 'the silence is sent');
    t.equal(sentAudio(1).length, 6400, 'as 400ms at 16kHz');
    t.ok(sentAudio(1).every(sample => sample === 0), 'and it is silence');

    // A long pause is capped, so one keepalive cannot claim more than a second.
    now += 5000;
    stt.write(pcm(new Int16Array(320)));
    t.equal(ws.sent.length, 3, 'the long pause is sent too');
    t.equal(sentAudio(2).length, 16000, 'capped at one second');
    stt.stop();
});
