// electron/rag/RAGManager.ts
// Central orchestrator for RAG pipeline
// Coordinates preprocessing, chunking, embedding, and retrieval

import Database from 'better-sqlite3';
import { getAnswerSources, PAST_MEETING_SEARCH_OFF } from '../services/SettingsManager';
import { LLMHelper } from '../core/LLMHelper';
import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript } from './SemanticChunker';
import { VectorStore } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';
import type { AppAPIConfig } from './EmbeddingProviderResolver';
import { RAGRetriever } from './RAGRetriever';
import { LiveRAGIndexer } from './LiveRAGIndexer';
import { buildRAGPrompt, NO_CONTEXT_FALLBACK, NO_GLOBAL_CONTEXT_FALLBACK } from './prompts';
import { buildMeetingSummaryText } from './meetingSummaryIndex';
import { DatabaseManager } from '../db/DatabaseManager';

export interface RAGManagerConfig extends AppAPIConfig {
    db: Database.Database;
    dbPath: string;       // Passed to VectorStore so worker can open its own read-only connection
    extPath: string;      // Resolved sqlite-vec extension path (no platform suffix)
}

/**
 * RAGManager - Central orchestrator for RAG operations
 * 
 * Lifecycle:
 * 1. Initialize with database and API key
 * 2. When meeting ends: processMeeting() -> chunks + queue embeddings
 * 3. When user queries: query() -> retrieve + stream response
 */
export class RAGManager {
    private db: Database.Database;
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private retriever: RAGRetriever;
    private llmHelper: LLMHelper | null = null;
    private liveIndexer: LiveRAGIndexer;
    /** Guards against concurrent reprocessMeeting() calls for the same meeting ID. */
    private _reprocessInFlight = new Set<string>();
    private reindexAllPromise: Promise<void> | null = null;

    constructor(config: RAGManagerConfig) {
        this.db = config.db;
        this.vectorStore = new VectorStore(config.db, config.dbPath, config.extPath);
        this.embeddingPipeline = new EmbeddingPipeline(config.db, this.vectorStore);
        this.retriever = new RAGRetriever(this.vectorStore, this.embeddingPipeline);
        this.liveIndexer = new LiveRAGIndexer(this.vectorStore, this.embeddingPipeline);

        void this.embeddingPipeline.initialize({
            openaiKey: config.openaiKey,
            geminiKey: config.geminiKey,
            ollamaUrl: config.ollamaUrl,
            selected: config.selected
        }).catch(() => {
            console.warn('[RAGManager] Embedding initialization failed; the pipeline stays not ready');
        });
    }

    /**
     * Set LLM helper for generating responses
     */
    setLLMHelper(llmHelper: LLMHelper): void {
        this.llmHelper = llmHelper;
    }

    getEmbeddingPipeline(): EmbeddingPipeline {
        return this.embeddingPipeline;
    }

    initializeEmbeddings(config: AppAPIConfig, options?: { force?: boolean }): Promise<void> {
        return this.embeddingPipeline.initialize(config, options);
    }

    getIncompatibleMeetingsCount(providerName: string): number {
        return this.vectorStore.getIncompatibleMeetingsCount(providerName);
    }

    /**
     * Check if RAG is ready for queries
     */
    isReady(): boolean {
        return this.embeddingPipeline.isReady() && this.llmHelper !== null;
    }

