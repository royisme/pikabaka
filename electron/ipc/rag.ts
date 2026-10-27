import { AppState } from "../main"
import { safeHandle } from "./safeHandle"
import { CredentialsManager } from "../services/CredentialsManager"
import { DatabaseManager } from "../db/DatabaseManager"
import { buildEmbeddingConfig } from "../rag/embeddingConfig"

// Abort controllers of the RAG answers being streamed; module-level so a Stop from anywhere can end them.
const activeRAGQueries = new Map<string, AbortController>();

export function cancelActiveRagQueries(): void {
  for (const controller of activeRAGQueries.values()) controller.abort();
}

export function registerRagHandlers(appState: AppState): void {
  // ==========================================
  // RAG (Retrieval-Augmented Generation) Handlers
  // ==========================================

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

        console.error("[RAG] Query failed");
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
        console.error("[RAG] Live query failed");
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

  safeHandle('embedding-use-get', async () => CredentialsManager.getInstance().getEmbeddingUse());

  safeHandle('embedding-use-set', async (_, use: { connectionId: string; model: string }) => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      const cm = CredentialsManager.getInstance();
      cm.setEmbeddingUse(use);
      await ragManager.initializeEmbeddings(buildEmbeddingConfig(cm), { force: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  safeHandle('embedding-status', async () => {
    const cm = CredentialsManager.getInstance();
    const use = cm.getEmbeddingUse();
    const connection = use.connectionId ? cm.resolveConnection(use.connectionId) : undefined;
    const ragManager = appState.getRAGManager();
    const status = ragManager?.getEmbeddingPipeline().getStatus() ?? { providerName: null, dimensions: null, usingSelected: false };
    return {
      ...status,
      selectedLabel: use.connectionId ? `${connection?.name ?? use.connectionId}: ${use.model}` : null,
      incompatible: status.providerName ? ragManager!.getIncompatibleMeetingsCount(status.providerName) : 0,
    };
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

      const llmHelper = appState.processingHelper.getLLMHelper();
      const lastMessage = messages[messages.length - 1];
      const endsWithUser = lastMessage.role === 'user';
      const stream = llmHelper.streamChat(
        endsWithUser ? lastMessage.content : undefined, undefined, undefined, systemPrompt,
        { history: endsWithUser ? messages.slice(0, -1) : messages, signal: abortController.signal, verbatimPrompt: true }
      );

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        sender.send('chat:stream-chunk', { requestId, chunk });
      }

      if (!abortController.signal.aborted) {
        sender.send('chat:stream-complete', { requestId });
      }

      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[chat:stream-meeting] Request failed');
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
