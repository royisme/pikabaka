// electron/rag/EmbeddingPipeline.ts
// Post-meeting embedding generation with queue-based retry logic
// Uses pluggable IEmbeddingProvider (Gemini, OpenAI, or Ollama)
// Exhausted jobs fail without changing the meeting's provider or existing vectors.

import Database from 'better-sqlite3';
import { VectorStore } from './VectorStore';

import { EmbeddingProviderResolver, AppAPIConfig } from './EmbeddingProviderResolver';
import { IEmbeddingProvider } from './providers/IEmbeddingProvider';
import { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 2000;

/**
 * EmbeddingPipeline - Handles post-meeting embedding generation
 * 
 * Design:
 * - NOT real-time: embeddings generated after meeting ends
 * - Queue-based: persists in SQLite for retry on failure
 * - Background processing: doesn't block UI
 * - Provider-agnostic: works with Gemini, OpenAI, or Ollama embeddings
 */
export class EmbeddingPipeline {
    private provider: IEmbeddingProvider | null = null;
    /** Local provider used only if primary initialization fails. */
    private fallbackProvider: IEmbeddingProvider | null = null;
    private db: Database.Database;
    private vectorStore: VectorStore;
    private processingPromise: Promise<void> | null = null;
    private reindexMeetings = new Set<string>();
    private liveBatches = new Set<Promise<number>>();
    private initPromise: Promise<void> | null = null;
    /** Tracks the config used in the most recent successful initialize() call to enable idempotency. */
    private _lastConfig: AppAPIConfig | null = null;

    constructor(db: Database.Database, vectorStore: VectorStore) {
        this.db = db;
        this.vectorStore = vectorStore;
    }

    /**
     * Initialize with provider config (picks best available provider)
     * Idempotent: re-initialization only runs if the new config adds at least one
     * key/URL that was not present in the last config (e.g., Ollama becomes available,
     * or a cloud API key is loaded from CredentialsManager after startup).
     * If the config is unchanged or strictly worse, the existing initPromise is returned.
     */
    async initialize(config: AppAPIConfig, options?: { force?: boolean }): Promise<void> {
        // Skip if config is identical or has no new information
        if (!options?.force && this._lastConfig && !this._isConfigImprovement(this._lastConfig, config)) {
            console.log('[EmbeddingPipeline] Config unchanged or no new keys — skipping re-initialization');
            return this.initPromise ?? Promise.resolve();
        }
        this._lastConfig = { ...config };
        console.log('[EmbeddingPipeline] Initializing embedding provider');
        const previous = this.initPromise;
        this.initPromise = (async () => {
            await previous?.catch(() => {});
            // Finish in-flight writes before a forced model switch changes index metadata.
            if (options?.force) await Promise.all([this.processingPromise, ...this.liveBatches]);
            this.provider = null;
            await this._doInitialize(config);
        })();
        return this.initPromise;
    }

    /**
     * Returns true if `next` provides at least one credential that `prev` did not have.
     * Prevents redundant re-initialization when the same keys are passed again.
     */
    private _isConfigImprovement(prev: AppAPIConfig, next: AppAPIConfig): boolean {
        const hasNew = (prevVal: string | undefined, nextVal: string | undefined) =>
            !prevVal && !!nextVal;
        return (
            hasNew(prev.openaiKey, next.openaiKey) ||
            hasNew(prev.geminiKey, next.geminiKey) ||
            hasNew(prev.ollamaUrl, next.ollamaUrl) ||
            prev.selected?.connection.id !== next.selected?.connection.id ||
            prev.selected?.model !== next.selected?.model
        );
    }

    private async _doInitialize(config: AppAPIConfig): Promise<void> {
        // Initialize the local provider independently so primary initialization can recover.
        try {
            const local = new LocalEmbeddingProvider();
            if (await local.isAvailable()) {
                this.fallbackProvider = local;
                console.log(`[EmbeddingPipeline] Local fallback provider ready (${local.dimensions}d)`);
            } else {
                console.warn('[EmbeddingPipeline] Local fallback provider unavailable — bundled model may be missing');
            }
        } catch (e) {
            console.warn('[EmbeddingPipeline] Could not initialize local fallback provider:', e);
        }

        // ── Step 2: Resolve primary provider.
        try {
            this.provider = await EmbeddingProviderResolver.resolve(config);
            console.log(`[EmbeddingPipeline] Ready with provider: ${this.provider.name} (${this.provider.dimensions}d)`);

            // If the primary IS local, point fallbackProvider at the same instance to avoid
            // loading the model twice.
            if (this.provider instanceof LocalEmbeddingProvider) {
                this.fallbackProvider = this.provider;
            }

            // Check for previous provider mismatches
            const stateRow = this.db.prepare("SELECT value FROM app_state WHERE key = 'last_embedding_provider'").get() as any;
            const lastProvider = stateRow?.value;

            if (lastProvider && lastProvider !== this.provider.name) {
                const count = this.vectorStore.getIncompatibleMeetingsCount(this.provider.name);
                if (count > 0) {
                    console.log(`[EmbeddingPipeline] Found ${count} incompatible meetings from ${lastProvider}.`);
                    const { BrowserWindow } = require('electron');
                    BrowserWindow.getAllWindows().forEach((win: any) => {
                        if (!win.isDestroyed()) {
                            win.webContents.send('embedding:incompatible-provider-warning', {
                                count,
                                oldProvider: lastProvider,
                                newProvider: this.provider!.name
                            });
                        }
                    });
                }
            }

            // Save new provider
            this.db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_embedding_provider', ?)").run(this.provider.name);

        } catch (err) {
            console.error('[EmbeddingPipeline] Failed to initialize primary provider:', err);
            // Don't rethrow — if we have a fallback, the pipeline can still function
            // in local-only mode. Callers check isReady() which checks this.provider.
            // Only throw if we also have no fallback at all.
            if (!this.fallbackProvider) {
                throw err;
            }
            console.warn('[EmbeddingPipeline] Falling back to local-only mode for all meetings.');
            // Promote fallback as the primary so isReady() returns true and queueing works.
            this.provider = this.fallbackProvider;
            // Persist the fallback provider name so the next launch does not fire a
            // false-positive incompatible-provider warning (e.g. 'openai' vs 'local').
            try {
                this.db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_embedding_provider', ?)").run(this.provider.name);
            } catch (_) { /* non-fatal — DB may not have app_state yet in edge cases */ }
        }
    }

    getStatus(): { providerName: string | null; dimensions: number | null; usingSelected: boolean } {
        const selected = this._lastConfig?.selected;
        return {
            providerName: this.provider?.name ?? null,
            dimensions: this.provider?.dimensions ?? null,
            usingSelected: !!selected && this.provider?.name === `${selected.connection.id}:${selected.model}`,
        };
    }

    /**
     * Check if pipeline is ready
     */
    isReady(): boolean {
        return this.provider !== null;
    }

    /**
     * Wait for the pipeline to finish initializing.
     * Safe to call multiple times — resolves immediately if already ready.
     * Throws if initialization failed entirely.
     */
    async waitForReady(timeoutMs: number = 15000): Promise<void> {
        if (this.provider) return; // already ready
        if (this.initPromise) {
            // Race against a timeout so we don't hang forever
            await Promise.race([
                this.initPromise,
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error(`Embedding pipeline initialization timed out after ${timeoutMs}ms`)), timeoutMs)
                )
            ]);
            return;
        }
        throw new Error('Embedding pipeline has not been initialized');
    }

    /**
     * Get the currently active provider name (used for dimension safety checks)
     */
    getActiveProviderName(): string | undefined {
        return this.provider?.name;
    }

    /**
     * Queue a meeting for embedding processing
     * Called when meeting ends
     */
    async queueMeeting(meetingId: string): Promise<void> {
        // Get chunks without embeddings
        const chunks = this.vectorStore.getChunksWithoutEmbeddings(meetingId);

        const summary = this.db.prepare('SELECT 1 FROM chunk_summaries WHERE meeting_id = ? AND embedding IS NULL').get(meetingId);
        if (chunks.length === 0 && !summary) {
            console.log(`[EmbeddingPipeline] No chunks to embed for meeting ${meetingId}`);
            return;
        }

        // Queue each chunk.
        // INSERT OR IGNORE prevents duplicate rows if queueMeeting() is called twice
        // for the same meeting (e.g., reprocessMeeting() path).
        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO embedding_queue (meeting_id, chunk_id, status)
            VALUES (?, ?, 'pending')
        `);

        const queueAll = this.db.transaction(() => {
            for (const chunk of chunks) {
                insert.run(meetingId, chunk.id);
            }
            this.queueMeetingSummary(meetingId);
        });

        queueAll();
        
        // NOTE: Provider metadata is written on the first successful embedding
        // for this meeting (inside embedChunk), not here — to avoid marking a
        // meeting as embedded if the queue crashes before any work is done.

        console.log(`[EmbeddingPipeline] Queued ${chunks.length} chunks + 1 summary for meeting ${meetingId}`);

        // Start processing in background
        this.processQueue().catch(err => {
            console.error('[EmbeddingPipeline] Queue processing error:', err);
        });
    }

    /**
     * NULL chunk ids bypass SQLite's unique constraint, so deduplicate summary work explicitly.
     */
    queueMeetingSummary(meetingId: string): void {
        this.db.transaction(() => {
            const queued = this.db.prepare(`
                SELECT 1 FROM embedding_queue
                WHERE meeting_id = ? AND chunk_id IS NULL AND status IN ('pending', 'processing')
            `).get(meetingId);
            if (queued) return;
            this.db.prepare(`
                INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES (?, NULL, 'pending')
            `).run(meetingId);
        })();
    }

    queueMeetingReindex(meetingId: string): void {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run(meetingId);
            this.db.prepare(`
                INSERT INTO embedding_queue (meeting_id, chunk_id, status)
                SELECT meeting_id, id, 'pending' FROM chunks WHERE meeting_id = ?
            `).run(meetingId);
            if (this.db.prepare('SELECT 1 FROM chunk_summaries WHERE meeting_id = ?').get(meetingId)) {
                this.queueMeetingSummary(meetingId);
            }
        })();
        this.reindexMeetings.add(meetingId);
    }

    /**
     * Process pending embeddings from queue, retaining exhausted jobs as failed.
     */
    processQueue(): Promise<void> {
        this.processingPromise ??= this._processQueue().finally(() => { this.processingPromise = null; });
        return this.processingPromise;
    }

    private async _processQueue(): Promise<void> {
        if (!this.provider) {
            console.log('[EmbeddingPipeline] No provider, skipping queue processing');
            return;
        }

        // Recover items stuck in 'processing' from a previous app crash.
        // These were marked 'processing' before the embed call but never completed.
        // Reset them to 'pending' so this run can pick them up.
        const stuckCount = this.db.prepare(
            `UPDATE embedding_queue SET status = 'pending' WHERE status = 'processing'`
        ).run().changes;
        if (stuckCount > 0) {
            console.warn(`[EmbeddingPipeline] Recovered ${stuckCount} stuck 'processing' items from prior crash.`);
        }

        while (true) {
            const pending = this.db.prepare(`
                SELECT * FROM embedding_queue
                WHERE status = 'pending'
                  AND retry_count < ?
                ORDER BY created_at ASC
                LIMIT 1
            `).get(MAX_RETRIES) as any;

            if (!pending) {
                console.log('[EmbeddingPipeline] Queue empty');
                break;
            }

            const activeProvider = this.provider;
            if (!activeProvider) {
                // Initialization may have changed the provider while the previous job was in flight.
                this.db.prepare(
                    `UPDATE embedding_queue SET error_message = 'No provider available' WHERE id = ?`
                ).run(pending.id);
                console.warn('[EmbeddingPipeline] No provider available. Stopping queue processing.');
                break;
            }

            const reindex = this.reindexMeetings.has(pending.meeting_id);
            const jobs = reindex ? this.db.prepare(`
                SELECT id FROM embedding_queue WHERE meeting_id = ? AND status = 'pending'
            `).all(pending.meeting_id) as { id: number }[] : [{ id: pending.id }];
            const ids = jobs.map(job => job.id);
            const placeholders = ids.map(() => '?').join(',');
            this.db.prepare(
                `UPDATE embedding_queue SET status = 'processing' WHERE id IN (${placeholders})`
            ).run(...ids);

            try {
                if (reindex) {
                    await this.embedWholeMeeting(pending.meeting_id, activeProvider);
                    this.reindexMeetings.delete(pending.meeting_id);
                } else if (pending.chunk_id) {
                    await this.embedChunk(pending.chunk_id, activeProvider);
                } else {
                    await this.embedMeetingSummary(pending.meeting_id, activeProvider);
                }

                // Mark as completed
                this.db.prepare(`
                    UPDATE embedding_queue
                    SET status = 'completed', processed_at = ?
                    WHERE id IN (${placeholders})
                `).run(new Date().toISOString(), ...ids);

            } catch (error: any) {
                const newRetryCount = pending.retry_count + 1;
                console.error(
                    `[EmbeddingPipeline] Error processing queue item ${pending.id} ` +
                    `(retry ${newRetryCount}/${MAX_RETRIES}, provider: ${activeProvider.name}):`,
                    error.message
                );

                const exhausted = newRetryCount >= MAX_RETRIES;
                this.db.prepare(`
                    UPDATE embedding_queue
                    SET status = ?, retry_count = ?, error_message = ?
                    WHERE id IN (${placeholders})
                `).run(exhausted ? 'failed' : 'pending', newRetryCount, error.message, ...ids);

                if (!exhausted) {
                    const delay = RETRY_DELAY_BASE_MS * Math.pow(2, pending.retry_count);
                    await this.delay(delay);
                }
            }
        }
    }

    async retryFailedEmbeddings(): Promise<void> {
        if (!this.provider) throw new Error('No active embedding provider available');
        // A failed rebuild can survive a restart with the old provider still recorded.
        const incompatible = this.db.prepare(`
            SELECT DISTINCT q.meeting_id FROM embedding_queue q JOIN meetings m ON m.id = q.meeting_id
            WHERE q.status = 'failed' AND m.embedding_provider IS NOT NULL
                AND (m.embedding_provider != ? OR m.embedding_dimensions != ?)
        `).all(this.provider.name, this.provider.dimensions) as { meeting_id: string }[];
        for (const row of incompatible) this.reindexMeetings.add(row.meeting_id);
        this.db.transaction(() => {
            // NULL chunk ids bypass the unique index, including on older failed summary jobs.
            this.db.prepare(`
                DELETE FROM embedding_queue WHERE status = 'failed' AND chunk_id IS NULL AND (
                    id NOT IN (SELECT MIN(id) FROM embedding_queue WHERE status = 'failed' AND chunk_id IS NULL GROUP BY meeting_id)
                    OR meeting_id IN (SELECT meeting_id FROM embedding_queue WHERE chunk_id IS NULL AND status IN ('pending', 'processing'))
                )
            `).run();
            this.db.prepare(`
                UPDATE embedding_queue SET status = 'pending', retry_count = 0, error_message = NULL, processed_at = NULL
                WHERE status = 'failed'
            `).run();
        })();
        await this.processQueue();
    }

    /**
     * Get embedding for a document chunk (for storage)
     */

    async getEmbedding(text: string): Promise<number[]> {
        if (!this.provider) {
            throw new Error('Embedding provider not initialized');
        }
        return this.provider.embed(text);
    }

    /**
     * Get embedding for a search query (may use different prefix for asymmetric models)
     */
    async getEmbeddingForQuery(text: string): Promise<number[]> {
        if (!this.provider) {
            throw new Error('Embedding provider not initialized');
        }
        return this.provider.embedQuery(text);
    }

    /** Capture one provider for the whole live batch, including its metadata writes. */
    embedLiveChunks(chunkIds: number[], isCurrent: () => boolean): Promise<number> {
        const provider = this.provider;
        if (!provider) return Promise.resolve(0);

        const batch = (async () => {
            let embedded = 0;
            for (const chunkId of chunkIds) {
                if (!isCurrent()) break;
                try {
                    if (await this.embedChunk(chunkId, provider, isCurrent)) embedded++;
                } catch {
                    console.warn(`[EmbeddingPipeline] Failed to embed live chunk ${chunkId} via ${provider.name}`);
                }
            }
            return embedded;
        })();
        this.liveBatches.add(batch);
        void batch.finally(() => { this.liveBatches.delete(batch); });
        return batch;
    }

    private async embedWholeMeeting(meetingId: string, provider: IEmbeddingProvider): Promise<void> {
        const readChunks = () => this.db.prepare(
            'SELECT id, cleaned_text FROM chunks WHERE meeting_id = ? ORDER BY id'
        ).all(meetingId) as { id: number; cleaned_text: string }[];
        const readSummary = () => this.db.prepare(
            'SELECT id, summary_text FROM chunk_summaries WHERE meeting_id = ?'
        ).get(meetingId) as { id: number; summary_text: string } | undefined;
        const chunks = readChunks();
        const summary = readSummary();
        const vectors: { id: number; embedding: number[] }[] = [];
        for (const chunk of chunks) vectors.push({ id: chunk.id, embedding: await provider.embed(chunk.cleaned_text) });
        const summaryVector = summary ? await provider.embed(summary.summary_text) : null;
        this.db.transaction(() => {
            if (!this.db.prepare('SELECT 1 FROM meetings WHERE id = ?').get(meetingId)) return;
            if (JSON.stringify(readChunks()) !== JSON.stringify(chunks) || JSON.stringify(readSummary()) !== JSON.stringify(summary)) {
                throw new Error('Meeting changed while re-indexing; retry required');
            }
            // Keep the entire old model until all replacement vectors exist, then swap together.
            this.vectorStore.clearNativeVectorsForMeeting(meetingId);
            for (const vector of vectors) this.vectorStore.storeEmbedding(vector.id, vector.embedding);
            if (summaryVector) this.vectorStore.storeSummaryEmbedding(meetingId, summaryVector);
            this.db.prepare('UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ? WHERE id = ?')
                .run(provider.name, provider.dimensions, meetingId);
        })();
    }

    /**
     * Embed a single chunk using the given provider (defaults to this.provider).
     */
    private async embedChunk(chunkId: number, provider?: IEmbeddingProvider, isCurrent = () => true): Promise<boolean> {
        const p = provider ?? this.provider;
        if (!p) throw new Error('No embedding provider');

        // Get chunk text
        const row = this.db.prepare('SELECT cleaned_text, meeting_id FROM chunks WHERE id = ?').get(chunkId) as any;
        if (!row) {
            console.log(`[EmbeddingPipeline] Chunk ${chunkId} not found, skipping`);
            return false;
        }

        const embedding = await p.embed(row.cleaned_text);
        if (!isCurrent()) return false;

        const stored = this.db.transaction(() => {
            if (!this.db.prepare('SELECT 1 FROM chunks WHERE id = ?').get(chunkId)) return false;
            const meeting = this.db.prepare(
                'SELECT embedding_provider, embedding_dimensions FROM meetings WHERE id = ?'
            ).get(row.meeting_id) as { embedding_provider: string | null; embedding_dimensions: number | null } | undefined;
            // Meeting metadata is shared by all its vectors; never stamp a new model onto old vectors.
            if (meeting?.embedding_provider != null &&
                (meeting.embedding_provider !== p.name || meeting.embedding_dimensions !== p.dimensions)) {
                throw new Error('Meeting embeddings use a different provider; rebuild required');
            }
            this.vectorStore.storeEmbedding(chunkId, embedding);
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ? WHERE id = ? AND embedding_provider IS NULL'
            ).run(p.name, p.dimensions, row.meeting_id);
            return true;
        })();
        if (stored) console.log(`[EmbeddingPipeline] Embedded chunk ${chunkId} via ${p.name}`);
        return stored;
    }

    /**
     * Embed meeting summary using the given provider (defaults to this.provider).
     */
    private async embedMeetingSummary(meetingId: string, provider?: IEmbeddingProvider): Promise<void> {
        const p = provider ?? this.provider;
        if (!p) throw new Error('No embedding provider');

        // Get summary text
        const row = this.db.prepare(
            'SELECT summary_text FROM chunk_summaries WHERE meeting_id = ?'
        ).get(meetingId) as { summary_text: string } | undefined;

        if (!row) {
            console.log(`[EmbeddingPipeline] No summary for meeting ${meetingId}, skipping`);
            return;
        }

        const embedding = await p.embed(row.summary_text);
        const stored = this.db.transaction(() => {
            const current = this.db.prepare(
                'SELECT summary_text FROM chunk_summaries WHERE meeting_id = ?'
            ).get(meetingId) as { summary_text: string } | undefined;
            if (!current || current.summary_text !== row.summary_text) return false;
            const meeting = this.db.prepare(
                'SELECT embedding_provider, embedding_dimensions FROM meetings WHERE id = ?'
            ).get(meetingId) as { embedding_provider: string | null; embedding_dimensions: number | null } | undefined;
            if (meeting?.embedding_provider != null &&
                (meeting.embedding_provider !== p.name || meeting.embedding_dimensions !== p.dimensions)) {
                throw new Error('Meeting embeddings use a different provider; rebuild required');
            }
            this.vectorStore.storeSummaryEmbedding(meetingId, embedding);
            this.db.prepare(
                'UPDATE meetings SET embedding_provider = ?, embedding_dimensions = ? WHERE id = ? AND embedding_provider IS NULL'
            ).run(p.name, p.dimensions, meetingId);
            return true;
        })();

        if (stored) console.log(`[EmbeddingPipeline] Embedded summary for meeting ${meetingId} via ${p.name}`);
    }

    /**
     * Get queue status
     */
    getQueueStatus(): { pending: number; processing: number; completed: number; failed: number } {
        const counts = this.db.prepare(`
            SELECT status, COUNT(*) as count FROM embedding_queue GROUP BY status
        `).all() as any[];

        const result = { pending: 0, processing: 0, completed: 0, failed: 0 };

        for (const row of counts) {
            if (row.status === 'pending') result.pending = row.count;
            else if (row.status === 'processing') result.processing = row.count;
            else if (row.status === 'completed') result.completed = row.count;
            else if (row.status === 'failed') result.failed = row.count;
        }

        // Older exhausted jobs may still be pending; report them as failed without double-counting.
        const effectivelyStalled = this.db.prepare(`
            SELECT COUNT(*) as count FROM embedding_queue 
            WHERE status = 'pending' AND retry_count >= ?
        `).get(MAX_RETRIES) as any;

        // Add stalled count on top of explicit status='failed' count (don't overwrite)
        result.failed += (effectivelyStalled.count || 0);
        // Deduct stalled items from pending so the totals are coherent
        result.pending = Math.max(0, result.pending - (effectivelyStalled.count || 0));

        return result;
    }

    /**
     * Clear completed queue items older than N days
     */
    cleanupQueue(daysOld: number = 7): void {
        const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
        this.db.prepare(`
            DELETE FROM embedding_queue 
            WHERE status = 'completed' AND processed_at < ?
        `).run(cutoff);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
