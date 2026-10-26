/**
 * CredentialsManager - Local storage for API keys and service account paths
 * Uses plaintext JSON in the userData directory.
 */

import { BUILTIN_CONNECTIONS, CONNECTION_TYPES, connectionNeedsKey, isBuiltinConnection, normalizeBaseUrl, type Connection, type ConnectionType, type ConnectionView } from './aiConnections';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT } from '../transcript/translationExecutor';
import { getCredentialsJsonPath } from './configPaths';

/** OpenAI-compatible Chat Completions (URL + API key; uses /v1/chat/completions and /v1/models). */
export interface OpenAICompatibleProvider {
    id: string;
    name: string;
    /** The wire protocol. Missing means `openai`, which is what every entry saved before types was. */
    type?: ConnectionType;
    baseUrl: string;
    apiKey: string;
    /** Model id for chat/completions (set via Fetch Models or manually). */
    preferredModel?: string;
}

export interface StoredCredentials {
    geminiApiKey?: string;
    groqApiKey?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
    googleServiceAccountPath?: string;
    openaiCompatibleProviders?: OpenAICompatibleProvider[];
    /** Host overrides of the built-in connections (gemini, openai, claude, groq), by id. */
    connectionBaseUrls?: Record<string, string>;
    /** Quick answers and chat: a connection and an exact model id. Unset means not chosen. */
    chatConnectionId?: string;
    chatModel?: string;
    /** Meeting summaries and titles. Unset means the same as quick answers. */
    summaryConnectionId?: string;
    summaryModel?: string;
    /** The agent's own model: a connection and a model id, chosen apart from the chat model. */
    agentConnectionId?: string;
    agentModel?: string;
    /** Whether that model reads images (unknown for a model Pika has not been told about). */
    agentModelImages?: boolean;
    // STT Provider settings
    sttProvider?: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox';
    groqSttApiKey?: string;
    groqSttModel?: string;
    /** The model chosen for each speech service (deepgram, openai, elevenlabs, soniox); empty means its default. */
    sttModels?: Record<string, string>;
    openAiSttApiKey?: string;
    deepgramApiKey?: string;
    elevenLabsApiKey?: string;
    azureApiKey?: string;
    azureRegion?: string;
    ibmWatsonApiKey?: string;
    ibmWatsonRegion?: string;
    sonioxApiKey?: string;
    sttLanguage?: string;
    sttLanguageUser?: string;
    aiResponseLanguage?: string;
    transcriptTranslationEnabled?: boolean;
    /** `ollama` | `gemini` | `groq` | `openai` | `claude` | OpenAI-compatible provider id from AI Providers */
    transcriptTranslationProvider?: string;
    transcriptTranslationModel?: string;
    transcriptTranslationPrompt?: string;
    transcriptTranslationDisplayMode?: 'original' | 'translated' | 'both';
    /** Recognition language key (RECOGNITION_LANGUAGES) or 'auto' */
    transcriptTranslationSourceLanguage?: string;
    transcriptTranslationTargetLanguage?: string;
    /** The one folder the agent's commands run under (a folder per day and per meeting inside it). */
    agentWorkspaceRoot?: string;
    // Proactive help: the decision model (a System One classifier) behind the gate
    agentGateMode?: 'log' | 'on' | 'off';
    agentGateModel?: string;
    agentGateBaseUrl?: string;
    agentGateApiKey?: string;
    agentGateThreshold?: number;
    agentGateCooldownSeconds?: number;
    // Tavily Search
    tavilyApiKey?: string;
    // Dynamic Model Discovery – preferred models per provider
    geminiPreferredModel?: string;
    groqPreferredModel?: string;
    openaiPreferredModel?: string;
    claudePreferredModel?: string;
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private credentials: StoredCredentials = {};
    private scrubbed: boolean = false;

    private constructor() {
        // Load on construction after app ready
    }

    public static getInstance(): CredentialsManager {
        if (!CredentialsManager.instance) {
            CredentialsManager.instance = new CredentialsManager();
        }
        return CredentialsManager.instance;
    }

    /**
     * Initialize - load credentials from disk
     * Must be called after app.whenReady()
     */
    public init(): void {
        this.loadCredentials();
        console.log('[CredentialsManager] Initialized');
    }

    // =========================================================================
    // Getters
    // =========================================================================

    public getGeminiApiKey(): string | undefined {
        return this.credentials.geminiApiKey;
    }

