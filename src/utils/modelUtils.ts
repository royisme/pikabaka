export const STANDARD_CLOUD_MODELS: Record<string, {
    hasKeyCheck: (creds: any) => boolean;
    ids: string[];
    names: string[];
    descs: string[];
    pmKey: 'geminiPreferredModel' | 'openaiPreferredModel' | 'claudePreferredModel' | 'groqPreferredModel';
}> = {
    gemini: {
        hasKeyCheck: (creds) => !!creds?.hasGeminiKey,
        ids: ['gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview'],
        names: ['Gemini 3.1 Flash', 'Gemini 3.1 Pro'],
        descs: ['Fastest • Multimodal', 'Reasoning • High Quality'],
        pmKey: 'geminiPreferredModel'
    },
    openai: {
        hasKeyCheck: (creds) => !!creds?.hasOpenaiKey,
        ids: ['gpt-5.4'],
        names: ['GPT 5.4'],
        descs: ['OpenAI'],
        pmKey: 'openaiPreferredModel'
    },
    claude: {
        hasKeyCheck: (creds) => !!creds?.hasClaudeKey,
        ids: ['claude-sonnet-4-6'],
        names: ['Sonnet 4.6'],
        descs: ['Anthropic'],
        pmKey: 'claudePreferredModel'
    },
    groq: {
        hasKeyCheck: (creds) => !!creds?.hasGroqKey,
        ids: ['llama-3.3-70b-versatile'],
        names: ['Groq Llama 3.3'],
        descs: ['Ultra Fast'],
        pmKey: 'groqPreferredModel'
    },
};

export const prettifyModelId = (id: string): string => {
    if (!id) return '';
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

export interface OpenAICompatibleProviderSummary {
    id: string;
    name: string;
    preferredModel?: string;
}

export interface ModelDisplayOption {
    id: string;
    name: string;
    description?: string;
}

export const getOpenAICompatibleProviderDisplayName = (provider: OpenAICompatibleProviderSummary): string => {
    const providerName = provider.name?.trim() || 'OpenAI-compatible';
    const preferredModel = provider.preferredModel?.trim();
    return preferredModel ? `${providerName} • ${prettifyModelId(preferredModel)}` : providerName;
};

export const buildOpenAICompatibleModelOption = (provider: OpenAICompatibleProviderSummary): ModelDisplayOption => ({
    id: provider.id,
    name: getOpenAICompatibleProviderDisplayName(provider),
    description: provider.preferredModel?.trim()
        ? `OpenAI-compatible • ${provider.preferredModel.trim()}`
        : 'OpenAI-compatible',
});

export const getFriendlyModelDisplayName = (
    modelId: string,
    providers: OpenAICompatibleProviderSummary[] = []
): string => {
    if (!modelId) return 'AI model';

    const provider = providers.find((p) => p.id === modelId || p.preferredModel === modelId);
    if (provider) return getOpenAICompatibleProviderDisplayName(provider);

    for (const cfg of Object.values(STANDARD_CLOUD_MODELS)) {
        const standardIndex = cfg.ids.indexOf(modelId);
        if (standardIndex !== -1) return cfg.names[standardIndex];
    }

    if (modelId.startsWith('ollama-')) return prettifyModelId(modelId.replace(/^ollama-/, ''));
    return prettifyModelId(modelId);
};
