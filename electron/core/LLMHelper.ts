import { GoogleGenAI, ThinkingLevel } from "@google/genai"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import {
  HARD_SYSTEM_PROMPT, GROQ_SYSTEM_PROMPT, OPENAI_SYSTEM_PROMPT, CLAUDE_SYSTEM_PROMPT
} from "../llm/prompts"
import { openAiRoot, type Connection } from '../services/aiConnections';
import { redactConnectionError } from '../services/connectionSecrets';
import { CredentialsManager } from '../services/CredentialsManager';
import { getAnswerSources } from '../services/SettingsManager';
import { buildTranscriptTranslationPrompt } from '../transcript/translationExecutor';
import { classifyTranslationError } from '../transcript/translationError';
import { answerLanguageInstruction } from '../llm/answerLanguage';
import { speakingStyleInstruction } from '../llm/speakingStyle';
import { runModelTest, type ModelTestResult } from '../llm/modelTest';
import { anthropicDeltas, geminiDeltas, openAIDeltas, streamText } from '../transcript/translationStream';

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

export interface TranscriptTranslationRequest {
  provider: 'connection';
  model: string;
  prompt: string;
  sourceText: string;
  /** RECOGNITION_LANGUAGES key or 'auto' */
  sourceLanguageKey?: string;
  /** RECOGNITION_LANGUAGES key */
  targetLanguageKey?: string;
  /** Per-segment language detected by STT provider (overrides sourceLanguageKey as a hint when present). */
  detectedLanguageKey?: string;
  /** When provider is `connection`: the connection chosen for translation (its type decides how it is called). */
  connection?: Pick<Connection, 'type' | 'baseUrl' | 'apiKey' | 'headers'>;
  /** Previous translated turns, oldest first, for terminology/pronoun consistency. */
  context?: Array<{ source: string; translation: string }>;
}

// Simple prompt for image analysis (not interview copilot - kept separate)
const IMAGE_ANALYSIS_PROMPT = `Analyze concisely. Be direct. No markdown formatting. Return plain text only.`

export class LLMHelper {
  private knowledgeOrchestrator: any = null;
  private aiResponseLanguage: string = 'English';
  private sttLanguage: string = 'english-us';

  public getAiResponseLanguage(): string {
    return this.aiResponseLanguage;
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  /** The SDK client for a translation connection: its type and host decide where the request goes. */
  private connectionClients(c: NonNullable<TranscriptTranslationRequest['connection']>) {
    const key = c.apiKey.trim();
    return {
      openai: () => new OpenAI({ apiKey: key || 'none', baseURL: openAiRoot(c.baseUrl), defaultHeaders: c.headers }),
      anthropic: () => new Anthropic({ apiKey: key, baseURL: c.baseUrl, defaultHeaders: c.headers }),
      gemini: () => new GoogleGenAI({
        apiKey: key,
        httpOptions: { headers: c.headers, apiVersion: "v1alpha", ...(c.baseUrl.includes('generativelanguage.googleapis.com') ? {} : { baseUrl: c.baseUrl }) },
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
    try {
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
    } catch (error) {
      throw redactConnectionError(error, c);
    }
  }

  public testModel(connection: Connection, model: string): Promise<ModelTestResult> {
    return runModelTest(this.streamViaConnectionChat(connection, model, 'You are a connection test.', 'Reply with the single word: ready'), connection.apiKey, connection.headers);
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

    throw new Error('Translation connection is not configured');
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
      if (status !== 400 || !translationThinking(model)) throw redactConnectionError(error, request.connection);
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

    throw new Error('Translation connection is not configured');
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
   * Uses the Quick answers model to reason about what the user should say
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
    const sources = getAnswerSources();
    try {
      console.log('[LLMHelper] chatWithGemini called')
      const documents = sources.materials ? this.knowledgeOrchestrator?.prepareDocumentContext(message) : null;

      // ============================================================
      // KNOWLEDGE MODE INTERCEPT
      // If knowledge mode is active, check for intro questions and
      // inject system prompt + relevant context
      // ============================================================
      if ((sources.materials || sources.profile) && this.knowledgeOrchestrator?.isKnowledgeMode()) {
        try {
          // Feed only to the depth scorer — NOT feedInterviewerUtterance, which also routes to the
          // negotiation tracker and would misclassify the user's typed question as a recruiter utterance.
          // Recruiter utterances reach the tracker exclusively via the STT path in main.ts.
          this.knowledgeOrchestrator.feedForDepthScoring(message);

          const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message, documents?.queryEmbedding);
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
          console.warn('[LLMHelper] Knowledge mode processing failed, falling back to normal:', classifyTranslationError(knowledgeError));
        }
      }

      const documentContext = await documents?.contextBlock;
      if (documentContext) context = context ? `${documentContext}\n\n${context}` : documentContext;

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

  /** Structured JSON tasks (resume/JD/company research) use the Quick answers model. */
  public async generateContentStructured(message: string): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt: '', userContent: message });
  }

  /** Legacy method name; screenshots use the chosen model without a vision fallback. */
  private async generateWithVisionFallback(systemPrompt: string, userPrompt: string, imagePaths: string[] = []): Promise<string> {
    return this.generateViaConnectionChat({ systemPrompt, userContent: userPrompt, imagePaths });
  }



  /** Legacy entry point, now streaming the Quick answers model on its chosen connection. */
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
    const sources = getAnswerSources();
    const documents = !options?.verbatimPrompt && sources.materials ? this.knowledgeOrchestrator?.prepareDocumentContext(message) : null;
    if (!options?.verbatimPrompt && (sources.materials || sources.profile) && this.knowledgeOrchestrator?.isKnowledgeMode()) {
      try {
        // Feed to depth scorer only (not negotiation tracker) — mirrors non-streaming path fix.
        this.knowledgeOrchestrator.feedForDepthScoring(message);

        const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message, documents?.queryEmbedding);
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
        console.warn('[LLMHelper] Knowledge mode (stream) processing failed, falling back:', classifyTranslationError(knowledgeError));
      }
    }

    const documentContext = await documents?.contextBlock;
    if (documentContext) context = context ? `${documentContext}\n\n${context}` : documentContext;

    // Helper to build combined user message
    const userContent = context
      ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
      : message;

    // The connection and model chosen for quick answers (Settings, Models & Agent): any host, any model id.
    const chatUse = CredentialsManager.getInstance().resolveModelUse('chat');
    if ('connection' in chatUse) {
      const systemFor = chatUse.connection.id === 'groq' ? GROQ_SYSTEM_PROMPT : chatUse.connection.type === 'anthropic' ? CLAUDE_SYSTEM_PROMPT : OPENAI_SYSTEM_PROMPT;
      yield* this.streamViaConnectionChat(chatUse.connection, chatUse.model, options?.verbatimPrompt ? systemPromptOverride ?? '' : this.injectLanguageInstruction(systemPromptOverride || systemFor), userContent, imagePaths, options?.history, options?.signal);
      return;
    }

    throw new Error(chatUse.error);
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