    public getGroqApiKey(): string | undefined {
        return this.credentials.groqApiKey;
    }

    public getOpenaiApiKey(): string | undefined {
        return this.credentials.openaiApiKey;
    }

    public getClaudeApiKey(): string | undefined {
        return this.credentials.claudeApiKey;
    }

    public getGoogleServiceAccountPath(): string | undefined {
        return this.credentials.googleServiceAccountPath;
    }

    public getSttProvider(): 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' {
        return this.credentials.sttProvider || 'google';
    }

    public getDeepgramApiKey(): string | undefined {
        return this.credentials.deepgramApiKey;
    }

    public getGroqSttApiKey(): string | undefined {
        return this.credentials.groqSttApiKey;
    }

    public getSttModel(provider: string): string {
        if (provider === 'groq') return this.getGroqSttModel();
        return this.credentials.sttModels?.[provider] || '';
    }

    public setSttModel(provider: string, model: string): void {
        if (provider === 'groq') {
            this.setGroqSttModel(model.trim() || 'whisper-large-v3-turbo');
            return;
        }
        const models = { ...(this.credentials.sttModels || {}) };
        if (model.trim()) models[provider] = model.trim();
        else delete models[provider];
        this.credentials.sttModels = Object.keys(models).length ? models : undefined;
        this.saveCredentials();
    }

    public getGroqSttModel(): string {
        return this.credentials.groqSttModel || 'whisper-large-v3-turbo';
    }

    public getOpenAiSttApiKey(): string | undefined {
        return this.credentials.openAiSttApiKey;
    }

    public getElevenLabsApiKey(): string | undefined {
        return this.credentials.elevenLabsApiKey;
    }

    public getAzureApiKey(): string | undefined {
        return this.credentials.azureApiKey;
    }

    public getAzureRegion(): string {
        return this.credentials.azureRegion || 'eastus';
    }

    public getIbmWatsonApiKey(): string | undefined {
        return this.credentials.ibmWatsonApiKey;
    }

    public getIbmWatsonRegion(): string {
        return this.credentials.ibmWatsonRegion || 'us-south';
    }

    public getSonioxApiKey(): string | undefined {
        return this.credentials.sonioxApiKey;
    }

    public getTavilyApiKey(): string | undefined {
        return this.credentials.tavilyApiKey;
    }

    // The language of the other party's audio. Before per-speaker languages this was the only one.
    public getSttLanguage(): string {
        return this.credentials.sttLanguage || 'english-us';
    }

    // The language the user speaks; follows the other party's language until set on its own.
    public getSttLanguageUser(): string {
        return this.credentials.sttLanguageUser || this.getSttLanguage();
    }

    public getAgentWorkspaceRoot(): string {
        return this.credentials.agentWorkspaceRoot || '';
    }

    public setAgentWorkspaceRoot(root: string): void {
        this.credentials.agentWorkspaceRoot = root.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Agent workspace root updated');
    }

    public getAgentGateMode(): 'log' | 'on' | 'off' {
        const mode = this.credentials.agentGateMode;
        return mode === 'on' || mode === 'off' ? mode : 'log';
    }

    public getAgentGateModel(): string {
        return this.credentials.agentGateModel || '';
    }

    public getAgentGateBaseUrl(): string {
        return this.credentials.agentGateBaseUrl || '';
    }

    public getAgentGateApiKey(): string {
        return this.credentials.agentGateApiKey || '';
    }

    public getAgentGateThreshold(): number {
        const value = this.credentials.agentGateThreshold;
        return typeof value === 'number' && value >= 0 && value <= 1 ? value : 0.7;
    }

    public getAgentGateCooldownSeconds(): number {
        const value = this.credentials.agentGateCooldownSeconds;
        return typeof value === 'number' && value >= 0 ? value : 120;
    }

    public setAgentGateSettings(settings: {
        mode?: 'log' | 'on' | 'off';
        model?: string;
        baseUrl?: string;
        apiKey?: string;
        threshold?: number;
        cooldownSeconds?: number;
    }): void {
        if (settings.mode !== undefined) this.credentials.agentGateMode = settings.mode;
        if (settings.model !== undefined) this.credentials.agentGateModel = settings.model.trim() || undefined;
        if (settings.baseUrl !== undefined) this.credentials.agentGateBaseUrl = settings.baseUrl.trim() || undefined;
        if (settings.apiKey !== undefined) this.credentials.agentGateApiKey = settings.apiKey.trim() || undefined;
        if (settings.threshold !== undefined) this.credentials.agentGateThreshold = settings.threshold;
        if (settings.cooldownSeconds !== undefined) this.credentials.agentGateCooldownSeconds = settings.cooldownSeconds;
        this.saveCredentials();
        console.log('[CredentialsManager] Proactive help settings updated');
    }

    public getAiResponseLanguage(): string {
        return this.credentials.aiResponseLanguage || 'English';
    }
    public getTranscriptTranslationEnabled(): boolean {
        return this.credentials.transcriptTranslationEnabled || false;
    }

    public getTranscriptTranslationProvider(): string {
        return this.credentials.transcriptTranslationProvider || 'ollama';
    }

    public getTranscriptTranslationModel(): string {
        return this.credentials.transcriptTranslationModel || '';
    }

    public getTranscriptTranslationPrompt(): string {
        return this.credentials.transcriptTranslationPrompt || DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT;
    }

    public getTranscriptTranslationDisplayMode(): 'original' | 'translated' | 'both' {
        return this.credentials.transcriptTranslationDisplayMode || 'original';
    }

    public getTranscriptTranslationSourceLanguage(): string {
        return this.credentials.transcriptTranslationSourceLanguage ?? 'auto';
    }

    public getTranscriptTranslationTargetLanguage(): string {
        return this.credentials.transcriptTranslationTargetLanguage ?? 'chinese';
    }

    public setTranscriptTranslationSourceLanguage(key: string): void {
        this.credentials.transcriptTranslationSourceLanguage = key;
        this.saveCredentials();
    }

    public setTranscriptTranslationTargetLanguage(key: string): void {
        this.credentials.transcriptTranslationTargetLanguage = key;
        this.saveCredentials();
    }

    public getAllCredentials(): StoredCredentials {
        return { ...this.credentials };
    }

    // =========================================================================
    // Setters (auto-save)
    // =========================================================================

    public setGeminiApiKey(key: string): void {
        this.credentials.geminiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Gemini API Key updated');
    }

    public setGroqApiKey(key: string): void {
        this.credentials.groqApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq API Key updated');
    }

    public setOpenaiApiKey(key: string): void {
        this.credentials.openaiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI API Key updated');
    }

    public setClaudeApiKey(key: string): void {
        this.credentials.claudeApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Claude API Key updated');
    }

    public setGoogleServiceAccountPath(filePath: string): void {
        this.credentials.googleServiceAccountPath = filePath;
        this.saveCredentials();
        console.log('[CredentialsManager] Google Service Account path updated');
    }

    public setSttProvider(provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox'): void {
        this.credentials.sttProvider = provider;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Provider set to: ${provider}`);
    }

    public setDeepgramApiKey(key: string): void {
        this.credentials.deepgramApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Deepgram API Key updated');
    }

    public setGroqSttApiKey(key: string): void {
        this.credentials.groqSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq STT API Key updated');
    }

    public setOpenAiSttApiKey(key: string): void {
        this.credentials.openAiSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI STT API Key updated');
    }

    public setGroqSttModel(model: string): void {
        this.credentials.groqSttModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq STT Model set to: ${model}`);
    }

    public setElevenLabsApiKey(key: string): void {
        this.credentials.elevenLabsApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] ElevenLabs API Key updated');
    }

    public setAzureApiKey(key: string): void {
        this.credentials.azureApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Azure API Key updated');
    }

    public setAzureRegion(region: string): void {
        this.credentials.azureRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] Azure Region set to: ${region}`);
    }

    public setIbmWatsonApiKey(key: string): void {
        this.credentials.ibmWatsonApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] IBM Watson API Key updated');
    }

    public setIbmWatsonRegion(region: string): void {
        this.credentials.ibmWatsonRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] IBM Watson Region set to: ${region}`);
    }

    public setSonioxApiKey(key: string): void {
        this.credentials.sonioxApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Soniox API Key updated');
    }

    public setTavilyApiKey(key: string): void {
        // Store undefined (not empty string) when removing, so hasKey() checks stay consistent
        this.credentials.tavilyApiKey = key.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Tavily API Key updated');
    }

    public setSttLanguage(language: string): void {
        this.credentials.sttLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Language set to: ${language}`);
    }

    public setSttLanguageUser(language: string): void {
        this.credentials.sttLanguageUser = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Language (user) set to: ${language}`);
    }

    public setAiResponseLanguage(language: string): void {
        this.credentials.aiResponseLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] AI Response Language set to: ${language}`);
    }

    public setTranscriptTranslationEnabled(enabled: boolean): void {
        this.credentials.transcriptTranslationEnabled = enabled;
        this.saveCredentials();
        console.log(`[CredentialsManager] Transcript Translation Enabled set to: ${enabled}`);
    }

    public setTranscriptTranslationProvider(provider: string): void {
        this.credentials.transcriptTranslationProvider = provider;
        this.saveCredentials();
        console.log(`[CredentialsManager] Transcript Translation Provider set to: ${provider}`);
    }

    public setTranscriptTranslationModel(model: string): void {
        this.credentials.transcriptTranslationModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Transcript Translation Model set to: ${model}`);
    }

    public setTranscriptTranslationPrompt(prompt: string): void {
        this.credentials.transcriptTranslationPrompt = prompt;
        this.saveCredentials();
        console.log('[CredentialsManager] Transcript Translation Prompt updated');
    }

    public setTranscriptTranslationDisplayMode(mode: 'original' | 'translated' | 'both'): void {
        this.credentials.transcriptTranslationDisplayMode = mode;
        this.saveCredentials();
        console.log(`[CredentialsManager] Transcript Translation Display Mode set to: ${mode}`);
    }
    public getPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude'): string | undefined {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.credentials[key] as string | undefined;
    }

    public setPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string): void {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        (this.credentials as any)[key] = modelId;
        this.saveCredentials();
        console.log(`[CredentialsManager] ${provider} preferred model set to: ${modelId}`);
    }

    // ---- Connections: where a model is reached (type, host, key). See aiConnections.ts ----

    private builtinKey(id: string): string {
        switch (id) {
            case 'gemini': return this.credentials.geminiApiKey || '';
            case 'groq': return this.credentials.groqApiKey || '';
            case 'openai': return this.credentials.openaiApiKey || '';
            case 'claude': return this.credentials.claudeApiKey || '';
            default: return '';
        }
    }

    /** The connection with its key (main process only), or undefined for an unknown id. */
    public resolveConnection(id: string): Connection | undefined {
        const builtin = BUILTIN_CONNECTIONS.find(c => c.id === id);
        if (builtin) {
            const override = this.credentials.connectionBaseUrls?.[id];
            return {
                id,
                name: builtin.name,
                type: builtin.type,
                baseUrl: normalizeBaseUrl(override) ?? builtin.defaultBaseUrl,
                apiKey: this.builtinKey(id),
                builtin: true,
            };
        }
        const custom = this.getOpenAICompatibleProviders().find(p => p.id === id);
        if (!custom) return undefined;
        return {
            id,
            name: custom.name,
            type: custom.type && CONNECTION_TYPES.includes(custom.type) ? custom.type : 'openai',
            baseUrl: normalizeBaseUrl(custom.baseUrl) ?? custom.baseUrl,
            apiKey: custom.apiKey || '',
            builtin: false,
        };
    }

    /** Every connection, built-in ones first, for the settings screen: no key leaves the main process. */
    public listConnections(): ConnectionView[] {
        const ids = [...BUILTIN_CONNECTIONS.map(c => c.id as string), ...this.getOpenAICompatibleProviders().map(p => p.id)];
        return ids.flatMap(id => {
            const connection = this.resolveConnection(id);
            if (!connection) return [];
            const builtin = BUILTIN_CONNECTIONS.find(c => c.id === id);
            return [{
                id,
                name: connection.name,
                type: connection.type,
                baseUrl: connection.baseUrl,
                customBaseUrl: !!builtin && connection.baseUrl !== builtin.defaultBaseUrl,
                hasApiKey: connection.apiKey !== '',
                builtin: !!builtin,
            }];
        });
    }

    /** Whether the connection can be used as it is: a key where one is needed. */
    public isConnectionReady(id: string): boolean {
        const connection = this.resolveConnection(id);
        return !!connection && (connection.apiKey !== '' || !connectionNeedsKey(connection.baseUrl));
    }

    /**
     * Saves a connection. A built-in one takes a key and a host override (empty means the default);
     * a custom one takes a name, a type and a host. A missing `apiKey` leaves the stored key as it is.
     * Returns the id, or the reason it was refused.
     */
    public saveConnection(input: { id?: string; name?: string; type?: ConnectionType; baseUrl?: string; apiKey?: string }): { id: string } | { error: string } {
        const baseUrl = (input.baseUrl ?? '').trim();
        if (baseUrl && !normalizeBaseUrl(baseUrl)) return { error: 'The host must be an http or https address without a query or credentials' };
        if (input.id && isBuiltinConnection(input.id)) {
            const id = input.id;
            const overrides = { ...(this.credentials.connectionBaseUrls || {}) };
            if (baseUrl) overrides[id] = normalizeBaseUrl(baseUrl)!;
            else delete overrides[id];
            this.credentials.connectionBaseUrls = Object.keys(overrides).length ? overrides : undefined;
            if (input.apiKey !== undefined) {
                const key = input.apiKey.trim();
                if (id === 'gemini') this.credentials.geminiApiKey = key || undefined;
                else if (id === 'groq') this.credentials.groqApiKey = key || undefined;
                else if (id === 'openai') this.credentials.openaiApiKey = key || undefined;
                else if (id === 'claude') this.credentials.claudeApiKey = key || undefined;
            }
            this.saveCredentials();
            return { id };
        }
        const name = (input.name ?? '').trim();
        if (!name || name.length > 80) return { error: 'Give the connection a name' };
        if (!input.type || !CONNECTION_TYPES.includes(input.type)) return { error: 'Choose a type' };
        if (!baseUrl) return { error: 'A custom connection needs a host' };
        const list = this.credentials.openaiCompatibleProviders || (this.credentials.openaiCompatibleProviders = []);
        const existing = input.id ? list.find(p => p.id === input.id) : undefined;
        if (input.id && !existing) return { error: 'That connection does not exist' };
        const entry: OpenAICompatibleProvider = {
            id: existing?.id ?? `conn-${randomUUID().slice(0, 8)}`,
            name,
            type: input.type,
            baseUrl: normalizeBaseUrl(baseUrl)!,
            apiKey: input.apiKey === undefined ? existing?.apiKey ?? '' : input.apiKey.trim(),
            ...(existing?.preferredModel ? { preferredModel: existing.preferredModel } : {}),
        };
        if (existing) list[list.indexOf(existing)] = entry;
        else list.push(entry);
        this.saveCredentials();
        return { id: entry.id };
    }

    public deleteConnection(id: string): boolean {
        if (isBuiltinConnection(id) || !this.credentials.openaiCompatibleProviders) return false;
        const before = this.credentials.openaiCompatibleProviders.length;
        this.credentials.openaiCompatibleProviders = this.credentials.openaiCompatibleProviders.filter(p => p.id !== id);
        if (this.credentials.agentConnectionId === id) this.credentials.agentConnectionId = undefined;
        this.saveCredentials();
        return this.credentials.openaiCompatibleProviders.length !== before;
    }

    public getModelUse(job: 'chat' | 'summary'): { connectionId: string; model: string } {
        return job === 'chat'
            ? { connectionId: this.credentials.chatConnectionId || '', model: this.credentials.chatModel || '' }
            : { connectionId: this.credentials.summaryConnectionId || '', model: this.credentials.summaryModel || '' };
    }

    public setModelUse(job: 'chat' | 'summary', use: { connectionId: string; model: string }): void {
        const connectionId = use.connectionId.trim() || undefined;
        const model = use.model.trim() || undefined;
        if (job === 'chat') {
            this.credentials.chatConnectionId = connectionId;
            this.credentials.chatModel = model;
        } else {
            this.credentials.summaryConnectionId = connectionId;
            this.credentials.summaryModel = model;
        }
        this.saveCredentials();
    }

    /** Summaries and the agent inherit quick answers only when their own connection is empty. */
    public resolveModelUse(job: 'chat' | 'summary' | 'agent'): { connection: Connection; model: string } | { error: string } {
        let use = job === 'agent' ? this.getAgentUse() : this.getModelUse(job);
        if (!use.connectionId && job !== 'chat') use = this.getModelUse('chat');
        if (!use.connectionId || !use.model) return { error: 'Choose the quick answers model in Settings, AI Providers' };
        const connection = this.resolveConnection(use.connectionId);
        if (!connection) return { error: 'The connection chosen for this job no longer exists' };
        if (!connection.apiKey && connectionNeedsKey(connection.baseUrl)) return { error: `No API key is saved for ${connection.name}` };
        return { connection, model: use.model };
    }

    public getAgentUse(): { connectionId: string; model: string; supportsImages: boolean } {
        return {
            connectionId: this.credentials.agentConnectionId || '',
            model: this.credentials.agentModel || '',
            supportsImages: this.credentials.agentModelImages === true,
        };
    }

    public setAgentUse(use: { connectionId: string; model: string; supportsImages?: boolean }): void {
        this.credentials.agentConnectionId = use.connectionId.trim() || undefined;
        this.credentials.agentModel = use.model.trim() || undefined;
        this.credentials.agentModelImages = use.supportsImages === true ? true : undefined;
        this.saveCredentials();
    }

    public getOpenAICompatibleProviders(): OpenAICompatibleProvider[] {
        return (this.credentials.openaiCompatibleProviders || []).filter(p => p.type === undefined || CONNECTION_TYPES.includes(p.type));
    }

    public saveOpenAICompatibleProvider(provider: OpenAICompatibleProvider): void {
        if (!this.credentials.openaiCompatibleProviders) {
            this.credentials.openaiCompatibleProviders = [];
        }
        const index = this.credentials.openaiCompatibleProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.openaiCompatibleProviders[index] = provider;
        } else {
            this.credentials.openaiCompatibleProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] OpenAI-compatible provider '${provider.name}' saved`);
    }

    public deleteOpenAICompatibleProvider(id: string): void {
        if (!this.credentials.openaiCompatibleProviders) return;
        this.credentials.openaiCompatibleProviders = this.credentials.openaiCompatibleProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] OpenAI-compatible provider '${id}' deleted`);
    }

    public clearAll(): void {
        this.scrubMemory();
        const jsonPath = getCredentialsJsonPath();
        if (fs.existsSync(jsonPath)) {
            fs.unlinkSync(jsonPath);
        }
        console.log('[CredentialsManager] All credentials cleared');
    }

    /**
     * Scrub all API keys from memory to minimize exposure window.
     * Called on app quit and credential clear.
     */
    public scrubMemory(): void {
        this.scrubbed = true;
        for (const key of Object.keys(this.credentials) as (keyof StoredCredentials)[]) {
            const val = this.credentials[key];
            if (typeof val === 'string') {
                (this.credentials as any)[key] = '';
            }
        }
        this.credentials = {};
        console.log('[CredentialsManager] Memory scrubbed');
    }

    // =========================================================================
    // Storage (Plaintext JSON)
    // =========================================================================

    private saveCredentials(): void {
        if (this.scrubbed) {
            console.warn('[CredentialsManager] saveCredentials BLOCKED - memory already scrubbed (app is quitting)');
            return;
        }
        try {
            const jsonPath = getCredentialsJsonPath();

            // Safety: never overwrite a file that has more keys than what we're about to write.
            // This guards against accidental wipe from race conditions or uninitialised state.
            const newKeys = Object.keys(this.credentials).filter(
                k => (this.credentials as any)[k] !== undefined && (this.credentials as any)[k] !== ''
            );
            if (newKeys.length === 0 && fs.existsSync(jsonPath)) {
                try {
                    const existing = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                    const existingKeys = Object.keys(existing).filter(
                        k => existing[k] !== undefined && existing[k] !== ''
                    );
                    if (existingKeys.length > 0) {
                        console.warn(`[CredentialsManager] saveCredentials BLOCKED - refusing to overwrite ${existingKeys.length} keys with empty credentials`);
                        return;
                    }
                } catch { /* file unreadable, OK to overwrite */ }
            }

            const tmp = jsonPath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.credentials, null, 2));
            fs.renameSync(tmp, jsonPath);
        } catch (error) {
            console.error('[CredentialsManager] Failed to save credentials:', error);
        }
    }

    private loadCredentials(): void {
        try {
            const jsonPath = getCredentialsJsonPath();
            console.log(`[CredentialsManager] Loading from: ${jsonPath}`);
            console.log(`[CredentialsManager] File exists: ${fs.existsSync(jsonPath)}`);
            if (fs.existsSync(jsonPath)) {
                const data = fs.readFileSync(jsonPath, 'utf-8');
                const parsed = JSON.parse(data);
                if (typeof parsed === 'object' && parsed !== null) {
                    this.credentials = parsed;
                    const keys = Object.keys(parsed).filter(k => parsed[k] !== undefined && parsed[k] !== '');
                    console.log(`[CredentialsManager] Loaded ${keys.length} keys from ${jsonPath}: ${keys.join(', ')}`);
                    return;
                }
            }

            console.log('[CredentialsManager] No stored credentials found, starting fresh');
        } catch (error) {
            console.error('[CredentialsManager] Failed to load credentials:', error);
            this.credentials = {};
        }
    }
}
