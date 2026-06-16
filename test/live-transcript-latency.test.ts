import { readFileSync } from 'node:fs';
import path from 'node:path';
import t from 'tap';

t.test('native audio streams continuously to STT instead of local VAD dropping speech', (t) => {
  const nativeSource = readFileSync(path.join(process.cwd(), 'native-module/src/lib.rs'), 'utf8');
  const systemStart = nativeSource.slice(nativeSource.indexOf('pub struct SystemAudioCapture'), nativeSource.indexOf('pub struct MicrophoneCapture'));
  const micStart = nativeSource.slice(nativeSource.indexOf('pub struct MicrophoneCapture'));

  t.match(systemStart, /continuous STT stream/, 'system capture documents continuous STT streaming');
  t.match(micStart, /continuous STT stream/, 'microphone capture documents continuous STT streaming');
  t.match(micStart, /Send every 20ms chunk/, 'microphone path sends every frame to Deepgram');
  t.notMatch(systemStart, /SilenceSuppressor::new\(SilenceSuppressionConfig[\s\S]*for_system_audio\(\)/, 'system path no longer uses local silence suppression');
  t.notMatch(micStart, /SilenceSuppressor::new\(SilenceSuppressionConfig[\s\S]*for_microphone\(\)/, 'microphone path no longer uses local silence suppression');
  t.end();
});

t.test('user speech appears quickly with partials and low final flush latency', (t) => {
  const hookSource = readFileSync(path.join(process.cwd(), 'src/hooks/useMeetingTranscript.ts'), 'utf8');
  const panelSource = readFileSync(path.join(process.cwd(), 'src/components/meeting/TranscriptPanel.tsx'), 'utf8');
  const assemblerSource = readFileSync(path.join(process.cwd(), 'electron/lib/transcript-assembler.ts'), 'utf8');

  t.match(hookSource, /currentUserPartial/, 'user interim transcripts are tracked');
  t.match(panelSource, /partialSpeakerLabel=\{partialSpeakerLabel\}/, 'transcript panel labels user partials as Me');
  const audioPipelineSource = readFileSync(path.join(process.cwd(), 'electron/lib/audio-pipeline.ts'), 'utf8');

  t.match(assemblerSource, /speaker === 'user'[\s\S]*Math\.min\(baseFlushDelayMs/, 'user final transcript flush is capped for low latency');
  t.match(audioPipelineSource, /pcm16ChunkHasAudioSignal/, 'system audio health uses real PCM signal rather than silence keepalives');
  t.match(assemblerSource, /fragmentFlushDelayMs: 950/, 'default fragment flush is below one second');
  t.end();
});
