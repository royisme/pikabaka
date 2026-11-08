import type { ElectronAPI } from '../../src/types/electron';
import { languages, type Scene } from './fixture';

type Handler = (payload: never) => void;

/**
 * A `window.electronAPI` for the browser: the overrides answer what the overlay reads at start, every
 * other method resolves to nothing, and every `on*` subscriber is real, so `emit` replays an event
 * through the same listener the app registers in Electron.
 */
export function installElectronStub(scene: Scene): { emit: (event: string, payload: unknown) => void } {
  const listeners = new Map<string, Set<Handler>>();
  const overrides: Partial<ElectronAPI> = {
    platform: 'darwin',
    getRecognitionLanguages: async () => languages,
    getTranscriptTranslationSettings: async () => ({
      enabled: true,
      provider: 'sample',
      model: 'sample-model',
      prompt: '',
      displayMode: 'both',
      sourceLanguage: scene.themLanguage,
      targetLanguage: scene.targetLanguage,
    }),
    getSttLanguage: async (speaker) => (speaker === 'user' ? 'english-us' : scene.themLanguage),
    getNativeAudioStatus: async () => ({
      connected: true,
      meetingActive: true,
      hasRecentSystemAudioChunk: true,
      hasRecentThemTranscript: true,
      lastSystemAudioChunkAt: Date.now(),
      lastThemTranscriptAt: Date.now(),
      lastError: null,
    }),
    chatModelGet: async () => ({ connectionId: 'sample', model: 'sample-model' }),
    aiConnectionsList: async () => [
      { id: 'sample', name: 'Sample provider', type: 'openai', baseUrl: 'https://example.invalid', customBaseUrl: false, hasApiKey: true, builtin: false },
    ],
    agentStatus: async () => ({ meetingActive: true, available: true }),
    agentSubmit: async () => ({ ok: true, requestId: 'sample-request' }),
    agentApprovalsList: async () => [],
    getKeybinds: async () => [],
    getUndetectable: async () => false,
    getMicrophoneMuted: async () => false,
    getOverlayMousePassthrough: async () => false,
  };

  const api = new Proxy(overrides, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop as keyof ElectronAPI];
      if (prop.startsWith('on')) {
        return (callback: Handler) => {
          const set = listeners.get(prop) ?? new Set<Handler>();
          set.add(callback);
          listeners.set(prop, set);
          return () => set.delete(callback);
        };
      }
      return () => Promise.resolve(undefined);
    },
  });
  window.electronAPI = api as ElectronAPI;

  return { emit: (event, payload) => listeners.get(event)?.forEach((callback) => callback(payload as never)) };
}
