import { GoogleGenAI, ThinkingLevel } from "@google/genai"
import Groq from "groq-sdk"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import sharp from "sharp"
import { ModelVersionManager, ModelFamily, TextModelFamily } from '../services/ModelVersionManager'
import {
  HARD_SYSTEM_PROMPT, GROQ_SYSTEM_PROMPT, OPENAI_SYSTEM_PROMPT, CLAUDE_SYSTEM_PROMPT,
  UNIVERSAL_SYSTEM_PROMPT, UNIVERSAL_ANSWER_PROMPT, UNIVERSAL_WHAT_TO_ANSWER_PROMPT,
  UNIVERSAL_RECAP_PROMPT, UNIVERSAL_FOLLOWUP_PROMPT, UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT, UNIVERSAL_ASSIST_PROMPT,
  CUSTOM_SYSTEM_PROMPT, CUSTOM_ANSWER_PROMPT, CUSTOM_WHAT_TO_ANSWER_PROMPT,
  CUSTOM_RECAP_PROMPT, CUSTOM_FOLLOWUP_PROMPT, CUSTOM_FOLLOW_UP_QUESTIONS_PROMPT, CUSTOM_ASSIST_PROMPT
} from "../llm/prompts"
import { OpenAICompatibleProvider } from '../services/CredentialsManager';
import { normalizeOpenAICompatibleBaseUrl } from '../utils/modelFetcher';
import { openAiRoot, BUILTIN_CONNECTIONS, type Connection } from '../services/aiConnections';
import { CredentialsManager } from '../services/CredentialsManager';
import { createProviderRateLimiters, RateLimiter } from '../services/RateLimiter';
import { buildTranscriptTranslationPrompt } from '../transcript/translationExecutor';
import { classifyTranslationError } from '../transcript/translationError';
import { answerLanguageInstruction } from '../llm/answerLanguage';
import { speakingStyleInstruction } from '../llm/speakingStyle';
import { anthropicDeltas, geminiDeltas, ollamaDeltas, openAIDeltas, streamText } from '../transcript/translationStream';

type ThinkingSetting = { thinkingConfig: { thinkingLevel?: ThinkingLevel; thinkingBudget?: number } };

/** How many thinking settings the host has refused for a model id (typed by the user, so it may not take them). */
const refusedThinkingSettings = new Map<string, number>();

/**
 * Translation is a rewrite, not a puzzle: a Gemini model that thinks first answers 5 to 8 seconds late.
 * Gemini 3 and newer take a thinking level, tried from the lowest (MINIMAL, then LOW; Pro starts at LOW);
 * 2.5 Flash takes a zero budget. Each setting the host answers 400 to is skipped for that model next time,
 * and once none is left the request goes out as it was. Any other model id is left as it is.
 */
function thinkingSettings(model: string): ThinkingSetting[] {
  const id = model.toLowerCase();
  if (/gemini-(?:[3-9]|\d{2})/.test(id)) {
    const levels = id.includes('pro') ? [ThinkingLevel.LOW] : [ThinkingLevel.MINIMAL, ThinkingLevel.LOW];
    return levels.map((thinkingLevel) => ({ thinkingConfig: { thinkingLevel } }));
  }
  if (id.includes('gemini-2.5-flash')) return [{ thinkingConfig: { thinkingBudget: 0 } }];
  return [];
}

function translationThinking(model: string): ThinkingSetting | undefined {
  return thinkingSettings(model)[refusedThinkingSettings.get(model) ?? 0];
}

interface OllamaResponse {
  response: string
  done: boolean
}

export type TranscriptTranslationProvider =
  | 'ollama'
  | 'gemini'
  | 'groq'
  | 'openai'
  | 'claude'
  | 'openai-compatible'
  | 'connection';

export interface TranscriptTranslationRequest {
  provider: TranscriptTranslationProvider;
  model: string;
  prompt: string;
  sourceText: string;
  ollamaUrl?: string;
  /** RECOGNITION_LANGUAGES key or 'auto' */
  sourceLanguageKey?: string;
  /** RECOGNITION_LANGUAGES key */
  targetLanguageKey?: string;
  /** Per-segment language detected by STT provider (overrides sourceLanguageKey as a hint when present). */
  detectedLanguageKey?: string;
  /** When provider is `openai-compatible`, URL + key from AI Providers (saved endpoint). */
  openAICompatible?: { baseUrl: string; apiKey: string };
  /** When provider is `connection`: the connection chosen for translation (its type decides how it is called). */
  connection?: { type: Connection['type']; baseUrl: string; apiKey: string };
  /** Previous translated turns, oldest first, for terminology/pronoun consistency. */
  context?: Array<{ source: string; translation: string }>;
}

// Model constant for Gemini 3 Flash
const GEMINI_FLASH_MODEL = "gemini-3.1-flash-lite-preview"
const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview"
const GROQ_MODEL = "llama-3.3-70b-versatile"
const OPENAI_MODEL = "gpt-5.4"
const CLAUDE_MODEL = "claude-sonnet-4-6"
const MAX_OUTPUT_TOKENS = 65536
const CLAUDE_MAX_OUTPUT_TOKENS = 64000

// Simple prompt for image analysis (not interview copilot - kept separate)
const IMAGE_ANALYSIS_PROMPT = `Analyze concisely. Be direct. No markdown formatting. Return plain text only.`

export class LLMHelper {
  private client: GoogleGenAI | null = null
  private groqClient: Groq | null = null
  private openaiClient: OpenAI | null = null
  private claudeClient: Anthropic | null = null
  private apiKey: string | null = null
  private groqApiKey: string | null = null
  private openaiApiKey: string | null = null
  private claudeApiKey: string | null = null
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"
  private ollamaStartedByApp: boolean = false;
  private geminiModel: string = GEMINI_FLASH_MODEL
  private activeOpenAICompatibleProvider: OpenAICompatibleProvider | null = null;
  private knowledgeOrchestrator: any = null;
  private aiResponseLanguage: string = 'English';
  private sttLanguage: string = 'english-us';

  // Rate limiters per provider to prevent 429 errors on free tiers
  private rateLimiters: ReturnType<typeof createProviderRateLimiters>;

