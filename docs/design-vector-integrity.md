# Design: vector integrity (V1)

Status: approved by the owner on 2026-10-28 (analysis and plan; the fallback change is called out below for acceptance). Step V1 `vector-integrity` in `TASKS.md`; it comes before K3b.

## Why

K3a (`refreshMeetingSummary`) exposed three older defects in the embedding store. Each was verified in code.

1. **A single failed job rewrites a whole meeting.** When any queue job (a chunk or the summary) fails `MAX_RETRIES` times with the primary provider, `EmbeddingPipeline.activateMeetingFallback` clears every vector of that meeting, re-embeds it with the local model and records the local provider on the meeting. Retrieval filters by the active provider (`RAGRetriever` calls `getActiveProviderName()` and the SQL compares `meetings.embedding_provider`), so after a fallback the meeting is silently excluded from search while it looks indexed. K3a's provider/dimension guard makes this easier to hit: after an embedding-provider switch, editing a summary is refused by the guard, exhausts its retries and wipes the whole meeting.
2. **Native vector writes can silently diverge from the BLOB.** `VectorStore.storeEmbedding` and `storeSummaryEmbedding` write the BLOB column, then `INSERT OR REPLACE` into the per-dimension `vec0` table inside a `try` that only logs a warning. The installed `vec0` rejects an insert on an existing primary key, so re-embedding a row leaves the old native vector in place while the BLOB is new. Native search then returns a stale vector with no error.
3. **Cleanup misses dimensions and deleted meetings keep their vectors.** `clearEmbeddingsForMeeting` and `deleteEmbeddingsForMeetings` clear only `DatabaseManager.KNOWN_DIMS` (768, 1536, 3072), although `ensureVecTableForDim` provisions other dimensions on demand. `DatabaseManager.deleteMeeting` deletes the `meetings` row only; `vec0` tables are virtual and do not cascade. Row ids are `AUTOINCREMENT`, so a leftover vector can never attach to a different row (no wrong hits), but a deleted meeting's text vectors stay in the database file.

## Decisions

- **One place discovers and clears native vectors.** `VectorStore` gets one method that clears a meeting's chunk and summary vectors from every `vec_chunks_<n>` and `vec_summaries_<n>` table found in `sqlite_master` (not a fixed list). `clearEmbeddingsForMeeting`, `deleteEmbeddingsForMeetings`, `RAGManager.deleteMeetingChunks` and `RAGManager.refreshMeetingSummary` use it; the three copies of the table-discovery loop go away. Deleting a meeting calls it too, so a deleted meeting leaves no vectors.
- **A native write replaces, then fails loudly.** Before inserting a native vector the store deletes any existing row for that id in that dimension; an insert error is thrown, not logged. Callers already run inside a transaction (`embedChunk`, `embedMeetingSummary`), so a failed native write rolls back the BLOB too, and the queue retries with the real error. When native search is off (`useNativeVec` false) nothing changes.
- **No whole-meeting fallback.** A job that exhausts its retries stays `failed` with its real error message; the meeting keeps its recorded provider and the vectors it already has. `activateMeetingFallback`, `fallbackMeetings` and the retry-count sentinel `-1` go away. The IPC channel name `embedding:fallback-activated` and its preload/type declarations stay (a released contract) but nothing sends it; if the renderer has a listener that now never fires, say so in the report and leave it. Retry and Re-index all are K6.

## Not in this step

No schema change and no migration. No sweep of historical orphan vector rows (harmless: ids never repeat; K6's Re-index all may rebuild them). No change to retrieval filters, the queue runner, summary callers (K3b) or the local provider itself.

## Behaviour change for the owner to accept

Before: when the primary provider failed three times for a job, Pika quietly switched the meeting to the local model and the meeting became unsearchable. After: the job is `failed` with the provider's message, the meeting stays as it was, and the Search index status shows the failed count. Nothing is lost; nothing is silently downgraded.

## Tests

Synthetic temporary databases and a fake provider, native and JS paths: re-embedding a row replaces its native vector (the query returns the new one); a failed native write rolls back the BLOB and retries; a dynamic dimension (for example 1024) is cleared by every clear path; deleting a meeting leaves no vector rows in any dimension; a job that exhausts its retries stays `failed` and the meeting's provider, dimensions and other vectors are unchanged; no `embedding:fallback-activated` is sent; the K3a tests still pass.
