import { AppState } from "../main"
import { safeHandle } from "./safeHandle"
import { CredentialsManager } from "../services/CredentialsManager"
import { DatabaseManager } from "../db/DatabaseManager"
import { normalizeOpenAICompatibleBaseUrl } from "../utils/modelFetcher"

type ChatStreamMessage = { role: 'user' | 'assistant'; content: string };
type OpenAICompatibleChatProvider = { id: string; name: string; baseUrl: string; apiKey: string; preferredModel?: string };

function extractOpenAICompatibleChunkText(data: any): string {
  const choice = data?.choices?.[0];
  const candidates = [
    choice?.delta?.content,
    choice?.message?.content,
    data?.delta?.content,
    data?.content,
    data?.text,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate;
    if (Array.isArray(candidate)) {
      return candidate
        .map((part: any) => typeof part === 'string' ? part : (part?.text || part?.content || ''))
        .join('');
    }
  }
  return '';
}

async function* streamOpenAICompatibleChatCompletion(
  provider: OpenAICompatibleChatProvider,
  model: string,
  systemPrompt: string,
  messages: ChatStreamMessage[],
  signal: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const base = normalizeOpenAICompatibleBaseUrl(provider.baseUrl);
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model,
      system: undefined,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.7,
      max_tokens: 8192,
      stream: true,
    }),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const safe = raw.replaceAll(provider.apiKey, '[redacted]').slice(0, 800);
    throw new Error(`OpenAI-compatible provider ${provider.name} failed (${response.status}): ${safe}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await response.json();
    const text = extractOpenAICompatibleChunkText(json);
    if (text) yield text;
    return;
  }

  if (!response.body) throw new Error('No response body from OpenAI-compatible provider');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal.aborted) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
      if (!payload || payload === '[DONE]') return;

      try {
        const json = JSON.parse(payload);
        const text = extractOpenAICompatibleChunkText(json);
        if (text) yield text;
      } catch {
        // Ignore keepalive / non-JSON SSE frames.
      }
    }
  }

  const tail = buffer.trim();
  if (tail && tail !== '[DONE]') {
    const payload = tail.startsWith('data:') ? tail.slice(5).trim() : tail;
    if (payload && payload !== '[DONE]') {
      try {
        const json = JSON.parse(payload);
        const text = extractOpenAICompatibleChunkText(json);
        if (text) yield text;
      } catch {
        // Ignore incomplete trailing frames.
      }
    }
  }
}

export function registerRagHandlers(appState: AppState): void {
  // ==========================================
  // RAG (Retrieval-Augmented Generation) Handlers
  // ==========================================

  // Store active query abort controllers for cancellation
  const activeRAGQueries = new Map<string, AbortController>();
  // Store active chat stream abort controllers
  const activeChatStreams = new Map<string, AbortController>();

  // Query meeting with RAG (meeting-scoped)
  safeHandle("rag:query-meeting", async (event, { meetingId, query }: { meetingId: string; query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      // Fallback to regular chat if RAG not available
      console.log("[RAG] Not ready, falling back to regular chat");
      return { fallback: true };
    }

    // For completed meetings, check if post-meeting RAG is processed.
    // For live meetings with JIT indexing, let RAGManager.queryMeeting() decide.
    if (!ragManager.isMeetingProcessed(meetingId) && !ragManager.isLiveIndexingActive(meetingId)) {
      console.log(`[RAG] Meeting ${meetingId} not processed and no JIT indexing, falling back to regular chat`);
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `meeting-${meetingId}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryMeeting(meetingId, query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { meetingId, chunk });
      }

      event.sender.send("rag:stream-complete", { meetingId });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        // If specific RAG failures, return fallback to use transcript window
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
          console.log(`[RAG] Query failed with '${msg}', falling back to regular chat`);
          return { fallback: true };
        }

        console.error("[RAG] Query error:", error);
        event.sender.send("rag:stream-error", { meetingId, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Query live meeting with JIT RAG
  safeHandle("rag:query-live", async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    // Check if JIT indexing is active and has chunks
    if (!ragManager.isLiveIndexingActive('live-meeting-current')) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `live-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryMeeting('live-meeting-current', query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { live: true, chunk });
      }

      event.sender.send("rag:stream-complete", { live: true });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        // If JIT RAG failed (no embeddings yet, no relevant context), fallback to regular chat
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
          console.log(`[RAG] JIT query failed with '${msg}', falling back to regular live chat`);
          return { fallback: true };
        }
        console.error("[RAG] Live query error:", error);
        event.sender.send("rag:stream-error", { live: true, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Query global (cross-meeting search)
  safeHandle("rag:query-global", async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `global-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryGlobal(query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { global: true, chunk });
      }

      event.sender.send("rag:stream-complete", { global: true });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        event.sender.send("rag:stream-error", { global: true, error: error.message });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Cancel active RAG query
  safeHandle("rag:cancel-query", async (_, { meetingId, global }: { meetingId?: string; global?: boolean }) => {
    const queryKey = global ? 'global' : `meeting-${meetingId}`;

    // Cancel any matching key
    for (const [key, controller] of activeRAGQueries) {
      if (key.startsWith(queryKey) || (global && key.startsWith('global'))) {
        controller.abort();
        activeRAGQueries.delete(key);
      }
    }

    return { success: true };
  });

  // Check if meeting has RAG embeddings
  safeHandle('rag:is-meeting-processed', async (_, meetingId: string) => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      return ragManager.isMeetingProcessed(meetingId);
    } catch (error: any) {
      console.error('[IPC rag:is-meeting-processed] Error:', error);
      return false;
    }
  });

  safeHandle('rag:reindex-incompatible-meetings', async () => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      await ragManager.reindexIncompatibleMeetings();
      return { success: true };
    } catch (error: any) {
      console.error('[IPC rag:reindex-incompatible-meetings] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Get RAG queue status
  safeHandle("rag:get-queue-status", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { pending: 0, processing: 0, completed: 0, failed: 0 };
    return ragManager.getQueueStatus();
  });

  // Retry pending embeddings
  safeHandle("rag:retry-embeddings", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { success: false };
    await ragManager.retryPendingEmbeddings();
    return { success: true };
  });

  // ==========================================
  // Chat Streaming Handlers (multi-turn, AI SDK)
  // ==========================================

  safeHandle("chat:stream-meeting", async (event, params: {
    requestId: string;
    meetingId: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    context?: string;
  }) => {
    const { requestId, meetingId, messages, context } = params;
    const sender = event.sender;

    // Validate messages
    if (!messages || messages.length === 0) {
      sender.send('chat:stream-error', { requestId, error: 'Messages array must not be empty' });
      return { success: false };
    }
    const validRoles = new Set(['user', 'assistant']);
    for (const m of messages) {
      if (!validRoles.has(m.role)) {
        sender.send('chat:stream-error', { requestId, error: `Invalid message role: ${m.role}` });
        return { success: false };
      }
    }

    const abortController = new AbortController();
    activeChatStreams.set(requestId, abortController);

    try {
      const cm = CredentialsManager.getInstance();
      const currentModel = cm.getDefaultModel();

      // Build provider model using AI SDK based on model prefix
      const { streamText } = await import('ai');
      let providerModel: any;
      let openAICompatibleProvider: OpenAICompatibleChatProvider | null = null;
      let openAICompatibleModel = '';

      if (currentModel.startsWith('gemini-')) {
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        const apiKey = cm.getGeminiApiKey();
        if (!apiKey) throw new Error('Gemini API key not configured');
        const google = createGoogleGenerativeAI({ apiKey });
        providerModel = google(currentModel);

      } else if (currentModel.startsWith('gpt-') || currentModel.startsWith('o1') || currentModel.startsWith('o3') || currentModel.startsWith('o4')) {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const apiKey = cm.getOpenaiApiKey();
        if (!apiKey) throw new Error('OpenAI API key not configured');
        const openai = createOpenAI({ apiKey });
        providerModel = openai(currentModel);

      } else if (currentModel.startsWith('claude-')) {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        const apiKey = cm.getClaudeApiKey();
        if (!apiKey) throw new Error('Anthropic API key not configured');
        const anthropic = createAnthropic({ apiKey });
        providerModel = anthropic(currentModel);

      } else if (currentModel.startsWith('llama-') || currentModel.startsWith('groq-') || currentModel.startsWith('mixtral') || currentModel.startsWith('whisper')) {
        const { createGroq } = await import('@ai-sdk/groq');
        const apiKey = cm.getGroqApiKey();
        if (!apiKey) throw new Error('Groq API key not configured');
        const groq = createGroq({ apiKey });
        providerModel = groq(currentModel);

      } else if (currentModel.startsWith('ollama-') || currentModel.startsWith('ollama:')) {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const ollamaModelName = currentModel.replace(/^ollama[-:]/, '');
        const openai = createOpenAI({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' });
        providerModel = openai(ollamaModelName);

      } else {
        // Try OpenAI-compatible custom providers
        const compatProviders = cm.getOpenAICompatibleProviders() as Array<{ id: string; name: string; baseUrl: string; apiKey: string; preferredModel?: string }>;
        const matchedProvider = compatProviders.find((p: { id: string; preferredModel?: string }) => p.preferredModel === currentModel || p.id === currentModel);
        if (matchedProvider) {
          // BYOK OpenAI-compatible providers are streamed through raw Chat Completions
          // instead of the AI SDK adapter so custom gateways receive /v1/chat/completions
          // with stream=true and chunks are forwarded to the renderer immediately.
          openAICompatibleProvider = matchedProvider;
          openAICompatibleModel = matchedProvider.preferredModel?.trim() || currentModel;
        } else {
          // Fallback: attempt as Gemini
          const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
          const apiKey = cm.getGeminiApiKey();
          if (!apiKey) throw new Error(`No provider matched for model: ${currentModel}`);
          const google = createGoogleGenerativeAI({ apiKey });
          providerModel = google('gemini-2.0-flash');
        }
      }

      let meetingContext = context ?? '';
      if (!meetingContext && meetingId) {
        const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);
        if (meeting) {
          const summary = [
            meeting.summary,
            meeting.detailedSummary?.overview,
            meeting.detailedSummary?.keyPoints?.join('\n'),
            meeting.detailedSummary?.actionItems?.join('\n'),
          ].filter(Boolean).join('\n\n');

          const transcript = (meeting.transcript ?? [])
            .slice(-80)
            .map((entry) => `${entry.speaker}: ${entry.text}`)
            .join('\n');

          meetingContext = [
            meeting.title ? `Meeting title: ${meeting.title}` : '',
            summary ? `Summary:\n${summary}` : '',
            transcript ? `Transcript:\n${transcript}` : '',
          ].filter(Boolean).join('\n\n');
        }
      }

      const systemPrompt = `You are a helpful meeting assistant. Answer questions about this meeting based on the context provided. Be concise and accurate.

${meetingContext || ''}`;

      if (openAICompatibleProvider) {
        sender.send('chat:stream-status', {
          requestId,
          provider: 'openai-compatible',
          providerName: openAICompatibleProvider.name,
          model: openAICompatibleModel,
          message: `Streaming via OpenAI-compatible: ${openAICompatibleProvider.name}`
        });

        for await (const chunk of streamOpenAICompatibleChatCompletion(
          openAICompatibleProvider,
          openAICompatibleModel,
          systemPrompt,
          messages,
          abortController.signal
        )) {
          if (abortController.signal.aborted) break;
          sender.send('chat:stream-chunk', { requestId, chunk });
        }

        if (!abortController.signal.aborted) {
          sender.send('chat:stream-complete', { requestId });
        }

        return { success: true };
      }

      const result = streamText({
        model: providerModel,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        abortSignal: abortController.signal,
      });

      for await (const chunk of result.textStream) {
        if (abortController.signal.aborted) break;
        sender.send('chat:stream-chunk', { requestId, chunk });
      }

      if (!abortController.signal.aborted) {
        sender.send('chat:stream-complete', { requestId });
      }

      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[chat:stream-meeting] Error:', error);
        sender.send('chat:stream-error', { requestId, error: error.message || 'Unknown error' });
      }
      return { success: false, error: error.message };
    } finally {
      activeChatStreams.delete(requestId);
    }
  });

  // Cancel active chat stream
  safeHandle("chat:cancel-stream", async (_, { requestId }: { requestId: string }) => {
    const controller = activeChatStreams.get(requestId);
    if (controller) {
      controller.abort();
      activeChatStreams.delete(requestId);
    }
    return { success: true };
  });
}
