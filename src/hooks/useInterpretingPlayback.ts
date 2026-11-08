import { useEffect, useRef } from 'react';
import { useMainEvent } from './useMainEvent';
import { listOutputDevices, resolveSink } from '../lib/virtualOutput';
import type { AudioMessage } from '../../electron/interpreting/InterpretingSession';

/**
 * Plays the clips the interpreting session sends into the saved virtual microphone and reports
 * each one back. A missing sink or a failed decode is reported with its reason and plays nothing.
 * The session sends one clip at a time and waits for the report, so no queue is kept here.
 */
export function useInterpretingPlayback(): void {
    const current = useRef<AudioBufferSourceNode | null>(null);

    useMainEvent(window.electronAPI?.onInterpretingAudio, (message: AudioMessage) => {
        void play(message, current);
    });
    useEffect(() => window.electronAPI?.onInterpretingStop?.(() => current.current?.stop()), []);
}

async function play({ id, bytes, sink }: AudioMessage, current: { current: AudioBufferSourceNode | null }): Promise<void> {
    let context: AudioContext | null = null;
    try {
        const settings = await window.electronAPI.interpretingGetSettings();
        const resolved = resolveSink(await listOutputDevices(), sink, settings.outputLabel);
        if (!resolved.ok) throw new Error(resolved.error);
        context = new AudioContext();
        await context.setSinkId(resolved.deviceId);
        const buffer = await context.decodeAudioData(bytes.slice().buffer);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        current.current = source;
        await new Promise<void>((resolve) => {
            source.onended = () => resolve();
            source.start();
        });
        await window.electronAPI.interpretingPlayed({ id, ok: true });
    } catch (error) {
        await window.electronAPI.interpretingPlayed({ id, ok: false, error: error instanceof Error ? error.message : 'Playback failed.' });
    } finally {
        current.current = null;
        void context?.close();
    }
}
