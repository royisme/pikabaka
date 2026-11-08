/**
 * Finding the output that carries interpreted speech. The native device list cannot route audio:
 * its ids are CoreAudio UIDs, while Chromium's sink ids are per-origin hashes. So the saved
 * setting is a label, and the sink id is resolved from `enumerateDevices()` each time a clip plays.
 */

/** Lower-case fragments of the virtual audio drivers people use for a virtual microphone. */
const KNOWN_VIRTUAL_NAMES = ['blackhole', 'vb-cable', 'cable input', 'vb-audio', 'voicemeeter'];

/** The label, or the name of the Pika microphone, as another device name by case-insensitive containment. */
export function sameDeviceName(a: string, b: string): boolean {
    const x = a.trim().toLowerCase();
    const y = b.trim().toLowerCase();
    return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

export function isKnownVirtualName(label: string): boolean {
    const name = label.toLowerCase();
    return KNOWN_VIRTUAL_NAMES.some((known) => name.includes(known));
}

export type SinkResolution = { ok: true; deviceId: string } | { ok: false; error: string };

type OutputDevice = Pick<MediaDeviceInfo, 'deviceId' | 'label'>;

/** The "default" and "communications" aliases repeat a real device under another label. */
const isAlias = (device: OutputDevice) => device.deviceId === 'default' || device.deviceId === 'communications';

/**
 * `default` plays to the system default output (deviceId ''). `virtual` needs the saved label to
 * match a real output; nothing falls back, because playing into the room would tell the other
 * party nothing. Among several matches an exact label wins, then a known virtual driver.
 */
export function resolveSink(devices: OutputDevice[], sink: 'virtual' | 'default', outputLabel: string): SinkResolution {
    if (sink === 'default') return { ok: true, deviceId: '' };
    const label = outputLabel.trim();
    if (!label) return { ok: false, error: 'No virtual microphone is chosen. Choose one in Settings.' };
    const outputs = devices.filter((device) => !isAlias(device));
    if (outputs.length > 0 && outputs.every((device) => !device.label)) {
        return { ok: false, error: 'Device names are not available, so the virtual microphone cannot be found.' };
    }
    const matches = outputs.filter((device) => sameDeviceName(device.label, label));
    const best =
        matches.find((device) => device.label.trim().toLowerCase() === label.toLowerCase()) ??
        matches.find((device) => isKnownVirtualName(device.label)) ??
        matches[0];
    return best ? { ok: true, deviceId: best.deviceId } : { ok: false, error: `Virtual microphone '${label}' not found.` };
}

/** The renderer's audio outputs, listed fresh so a device plugged in or removed since the last clip is seen. */
export async function listOutputDevices(): Promise<OutputDevice[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audiooutput');
}
