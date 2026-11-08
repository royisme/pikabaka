import { isKnownVirtualName } from './virtualOutput';
import type { InterpretingSettings } from '../../electron/services/interpretingSettings';

/** The notice is asked for on the first Enable, and again whenever the stored acceptance is gone. */
export const noticeNeeded = (settings: Pick<InterpretingSettings, 'noticeAcceptedAt'>): boolean => !settings.noticeAcceptedAt;

/** Persistent text under the section header. */
export const PERSISTENT_NOTICE =
    'Speaks a translation of what you say into a virtual microphone, so the other party hears it in their language. Off by default. Tell people they are hearing a machine translation. Your text, and your voice sample if you clone your voice, go to the voice service you choose.';

export const FIRST_ENABLE_TITLE = 'Before you turn on Interpreting';

/** The first-enable notice, one string per bullet. */
export const FIRST_ENABLE_POINTS = [
    'When you press Talk, Pika translates what you say and speaks it into a virtual microphone. In your meeting app, people hear only the translation, not your own voice.',
    'Machine translation and synthetic speech make mistakes. What is spoken goes out in your name: watch the transcript and correct yourself when it matters.',
    'Tell the people in the call that they are hearing a machine translation in a synthetic voice. In some places and situations the law requires this, and leaving it out can mislead them.',
    'What you say is sent as text to your translation model and to the voice service you choose (Fish Audio or ElevenLabs), and is handled under that service\'s terms. Pika keeps no audio.',
];

export const NO_VIRTUAL_DEVICE =
    'No virtual microphone found. Install BlackHole 2ch (macOS, existential.audio/blackhole) or VB-CABLE (Windows, vb-audio.com/Cable), then press Refresh.';

/** Device names for the picker: the default/communications aliases and unnamed devices left out, repeats merged. */
export function outputNames(devices: Array<{ deviceId: string; label: string }>): string[] {
    const names = devices
        .filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications' && device.label)
        .map((device) => device.label);
    return [...new Set(names)];
}

/** The saved name wins; with none saved, the first known virtual driver in the list is proposed. */
export function preselectOutput(saved: string, names: string[]): string {
    return saved || names.find(isKnownVirtualName) || '';
}
