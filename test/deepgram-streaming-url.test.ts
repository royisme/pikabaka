import t from 'tap';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDeepgramListenUrl, describeDeepgramConnectionError } from '../electron/audio/DeepgramStreamingSTT';

t.test('Deepgram auto language uses realtime multilingual mode without detect_language', (t) => {
  const url = new URL(buildDeepgramListenUrl({ sampleRate: 48000, channels: 1 }));

  t.equal(url.origin + url.pathname, 'wss://api.deepgram.com/v1/listen');
  t.equal(url.searchParams.get('model'), 'nova-3');
  t.equal(url.searchParams.get('encoding'), 'linear16');
  t.equal(url.searchParams.get('sample_rate'), '48000');
  t.equal(url.searchParams.get('channels'), '1');
  t.equal(url.searchParams.get('interim_results'), 'true', 'interim transcripts should stream while the user is speaking');
  t.equal(url.searchParams.get('endpointing'), '300', 'short endpointing keeps final transcript latency low');
  t.equal(url.searchParams.get('language'), 'multi', 'auto mode must enable multilingual English/Russian recognition');
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
  t.match(message, /detect_language=true/, 'mentions the unsupported realtime detect_language parameter');
  t.end();
});


t.test('default STT language is auto/multilingual, not English', (t) => {
  const credentialsSource = readFileSync(join(process.cwd(), 'electron/services/CredentialsManager.ts'), 'utf8');
  const deepgramSource = readFileSync(join(process.cwd(), 'electron/audio/DeepgramStreamingSTT.ts'), 'utf8');
  const openAiSource = readFileSync(join(process.cwd(), 'electron/audio/OpenAIStreamingSTT.ts'), 'utf8');
  const elevenLabsSource = readFileSync(join(process.cwd(), 'electron/audio/ElevenLabsStreamingSTT.ts'), 'utf8');
  const settingsSource = readFileSync(join(process.cwd(), 'src/components/SettingsOverlay.tsx'), 'utf8');
  const llmHelperSource = readFileSync(join(process.cwd(), 'electron/core/LLMHelper.ts'), 'utf8');

  t.match(credentialsSource, /return raw \|\| 'auto'/, 'credentials manager defaults STT language to auto');
  t.notMatch(credentialsSource, /sttLanguage \|\| 'english-us'/, 'credentials manager no longer defaults to English');
  t.match(deepgramSource, /languageCode: string \| undefined = undefined/, 'Deepgram defaults to language=multi');
  t.match(openAiSource, /private languageKey = 'auto'/, 'OpenAI STT defaults to native language detection');
  t.match(elevenLabsSource, /languageCode: string \| undefined = undefined/, 'ElevenLabs STT defaults to language detection');
  t.match(elevenLabsSource, /key === 'auto' \? undefined/, 'ElevenLabs auto mode omits language_code');
  t.match(settingsSource, /const currentLangKey = storedStt \|\| 'auto'/, 'settings UI shows Auto on fresh installs');
  t.match(llmHelperSource, /private sttLanguage: string = 'auto'/, 'LLM helper language hint starts in auto mode');
  t.end();
});
