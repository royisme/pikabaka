/**
 * Recording the voice sample from the physical microphone. The audio stays in memory: the chunks
 * are encoded to one WAV at stop and dropped, and nothing here touches the disk.
 */
import { isKnownVirtualName, sameDeviceName } from './virtualOutput';
import { wavEncode } from './wavEncode';

export const MIN_SECONDS = 15;
export const MAX_SECONDS = 30;

export const VIRTUAL_INPUT_REFUSAL = "Pika's microphone is the virtual microphone. Choose your real microphone in Audio & Translation.";

type InputDevice = Pick<MediaDeviceInfo, 'deviceId' | 'label'>;

/** Whether a microphone name is the virtual device: the saved output name, or a known virtual driver. */
export const isVirtualInput = (name: string, outputLabel: string): boolean => sameDeviceName(name, outputLabel) || isKnownVirtualName(name);

/** Pika's chosen microphone as the native list names it; the first listed one when the saved id is gone, as the audio settings do. */
export function preferredInputName(inputs: Array<{ id: string; name: string }>, preferredId: string | null): string | null {
    return (inputs.find((input) => input.id === preferredId) ?? inputs[0])?.name ?? null;
}

/** The browser's id for a native microphone name (null name: the system default, no id). */
export function inputDeviceId(devices: InputDevice[], name: string | null): { ok: true; deviceId?: string } | { ok: false; error: string } {
    if (!name) return { ok: true };
    const inputs = devices.filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications');
    const found = inputs.find((device) => sameDeviceName(device.label, name));
    if (found) return { ok: true, deviceId: found.deviceId };
    return { ok: false, error: inputs.every((device) => !device.label) ? 'Device names are not available, so the microphone cannot be found.' : `Microphone '${name}' not found.` };
}

export interface MicRecording {
    /** Ends the recording and returns the WAV bytes. */
    stop(): Uint8Array;
    /** Ends it and drops everything. */
    cancel(): void;
}

/** Starts recording mono audio. Throws the real error: a refused device, a denied permission, a missing microphone. */
export async function startRecording(micName: string | null, outputLabel: string, onLevel: (level: number) => void): Promise<MicRecording> {
    if (micName && isVirtualInput(micName, outputLabel)) throw new Error(VIRTUAL_INPUT_REFUSAL);
    const picked = inputDeviceId(await navigator.mediaDevices.enumerateDevices().then((all) => all.filter((d) => d.kind === 'audioinput')), micName);
    if (!picked.ok) throw new Error(picked.error);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, ...(picked.deviceId ? { deviceId: { exact: picked.deviceId } } : {}) } });
    const release = () => stream.getTracks().forEach((track) => track.stop());
    const trackLabel = stream.getAudioTracks()[0]?.label ?? '';
    if (isVirtualInput(trackLabel, outputLabel)) {
        release();
        throw new Error(VIRTUAL_INPUT_REFUSAL);
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    let chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        chunks.push(data.slice());
        let sum = 0;
        for (const value of data) sum += value * value;
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
    };
    source.connect(processor);
    processor.connect(context.destination);
    const end = () => {
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        release();
        void context.close();
    };
    return {
        stop() {
            end();
            const wav = wavEncode(chunks, context.sampleRate);
            chunks = [];
            return wav;
        },
        cancel() {
            end();
            chunks = [];
        },
    };
}