  // Self-improving model version manager for vision analysis
  private modelVersionManager: ModelVersionManager;

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string, groqApiKey?: string, openaiApiKey?: string, claudeApiKey?: string) {
    this.useOllama = useOllama

    // Initialize rate limiters
    this.rateLimiters = createProviderRateLimiters();

    // Initialize model version manager
    this.modelVersionManager = new ModelVersionManager();

    // Initialize Groq client if API key provided
    if (groqApiKey) {
      this.groqApiKey = groqApiKey
      this.groqClient = this.makeGroqClient(groqApiKey)
      console.log(`[LLMHelper] Groq client initialized with model: ${GROQ_MODEL}`)
    }

    // Initialize OpenAI client if API key provided
    if (openaiApiKey) {
      this.openaiApiKey = openaiApiKey
      this.openaiClient = this.makeOpenAiClient(openaiApiKey)
      console.log(`[LLMHelper] OpenAI client initialized with model: ${OPENAI_MODEL}`)
    }

    // Initialize Claude client if API key provided
    if (claudeApiKey) {
      this.claudeApiKey = claudeApiKey
      this.claudeClient = this.makeClaudeClient(claudeApiKey)
      console.log(`[LLMHelper] Claude client initialized with model: ${CLAUDE_MODEL}`)
    }

    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      // console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)

      // Auto-detect and use first available model if specified model doesn't exist
      this.initializeOllamaModel()
    } else if (apiKey) {
      this.apiKey = apiKey
      // Initialize with v1alpha API version for Gemini 3 support
      this.client = this.makeGeminiClient(apiKey)
      // console.log(`[LLMHelper] Using Google Gemini 3 with model: ${this.geminiModel} (v1alpha API)`)
    } else {
      console.warn("[LLMHelper] No API key provided. Client will be uninitialized until key is set.")
    }
  }

  /** The host the user set for a built-in connection (Settings, AI), or undefined for its default. */
  private hostOverride(id: 'gemini' | 'openai' | 'claude' | 'groq'): string | undefined {
    try {
      const connection = CredentialsManager.getInstance().resolveConnection(id);
      const builtin = BUILTIN_CONNECTIONS.find(candidate => candidate.id === id);
      return connection && builtin && connection.baseUrl !== builtin.defaultBaseUrl ? connection.baseUrl : undefined;
    } catch {
      return undefined;
    }
  }

  private makeGeminiClient(apiKey: string): GoogleGenAI {
    const host = this.hostOverride('gemini');
    // Initialize with v1alpha API version for Gemini 3 support
    return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha", ...(host ? { baseUrl: host } : {}) } });
  }

  private makeGroqClient(apiKey: string): Groq {
    const host = this.hostOverride('groq');
    // The Groq SDK adds /openai/v1 itself; the connection stores the OpenAI-compatible root.
    return new Groq({ apiKey, ...(host ? { baseURL: host.replace(/\/openai\/v1$/, '') } : {}) });
  }

  private makeOpenAiClient(apiKey: string): OpenAI {
    const host = this.hostOverride('openai');
    return new OpenAI({ apiKey, ...(host ? { baseURL: openAiRoot(host) } : {}) });
  }

  private makeClaudeClient(apiKey: string): Anthropic {
    const host = this.hostOverride('claude');
    return new Anthropic({ apiKey, ...(host ? { baseURL: host } : {}) });
  }

  public setApiKey(apiKey: string) {
    this.apiKey = apiKey;
    this.client = this.makeGeminiClient(apiKey)
    console.log("[LLMHelper] Gemini API Key updated.");
  }

  public setGroqApiKey(apiKey: string) {
    this.groqApiKey = apiKey;
    this.groqClient = this.makeGroqClient(apiKey);
    console.log("[LLMHelper] Groq API Key updated.");
  }

  public setOpenaiApiKey(apiKey: string) {
    this.openaiApiKey = apiKey;
    this.openaiClient = this.makeOpenAiClient(apiKey);
    console.log("[LLMHelper] OpenAI API Key updated.");
  }

  public setClaudeApiKey(apiKey: string) {
    this.claudeApiKey = apiKey;
    this.claudeClient = this.makeClaudeClient(apiKey);
    console.log("[LLMHelper] Claude API Key updated.");
  }

  /**
   * Initialize the self-improving model version manager.
   * Should be called after all API keys are configured.
   * Triggers initial model discovery and starts background scheduler.
   */
  public async initModelVersionManager(): Promise<void> {
    this.modelVersionManager.setApiKeys({
      openai: this.openaiApiKey,
      gemini: this.apiKey,
      claude: this.claudeApiKey,
      groq: this.groqApiKey,
    });
    await this.modelVersionManager.initialize();
    console.log(this.modelVersionManager.getSummary());
  }

  /**
   * Scrub all API keys from memory to minimize exposure window.
   * Called on app quit.
   */
  public scrubKeys(): void {
    this.apiKey = null;
    this.groqApiKey = null;
    this.openaiApiKey = null;
    this.claudeApiKey = null;
    this.client = null;
    this.groqClient = null;
    this.openaiClient = null;
    this.claudeClient = null;
    // Destroy rate limiters
    if (this.rateLimiters) {
      Object.values(this.rateLimiters).forEach(rl => rl.destroy());
    }
    // Stop model version manager background scheduler
    this.modelVersionManager.stopScheduler();
    console.log('[LLMHelper] Keys scrubbed from memory');
  }

  public getAiResponseLanguage(): string {
    return this.aiResponseLanguage;
  }

  // --- Model Type Checkers ---
  private isOpenAiModel(modelId: string): boolean {
    return modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-") || modelId.includes("openai");
  }

  private isClaudeModel(modelId: string): boolean {
    return modelId.startsWith("claude-");
  }

  private isGroqModel(modelId: string): boolean {
    return modelId.startsWith("llama-") || modelId.startsWith("mixtral-") || modelId.startsWith("gemma-");
  }

  private isGeminiModel(modelId: string): boolean {
    return modelId.startsWith("gemini-") || modelId.startsWith("models/");
  }
  // ---------------------------

  private currentModelId: string = GEMINI_FLASH_MODEL;

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOllama(prompt: string, imagePath?: string): Promise<string> {
    try {
      // Build optional images array — Ollama multimodal API accepts raw base64 strings (no data-URL prefix)
      let images: string[] | undefined;
      if (imagePath) {
        try {
          const imageData = await fs.promises.readFile(imagePath);
          images = [imageData.toString("base64")];
        } catch (e) {
          console.warn("[LLMHelper] callOllama: failed to read image, sending text only:", e);
        }
      }

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          ...(images ? { images } : {}),
          options: {
            temperature: 0.7,
            top_p: 0.9,
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error: any) {
      // console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async callOllamaWithConfig(url: string, model: string, prompt: string): Promise<string> {
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
          top_p: 0.9,
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data: OllamaResponse = await response.json();
    return data.response || "";
  }

  /** The SDK client for a translation connection: its type and host decide where the request goes. */
  private connectionClients(c: NonNullable<TranscriptTranslationRequest['connection']>) {
    const key = c.apiKey.trim();
    return {
      openai: () => new OpenAI({ apiKey: key || 'none', baseURL: openAiRoot(c.baseUrl) }),
      anthropic: () => new Anthropic({ apiKey: key, baseURL: c.baseUrl }),
      gemini: () => new GoogleGenAI({
        apiKey: key,
        httpOptions: { apiVersion: "v1alpha", ...(c.baseUrl.includes('generativelanguage.googleapis.com') ? {} : { baseUrl: c.baseUrl }) },
      }),
    };
  }

  private async translateViaConnection(
    c: NonNullable<TranscriptTranslationRequest['connection']>,
    model: string,
    prompt: string
  ): Promise<string> {
    const clients = this.connectionClients(c);
    if (c.type === 'anthropic') {
      const response = await clients.anthropic().messages.create({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      });
      const textBlock = response.content.find(block => block.type === 'text');
      return textBlock && textBlock.type === 'text' ? textBlock.text : "";
    }
    if (c.type === 'gemini') {
      const response = await clients.gemini().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: translationThinking(model),
      });
      return response.text || "";
    }
    const response = await clients.openai().chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      ...(c.baseUrl.includes('api.openai.com') ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }),
      stream: false,
    });
    return response.choices[0]?.message?.content || "";
  }

  /** Quick answers on any connection: its type decides the protocol, its host and key the destination. */
  private async * streamViaConnectionChat(
    c: Connection,
    model: string,
    systemPrompt: string,
    userContent: string | undefined,
    imagePaths?: string[],
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    signal?.throwIfAborted();
    const images = await Promise.all((imagePaths ?? []).map(async p => (await fs.promises.readFile(p)).toString('base64')));
    const clients = this.connectionClients(c);
    if (c.type === 'anthropic') {
      const stream = await clients.anthropic().messages.stream({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [...history, ...(userContent === undefined ? [] : [{
          role: "user" as const,
          content: [
            ...images.map(data => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data } })),
            { type: "text" as const, text: userContent },
          ],
        }])],
      }, { signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
      }
      return;
    }
    if (c.type === 'gemini') {
      const stream = await clients.gemini().models.generateContentStream({
        model,
        config: { systemInstruction: systemPrompt, abortSignal: signal },
        contents: [
          ...history.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
          ...(userContent === undefined ? [] : [{ role: "user", parts: [{ text: userContent }, ...images.map(data => ({ inlineData: { mimeType: "image/png", data } }))] }]),
        ],
      });
      for await (const chunk of stream) {
        if (chunk.text) yield chunk.text;
      }
      return;
    }
    const stream = await clients.openai().chat.completions.create({
      model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        ...(userContent === undefined ? [] : [{
          role: "user" as const,
          content: images.length
            ? [{ type: "text" as const, text: userContent }, ...images.map(data => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${data}` } }))]
            : userContent,
        }]),
      ],
      ...(c.baseUrl.includes('api.openai.com') ? { max_completion_tokens: 8192 } : { max_tokens: 8192 }),
    }, { signal });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  private async generateViaConnectionChat({ systemPrompt, userContent, imagePaths }: {
    systemPrompt: string;
    userContent: string;
    imagePaths?: string[];
  }): Promise<string> {
    const use = CredentialsManager.getInstance().resolveModelUse('chat');
    if ('error' in use) throw new Error(use.error);
    let text = '';
    for await (const part of this.streamViaConnectionChat(use.connection, use.model, systemPrompt, userContent, imagePaths)) text += part;
    if (!text.trim()) throw new Error('The quick answers model returned no text');
    return text;
  }

  private async streamViaConnection(
    c: NonNullable<TranscriptTranslationRequest['connection']>,
    model: string,
    prompt: string,
    onProgress: (textSoFar: string) => void
  ): Promise<string> {
    const clients = this.connectionClients(c);
    if (c.type === 'anthropic') {
      const stream = await clients.anthropic().messages.create({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        stream: true,
      });
      return streamText(anthropicDeltas(stream), onProgress);
    }
    if (c.type === 'gemini') {
      const stream = await clients.gemini().models.generateContentStream({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: translationThinking(model),
      });
      return streamText(geminiDeltas(stream), onProgress);
    }
    const stream = await clients.openai().chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      ...(c.baseUrl.includes('api.openai.com') ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }),
      stream: true,
    });
    return streamText(openAIDeltas(stream), onProgress);
  }

  /**
   * Same request as `translateTranscriptText`, read as a stream. `onProgress` gets the text so far,
   * throttled, starting with the first text. Text that has been reported is never taken back, so
   * the stream is append-only.
   */
  private async streamTranscriptTranslation(
    request: TranscriptTranslationRequest,
    model: string,
    fullPrompt: string,
    onProgress: (textSoFar: string) => void
  ): Promise<string> {
    if (request.provider === 'connection' && request.connection) {
      return this.streamViaConnection(request.connection, model, fullPrompt, onProgress);
    }

    if (request.provider === 'ollama') {
      const url = (request.ollamaUrl || this.ollamaUrl || "http://localhost:11434").trim();
      const response = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: fullPrompt, stream: true, options: { temperature: 0.2, top_p: 0.9 } }),
      });
      if (!response.ok || !response.body) throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      return streamText(ollamaDeltas(response.body as unknown as AsyncIterable<Uint8Array>), onProgress);
    }

    if (request.provider === 'gemini') {
      if (!this.apiKey) throw new Error("Gemini API key is not configured");
      const client = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { apiVersion: "v1alpha" } });
      const stream = await client.models.generateContentStream({
        model,
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        config: translationThinking(model),
      });
      return streamText(geminiDeltas(stream), onProgress);
    }

    if (request.provider === 'groq') {
      if (!this.groqApiKey) throw new Error("Groq API key is not configured");
      const client = new Groq({ apiKey: this.groqApiKey });
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.2,
        max_tokens: 4096,
        stream: true,
      });
      return streamText(openAIDeltas(stream), onProgress);
    }

    if (request.provider === 'openai') {
      if (!this.openaiApiKey) throw new Error("OpenAI API key is not configured");
      const client = new OpenAI({ apiKey: this.openaiApiKey });
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.2,
        max_completion_tokens: 4096,
        stream: true,
      });
      return streamText(openAIDeltas(stream), onProgress);
    }

    if (request.provider === 'claude') {
      if (!this.claudeApiKey) throw new Error("Claude API key is not configured");
      const client = new Anthropic({ apiKey: this.claudeApiKey });
      const stream = await client.messages.create({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: [{ type: "text", text: fullPrompt }] }],
        stream: true,
      });
      return streamText(anthropicDeltas(stream), onProgress);
    }

    if (request.provider === 'openai-compatible') {
      const cfg = request.openAICompatible;
      if (!cfg?.baseUrl?.trim() || !cfg.apiKey?.trim()) {
        throw new Error("OpenAI-compatible translation: missing base URL or API key (configure under AI Providers)");
      }
      const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: normalizeOpenAICompatibleBaseUrl(cfg.baseUrl) });
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.2,
        max_tokens: 4096,
        stream: true,
      });
      return streamText(openAIDeltas(stream), onProgress);
    }

    throw new Error(`Unsupported translation provider: ${request.provider}`);
  }

  public async translateTranscriptText(
    request: TranscriptTranslationRequest,
    onProgress?: (textSoFar: string) => void
  ): Promise<string> {
    try {
      return await this.translateOnce(request, onProgress);
    } catch (error) {
      // A 400 while a thinking setting was sent: ask again with the next setting, or none when none is left.
      const status = Number((error as { status?: unknown } | null)?.status);
      const model = request.model?.trim() ?? '';
      if (status !== 400 || !translationThinking(model)) throw error;
      refusedThinkingSettings.set(model, (refusedThinkingSettings.get(model) ?? 0) + 1);
      console.warn('[LLMHelper] The host rejected a thinking setting; trying the next one');
      return this.translateTranscriptText(request, onProgress);
    }
  }

  private async translateOnce(
    request: TranscriptTranslationRequest,
    onProgress?: (textSoFar: string) => void
  ): Promise<string> {
    const sourceText = request.sourceText?.trim();
    if (!sourceText) return "";

    const model = request.model?.trim();
    if (!model) {
      throw new Error("Translation model is required");
    }

    const fullPrompt = buildTranscriptTranslationPrompt(request.prompt || '', sourceText, {
      sourceLanguageKey: request.sourceLanguageKey,
      targetLanguageKey: request.targetLanguageKey,
      detectedLanguageKey: request.detectedLanguageKey,
      context: request.context,
    });

    if (onProgress) {
      let receivedText = false;
      try {
        const streamed = await this.streamTranscriptTranslation(request, model, fullPrompt, (textSoFar) => {
          receivedText = true;
          onProgress(textSoFar);
        });
        // An endpoint that ignores `stream: true` and answers with plain JSON yields no text and no error: ask again without streaming.
        if (streamed.trim()) return streamed.trim();
      } catch (error) {
        // A failure that says why (wrong key, rate limit, timeout, no connection) would only repeat, so it stands. An endpoint that
        // cannot stream fails with something unclassified before any text: ask once more without streaming. After text has been
        // shown, a retry would replace it.
        const reason = classifyTranslationError(error);
        if (receivedText || reason !== 'other') throw error;
        console.warn('[LLMHelper] Translation stream failed before any text; retrying without streaming:', reason);
      }
    }

    if (request.provider === 'connection' && request.connection) {
      return (await this.translateViaConnection(request.connection, model, fullPrompt)).trim();
    }

    if (request.provider === 'ollama') {
      const url = (request.ollamaUrl || this.ollamaUrl || "http://localhost:11434").trim();
      return (await this.callOllamaWithConfig(url, model, fullPrompt)).trim();
    }

    if (request.provider === 'gemini') {
      if (!this.apiKey) throw new Error("Gemini API key is not configured");
      const client = new GoogleGenAI({
        apiKey: this.apiKey,
        httpOptions: { apiVersion: "v1alpha" }
      });
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        config: translationThinking(model),
      });
      return (response.text || "").trim();
    }

    if (request.provider === 'groq') {
      if (!this.groqApiKey) throw new Error("Groq API key is not configured");
      const client = new Groq({ apiKey: this.groqApiKey });
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.2,
        max_tokens: 4096,
        stream: false,
      });
      return (response.choices[0]?.message?.content || "").trim();
    }

    if (request.provider === 'openai') {
      if (!this.openaiApiKey) throw new Error("OpenAI API key is not configured");
      const client = new OpenAI({ apiKey: this.openaiApiKey });
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.2,
        max_completion_tokens: 4096,
      });
      return (response.choices[0]?.message?.content || "").trim();
    }

    if (request.provider === 'claude') {
      if (!this.claudeApiKey) throw new Error("Claude API key is not configured");
      const client = new Anthropic({ apiKey: this.claudeApiKey });
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: [{ type: "text", text: fullPrompt }] }],
      });
      const textBlock = response.content.find((block: any) => block.type === 'text') as any;
      return (textBlock?.text || "").trim();
    }

    if (request.provider === 'openai-compatible') {
      const cfg = request.openAICompatible;
      if (!cfg?.baseUrl?.trim() || !cfg.apiKey?.trim()) {
        throw new Error("OpenAI-compatible translation: missing base URL or API key (configure under AI Providers)");
      }
      const base = normalizeOpenAICompatibleBaseUrl(cfg.baseUrl);
      const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: base });
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.2,
        max_tokens: 4096,
        stream: false,
      });
      return (response.choices[0]?.message?.content || "").trim();
    }

    throw new Error(`Unsupported translation provider: ${request.provider}`);
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        // console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        // console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      await this.callOllama("Hello")
      // console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error: any) {
      // console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          // console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError: any) {
        // console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  /**
   * Generate content using Gemini 3 Flash (text reasoning)
   * Used by IntelligenceManager for mode-specific prompts
   * NOTE: Migrated from Pro to Flash for consistency
   */
  public async generateWithPro(contents: any[]): Promise<string> {
    return this.generateContent(contents);
  }

  /**
   * Generate content using Gemini 3 Flash (audio + fast multimodal)
   * CRITICAL: Audio input MUST use this model, not Pro
   */
  public async generateWithFlash(contents: any[]): Promise<string> {
    return this.generateContent(contents);
  }

  /**
   * Post-process the response
   * NOTE: Truncation/clamping removed - response length is handled in prompts
   */
  private processResponse(text: string): string {
    // Basic cleaning
    let clean = this.cleanJsonResponse(text);

    // Truncation/clamping removed - prompts already handle response length
    // clean = clampResponse(clean, 3, 60);

    // Filter out fallback phrases
    const fallbackPhrases = [
      "I'm not sure",
      "It depends",
      "I can't answer",
      "I don't know"
    ];

    if (fallbackPhrases.some(phrase => clean.toLowerCase().includes(phrase.toLowerCase()))) {
      throw new Error("Filtered fallback response");
    }

    return clean;
  }

  /**
   * Retry logic with exponential backoff
   * Specifically handles 503 Service Unavailable
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let delay = 400;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (e: any) {
        // Only retry on 503 or overload errors
        if (!e.message?.includes("503") && !e.message?.includes("overloaded")) throw e;

        console.warn(`[LLMHelper] 503 Overload. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error("Model busy, try again");
  }

  /**
   * Generate content using the currently selected model
   */
  private async generateContent(contents: any[], modelIdOverride?: string): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt: '', userContent: contents.map(content => content.text ?? content.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? '').join('') });
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const prompt = `You are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt, imagePaths)
      return JSON.parse(this.cleanJsonResponse(text))
    } catch (error) {
      // console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `Given this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    try {
      const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      return parsed
    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate a structured 4-phase "Rolling Interview Script" from screenshot(s).
   * Returns a typed Solution with: problem_identifier_script, brainstorm_script,
   * code, dry_run_script, time_complexity, space_complexity.
   */
  public async generateRollingScript(imagePaths: string[]): Promise<{
    problem_identifier_script: string;
    brainstorm_script: string;
    code: string;
    dry_run_script: string;
    time_complexity: string;
    space_complexity: string;
  }> {
    const systemPrompt = `You are an elite FAANG Senior Software Engineer taking a live technical interview.
The user has provided a screenshot of a coding problem. You must generate a highly structured "Rolling Interview Script" that the candidate can read out loud to pass the interview perfectly.

Output EXACTLY this JSON structure, and nothing else (no markdown fences around the whole response):
{
  "problem_identifier_script": "1-2 conversational sentences confirming you understand the problem and its edge cases. Start with 'So just to make sure I understand...'",
  "brainstorm_script": "3-4 conversational sentences. First, mention a naive/brute-force approach and its complexity. Then, pivot to the optimal approach, mentioning the key data structure or algorithm. End by asking the interviewer if you can proceed with the optimal approach. Keep it natural.",
  "code": "The full, production-ready, heavily-commented optimal code solution in the language shown or Python if unclear. Include all necessary imports.",
  "dry_run_script": "2-3 conversational sentences doing a quick dry-run of the code with a simple example input. E.g., 'Let\\'s trace this. If our array is [1,2], the loop starts...'",
  "time_complexity": "O(...) — brief 5-word explanation",
  "space_complexity": "O(...) — brief 5-word explanation"
}

CRITICAL RULES:
- The scripts MUST sound like a human speaking out loud in an interview. Use "I", "we", "my first thought is".
- The JSON must be perfectly valid. Escape any internal quotes with backslash.
- Do NOT wrap the JSON in markdown fences.`;

    const userPrompt = `Please analyze the coding problem shown in the screenshot(s) and generate the Rolling Interview Script JSON.`;

    try {
      const raw = await this.generateWithVisionFallback(systemPrompt, userPrompt, imagePaths);
      const cleaned = this.cleanJsonResponse(raw);

      // Primary: direct parse
      try {
        return JSON.parse(cleaned);
      } catch (_) {
        // Fallback: extract JSON block via regex
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('Could not extract valid JSON from LLM response');
      }
    } catch (error) {
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const prompt = `You are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt, debugImagePaths)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      return parsed
    } catch (error) {
      throw error
    }
  }





  /**
   * NEW: Helper to process image: resize to max 1536px and compress to JPEG 80%
   * drastically reduces token usage and upload time.
   */
  private async processImage(path: string): Promise<{ mimeType: string, data: string }> {
    try {
      const imageBuffer = await fs.promises.readFile(path);

      // Resize and compress
      const processedBuffer = await sharp(imageBuffer)
        .resize({
          width: 1536,
          height: 1536,
          fit: 'inside', // Maintain aspect ratio, max dimension 1536
          withoutEnlargement: true
        })
        .jpeg({ quality: 80 }) // 80% quality JPEG is much smaller than PNG
        .toBuffer();

      return {
        mimeType: "image/jpeg",
        data: processedBuffer.toString("base64")
      };
    } catch (error) {
      console.error("[LLMHelper] Failed to process image with sharp:", error);
      // Fallback to raw read if sharp fails
      const data = await fs.promises.readFile(path);
      return {
        mimeType: "image/png",
        data: data.toString("base64")
      };
    }
  }

  public async analyzeImageFiles(imagePaths: string[]) {
    try {
      const prompt = `Describe the content of ${imagePaths.length > 1 ? 'these images' : 'this image'} in a short, concise answer. If it contains code or a problem, solve it.`;
      const text = await this.generateWithVisionFallback(HARD_SYSTEM_PROMPT, prompt, imagePaths);

      return { text: text, timestamp: Date.now() };

    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate a suggestion based on conversation transcript - Pika-style
   * This uses Gemini Flash to reason about what the user should say
   * @param context - The full conversation transcript
   * @param lastQuestion - The most recent question from the interviewer
   * @returns Suggested response for the user
   */
  public async generateSuggestion(context: string, lastQuestion: string): Promise<string> {
    const basePrompt = `You are an expert interview coach. Based on the conversation transcript, provide a concise, natural response the user could say.

RULES:
- Be direct and conversational
- Keep responses under 3 sentences unless complexity requires more  
- Focus on answering the specific question asked
- If it's a technical question, provide a clear, structured answer
- Do NOT preface with "You could say" or similar - just give the answer directly
- If unsure, answer briefly and confidently anyway.
- Never hedge.
- Never say "it depends".

CONVERSATION SO FAR:
${context}

LATEST QUESTION FROM INTERVIEWER:
${lastQuestion}

ANSWER DIRECTLY:`;

    // Apply language instruction so this path honurs the user's language setting
    const systemPrompt = this.injectLanguageInstruction(basePrompt);

    const text = await this.generateViaConnectionChat({ systemPrompt: '', userContent: systemPrompt });
    return this.processResponse(text);
  }

  public setKnowledgeOrchestrator(orchestrator: any): void {
    this.knowledgeOrchestrator = orchestrator;
    console.log('[LLMHelper] KnowledgeOrchestrator attached');
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public setAiResponseLanguage(language: string) {
    this.aiResponseLanguage = language;
    console.log(`[LLMHelper] AI Response Language set to: ${language}`);
  }

  public setSttLanguage(language: string) {
    this.sttLanguage = language;
    console.log(`[LLMHelper] STT Language set to: ${language}`);
  }

  /**
   * Inject a hard language instruction that gates the entire response.
   *
   * WHY prepended, not appended:
   *   LLMs attend more strongly to early tokens. Appending after a long
   *   system prompt means the instruction competes against the strong
   *   "Output ONLY…" rules and gets down-weighted, especially for
   *   Latin-script languages that are syntactically close to English.
   *   Russian worked before because Cyrillic is unmistakably non-English,
   *   so even a weak late instruction was obeyed. French/Spanish/German etc.
   *   require the instruction to come first and be unambiguous.
   *
   * The instruction is wrapped in triple-layered enforcement:
   *   1. Hard pre-prompt gate at the very top
   *   2. System prompt body (unchanged)
   *   3. Closing reminder at the bottom (double-lock)
   */
  private injectLanguageInstruction(systemPrompt: string): string {
    const cm = CredentialsManager.getInstance();
    const language = answerLanguageInstruction(this.aiResponseLanguage, cm.getSttLanguageUser());
    const style = speakingStyleInstruction(cm.getAnswerStyle());
    return `${language?.header ?? ''}${style.header}${systemPrompt}${style.footer}${language?.footer ?? ''}`;
  }

  private emitKnowledgeContextUpdate(knowledgeResult: any): void {
    if (!knowledgeResult?.matchedJDSignals && !knowledgeResult?.resumeEvidence && !knowledgeResult?.mustHitKeywords) {
      return;
    }

    try {
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send('knowledge:context-update', {
          matchedJDSignals: knowledgeResult.matchedJDSignals || [],
          resumeEvidence: knowledgeResult.resumeEvidence || [],
          mustHitKeywords: knowledgeResult.mustHitKeywords || [],
          questionCategory: knowledgeResult.questionCategory || 'technical',
        });
      }
    } catch (e) {
      console.warn('[LLMHelper] emitKnowledgeContextUpdate failed:', e);
    }
  }

  public async chatWithGemini(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false, alternateGroqMessage?: string): Promise<string> {
    try {
      console.log('[LLMHelper] chatWithGemini called')

      // ============================================================
      // KNOWLEDGE MODE INTERCEPT
      // If knowledge mode is active, check for intro questions and
      // inject system prompt + relevant context
      // ============================================================
      if (this.knowledgeOrchestrator?.isKnowledgeMode()) {
        try {
          // Feed only to the depth scorer — NOT feedInterviewerUtterance, which also routes to the
          // negotiation tracker and would misclassify the user's typed question as a recruiter utterance.
          // Recruiter utterances reach the tracker exclusively via the STT path in main.ts.
          this.knowledgeOrchestrator.feedForDepthScoring(message);

          const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);
          this.emitKnowledgeContextUpdate(knowledgeResult);
          if (knowledgeResult) {
            // Fix 1: short-circuit for live negotiation coaching — bypass second LLM call
            if (knowledgeResult.liveNegotiationResponse) {
              return JSON.stringify({ __negotiationCoaching: knowledgeResult.liveNegotiationResponse });
            }
            // Intro question shortcut — return generated response directly
            if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
              console.log('[LLMHelper] Knowledge mode: returning generated intro response');
              return knowledgeResult.introResponse;
            }
            // Inject knowledge system prompt and context
            if (!skipSystemPrompt && knowledgeResult.systemPromptInjection) {
              skipSystemPrompt = false; // ensure we use the knowledge prompt
              // Prepend knowledge context to existing context
              if (knowledgeResult.contextBlock) {
                context = context
                  ? `${knowledgeResult.contextBlock}\n\n${context}`
                  : knowledgeResult.contextBlock;
              }
            }
          }
        } catch (knowledgeError: any) {
          console.warn('[LLMHelper] Knowledge mode processing failed, falling back to normal:', knowledgeError.message);
        }
      }

      const use = CredentialsManager.getInstance().resolveModelUse('chat');
      if ('error' in use) throw new Error(use.error);
      const prompt = use.connection.id === 'groq'
        ? alternateGroqMessage || this.injectLanguageInstruction(GROQ_SYSTEM_PROMPT)
        : this.injectLanguageInstruction(use.connection.type === 'anthropic' ? CLAUDE_SYSTEM_PROMPT : use.connection.type === 'gemini' ? HARD_SYSTEM_PROMPT : OPENAI_SYSTEM_PROMPT);
      const userContent = context
        ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
        : message;
      return this.processResponse(await this.generateViaConnectionChat({ systemPrompt: skipSystemPrompt ? '' : prompt, userContent, imagePaths }));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate content using only reasoning-capable models.
   * Priority: OpenAI → Claude → Gemini Pro → Groq (last resort).
   * Used for structured JSON output tasks (resume/JD/company research).
   * NOTE: Does NOT mutate this.geminiModel — calls Gemini Pro directly to avoid race conditions.
   */
  public async generateContentStructured(message: string): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt: '', userContent: message });
  }

  private async generateWithGroq(fullMessage: string): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt: '', userContent: fullMessage });
  }

  /**
   * Non-streaming OpenAI generation with proper system/user separation
   */
  private async generateWithOpenai(userMessage: string, systemPrompt?: string, imagePaths?: string[], modelId?: string): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt: systemPrompt ?? '', userContent: userMessage, imagePaths });
  }

  /**
   * OpenAI-compatible Chat Completions (any /v1 base URL).
   */
  public async chatWithOpenAICompatible(
    userMessage: string,
    systemPrompt?: string,
    imagePath?: string
  ): Promise<string> {
    return (await this.generateViaConnectionChat({ systemPrompt: systemPrompt ?? '', userContent: userMessage, imagePaths: imagePath ? [imagePath] : undefined })).trim();
  }

  /**
   * Non-streaming Claude generation with proper system/user separation
   */
  private async generateWithClaude(userMessage: string, systemPrompt?: string, imagePaths?: string[], modelId?: string): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt: systemPrompt ?? '', userContent: userMessage, imagePaths });
  }

  /**
   * Map UNIVERSAL (local model) prompts to richer CUSTOM prompts.
   * Custom providers can be any cloud model, so they get detailed prompts.
   */
  private mapToCustomPrompt(prompt: string): string {
    // Map from concise UNIVERSAL to rich CUSTOM equivalents
    if (prompt === UNIVERSAL_SYSTEM_PROMPT || prompt === HARD_SYSTEM_PROMPT) return CUSTOM_SYSTEM_PROMPT;
    if (prompt === UNIVERSAL_ANSWER_PROMPT) return CUSTOM_ANSWER_PROMPT;
    if (prompt === UNIVERSAL_WHAT_TO_ANSWER_PROMPT) return CUSTOM_WHAT_TO_ANSWER_PROMPT;
    if (prompt === UNIVERSAL_RECAP_PROMPT) return CUSTOM_RECAP_PROMPT;
    if (prompt === UNIVERSAL_FOLLOWUP_PROMPT) return CUSTOM_FOLLOWUP_PROMPT;
    if (prompt === UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT) return CUSTOM_FOLLOW_UP_QUESTIONS_PROMPT;
    if (prompt === UNIVERSAL_ASSIST_PROMPT) return CUSTOM_ASSIST_PROMPT;
    // If it's already a different override (e.g. user-supplied), pass through
    return prompt;
  }

  private async tryGenerateResponse(fullMessage: string, imagePaths?: string[], modelIdOverride?: string): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt: '', userContent: fullMessage, imagePaths });
  }


  /**
   * Non-streaming multimodal response from Groq using Llama 4 Scout
   */
  private async generateWithGroqMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt: systemPrompt ?? '', userContent: userMessage, imagePaths });
  }

  /**
   * Universal non-streaming fallback helper for internal operations (screenshot analysis, problem extraction, etc.)
   *
   * THREE-TIER RETRY ROTATION (self-improving):
   *   Tier 1: Pinned stable models (promoted only when 2+ minor versions behind)
   *   Tier 2: Latest auto-discovered models (updated every ~14 days) — 1st retry
   *   Tier 3: Same as Tier 2 — 2nd retry (with backoff between tiers)
   *
   * Provider order per tier: OpenAI -> Gemini Flash -> Claude -> Gemini Pro -> Groq Scout
   * After all cloud tiers: OpenAI-compatible Provider -> Ollama
   */
  private async generateWithVisionFallback(systemPrompt: string, userPrompt: string, imagePaths: string[] = []): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt, userContent: userPrompt, imagePaths });
  }



  /**
   * Stream chat response with Groq-first fallback chain for text-only,
   * and Gemini-only for multimodal (images)
   * 
   * TEXT-ONLY FALLBACK CHAIN:
   * 1. Groq (llama-3.3-70b-versatile) - Primary
   * 2. Gemini Flash - 1st fallback
   * 3. Gemini Flash + Pro parallel - 2nd fallback
   * 4. Gemini Flash retries (max 3) - Last resort
   * 
   * MULTIMODAL: Gemini-only (existing logic)
   */
  public async * streamChatWithGemini(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
    const userContent = context
      ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
      : message;
    const use = CredentialsManager.getInstance().resolveModelUse('chat');
    if ('error' in use) throw new Error(use.error);
    const systemPrompt = use.connection.id === 'groq' ? GROQ_SYSTEM_PROMPT : use.connection.type === 'anthropic' ? CLAUDE_SYSTEM_PROMPT : use.connection.type === 'gemini' ? HARD_SYSTEM_PROMPT : OPENAI_SYSTEM_PROMPT;
    yield* this.streamChat(userContent, imagePaths, undefined, skipSystemPrompt ? '' : this.injectLanguageInstruction(systemPrompt), { signal, verbatimPrompt: true });
  }

  /**
   * Quick answers through the chosen connection and exact model id.
   */
  public async * streamChat(
    message: string | undefined,
    imagePaths?: string[],
    context?: string,
    systemPromptOverride?: string, // Optional override (defaults to HARD_SYSTEM_PROMPT)
    options?: { history?: Array<{ role: 'user' | 'assistant'; content: string }>; signal?: AbortSignal; verbatimPrompt?: boolean }
  ): AsyncGenerator<string, void, unknown> {

    // ============================================================
    // KNOWLEDGE MODE INTERCEPT (Streaming)
    // ============================================================
    if (!options?.verbatimPrompt && this.knowledgeOrchestrator?.isKnowledgeMode()) {
      try {
        // Feed to depth scorer only (not negotiation tracker) — mirrors non-streaming path fix.
        this.knowledgeOrchestrator.feedForDepthScoring(message);

        const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);
        if (knowledgeResult) {
          // Fix 1: short-circuit for live negotiation coaching — bypass second LLM call
          if (knowledgeResult.liveNegotiationResponse) {
            yield JSON.stringify({ __negotiationCoaching: knowledgeResult.liveNegotiationResponse });
            return;
          }
          // Intro question shortcut — yield generated response directly
          if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
            console.log('[LLMHelper] Knowledge mode (stream): returning generated intro response');
            yield knowledgeResult.introResponse;
            return;
          }
          // Inject knowledge system prompt
          if (knowledgeResult.systemPromptInjection) {
            systemPromptOverride = knowledgeResult.systemPromptInjection;
          }
          // Inject knowledge context
          if (knowledgeResult.contextBlock) {
            context = context
              ? `${knowledgeResult.contextBlock}\n\n${context}`
              : knowledgeResult.contextBlock;
          }
        }
      } catch (knowledgeError: any) {
        console.warn('[LLMHelper] Knowledge mode (stream) processing failed, falling back:', knowledgeError.message);
      }
    }

    // Helper to build combined user message
    const userContent = context
      ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
      : message;

    // The connection and model chosen for quick answers (Settings, AI Providers): any host, any model id.
    const chatUse = CredentialsManager.getInstance().resolveModelUse('chat');
    if ('connection' in chatUse) {
      const systemFor = chatUse.connection.id === 'groq' ? GROQ_SYSTEM_PROMPT : chatUse.connection.type === 'anthropic' ? CLAUDE_SYSTEM_PROMPT : OPENAI_SYSTEM_PROMPT;
      yield* this.streamViaConnectionChat(chatUse.connection, chatUse.model, options?.verbatimPrompt ? systemPromptOverride ?? '' : this.injectLanguageInstruction(systemPromptOverride ?? systemFor), userContent, imagePaths, options?.history, options?.signal);
      return;
    }

    throw new Error(chatUse.error);
  }

  /**
   * Stream response from Groq
   */
  private async * streamWithGroq(fullMessage: string): AsyncGenerator<string, void, unknown> {
    if (!this.groqClient) throw new Error("Groq client not initialized");

    const stream = await this.groqClient.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: fullMessage }],
      stream: true,
      temperature: 0.4,
      max_tokens: 8192,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Stream multimodal (image + text) response from Groq using Llama 4 Scout as a last resort
   */
  private async * streamWithGroqMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string): AsyncGenerator<string, void, unknown> {
    if (!this.groqClient) throw new Error("Groq client not initialized");

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    const contentParts: any[] = [{ type: "text", text: userMessage }];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        // Groq requires base64 URL format for images, similar to OpenAI
        const imageData = await fs.promises.readFile(p);
        contentParts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData.toString("base64")}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });

    const stream = await this.groqClient.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages,
      stream: true,
      max_tokens: 8192,
      temperature: 1,
      top_p: 1,
      stop: null
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Stream response from OpenAI with proper system/user message separation
   */
  private async * streamWithOpenai(userMessage: string, systemPrompt?: string, modelId?: string): AsyncGenerator<string, void, unknown> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    // Use explicit override, then currentModelId if it's an OpenAI model, else baseline constant
    const model = modelId || (this.isOpenAiModel(this.currentModelId) ? this.currentModelId : OPENAI_MODEL);

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userMessage });

    const stream = await this.openaiClient.chat.completions.create({
      model,
      messages,
      stream: true,
      max_completion_tokens: model.toLowerCase().includes('claude') ? CLAUDE_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Stream response from Claude with proper system/user message separation
   */
  private async * streamWithClaude(userMessage: string, systemPrompt?: string, modelId?: string): AsyncGenerator<string, void, unknown> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    // Use explicit override, then currentModelId if it's a Claude model, else baseline constant
    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);

    const stream = await this.claudeClient.messages.stream({
      model,
      max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: userMessage }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  /**
   * Stream multimodal (image + text) response from OpenAI with system/user separation
   */
  private async * streamWithOpenaiMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string, modelId?: string): AsyncGenerator<string, void, unknown> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    // Use explicit override, then currentModelId if it's an OpenAI model, else baseline constant
    const model = modelId || (this.isOpenAiModel(this.currentModelId) ? this.currentModelId : OPENAI_MODEL);

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    const contentParts: any[] = [{ type: "text", text: userMessage }];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        const imageData = await fs.promises.readFile(p);
        contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${imageData.toString("base64")}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });

    const stream = await this.openaiClient.chat.completions.create({
      model,
      messages,
      stream: true,
      max_completion_tokens: model.toLowerCase().includes('claude') ? CLAUDE_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Stream multimodal (image + text) response from Claude with system/user separation
   */
  private async * streamWithClaudeMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string, modelId?: string): AsyncGenerator<string, void, unknown> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    // Use explicit override, then currentModelId if it's a Claude model, else baseline constant
    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);

    const imageContentParts: any[] = [];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        const imageData = await fs.promises.readFile(p);
        imageContentParts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: imageData.toString("base64")
          }
        });
      }
    }

    const stream = await this.claudeClient.messages.stream({
      model,
      max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{
        role: "user",
        content: [
          ...imageContentParts,
          { type: "text", text: userMessage }
        ]
      }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  /**
   * Stream response from a specific Gemini model
   */
  private async * streamWithGeminiModel(fullMessage: string, model: string, imagePaths?: string[]): AsyncGenerator<string, void, unknown> {
    if (!this.client) throw new Error("Gemini client not initialized");

    const contents: any[] = [{ text: fullMessage }];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          contents.push({
            inlineData: {
              mimeType: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }
    }

    const streamResult = await this.client.models.generateContentStream({
      model: model,
      contents: contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      }
    });

    // @ts-ignore
    const stream = streamResult.stream || streamResult;

    for await (const chunk of stream) {
      let chunkText = "";
      if (typeof chunk.text === 'function') {
        chunkText = chunk.text();
      } else if (typeof chunk.text === 'string') {
        chunkText = chunk.text;
      } else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
        chunkText = chunk.candidates[0].content.parts[0].text;
      }
      if (chunkText) {
        yield chunkText;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  public async getOllamaModels(): Promise<string[]> {
    const baseUrl = (this.ollamaUrl || "http://127.0.0.1:11434").replace('localhost', '127.0.0.1');
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000); // Fast 1s timeout

        const response = await fetch(`${baseUrl}/api/tags`, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) return [];

        const data = await response.json();
        if (data && data.models) {
            return data.models.map((m: any) => m.name);
        }
        
        return [];
    } catch (error: any) {
        // Silently catch connection refused/timeout errors. 
        // OllamaManager handles logging the startup status.
        return [];
    }
  }

  /**
   * Get the Gemini client for mode-specific LLMs
   * Used by AnswerLLM, AssistLLM, FollowUpLLM, RecapLLM
   * RETURNS A PROXY client that handles retries and fallbacks transparently
   */
  public getGeminiClient(): GoogleGenAI | null {
    if (!this.client) return null;
    return this.createRobustClient(this.client);
  }

  /**
   * Get the Groq client for mode-specific LLMs
   */
  public getGroqClient(): Groq | null {
    return this.groqClient;
  }

  /**
   * Check if Groq is available
   */
  public hasGroq(): boolean {
    return this.groqClient !== null;
  }

  /**
   * Get the OpenAI client for mode-specific LLMs
   */
  public getOpenaiClient(): OpenAI | null {
    return this.openaiClient;
  }

  /**
   * Get the Claude client for mode-specific LLMs
   */
  public getClaudeClient(): Anthropic | null {
    return this.claudeClient;
  }

  /**
   * Check if OpenAI is available
   */
  public hasOpenai(): boolean {
    return this.openaiClient !== null;
  }

  /**
   * Check if Claude is available
   */
  public hasClaude(): boolean {
    return this.claudeClient !== null;
  }

  /**
   * Stream with Groq using a specific prompt, with Gemini fallback
   * Used by mode-specific LLMs (RecapLLM, FollowUpLLM, WhatToAnswerLLM)
   * @param groqMessage - Message with Groq-optimized prompt
   * @param geminiMessage - Message with Gemini prompt (for fallback)
   * @param config - Optional temperature and max tokens
   */
  public async * streamWithGroqOrGemini(
    groqMessage: string,
    geminiMessage: string,
    config?: { temperature?: number; maxTokens?: number }
  ): AsyncGenerator<string, void, unknown> {
    const temperature = config?.temperature ?? 0.3;
    const maxTokens = config?.maxTokens ?? 8192;

    // Try Groq first if available
    if (this.groqClient) {
      try {
        console.log(`[LLMHelper] 🚀 Mode-specific Groq stream starting...`);
        const stream = await this.groqClient.chat.completions.create({
          model: GROQ_MODEL,
          messages: [{ role: "user", content: groqMessage }],
          stream: true,
          temperature: temperature,
          max_tokens: maxTokens,
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
        console.log(`[LLMHelper] ✅ Mode-specific Groq stream completed`);
        return; // Success - done
      } catch (err: any) {
        console.warn(`[LLMHelper] ⚠️ Groq mode-specific failed: ${err.message}, falling back to Gemini`);
      }
    }

    // Fallback to Gemini
    if (this.client) {
      console.log(`[LLMHelper] 🔄 Falling back to Gemini for mode-specific request...`);
      yield* this.streamWithGeminiModel(geminiMessage, GEMINI_FLASH_MODEL);
    } else {
      throw new Error("No LLM provider available");
    }
  }

  /**
   * Creates a proxy around the real Gemini client to intercept generation calls
   * and apply robust retry/fallback logic without modifying consumer code.
   */
  private createRobustClient(realClient: GoogleGenAI): GoogleGenAI {
    // We proxy the 'models' property to intercept 'generateContent'
    const modelsProxy = new Proxy(realClient.models, {
      get: (target, prop, receiver) => {
        if (prop === 'generateContent') {
          return async (args: any) => {
            return this.generateWithFallback(realClient, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    // We proxy the client itself to return our modelsProxy
    return new Proxy(realClient, {
      get: (target, prop, receiver) => {
        if (prop === 'models') {
          return modelsProxy;
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }

  /**
   * ROBUST GENERATION STRATEGY (SPECULATIVE PARALLEL EXECUTION)
   * 1. Attempt with original model (Flash).
   * 2. If it fails/empties:
   *    - IMMEDIATELY launch two requests in parallel:
   *      a) Retry Flash (Attempt 2)
   *      b) Start Pro (Backup)
   * 3. Return whichever finishes successfully first (prioritizing Flash if both fast).
   * 4. If both fail, try Flash one last time (Attempt 3).
   * 5. If that fails, throw error.
   */
  private async generateWithFallback(client: GoogleGenAI, args: any): Promise<any> {
    const originalModel = args.model;

    // Helper to check for valid content
    const isValidResponse = (response: any) => {
      const candidate = response.candidates?.[0];
      if (!candidate) return false;
      // Check for text content
      if (response.text && response.text.trim().length > 0) return true;
      if (candidate.content?.parts?.[0]?.text && candidate.content.parts[0].text.trim().length > 0) return true;
      if (typeof candidate.content === 'string' && candidate.content.trim().length > 0) return true;
      return false;
    };

    // 1. Initial Attempt (Flash)
    try {
      const response = await client.models.generateContent({
        ...args,
        model: originalModel
      });
      if (isValidResponse(response)) return response;
      console.warn(`[LLMHelper] Initial ${originalModel} call returned empty/invalid response.`);
    } catch (error: any) {
      console.warn(`[LLMHelper] Initial ${originalModel} call failed: ${error.message}`);
    }

    console.log(`[LLMHelper] 🚀 Triggering Speculative Parallel Retry (Flash + Pro)...`);

    // 2. Parallel Execution (Retry Flash vs Pro)
    // We create promises for both but treat them carefully
    const flashRetryPromise = (async () => {
      // Small delay before retry to let system settle? No, user said "immediately"
      try {
        const res = await client.models.generateContent({ ...args, model: originalModel });
        if (isValidResponse(res)) return { type: 'flash', res };
        throw new Error("Empty Flash Response");
      } catch (e) { throw e; }
    })();

    const proBackupPromise = (async () => {
      try {
        // Pro might be slower, but it's the robust backup
        const res = await client.models.generateContent({ ...args, model: GEMINI_PRO_MODEL });
        if (isValidResponse(res)) return { type: 'pro', res };
        throw new Error("Empty Pro Response");
      } catch (e) { throw e; }
    })();

    // 3. Race / Fallback Logic
    try {
      // We want Flash if it succeeds, but will accept Pro if Flash fails
      // If Flash finishes first and success -> return Flash
      // If Pro finishes first -> wait for Flash? Or return Pro?
      // User said: "if the gemini 3 flash again fails the gemini 3 pro response can be immediatly displayed"
      // This implies we prioritize Flash's *result*, but if Flash fails, we want Pro.

      // We use Promise.any to get the first *successful* result
      const winner = await Promise.any([flashRetryPromise, proBackupPromise]);
      console.log(`[LLMHelper] Parallel race won by: ${winner.type}`);
      return winner.res;

    } catch (aggregateError) {
      console.warn(`[LLMHelper] Both parallel retry attempts failed.`);
    }

    // 4. Last Resort: Flash Final Retry
    console.log(`[LLMHelper] ⚠️ All parallel attempts failed. Trying Flash one last time...`);
    try {
      return await client.models.generateContent({ ...args, model: originalModel });
    } catch (finalError) {
      console.error(`[LLMHelper] Final retry failed.`);
      throw finalError;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([
      promise.then(result => {
        clearTimeout(timeoutHandle);
        return result;
      }),
      timeoutPromise
    ]);
  }

  /**
   * Text for the meeting record (a summary, a title) from the model chosen for summaries, which is the
   * quick-answers model unless one is set apart. Three tries; a failure shows the real reason.
   */
  public async generateMeetingSummary(systemPrompt: string, context: string): Promise<string> {
    const use = CredentialsManager.getInstance().resolveModelUse('summary');
    if ('error' in use) throw new Error(use.error);
    let lastError: unknown = new Error('The summary model returned no text');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = await this.withTimeout(
          (async () => {
            let whole = '';
            for await (const part of this.streamViaConnectionChat(use.connection, use.model, systemPrompt, `Context:\n${context}`)) whole += part;
            return whole;
          })(),
          90000,
          `Summary (attempt ${attempt})`
        );
        if (text.trim()) return this.processResponse(text);
      } catch (e: unknown) {
        lastError = e;
        console.warn(`[LLMHelper] Summary attempt ${attempt}/3 failed: ${classifyTranslationError(e)}`);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
    throw lastError;
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.client) {
          return { success: false, error: "No Gemini client configured" };
        }
        // Test with a simple prompt using the selected model
        const text = await this.generateContent([{ text: "Hello" }])
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  /**
   * Universal Chat (Non-streaming)
   */
  public async chat(message: string, imagePaths?: string[], context?: string, systemPromptOverride?: string): Promise<string> {
    let fullResponse = "";
    for await (const chunk of this.streamChat(message, imagePaths, context, systemPromptOverride)) {
      fullResponse += chunk;
    }
    return fullResponse;
  }

}