import { buildEmbeddingConfig } from "../rag/embeddingConfig"
import { fetchSttModels, STT_MODEL_PROVIDERS, type SttModelProvider } from "../utils/sttModels"
import { AppState } from "../main"
import { AudioDevices } from "../audio/AudioDevices"
import { DEFAULT_TRANSCRIPT_ASSEMBLER_PROFILE, isTranscriptAssemblerProfile } from "../lib/transcript-assembler"
import { SettingsManager } from "../services/SettingsManager"
import { safeHandle } from "./safeHandle"

export function registerSttHandlers(appState: AppState): void {
  // ==========================================
  // STT Provider Management Handlers
  // ==========================================

  // Mute the microphone (for example when the other party is heard through speakers).
  safeHandle("get-microphone-muted", () => appState.microphoneMuted);

  safeHandle("set-microphone-muted", (_, muted: boolean) => {
    appState.setMicrophoneMuted(muted === true);
    return { success: true };
  });

  safeHandle("set-stt-provider", async (_, provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'gemini') => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setSttProvider(provider);

      // Reconfigure the audio pipeline to use the new STT provider
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting STT provider:", error);
      return { success: false, error: error.message };
    }
  });

  // The model of a speech service (empty means its default). Applies by rebuilding the recognition streams.
  safeHandle("set-stt-model", async (_, provider: string, model: string) => {
    if (!STT_MODEL_PROVIDERS.includes(provider as SttModelProvider) || typeof model !== 'string' || model.length > 200) {
      return { success: false, error: 'This speech service has no model to choose' };
    }
    const { CredentialsManager } = require('../services/CredentialsManager');
    CredentialsManager.getInstance().setSttModel(provider, model);
    await appState.reconfigureSttProvider();
    return { success: true };
  });

  // What a speech service offers. A key typed but not yet saved is used when given; otherwise the saved one.
  safeHandle("fetch-stt-models", async (_, provider: string, apiKey?: string) => {
    if (!STT_MODEL_PROVIDERS.includes(provider as SttModelProvider)) return { success: false, error: 'This speech service has no model list' };
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const saved: Record<string, string | undefined> = {
        groq: cm.getGroqSttApiKey(), openai: cm.getOpenAiSttApiKey(), deepgram: cm.getDeepgramApiKey(),
        elevenlabs: cm.getElevenLabsApiKey(), soniox: cm.getSonioxApiKey(), gemini: cm.getGeminiApiKey(),
      };
      const models = await fetchSttModels(provider as SttModelProvider, (typeof apiKey === 'string' && apiKey.trim()) || saved[provider] || '');
      return { success: true, models };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  safeHandle("get-stt-provider", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      return CredentialsManager.getInstance().getSttProvider();
    } catch (error: any) {
      return 'google';
    }
  });

  safeHandle("get-transcript-assembler-profile", async () => {
    const profile = SettingsManager.getInstance().get('transcriptAssemblerProfile');
    return isTranscriptAssemblerProfile(profile) ? profile : DEFAULT_TRANSCRIPT_ASSEMBLER_PROFILE;
  });

  safeHandle("set-transcript-assembler-profile", async (_, profile: unknown) => {
    if (!isTranscriptAssemblerProfile(profile)) {
      return { success: false, error: 'Invalid transcript assembler profile' };
    }

    SettingsManager.getInstance().set('transcriptAssemblerProfile', profile);
    appState.transcriptAssemblerProfile = profile;
    return { success: true };
  });

  safeHandle("set-groq-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Groq STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openai-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setOpenAiSttApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenAI STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-deepgram-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setDeepgramApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Deepgram API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-groq-stt-model", async (_, model: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttModel(model);

      // Reconfigure the audio pipeline to use the new model
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Groq STT model:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-elevenlabs-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setElevenLabsApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving ElevenLabs API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setAzureApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Azure API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-region", async (_, region: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setAzureRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Azure region:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-ibmwatson-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving IBM Watson API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-gemini-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      cm.setGeminiApiKey(apiKey);
      // The same key serves the AI connection; embeddings that use it must follow it.
      if (cm.getEmbeddingUse().connectionId === 'gemini') {
        await appState.getRAGManager()?.initializeEmbeddings(buildEmbeddingConfig(cm), { force: true });
      }
      return { success: true };
    } catch (error) {
      console.error("Error saving Gemini API key:", error);
      return { success: false, error: (error as Error).message };
    }
  });

  safeHandle("set-soniox-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setSonioxApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Soniox API key:", error);
      return { success: false, error: error.message };
    }
  });

  // Helper to sanitize error messages (remove API key references)
  const sanitizeErrorMessage = (msg: string): string => {
    // Remove patterns like ": sk-***...***" or ": sdasdada***...dwwC"
    return msg.replace(/:\s*[a-zA-Z0-9*]+\*+[a-zA-Z0-9*]+\.?$/g, '').trim();
  };

  safeHandle("test-stt-connection", async (_, provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'gemini', apiKey: string, region?: string) => {
    console.log(`[IPC] Received test - stt - connection request for provider: ${provider} `);

    // If no key provided, fall back to the stored key
    if (!apiKey || !apiKey.trim()) {
      const { CredentialsManager } = require('../services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const storedKeyMap: Record<string, () => string | undefined> = {
        groq: () => cm.getGroqSttApiKey(),
        openai: () => cm.getOpenAiSttApiKey(),
        deepgram: () => cm.getDeepgramApiKey(),
        elevenlabs: () => cm.getElevenLabsApiKey(),
        azure: () => cm.getAzureApiKey(),
        ibmwatson: () => cm.getIbmWatsonApiKey(),
        soniox: () => cm.getSonioxApiKey(),
        gemini: () => cm.getGeminiApiKey(),
      };
      apiKey = storedKeyMap[provider]?.() || '';
      if (!region && provider === 'azure') {
        region = cm.getAzureRegion() || 'eastus';
      }
      if (!apiKey) {
        return { success: false, error: 'No API key found. Please enter one first.' };
      }
    }

    try {
      if (provider === 'deepgram') {
        // Test Deepgram via WebSocket connection
        const WebSocket = require('ws');
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const url = 'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1';
          const ws = new WebSocket(url, {
            headers: { Authorization: `Token ${apiKey} ` },
          });

          const timeout = setTimeout(() => {
            ws.close();
            resolve({ success: false, error: 'Connection timed out' });
          }, 15000);

          ws.on('open', () => {
            clearTimeout(timeout);
            try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { }
            ws.close();
            resolve({ success: true });
          });

          ws.on('error', (err: any) => {
            clearTimeout(timeout);
            resolve({ success: false, error: err.message || 'Connection failed' });
          });
        });
      }

      if (provider === 'soniox') {
        // Test Soniox via WebSocket connection
        const WebSocket = require('ws');
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

          const timeout = setTimeout(() => {
            ws.close();
            resolve({ success: false, error: 'Connection timed out' });
          }, 15000);

          ws.on('open', () => {
            // Send a minimal config to validate the API key
            ws.send(JSON.stringify({
              api_key: apiKey,
              model: 'stt-rt-v4',
              audio_format: 'pcm_s16le',
              sample_rate: 16000,
              num_channels: 1,
            }));
          });

          ws.on('message', (msg: any) => {
            clearTimeout(timeout);
            try {
              const res = JSON.parse(msg.toString());
              if (res.error_code) {
                resolve({ success: false, error: `${res.error_code}: ${res.error_message}` });
              } else {
                resolve({ success: true });
              }
            } catch {
              const firstLine = msg.toString().split(/\r?\n/, 1)[0].trim().slice(0, 200);
              const safeLine = firstLine.split(apiKey).join('***');
              resolve({ success: false, error: `The service sent a reply that is not JSON: ${safeLine || '(empty reply)'}` });
            }
            ws.close();
          });

          ws.on('error', (err: any) => {
            clearTimeout(timeout);
            resolve({ success: false, error: err.message || 'Connection failed' });
          });
        });
      }

      const axios = require('axios');
      const FormData = require('form-data');

      // Generate a tiny silent WAV (0.5s of silence at 16kHz mono 16-bit)
      const numSamples = 8000;
      const pcmData = Buffer.alloc(numSamples * 2);
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(36 + pcmData.length, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20);
      wavHeader.writeUInt16LE(1, 22);
      wavHeader.writeUInt32LE(16000, 24);
      wavHeader.writeUInt32LE(32000, 28);
      wavHeader.writeUInt16LE(2, 32);
      wavHeader.writeUInt16LE(16, 34);
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(pcmData.length, 40);
      const testWav = Buffer.concat([wavHeader, pcmData]);

      if (provider === 'gemini') {
        // Checks key acceptance by listing one model, not speech recognition.
        await axios.get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
          headers: { 'x-goog-api-key': apiKey },
          timeout: 10000,
        });
      } else if (provider === 'elevenlabs') {
        // Checks key acceptance at /v1/voices, not speech recognition.
        await axios.get('https://api.elevenlabs.io/v1/voices', {
          headers: { 'xi-api-key': apiKey },
          timeout: 10000,
        });
      } else if (provider === 'azure') {
        // Azure: raw binary with subscription key
        const azureRegion = region || 'eastus';
        await axios.post(
          `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
          testWav,
          {
            headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'audio/wav' },
            timeout: 15000,
          }
        );
      } else if (provider === 'ibmwatson') {
        // IBM Watson: raw binary with Basic auth
        const ibmRegion = region || 'us-south';
        await axios.post(
          `https://api.${ibmRegion}.speech-to-text.watson.cloud.ibm.com/v1/recognize`,
          testWav,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`,
              'Content-Type': 'audio/wav',
            },
            timeout: 15000,
          }
        );
      } else {
        // Groq / OpenAI: multipart FormData
        const endpoint = provider === 'groq'
          ? 'https://api.groq.com/openai/v1/audio/transcriptions'
          : 'https://api.openai.com/v1/audio/transcriptions';
        const model = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';

        const form = new FormData();
        form.append('file', testWav, { filename: 'test.wav', contentType: 'audio/wav' });
        form.append('model', model);

        await axios.post(endpoint, form, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...form.getHeaders(),
          },
          timeout: 15000,
        });
      }

      return { success: true };
    } catch (error: any) {
      const respData = error?.response?.data;
      const rawMsg = respData?.error?.message || respData?.detail?.message || respData?.message || error.message || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      console.error("STT connection test failed:", msg);
      return { success: false, error: msg };
    }
  });

  // --- Model Selector Window IPC ---

  safeHandle("show-model-selector", (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.showWindow(coords.x, coords.y);
  });

  safeHandle("hide-model-selector", () => {
    appState.modelSelectorWindowHelper.hideWindow();
  });

  safeHandle("toggle-model-selector", (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.toggleWindow(coords.x, coords.y);
  });



  // Native Audio Service Handlers
  // Native Audio handlers removed as part of migration to driverless architecture
  safeHandle("native-audio-status", async () => {
    return appState.getNativeAudioStatus();
  });

  safeHandle("get-input-devices", async () => {
    return AudioDevices.getInputDevices();
  });

  safeHandle("get-output-devices", async () => {
    return AudioDevices.getOutputDevices();
  });

  safeHandle("start-audio-test", async (event, deviceId?: string) => {
    const result = await appState.startAudioTest(deviceId);
    if (result.fallbackUsed && deviceId) {
      return { success: true, warning: `Device '${deviceId}' not found, using default microphone.` };
    }
    return { success: true };
  });

  safeHandle("stop-audio-test", async () => {
    appState.stopAudioTest();
    return { success: true };
  });

  safeHandle("set-recognition-language", async (_, key: string, speaker?: 'them' | 'user') => {
    appState.setRecognitionLanguage(key, speaker === 'user' ? 'user' : 'them');
    return { success: true };
  });
}
