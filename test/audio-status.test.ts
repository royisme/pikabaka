import t from 'tap';
import { NO_AUDIO_AFTER_MS, STARTUP_GRACE_MS, audioStatus, type AudioStatusInput } from '../src/lib/audioStatus';

const base: AudioStatusInput = {
  meetingActive: true,
  isConnected: true,
  hasRecentSystemAudioChunk: false,
  hasRecentThemTranscript: false,
  lastError: null,
  activeSince: 1000,
  noSystemAudioSince: null,
  now: 2000,
};

t.test('no meeting: not listening, with a way to open Pika', async (t) => {
  const status = audioStatus({ ...base, meetingActive: false, activeSince: null });
  t.equal(status.key, 'off');
  t.equal(status.action, 'open-pika');
  t.equal(status.dot, 'neutral');
});

t.test('a normal start is "starting", not a red failure, for the first 10 seconds', async (t) => {
  const early = audioStatus({ ...base, isConnected: false, now: base.activeSince! + STARTUP_GRACE_MS - 1 });
  t.equal(early.key, 'starting');
  t.equal(early.level, 'info');
  t.equal(early.action, null);
  const late = audioStatus({ ...base, isConnected: false, now: base.activeSince! + STARTUP_GRACE_MS });
  t.equal(late.key, 'stopped');
  t.equal(late.level, 'blocking');
  t.equal(late.action, 'fix-audio');
});

t.test('an error while disconnected is stopped at once, with the real text as detail only', async (t) => {
  const status = audioStatus({ ...base, isConnected: false, lastError: 'ScreenCaptureKit: permission denied' });
  t.equal(status.key, 'stopped');
  t.equal(status.detail, 'ScreenCaptureKit: permission denied');
  t.equal(status.zone?.body, 'ScreenCaptureKit: permission denied');
  t.equal(status.zone?.title, 'Transcription stopped.');
});

t.test('a long error is cut in the zone but kept whole as detail', async (t) => {
  const long = 'x'.repeat(300);
  const status = audioStatus({ ...base, isConnected: false, lastError: long });
  t.equal(status.detail, long);
  t.ok(status.zone!.body.length <= 160);
  t.ok(status.zone!.body.endsWith('…'));
});

t.test('with no error text, stopped points at the permission', async (t) => {
  const status = audioStatus({ ...base, isConnected: false, now: base.activeSince! + STARTUP_GRACE_MS + 1 });
  t.match(status.zone!.body, /Screen & System Audio Recording permission/);
});

t.test('a transcript means live, whatever else is reported', async (t) => {
  const status = audioStatus({ ...base, hasRecentThemTranscript: true, hasRecentSystemAudioChunk: true, lastError: 'old error' });
  t.equal(status.key, 'live');
  t.equal(status.dot, 'success');
  t.equal(status.zone, null, 'there are rows, so no empty-area text');
});

t.test('audio without words yet is listening, and names the translation language', async (t) => {
  const plain = audioStatus({ ...base, hasRecentSystemAudioChunk: true });
  t.equal(plain.key, 'listening');
  t.equal(plain.zone?.body, 'Listening. Their words appear here.');
  t.equal(audioStatus({ ...base, hasRecentSystemAudioChunk: true, translateInto: 'Chinese' }).zone?.body, 'Listening. Their words appear here in Chinese.');
});

t.test('silence alone is waiting for 8 seconds, then "no call audio" with Fix audio', async (t) => {
  const since = 5000;
  const waiting = audioStatus({ ...base, noSystemAudioSince: since, now: since + NO_AUDIO_AFTER_MS - 1 });
  t.equal(waiting.key, 'waiting');
  t.equal(waiting.action, null);
  const none = audioStatus({ ...base, noSystemAudioSince: since, now: since + NO_AUDIO_AFTER_MS });
  t.equal(none.key, 'no-audio');
  t.equal(none.level, 'warn');
  t.equal(none.dot, 'warn');
  t.equal(none.action, 'fix-audio');
  t.equal(none.zone?.title, 'No sound from the call yet.');
});

t.test('connected with no audio and an error is stopped, not "no audio"', async (t) => {
  t.equal(audioStatus({ ...base, lastError: 'device lost', noSystemAudioSince: 1, now: 99999 }).key, 'stopped');
});

t.test('every chip has a short form of at most 12 characters', async (t) => {
  const inputs: Partial<AudioStatusInput>[] = [
    { meetingActive: false, activeSince: null },
    { isConnected: false },
    { isConnected: false, lastError: 'e' },
    { hasRecentSystemAudioChunk: true },
    { hasRecentThemTranscript: true },
    { noSystemAudioSince: 0, now: NO_AUDIO_AFTER_MS },
    {},
  ];
  for (const input of inputs) {
    const status = audioStatus({ ...base, ...input });
    t.ok(status.chipShort.length <= 12, `${status.key}: ${status.chipShort}`);
  }
});
