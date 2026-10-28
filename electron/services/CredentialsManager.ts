/**
 * CredentialsManager - Local storage for API keys and service account paths
 * Encrypts local credentials with the operating system's secure storage when available.
 */

import { BUILTIN_CONNECTIONS, CONNECTION_TYPES, connectionNeedsKey, isBuiltinConnection, normalizeBaseUrl, type Connection, type ConnectionType, type ConnectionView } from './aiConnections';
import { editConnectionHeaders, type HeaderEdit } from './connectionHeaders';
import fs from 'fs';
import { safeStorage } from 'electron';
import { isDeepStrictEqual } from 'node:util';
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
    headers?: Record<string, string>;
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
    /** Search embeddings. An empty connection keeps automatic provider selection. */
    embeddingConnectionId?: string;
    embeddingModel?: string;
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
    /** How answers sound (a manner of speaking, free text). Unset means the default style. */
    answerStyle?: string;
    transcriptTranslationEnabled?: boolean;
    /** Connection id from Models & Agent. An unknown or removed id is not configured. */
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

export type CredentialStorageStatus = { mode: 'encrypted' | 'plaintext' | 'locked'; reason?: string };

export class CredentialStorageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CredentialStorageError';
    }
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private credentials: StoredCredentials = {};
    private scrubbed: boolean = false;
    private storageStatus?: CredentialStorageStatus;
    private saveBlocked?: string;
    private persistedCredentials?: StoredCredentials;

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
        // Unset means on: once a decision model is set, a question puts a card on screen without a click.
        return mode === 'log' || mode === 'off' ? mode : 'on';
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

    public getAnswerStyle(): string {
        return this.credentials.answerStyle || '';
    }

    public setAnswerStyle(style: string): void {
        this.credentials.answerStyle = style.trim().slice(0, 200) || undefined;
        this.saveCredentials();
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
        const result = editConnectionHeaders(custom.headers);
        if ('error' in result) return undefined;
        return {
            id,
            name: custom.name,
            type: custom.type && CONNECTION_TYPES.includes(custom.type) ? custom.type : 'openai',
            baseUrl: normalizeBaseUrl(custom.baseUrl) ?? custom.baseUrl,
            apiKey: custom.apiKey || '',
            ...(result.headers ? { headers: result.headers } : {}),
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
                ...(connection.headers ? { headers: Object.keys(connection.headers).map(name => ({ name, set: true as const })) } : {}),
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
    public saveConnection(input: { id?: string; name?: string; type?: ConnectionType; baseUrl?: string; apiKey?: string; headerEdits?: HeaderEdit[] }): { id: string } | { error: string } {
        const baseUrl = (input.baseUrl ?? '').trim();
        if (baseUrl && !normalizeBaseUrl(baseUrl)) return { error: 'The host must be an http or https address without a query or credentials' };
        if (input.id && isBuiltinConnection(input.id)) {
            if (input.headerEdits !== undefined) return { error: 'Custom headers are not supported for built-in connections' };
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
        const list = this.credentials.openaiCompatibleProviders || [];
        const existing = input.id ? list.find(p => p.id === input.id) : undefined;
        if (input.id && !existing) return { error: 'That connection does not exist' };
        const result = editConnectionHeaders(existing?.headers, input.headerEdits);
        if ('error' in result) return result;
        const entry: OpenAICompatibleProvider = {
            id: existing?.id ?? `conn-${randomUUID().slice(0, 8)}`,
            name,
            type: input.type,
            baseUrl: normalizeBaseUrl(baseUrl)!,
            apiKey: input.apiKey === undefined ? existing?.apiKey ?? '' : input.apiKey.trim(),
            ...(existing?.preferredModel ? { preferredModel: existing.preferredModel } : {}),
            ...(result.headers ? { headers: result.headers } : {}),
        };
        if (existing) list[list.indexOf(existing)] = entry;
        else list.push(entry);
        this.credentials.openaiCompatibleProviders = list;
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

    public getEmbeddingUse(): { connectionId: string; model: string } {
        return { connectionId: this.credentials.embeddingConnectionId || '', model: this.credentials.embeddingModel || '' };
    }

    public setEmbeddingUse(use: { connectionId: string; model: string }): void {
        if (typeof use?.connectionId !== 'string' || typeof use.model !== 'string' || use.connectionId.length > 512 || use.model.length > 512) {
            throw new Error('Invalid embedding model');
        }
        const connectionId = use.connectionId.trim();
        const model = use.model.trim();
        if (connectionId) {
            const connection = this.resolveConnection(connectionId);
            if (!connection) throw new Error('That connection does not exist');
            if (connection.type !== 'openai' && connection.type !== 'gemini') throw new Error('Embeddings require an OpenAI-type or Gemini-type connection; Anthropic has no embeddings API');
            if (!model) throw new Error('Choose an embedding model id');
        }
        this.credentials.embeddingConnectionId = connectionId || undefined;
        this.credentials.embeddingModel = connectionId ? model : undefined;
        this.saveCredentials();
    }

    /** Summaries and the agent inherit quick answers only when their own connection is empty. */
    public resolveModelUse(job: 'chat' | 'summary' | 'agent'): { connection: Connection; model: string } | { error: string } {
        let use = job === 'agent' ? this.getAgentUse() : this.getModelUse(job);
        if (!use.connectionId && job !== 'chat') use = this.getModelUse('chat');
        if (!use.connectionId || !use.model) return { error: 'Choose the quick answers model in Settings, Models & Agent' };
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

    public clearAll(): void {
        this.scrubMemory();
        const jsonPath = getCredentialsJsonPath();
        for (const file of [jsonPath, this.encryptedPath(jsonPath)]) {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        this.saveBlocked = undefined;
        this.storageStatus = undefined;
        console.log('[CredentialsManager] All credentials cleared');
    }

    /**
     * Scrub all API keys from memory to minimize exposure window.
     * Called on app quit and credential clear.
     */
    public scrubMemory(): void {
        this.scrubbed = true;
        this.persistedCredentials = undefined;
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
    // Storage
    // =========================================================================

    public getStorageStatus(): CredentialStorageStatus {
        return { ...(this.storageStatus ?? this.availableStorageStatus()) };
    }

    private availableStorageStatus(): CredentialStorageStatus {
        // Linux's basic_text backend uses a hardcoded password, not an OS secret store.
        try {
            if (safeStorage?.isEncryptionAvailable() &&
                !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
                return { mode: 'encrypted' };
            }
        } catch { /* An unavailable keychain must not prevent loading the plaintext store. */ }
        return { mode: 'plaintext', reason: 'No operating-system secure storage is available on this system.' };
    }

    private encryptedPath(jsonPath: string): string {
        return jsonPath.replace(/\.json$/, '.enc');
    }

    private storageError(error: unknown): CredentialStorageError {
        // Storage errors may quote input (notably JSON errors); never expose credential values.
        let message = error instanceof SyntaxError ? 'The credential file is not valid JSON.'
            : error instanceof Error ? error.message : 'Credential storage failed.';
        const redact = (value: unknown, name = ''): void => {
            if (typeof value === 'string' && value && (/apiKey$/i.test(name) || name === 'headerValue')) {
                message = message.split(value).join('[redacted]');
            } else if (value && typeof value === 'object') {
                Object.entries(value).forEach(([key, entry]) => redact(entry, name === 'headers' ? 'headerValue' : key));
            }
        };
        redact(this.credentials);
        redact(this.persistedCredentials);
        return new CredentialStorageError(message);
    }

    private readCredentials(file: string, encrypted: boolean): StoredCredentials {
        const data = encrypted ? safeStorage.decryptString(fs.readFileSync(file)) : fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(data);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The credential file must contain an object.');
        return parsed;
    }

    private writeCredentials(file: string, encrypted: boolean): void {
        const data = JSON.stringify(this.credentials);
        const tmp = file + '.tmp';
        try {
            fs.writeFileSync(tmp, encrypted ? safeStorage.encryptString(data) : data, { mode: 0o600 });
            // Verify before publishing: an unverified .enc must never shadow the good plaintext.
            if (encrypted && !isDeepStrictEqual(this.readCredentials(tmp, true), JSON.parse(data))) {
                throw new Error('Encrypted credential verification failed.');
            }
            fs.renameSync(tmp, file);
        } finally {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        }
    }

    private saveCredentials(): void {
        try {
            if (this.scrubbed) throw new Error('Credentials cannot be saved after memory has been scrubbed.');
            if (this.saveBlocked) throw new Error(this.saveBlocked);
            const jsonPath = getCredentialsJsonPath();
            const encPath = this.encryptedPath(jsonPath);
            const status = this.availableStorageStatus();
            const encrypted = status.mode === 'encrypted';
            if (!encrypted && fs.existsSync(encPath)) {
                this.saveBlocked = 'Stored credentials cannot be decrypted without operating-system secure storage. Unlock it and restart Pika.';
                this.storageStatus = { mode: 'locked', reason: this.saveBlocked };
                throw new Error(this.saveBlocked);
            }
            const existingFile = fs.existsSync(encPath) ? encPath : jsonPath;
            const newKeys = Object.values(this.credentials).filter(value => value !== undefined && value !== '');
            // Keep the existing empty-store wipe guard, including for encrypted credentials.
            if (newKeys.length === 0 && fs.existsSync(existingFile)) {
                const existing = this.readCredentials(existingFile, existingFile === encPath);
                if (Object.values(existing).some(value => value !== undefined && value !== '')) {
                    throw new Error('Refusing to overwrite stored keys with empty credentials.');
                }
            }
            this.writeCredentials(encrypted ? encPath : jsonPath, encrypted);
            if (encrypted && fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
            this.storageStatus = status;
            this.persistedCredentials = structuredClone(this.credentials);
        } catch (error) {
            const failure = this.storageError(error);
            this.credentials = structuredClone(this.persistedCredentials ?? {});
            throw failure;
        }
    }

    private loadCredentials(): void {
        this.credentials = {};
        this.persistedCredentials = undefined;
        this.saveBlocked = undefined;
        this.scrubbed = false;
        try {
            const jsonPath = getCredentialsJsonPath();
            const encPath = this.encryptedPath(jsonPath);
            this.storageStatus = this.availableStorageStatus();
            if (fs.existsSync(encPath)) {
                try {
                    if (this.storageStatus.mode !== 'encrypted') throw new Error('Secure storage unavailable');
                    this.credentials = this.readCredentials(encPath, true);
                } catch {
                    this.saveBlocked = 'Stored credentials cannot be decrypted. Unlock operating-system secure storage or restore the credential file, then restart Pika.';
                    this.storageStatus = { mode: 'locked', reason: this.saveBlocked };
                    return;
                }
            } else if (fs.existsSync(jsonPath)) {
                this.credentials = this.readCredentials(jsonPath, false);
            }
            this.persistedCredentials = structuredClone(this.credentials);
            if (fs.existsSync(jsonPath) && this.storageStatus.mode === 'encrypted') {
                // After a crash or failed deletion, the verified .enc takes precedence; retry cleanup only if equal.
                if (fs.existsSync(encPath)) {
                    if (!isDeepStrictEqual(this.readCredentials(jsonPath, false), this.credentials)) {
                        throw new Error('Plaintext and encrypted credentials differ; plaintext has been kept.');
                    }
                } else this.writeCredentials(encPath, true);
                fs.unlinkSync(jsonPath);
            }
        } catch (error) {
            this.storageStatus = { mode: 'plaintext', reason: this.storageError(error).message };
            console.error('[CredentialsManager] Failed to load or migrate credentials');
        }
    }
}
