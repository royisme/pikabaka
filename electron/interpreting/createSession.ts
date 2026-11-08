/** Connects an InterpretingSession to the app: credentials, assembler, audio pipeline and windows. */
import type { AppState } from '../main';
import { AudioDevices } from '../audio/AudioDevices';
import { CredentialsManager } from '../services/CredentialsManager';
import { finalizeMicSTT } from '../lib/audio-pipeline';
import { emitNativeAudioTranscript, flushBufferedTranscriptTurn, sealFlushedTranscriptTurn } from '../lib/transcript-assembler';
import { isInterpretingTranslationReady, translateForInterpreting } from '../lib/transcript-translation';
import { InterpretingSession } from './InterpretingSession';
import { elevenLabs, fishAudio } from './voiceProviders';

export function createInterpretingSession(appState: AppState): InterpretingSession {
    const cm = () => CredentialsManager.getInstance();
    const overlay = () => {
        const win = appState.getWindowHelper().getOverlayWindow();
        return win && !win.isDestroyed() ? win : null;
    };
    return new InterpretingSession({
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        settings: () => cm().getInterpretingSettings(),
        apiKey: (provider) => (provider === 'fishaudio' ? cm().getFishAudioApiKey() : cm().getElevenLabsApiKey()),
        isMeetingActive: () => appState.getIsMeetingActive(),
        isMuted: () => appState.microphoneMuted,
        micDeviceName: () => {
            const id = appState.microphoneCapture?.getDeviceId();
            return (id && AudioDevices.getInputDevices().find((d) => d.id === id)?.name) || null;
        },
        targetLanguage: () => cm().getSttLanguage(),
        translationReady: isInterpretingTranslationReady,
        flushOwn: () => flushBufferedTranscriptTurn(appState, 'user', { all: true }),
        sealOwn: () => sealFlushedTranscriptTurn(appState, 'user'),
        finalizeMic: () => finalizeMicSTT(appState),
        translate: (text) => translateForInterpreting(appState, text),
        provider: (id, key) => (id === 'fishaudio' ? fishAudio(key) : elevenLabs(key)),
        noteSpoken: (text) => appState.spokenEcho.noteOther(text, Date.now()),
        sendAudio: (message) => {
            const win = overlay();
            win?.webContents.send('interpreting-audio', message);
            return !!win;
        },
        sendStop: () => overlay()?.webContents.send('interpreting-stop'),
        broadcastState: (state) => appState.broadcast('interpreting-state-changed', state),
        showTranslation: (turn, translatedText) => emitNativeAudioTranscript(appState, {
            speaker: 'user',
            text: turn.text,
            sourceText: turn.text,
            translatedText,
            segmentId: turn.segmentId,
            timestamp: turn.startedAt,
            final: true,
            displayMode: cm().getTranscriptTranslationDisplayMode(),
            translationState: 'complete',
            speakerLabel: 'Me',
            revision: turn.revision,
        }),
        log: (line) => console.log(line),
    });
}
