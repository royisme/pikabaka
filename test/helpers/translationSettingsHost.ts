import { settingsModuleHost } from './settingsModuleHost';

export const languages = [
    { value: 'english-us', label: 'English (US)' },
    { value: 'german', label: 'German' },
    { value: 'chinese', label: 'Chinese' },
];

export const gateways = [
    { id: 'invented-gateway', name: 'Invented gateway', type: 'openai' as const, baseUrl: 'http://localhost:1234/v1', builtin: false, hasApiKey: true, customBaseUrl: false },
    { id: 'invented-other', name: 'Invented other', type: 'openai' as const, baseUrl: 'http://localhost:4321/v1', builtin: false, hasApiKey: true, customBaseUrl: false },
];

export function translationHost(api: object = {}, credentials: Record<string, unknown> = {}, profile = 'sentence_bias') {
    const electronAPI = {
        getStoredCredentials: async () => ({ ...credentials }),
        getTranscriptAssemblerProfile: async () => profile,
        setTranscriptAssemblerProfile: async () => ({ success: true }),
        aiConnectionsList: async () => gateways,
        aiConnectionModels: async () => ({ success: true, models: [{ id: 'invented-model', label: 'invented-model' }] }),
        openSettingsSection: () => {},
        testTranscriptTranslation: async () => ({ success: true, sample: 'Invented sample.', translatedText: 'Invented translation.', firstTokenMs: 120, totalMs: 400 }),
        ...api,
    };
    const host = settingsModuleHost('src/components/settings/TranslationSettings.tsx', electronAPI, [
        [['speech-credentials'], { ...credentials }],
        [['transcript-assembler-profile'], profile],
        [['ai-connections'], gateways],
    ]);
    host.render({ languages });
    return host;
}

export function translationTestHost(api: object = {}) {
    const electronAPI = {
        testTranscriptTranslation: async () => ({ success: true, sample: 'Invented sample.', translatedText: 'Invented translation.', firstTokenMs: 120, totalMs: 400 }),
        ...api,
    };
    const host = settingsModuleHost('src/components/settings/TranslationTest.tsx', electronAPI);
    host.render({ provider: 'invented-gateway', model: 'invented-model', prompt: 'Invented prompt.', targetLanguage: 'chinese' });
    return host;
}