    /**
     * Process a meeting after it ends
     * Creates chunks and queues them for embedding
     */
    async processMeeting(
        meetingId: string,
        transcript: RawSegment[],
        summary?: string
    ): Promise<{ chunkCount: number }> {
        console.log(`[RAGManager] Processing meeting ${meetingId} with ${transcript.length} segments`);

        // 1. Preprocess transcript
        const cleaned = preprocessTranscript(transcript);
        console.log(`[RAGManager] Preprocessed to ${cleaned.length} cleaned segments`);

        // 2. Chunk the transcript
        const chunks = chunkTranscript(meetingId, cleaned);
        console.log(`[RAGManager] Created ${chunks.length} chunks`);

        // Finish queued writes before replacing their rows.
        await this.embeddingPipeline.processQueue();
        if (!this.db.prepare('SELECT 1 FROM meetings WHERE id = ?').get(meetingId)) return { chunkCount: 0 };
        this.db.transaction(() => {
            this.deleteMeetingChunks(meetingId);
            // With no surviving summary vector, the full set can use the current provider.
            this.db.prepare(`
                UPDATE meetings SET embedding_provider = NULL, embedding_dimensions = NULL
                WHERE id = ? AND NOT EXISTS (
                    SELECT 1 FROM chunk_summaries WHERE meeting_id = ? AND embedding IS NOT NULL
                )
            `).run(meetingId, meetingId);
            this.vectorStore.saveChunks(chunks);
        })();

        if (chunks.length === 0) {
            console.log(`[RAGManager] No chunks to save for meeting ${meetingId}`);
            return { chunkCount: 0 };
        }

        // 4. Save summary if provided
        if (summary) {
            this.vectorStore.saveSummary(meetingId, summary);
        }

        // 5. Queue for embedding (background processing)
        if (this.embeddingPipeline.isReady()) {
            await this.embeddingPipeline.queueMeeting(meetingId);
        } else {
            console.log(`[RAGManager] Embeddings not ready, chunks saved without embeddings`);
        }

        return { chunkCount: chunks.length };
    }

    /**
     * Replace only the derived summary index and queue its current text for embedding.
     * Leave processing to the shared queue runner so a refresh cannot run chunk jobs.
     */
    refreshMeetingSummary(meetingId: string, summaryText: string): void {
        const hasSummary = summaryText.trim().length > 0;
        this.db.transaction(() => {
            this.vectorStore.clearNativeVectorsForMeeting(meetingId, 'summaries');
            this.db.prepare('DELETE FROM chunk_summaries WHERE meeting_id = ?').run(meetingId);
            // Cancel in-flight jobs too, so their late completion cannot complete the replacement job.
            this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ? AND chunk_id IS NULL').run(meetingId);
            if (hasSummary) {
                this.vectorStore.saveSummary(meetingId, summaryText);
                this.embeddingPipeline.queueMeetingSummary(meetingId);
            }
        })();
    }

    /**
     * Query meeting with RAG
     * Returns streaming generator for response
     */
    async *queryMeeting(
        meetingId: string,
        query: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        if (!this.llmHelper) {
            throw new Error('LLM helper not initialized');
        }

        // Check if meeting has embeddings (post-meeting RAG)
        const hasEmbeddings = this.vectorStore.hasEmbeddings(meetingId);

        if (!hasEmbeddings) {
            // JIT RAG: Check if live indexer has chunks for this meeting
            const isLiveMeeting = this.liveIndexer.getActiveMeetingId() === meetingId;
            if (isLiveMeeting && this.liveIndexer.hasIndexedChunks()) {
                console.log(`[RAGManager] Using JIT RAG for live meeting ${meetingId} (${this.liveIndexer.getIndexedChunkCount()} chunks)`);
                // Fall through to retrieval — VectorStore already has the JIT chunks
            } else {
                // No embeddings at all — trigger wrapper fallback
                throw new Error('NO_MEETING_EMBEDDINGS');
            }
        }

        // Retrieve relevant context
        const context = await this.retriever.retrieve(query, { meetingId });

        if (context.chunks.length === 0) {
            // No context relevant to query - trigger wrapper fallback to use context window
            throw new Error('NO_RELEVANT_CONTEXT_FOUND');
        }

        // Build prompt with intent hint
        const prompt = buildRAGPrompt(query, context.formattedContext, 'meeting', context.intent);

        // Stream response
        abortSignal?.throwIfAborted();
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true, abortSignal);

