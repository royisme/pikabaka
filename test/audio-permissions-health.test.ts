import { readFileSync } from 'node:fs';
import path from 'node:path';
import t from 'tap';

t.test('mac build declares all live-transcription privacy usage strings', (t) => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const extendInfo = pkg.build?.mac?.extendInfo ?? {};

  t.match(extendInfo.NSMicrophoneUsageDescription, /transcribe/i, 'microphone permission explains transcription');
  t.match(extendInfo.NSScreenCaptureUsageDescription, /Screen & System Audio Recording/, 'screen/system audio permission is declared');
  t.match(extendInfo.NSAudioCaptureUsageDescription, /System Audio Recording/, 'audio capture permission is declared');
  t.end();
});

t.test('meeting start falls back from SCK when no system audio chunks arrive', (t) => {
  const mainSource = readFileSync(path.join(process.cwd(), 'electron/main.ts'), 'utf8');

  t.match(mainSource, /armSystemAudioHealthFallback/, 'health fallback is armed on meeting start');
  t.match(mainSource, /outputDeviceId === 'sck'/, 'fallback specifically handles the experimental SCK backend');
  t.match(mainSource, /Screen & System Audio Recording permission is stale/, 'fallback tells the user which macOS permission to fix');
  t.match(mainSource, /reconfigureAudio\(inputDeviceId, undefined\)/, 'fallback switches back to default CoreAudio capture');
  t.match(mainSource, /lastAudioPipelineError = null;\n\s*this\.googleSTT\?\.write\(chunk\)/, 'system audio chunks clear stale permission warnings');
  t.match(mainSource, /resolveMicrophoneAccessForMeeting/, 'microphone permission resolution is bounded');
  t.match(mainSource, /start live transcript for meeting\/system audio only/, 'meeting still starts when microphone permission is pending or denied');
  t.notMatch(mainSource, /throw new Error\(message\);\n\s*}\n\n\s*this\.isMeetingActive = true/, 'microphone permission failure no longer blocks system-audio transcription');
  t.end();
});

t.test('settings names the macOS system-audio permission and marks SCK experimental', (t) => {
  const settingsSource = readFileSync(path.join(process.cwd(), 'src/components/SettingsOverlay.tsx'), 'utf8');

  t.match(settingsSource, /Screen & System Audio Recording/, 'permissions UI uses the current macOS privacy label');
  t.match(settingsSource, /Experimental system-audio capture path/, 'SCK toggle warns that it is experimental');
  t.match(settingsSource, /leave off unless CoreAudio capture fails/, 'SCK guidance keeps CoreAudio as the default path');
  t.end();
});
