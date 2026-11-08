import t from 'tap';
import { wavEncode } from '../../src/lib/wavEncode';

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));

t.test('header fields and length', async (t) => {
    const wav = wavEncode([new Float32Array([0, 0.5]), new Float32Array([-0.5])], 48000);
    const v = new DataView(wav.buffer);
    t.equal(wav.length, 44 + 3 * 2);
    t.equal(text(wav, 0, 4), 'RIFF');
    t.equal(v.getUint32(4, true), 36 + 6);
    t.equal(text(wav, 8, 8), 'WAVEfmt ');
    t.equal(v.getUint32(16, true), 16);
    t.equal(v.getUint16(20, true), 1);
    t.equal(v.getUint16(22, true), 1);
    t.equal(v.getUint32(24, true), 48000);
    t.equal(v.getUint32(28, true), 96000);
    t.equal(v.getUint16(32, true), 2);
    t.equal(v.getUint16(34, true), 16);
    t.equal(text(wav, 36, 4), 'data');
    t.equal(v.getUint32(40, true), 6);
});

t.test('samples scale and clip at plus and minus 1.0', async (t) => {
    const wav = wavEncode([new Float32Array([1, -1, 2.5, -3, 0.5, -0.5, 0])], 16000);
    const v = new DataView(wav.buffer);
    const out = Array.from({ length: 7 }, (_, i) => v.getInt16(44 + i * 2, true));
    t.same(out, [32767, -32768, 32767, -32768, 16384, -16384, 0]);
});

t.test('empty input is a header only', async (t) => {
    t.equal(wavEncode([], 8000).length, 44);
});
