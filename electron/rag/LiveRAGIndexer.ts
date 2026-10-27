// electron/rag/LiveRAGIndexer.ts
// JIT RAG: Incrementally indexes transcript during a live meeting.
//
// Architecture:
// - Background timer (30s) chunks & embeds NEW transcript segments
// - Embedding never blocks the query path; stop waits for the active batch and drains the tail
// - At query time, VectorStore already has indexed chunks for fast search
// - Falls back gracefully if embedding API unavailable

import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript } from './SemanticChunker';
import { VectorStore } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';

const INDEXING_INTERVAL_MS = 30_000;  // 30 seconds
const MIN_NEW_SEGMENTS = 3;           // Don't chunk unless we have enough new content

interface LiveSession {
    meetingId: string;
    allSegments: RawSegment[];
    indexedSegmentCount: number;
    chunkCounter: number;
    indexedChunkCount: number;
    isActive: boolean;
    timer: ReturnType<typeof setInterval> | null;
    processingPromise: Promise<void> | null;
    stopPromise: Promise<void> | null;
}

export class LiveRAGIndexer {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private session: LiveSession | null = null;

    constructor(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline) {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /**
     * Start live indexing for a meeting.
     * Begins a background timer that periodically chunks & embeds new transcript.
     * Any superseded batch loses permission to write.
     */
    start(meetingId: string): void {
        void this.stop();
        const session: LiveSession = {
            meetingId,
            allSegments: [],
            indexedSegmentCount: 0,
            chunkCounter: 0,
            indexedChunkCount: 0,
            isActive: true,
            timer: null,
            processingPromise: null,
            stopPromise: null,
        };
        this.session = session;
        session.timer = setInterval(() => {
            void this.tick();
        }, INDEXING_INTERVAL_MS);
        console.log(`[LiveRAGIndexer] Started for meeting ${meetingId}`);
    }

    /**
     * Feed new transcript segments from the live meeting.
     * Called by SessionTracker whenever new transcript arrives.
     * This is append-only — segments are never modified after being fed.
     */
    feedSegments(segments: RawSegment[]): void {
        if (!this.session?.isActive) return;
        this.session.allSegments.push(...segments);
    }

    private tick(force = false): Promise<void> {
        const session = this.session;
        if (!session || (!session.isActive && !force) || session.processingPromise) return Promise.resolve();

        const end = session.allSegments.length;
        const count = end - session.indexedSegmentCount;
        if (count === 0 || (!force && count < MIN_NEW_SEGMENTS)) return Promise.resolve();

        session.processingPromise = this.processBatch(session, end).finally(() => {
            session.processingPromise = null;
        });
        return session.processingPromise;
    }

    private async processBatch(session: LiveSession, end: number): Promise<void> {
        try {
            const cleaned = preprocessTranscript(session.allSegments.slice(session.indexedSegmentCount, end));
            const chunks = chunkTranscript(session.meetingId, cleaned).map((chunk, i) => ({
                ...chunk,
                chunkIndex: session.chunkCounter + i,
            }));
            if (chunks.length > 0) {
                const chunkIds = this.vectorStore.saveChunks(chunks);
                session.chunkCounter += chunks.length;
                const embedded = await this.embeddingPipeline.embedLiveChunks(chunkIds, () => this.session === session);
                if (this.session !== session) return;
                session.indexedChunkCount += embedded;
                console.log(`[LiveRAGIndexer] Embedded ${embedded}/${chunkIds.length} chunks for meeting ${session.meetingId}`);
            }
            // Arrivals during embedding belong to the next batch, not this cursor.
            session.indexedSegmentCount = end;
        } catch {
            console.error('[LiveRAGIndexer] Processing failed');
        }
    }

    /** Stop accepting input, finish the active batch, then force the pending tail. */
    stop(): Promise<void> {
        const session = this.session;
        if (!session) return Promise.resolve();
        if (session.stopPromise) return session.stopPromise;

        session.isActive = false;
        if (session.timer) {
            clearInterval(session.timer);
            session.timer = null;
        }
        session.stopPromise = (async () => {
            await session.processingPromise;
            if (this.session !== session) return;
            await this.tick(true);
            if (this.session !== session) return;
            this.session = null;
            console.log(`[LiveRAGIndexer] Stopped for meeting ${session.meetingId}`);
        })();
        return session.stopPromise;
    }

    /**
     * Check if there are any queryable JIT chunks for the current meeting.
     */
    hasIndexedChunks(): boolean {
        return this.getIndexedChunkCount() > 0;
    }

    /**
     * Get the number of chunks with embeddings (queryable).
     */
    getIndexedChunkCount(): number {
        return this.session?.indexedChunkCount ?? 0;
    }

    /**
     * Get the meeting ID currently being indexed.
     */
    getActiveMeetingId(): string | null {
        return this.session?.meetingId ?? null;
    }

    /**
     * Check if actively indexing.
     */
    isRunning(): boolean {
        return this.session?.isActive ?? false;
    }
}
