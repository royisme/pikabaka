import t from 'tap';
import path from 'node:path';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { RestSTT as RestSTTType } from '../../electron/audio/RestSTT';

t.test('a language change keeps the chosen Groq model in the request', async t => {
    const forms: Array<{ getBuffer: () => Buffer }> = [];
    const { RestSTT } = mockRequire(path.resolve('electron/audio/RestSTT.ts'), {
        axios: {
            post: async (_url: string, form: { getBuffer: () => Buffer }) => {
                forms.push(form);
                return { data: { text: 'Invented transcript', language: 'ru' } };
            },
        },
    }) as { RestSTT: typeof RestSTTType };

    const stt = new RestSTT('groq', 'invented-key', 'whisper-large-v3');
    stt.setRecognitionLanguage('russian');
    stt.start();
    stt.write(Buffer.alloc(8000, 1));
    await (stt as unknown as { flushAndUpload: () => Promise<void> }).flushAndUpload();
    stt.stop();

    t.equal(forms.length, 1, 'the test upload reaches the mocked service once');
    const body = forms[0].getBuffer().toString('utf8');
    t.match(body, /name="model"\r\n\r\nwhisper-large-v3\r\n/, 'the chosen model is sent after the language changed');
    t.match(body, /name="language"\r\n\r\nru\r\n/, 'the new language is sent with it');
});
