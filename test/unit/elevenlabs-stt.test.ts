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
