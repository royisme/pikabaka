import t from 'tap';
import { buildDeepgramListenUrl, describeDeepgramConnectionError } from '../electron/audio/DeepgramStreamingSTT';

t.test('Deepgram auto language omits unsupported realtime language detection params', (t) => {
  const url = new URL(buildDeepgramListenUrl({ sampleRate: 48000, channels: 1 }));

  t.equal(url.origin + url.pathname, 'wss://api.deepgram.com/v1/listen');
  t.equal(url.searchParams.get('model'), 'nova-3');
  t.equal(url.searchParams.get('encoding'), 'linear16');
  t.equal(url.searchParams.get('sample_rate'), '48000');
  t.equal(url.searchParams.get('channels'), '1');
  t.equal(url.searchParams.has('language'), false, 'auto mode must not send language=multi');
  t.equal(url.searchParams.has('detect_language'), false, 'auto mode must not send detect_language=true');
  t.end();
});

t.test('Deepgram explicit recognition language is still sent', (t) => {
  const url = new URL(buildDeepgramListenUrl({ sampleRate: 16000, channels: 2, languageCode: 'en' }));

  t.equal(url.searchParams.get('language'), 'en');
  t.equal(url.searchParams.get('sample_rate'), '16000');
  t.equal(url.searchParams.get('channels'), '2');
  t.end();
});


t.test('Deepgram HTTP 400 errors explain provider, language, and likely fix', (t) => {
  const message = describeDeepgramConnectionError(new Error('Unexpected server response: 400'), {
    sampleRate: 48000,
    channels: 1,
  });

  t.match(message, /Deepgram STT connection failed/, 'names the failing STT provider');
  t.match(message, /HTTP 400/, 'keeps the server status code');
  t.match(message, /language=auto/, 'includes the selected recognition language');
  t.match(message, /API key\/project\/plan/, 'points to credential/account cause');
  t.match(message, /language=multi/, 'mentions the previously unsupported auto-language parameter');
  t.end();
});