        for await (const chunk of stream) {
            if (abortSignal?.aborted) break;
            yield chunk;
        }
    }

    /**
     * Query across all meetings (global search)
     */
    async *queryGlobal(
        query: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        if (!getAnswerSources().meetings) {
            yield PAST_MEETING_SEARCH_OFF;
            return;
        }
        if (!this.llmHelper) {
            throw new Error('LLM helper not initialized');
        }

        // Retrieve from all meetings
        const context = await this.retriever.retrieveGlobal(query);

        if (context.chunks.length === 0) {
            yield NO_GLOBAL_CONTEXT_FALLBACK;
            return;
        }

        // Build prompt with intent hint
        const prompt = buildRAGPrompt(query, context.formattedContext, 'global', context.intent);

        // Stream response
        abortSignal?.throwIfAborted();
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true, abortSignal);

        for await (const chunk of stream) {
            if (abortSignal?.aborted) break;
            yield chunk;
        }
    }

    /**
     * Smart query - auto-detects scope
     */
    async *query(
        query: string,
        currentMeetingId?: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        const scope = this.retriever.detectScope(query, currentMeetingId);

        if (scope === 'meeting' && currentMeetingId) {
            yield* this.queryMeeting(currentMeetingId, query, abortSignal);
        } else {
            yield* this.queryGlobal(query, abortSignal);
        }
    }

    /**
     * Get embedding queue status
     */
    getQueueStatus(): { pending: number; processing: number; completed: number; failed: number } {
        return this.embeddingPipeline.getQueueStatus();
    }

    getIndexRecoveryStatus(): { meetingCount: number; failedMeetings: number; firstError: string | null } {
        const { count: meetingCount } = this.db.prepare('SELECT COUNT(*) AS count FROM meetings').get() as { count: number };
        const { count: failedMeetings } = this.db.prepare(`
            SELECT COUNT(DISTINCT meeting_id) AS count FROM embedding_queue
            WHERE status = 'failed' AND meeting_id IN (SELECT id FROM meetings)
        `).get() as { count: number };
        const failure = this.db.prepare(`
            SELECT error_message FROM embedding_queue
            WHERE status = 'failed' AND error_message IS NOT NULL AND meeting_id IN (SELECT id FROM meetings)
            ORDER BY id LIMIT 1
        `).get() as { error_message: string } | undefined;
        return { meetingCount, failedMeetings, firstError: failure?.error_message.split(/[\r\n]/, 1)[0] ?? null };
    }

    retryFailedEmbeddings(): Promise<void> {
        return this.embeddingPipeline.retryFailedEmbeddings();
    }

    /**
     * Retry pending embeddings
     */
    async retryPendingEmbeddings(): Promise<void> {
        await this.embeddingPipeline.processQueue();
    }

    /**
     * Check if a meeting has been processed for RAG
     */
    isMeetingProcessed(meetingId: string): boolean {
        return this.vectorStore.hasEmbeddings(meetingId);
    }

    // ─── JIT RAG: Live Meeting Indexing ──────────────────────────────

    /**
     * Start JIT indexing for a live meeting.
     * Call when a meeting session begins.
     */
    startLiveIndexing(meetingId: string): void {
        if (!this.embeddingPipeline.isReady()) {
            console.log('[RAGManager] Embedding pipeline not ready, skipping live indexing');
            return;
        }

        if (!this.db.prepare('SELECT 1 FROM meetings WHERE id = ?').get(meetingId)) return;
        this.liveIndexer.start(meetingId);
    }

    /**
     * Feed new transcript segments to the live indexer.
     * Call whenever new transcript arrives during the meeting.
     */
    feedLiveTranscript(segments: RawSegment[]): void {
        this.liveIndexer.feedSegments(segments);
    }

    /**
     * Stop JIT indexing (flushes remaining segments).
     * Call when the meeting session ends.
     * NOTE: The post-meeting processMeeting() will later replace JIT chunks
     * with the complete, properly indexed version.
     */
    async stopLiveIndexing(): Promise<void> {
        await this.liveIndexer.stop();
    }

    getActiveLiveMeetingId(): string | null {
        return this.liveIndexer.getActiveMeetingId();
    }

    /**
     * Check if JIT indexing is active for a meeting.
     */
    isLiveIndexingActive(meetingId?: string): boolean {
        if (meetingId) {
            return this.liveIndexer.getActiveMeetingId() === meetingId;
        }
        return this.liveIndexer.isRunning();
    }

    /**
     * Delete RAG data for a meeting
     */
    deleteMeetingData(meetingId: string): void {
        this.db.transaction(() => {
            this.vectorStore.clearNativeVectorsForMeeting(meetingId);
            this.db.prepare('DELETE FROM chunks WHERE meeting_id = ?').run(meetingId);
            this.db.prepare('DELETE FROM chunk_summaries WHERE meeting_id = ?').run(meetingId);
            this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run(meetingId);
        })();
    }

    private deleteMeetingChunks(meetingId: string): void {
        this.vectorStore.clearNativeVectorsForMeeting(meetingId, 'chunks');
        this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ? AND chunk_id IS NOT NULL').run(meetingId);
        this.db.prepare('DELETE FROM chunks WHERE meeting_id = ?').run(meetingId);
    }

    /**
     * Manually trigger processing for a meeting
     * Useful for demo meetings or reprocessing failed ones
     */
    async reprocessMeeting(meetingId: string): Promise<void> {
        // Guard: if this meeting is already being reprocessed, skip to prevent
        // concurrent runs from clearing each other's queue work.
        if (this._reprocessInFlight.has(meetingId)) {
            console.log(`[RAGManager] Reprocessing already in-flight for ${meetingId}, skipping duplicate call`);
            return;
        }
        this._reprocessInFlight.add(meetingId);

        console.log(`[RAGManager] Reprocessing meeting ${meetingId}`);

        try {
            // delete existing RAG data first to avoid duplicates
            this.deleteMeetingData(meetingId);

            // Fetch meeting details from DB
            const { DatabaseManager } = require('../db/DatabaseManager');
            const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);

            if (!meeting) {
                console.error(`[RAGManager] Meeting ${meetingId} not found for reprocessing`);
                return;
            }

            if (!meeting.transcript || meeting.transcript.length === 0) {
                console.log(`[RAGManager] Meeting ${meetingId} has no transcript, skipping`);
                return;
            }

            // Convert to RawSegment format
            const segments = meeting.transcript.map((t: any) => ({
                speaker: t.speaker,
                text: t.text,
                timestamp: t.timestamp
            }));

            // Get summary if available
            let summary: string | undefined;
            if (meeting.detailedSummary) {
                summary = [
                    ...(meeting.detailedSummary.overview ? [meeting.detailedSummary.overview] : []),
                    ...(meeting.detailedSummary.keyPoints || []),
                    ...(meeting.detailedSummary.actionItems || []).map((a: any) => `Action: ${a}`)
                ].join('. ');
            } else if (meeting.summary) {
                summary = meeting.summary;
            }

            await this.processMeeting(meetingId, segments, summary);
        } finally {
            this._reprocessInFlight.delete(meetingId);
        }
    }

    /**
     * Ensure demo meeting is processed
     * Checks if demo meeting exists but has no chunks, then processes it
     */
    async ensureDemoMeetingProcessed(): Promise<void> {
        const demoId = 'demo-meeting'; // Corrected ID to match DatabaseManager

        // Check if demo meeting exists in DB
        const { DatabaseManager } = require('../db/DatabaseManager');
        const meeting = DatabaseManager.getInstance().getMeetingDetails(demoId);

        if (!meeting) {
            // console.log('[RAGManager] Demo meeting not found in DB, skipping RAG processing');
            return;
        }

        // Check if already processed (has embeddings)
        if (this.isMeetingProcessed(demoId)) {
            // console.log('[RAGManager] Demo meeting already processed');
            return;
        }

        // Guard: also check the in-flight set — reprocessMeeting() itself is guarded,
        // but checking here avoids even printing the "Processing now..." log redundantly.
        if (this._reprocessInFlight.has(demoId)) {
            console.log(`[RAGManager] Demo meeting reprocessing already in-flight, skipping`);
            return;
        }

        console.log('[RAGManager] Demo meeting found but not processed. Processing now...');
        await this.reprocessMeeting(demoId);
    }

    /**
     * Cleanup stale queue items for meetings that no longer exist
     */
    public cleanupStaleQueueItems(): void {
        try {
            const info = this.db.prepare(`
                DELETE FROM embedding_queue 
                WHERE meeting_id NOT IN (SELECT id FROM meetings)
            `).run();
            if (info.changes > 0) {
                console.log(`[RAGManager] Cleaned up ${info.changes} stale queue items`);
            }
        } catch (error) {
            console.error('[RAGManager] Failed to cleanup stale queue items:', error);
        }
    }

    reindexAllMeetings(): Promise<void> {
        this.reindexAllPromise ??= this.reindexAll().finally(() => { this.reindexAllPromise = null; });
        return this.reindexAllPromise;
    }

    private async reindexAll(): Promise<void> {
        await this.embeddingPipeline.processQueue();
        if (!this.embeddingPipeline.isReady()) throw new Error('No active embedding provider available');
        const meetings = this.db.prepare('SELECT id FROM meetings ORDER BY id').all() as { id: string }[];
        this.db.transaction(() => {
            for (const { id } of meetings) {
                const hasChunks = this.db.prepare('SELECT 1 FROM chunks WHERE meeting_id = ?').get(id);
                const hasSummary = this.db.prepare('SELECT 1 FROM chunk_summaries WHERE meeting_id = ?').get(id);
                if (!hasChunks || !hasSummary) {
                    const meeting = DatabaseManager.getInstance().getMeetingDetails(id);
                    if (!meeting) continue;
                    if (!hasChunks) {
                        this.vectorStore.saveChunks(chunkTranscript(id, preprocessTranscript(meeting.transcript ?? [])));
                    }
                    const summary = buildMeetingSummaryText(meeting);
                    if (!hasSummary && summary) this.vectorStore.saveSummary(id, summary);
                }
                this.embeddingPipeline.queueMeetingReindex(id);
            }
        })();
        await this.embeddingPipeline.processQueue();
    }

    /**
     * Trigger bulk re-indexing of meetings with obsolete/incompatible embedding dimensions.
     * Deletes their unreadable geometric BLOBs and requeues them via the active EmbeddingPipeline.
     */
    async reindexIncompatibleMeetings(): Promise<void> {
        await this.embeddingPipeline.processQueue();
        const providerName = this.embeddingPipeline.getActiveProviderName();
        if (!providerName) throw new Error('No active embedding provider available');
        const affectedMeetingIds = this.vectorStore.deleteEmbeddingsForMeetings(providerName);
        
        for (const meetingId of affectedMeetingIds) {
            // Completed/failed queue rows belong to the old index and must not block new work.
            this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run(meetingId);
            const indexedText = this.db.prepare(`
                SELECT 1 FROM chunks WHERE meeting_id = ?
                UNION ALL SELECT 1 FROM chunk_summaries WHERE meeting_id = ? LIMIT 1
            `).get(meetingId, meetingId);
            if (indexedText) await this.embeddingPipeline.queueMeeting(meetingId);
            else await this.reprocessMeeting(meetingId);
        }

        console.log(`[RAGManager] Successfully requeued ${affectedMeetingIds.length} meetings for re-embedding.`);
    }
}
