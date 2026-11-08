import t from 'tap';
import { elevenLabs, fishAudio, VoiceProviderError, type FetchFn } from '../../electron/interpreting/voiceProviders';

// No real provider is called: every request goes to a fake fetch that records it.
type Recorded = { url: string; init: RequestInit };
function fake(respond: (n: number) => Response) {
    const calls: Recorded[] = [];
    const fetchFn: FetchFn = async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return respond(calls.length);
    };
    return { calls, fetchFn };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const KEY = 'test-key-0123';
const SAMPLE = new Uint8Array([1, 2, 3]);
const hdr = (c: Recorded, k: string) => new Headers(c.init.headers).get(k);

t.test('elevenlabs synthesize', async (t) => {
    const f = fake(() => new Response(new Uint8Array([9, 8, 7])));
    const out = await elevenLabs(KEY, f.fetchFn).synthesize('hello there', 'voice1', 'chinese');
    t.same([...out], [9, 8, 7]);
    const c = f.calls[0];
    t.equal(c.url, 'https://api.elevenlabs.io/v1/text-to-speech/voice1?output_format=mp3_44100_128');
    t.equal(c.init.method, 'POST');
    t.equal(hdr(c, 'xi-api-key'), KEY);
    t.same(JSON.parse(String(c.init.body)), { text: 'hello there', model_id: 'eleven_flash_v2_5', language_code: 'zh' });
});

t.test('elevenlabs clone and verification', async (t) => {
    const f = fake(() => json({ voice_id: 'v9', requires_verification: true }));
    const r = await elevenLabs(KEY, f.fetchFn).cloneVoice(SAMPLE, 'Pika voice');
    t.same(r, { voiceId: 'v9', needsVerification: true });
    const c = f.calls[0];
    t.equal(c.url, 'https://api.elevenlabs.io/v1/voices/add');
    t.equal(c.init.method, 'POST');
    t.equal(hdr(c, 'xi-api-key'), KEY);
    const form = c.init.body as FormData;
    t.equal(form.get('name'), 'Pika voice');
    t.ok(form.get('files') instanceof Blob);
});

t.test('elevenlabs delete', async (t) => {
    const f = fake(() => json({ status: 'ok' }));
    await elevenLabs(KEY, f.fetchFn).deleteVoice('v9');
    t.equal(f.calls[0].url, 'https://api.elevenlabs.io/v1/voices/v9');
    t.equal(f.calls[0].init.method, 'DELETE');
    t.equal(hdr(f.calls[0], 'xi-api-key'), KEY);
});

t.test('fish synthesize', async (t) => {
    const f = fake(() => new Response(new Uint8Array([5, 6])));
    const out = await fishAudio(KEY, f.fetchFn).synthesize('hi', 'ref1', 'english-us');
    t.same([...out], [5, 6]);
    const c = f.calls[0];
    t.equal(c.url, 'https://api.fish.audio/v1/tts');
    t.equal(c.init.method, 'POST');
    t.equal(hdr(c, 'authorization'), `Bearer ${KEY}`);
    t.equal(hdr(c, 'model'), 's2.1-pro');
    t.same(JSON.parse(String(c.init.body)), { text: 'hi', reference_id: 'ref1', format: 'mp3', latency: 'balanced', normalize: true });
});

t.test('fish clone', async (t) => {
    const f = fake(() => json({ _id: 'm1', state: 'trained' }, 201));
    const r = await fishAudio(KEY, f.fetchFn).cloneVoice(SAMPLE, 'Pika voice');
    t.same(r, { voiceId: 'm1', needsVerification: false });
    const c = f.calls[0];
    t.equal(c.url, 'https://api.fish.audio/model');
    t.equal(hdr(c, 'authorization'), `Bearer ${KEY}`);
    const form = c.init.body as FormData;
    t.equal(form.get('type'), 'tts');
    t.equal(form.get('title'), 'Pika voice');
    t.equal(form.get('train_mode'), 'fast');
    t.equal(form.get('visibility'), 'private');
    t.ok(form.get('voices') instanceof Blob);
    t.equal(form.has('texts'), false);
});

t.test('fish clone refuses a state that is not trained', async (t) => {
    const f = fake(() => json({ _id: 'm1', state: 'training' }, 201));
    await t.rejects(fishAudio(KEY, f.fetchFn).cloneVoice(SAMPLE, 'n'), {
        message: 'Fish Audio has not finished this voice (state: training).',
    });
});

t.test('fish delete', async (t) => {
    const f = fake(() => new Response(null, { status: 200 }));
    await fishAudio(KEY, f.fetchFn).deleteVoice('m1');
    t.equal(f.calls[0].url, 'https://api.fish.audio/model/m1');
    t.equal(f.calls[0].init.method, 'DELETE');
});

t.test('errors carry the mapped message, never the key or the body', async (t) => {
    const cases: Array<[number, RegExp]> = [
        [401, /key/i], [403, /key/i], [402, /credits/], [422, /input/], [429, /rate limit/], [503, /unavailable/],
    ];
    for (const [status, re] of cases) {
        for (const make of [elevenLabs, fishAudio]) {
            const f = fake(() => new Response(`echo SECRET-BODY ${KEY}`, { status }));
            const err = await make(KEY, f.fetchFn).synthesize('SECRET-TEXT', 'v', 'english-us').catch((e: unknown) => e);
            t.ok(err instanceof VoiceProviderError);
            const e = err as VoiceProviderError;
            t.match(e.message, re);
            t.equal(e.status, status);
            t.notMatch(e.message, /SECRET|test-key/);
        }
    }
});

t.test('network failure has a fixed message', async (t) => {
    const fetchFn: FetchFn = async () => {
        throw new Error(`connect failed ${KEY}`);
    };
    const err = await fishAudio(KEY, fetchFn).deleteVoice('m1').catch((e: unknown) => e);
    t.equal((err as Error).message, 'Could not reach Fish Audio. Check the network connection.');
});
