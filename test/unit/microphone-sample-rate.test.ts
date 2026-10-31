import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';

t.test('the microphone reports the rate the native device opened at, not the 48000 default', async t => {
    class FakeMic { getSampleRate() { return 16000; } }
    const { MicrophoneCapture } = mockRequire(path.resolve('electron/audio/MicrophoneCapture'), {
        [path.resolve('electron/audio/nativeModuleLoader')]: { loadNativeModule: () => ({ MicrophoneCapture: FakeMic }) },
    }) as { MicrophoneCapture: typeof import('../../electron/audio/MicrophoneCapture').MicrophoneCapture };
    t.equal(new MicrophoneCapture().getSampleRate(), 16000);
});
