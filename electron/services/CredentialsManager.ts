/**
 * CredentialsManager - Local storage for API keys and service account paths
 * Uses plaintext JSON in the userData directory.
 */

import fs from 'fs';
import { DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT } from '../transcript/translationExecutor';
import { getCredentialsJsonPath } from './configPaths';

export interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
}

export interface CurlProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string; // e.g. "choices[0].message.content"
}

/** OpenAI-compatible Chat Completions (URL + API key; uses /v1/chat/completions and /v1/models). */
export interface OpenAICompatibleProvider {
    id: string;
    name: string;
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
    customProviders?: CustomProvider[];
    curlProviders?: CurlProvider[];
    openaiCompatibleProviders?: OpenAICompatibleProvider[];
    defaultModel?: string;
    // STT Provider settings
    sttProvider?: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox';
    groqSttApiKey?: string;
    groqSttModel?: string;
    openAiSttApiKey?: string;
    deepgramApiKey?: string;
    elevenLabsApiKey?: string;
    azureApiKey?: string;
    azureRegion?: string;
    ibmWatsonApiKey?: string;
    ibmWatsonRegion?: string;
    sonioxApiKey?: string;
    sttLanguage?: string;
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

    public getCustomProviders(): CustomProvider[] {
        return this.credentials.customProviders || [];
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

    public getSttLanguage(): string {
        return this.credentials.sttLanguage || 'english-us';
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
    public getDefaultModel(): string {
        return this.credentials.defaultModel || 'gemini-3.1-flash-lite-preview';
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
    public setDefaultModel(model: string): void {
        this.credentials.defaultModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Default Model set to: ${model}`);
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

    public saveCustomProvider(provider: CustomProvider): void {
        if (!this.credentials.customProviders) {
            this.credentials.customProviders = [];
        }
        // Check if exists, update if so
        const index = this.credentials.customProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.customProviders[index] = provider;
        } else {
            this.credentials.customProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${provider.name}' saved`);
    }

    public deleteCustomProvider(id: string): void {
        if (!this.credentials.customProviders) return;
        this.credentials.customProviders = this.credentials.customProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${id}' deleted`);
    }

    public getCurlProviders(): CurlProvider[] {
        return this.credentials.curlProviders || [];
    }

    public getOpenAICompatibleProviders(): OpenAICompatibleProvider[] {
        return this.credentials.openaiCompatibleProviders || [];
    }

    /** All non-standard LLM backends (legacy custom, curl templates, OpenAI-compatible). */
    public getMergedLlmCustomProviders(): (CustomProvider | CurlProvider | OpenAICompatibleProvider)[] {
        return [
            ...(this.credentials.customProviders || []),
            ...(this.credentials.curlProviders || []),
            ...(this.credentials.openaiCompatibleProviders || []),
        ];
    }

    public saveCurlProvider(provider: CurlProvider): void {
        if (!this.credentials.curlProviders) {
            this.credentials.curlProviders = [];
        }
        const index = this.credentials.curlProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.curlProviders[index] = provider;
        } else {
            this.credentials.curlProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${provider.name}' saved`);
    }

    public deleteCurlProvider(id: string): void {
        if (!this.credentials.curlProviders) return;
        this.credentials.curlProviders = this.credentials.curlProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${id}' deleted`);
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
