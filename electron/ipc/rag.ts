import { AppState } from "../main"
import { safeHandle } from "./safeHandle"
import { CredentialsManager } from "../services/CredentialsManager"
import { DatabaseManager } from "../db/DatabaseManager"

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
          const { createOpenAI } = await import('@ai-sdk/openai');
          const openai = createOpenAI({ baseURL: matchedProvider.baseUrl, apiKey: matchedProvider.apiKey });
          providerModel = openai(matchedProvider.preferredModel || currentModel);
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
