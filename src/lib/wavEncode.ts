/** Mono Float32 PCM chunks as a 16-bit little-endian WAV file. Samples outside [-1, 1] are clipped. */
export function wavEncode(chunks: Float32Array[], sampleRate: number): Uint8Array {
    const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(44 + samples * 2);
    const view = new DataView(bytes.buffer);
    const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    tag(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    tag(36, 'data');
    view.setUint32(40, samples * 2, true);
    let offset = 44;
    for (const chunk of chunks) {
        for (const value of chunk) {
            const clipped = Math.max(-1, Math.min(1, value));
            view.setInt16(offset, Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff), true);
            offset += 2;
        }
    }
    return bytes;
}
