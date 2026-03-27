import Database from 'better-sqlite3';
import { DocType, EmbedFn, ChunkRow } from './types';

export interface ScoredChunk {
  id: number;
  text: string;
  score: number;
  metadata: any;
  docType: string;
}

export class KnowledgeVectorStore {
  private db: Database.Database;
  private vecTableReady: boolean = false;
  private embeddingDim: number | null = null;
  private ensuredDims = new Set<number>();

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Store embeddings for chunks. Called after document ingestion.
   */
  async storeEmbeddings(
    chunks: Array<{ id: number; text: string }>,
    embedFn: EmbedFn
  ): Promise<void> {
    for (const chunk of chunks) {
      const embedding = await embedFn(chunk.text);
      if (!Array.isArray(embedding) || embedding.length === 0) {
        continue;
      }

      const blob = this.embeddingToBlob(embedding);
      this.db.prepare('UPDATE knowledge_chunks SET embedding = ? WHERE id = ?').run(blob, chunk.id);

      const dim = embedding.length;
      this.embeddingDim = this.embeddingDim ?? dim;

      if (this.ensureVecTableForDim(dim)) {
        try {
          this.db.prepare(
            `INSERT OR REPLACE INTO vec_knowledge_${dim}(chunk_id, embedding) VALUES (?, ?)`
          ).run(BigInt(chunk.id), blob);
        } catch (error) {
          console.warn(`[KnowledgeVectorStore] Failed to insert into vec_knowledge_${dim}:`, error);
        }
      }
    }
  }

  /**
   * Search for similar chunks using cosine similarity.
   * Uses sqlite-vec if available, falls back to JS cosine over BLOB embeddings.
   */
  searchSimilar(
    queryEmbedding: number[],
    limit: number,
    docType?: DocType
  ): ScoredChunk[] {
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0 || limit <= 0) {
      return [];
    }

    const nativeResults = this.searchSimilarNative(queryEmbedding, limit, docType);
    if (nativeResults) {
      return nativeResults;
    }

    return this.searchSimilarJS(queryEmbedding, limit, docType);
  }

  /**
   * Check if any chunks have embeddings stored.
   */
  hasEmbeddings(): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM knowledge_chunks WHERE embedding IS NOT NULL')
      .get() as { count: number };

    return row.count > 0;
  }

  /**
   * Delete all embeddings (but keep chunks) for a doc type.
   */
  clearEmbeddings(docType?: DocType): void {
    const rows = docType
      ? (this.db.prepare(`
          SELECT id, embedding
          FROM knowledge_chunks
          WHERE doc_type = ? AND embedding IS NOT NULL
        `).all(docType) as Array<{ id: number; embedding: Buffer | null }>)
      : (this.db.prepare(`
          SELECT id, embedding
          FROM knowledge_chunks
          WHERE embedding IS NOT NULL
        `).all() as Array<{ id: number; embedding: Buffer | null }>);

    if (rows.length > 0) {
      const idsByDim = new Map<number, number[]>();

      for (const row of rows) {
        if (!row.embedding) continue;
        const dim = Math.floor(row.embedding.byteLength / 4);
        if (!Number.isInteger(dim) || dim <= 0) continue;

        const ids = idsByDim.get(dim) ?? [];
        ids.push(row.id);
        idsByDim.set(dim, ids);
      }

      for (const [dim, ids] of idsByDim) {
        if (!this.isValidDim(dim)) continue;
        const placeholders = ids.map(() => '?').join(',');
        try {
          this.db.prepare(
            `DELETE FROM vec_knowledge_${dim} WHERE chunk_id IN (${placeholders})`
          ).run(...ids);
        } catch {
          // Table may not exist or sqlite-vec may be unavailable.
        }
      }
    }

    if (docType) {
      this.db.prepare('UPDATE knowledge_chunks SET embedding = NULL WHERE doc_type = ?').run(docType);
    } else {
      this.db.prepare('UPDATE knowledge_chunks SET embedding = NULL').run();
    }
  }

  private searchSimilarNative(
    queryEmbedding: number[],
    limit: number,
    docType?: DocType
  ): ScoredChunk[] | null {
    const dim = queryEmbedding.length;
    const queryBlob = this.embeddingToBlob(queryEmbedding);

    if (!this.ensureVecTableForDim(dim)) {
      return null;
    }

    try {
      const fetchLimit = docType ? limit * 4 : limit;
      const vecRows = this.db.prepare(`
        SELECT chunk_id, distance
        FROM vec_knowledge_${dim}
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `).all(queryBlob, fetchLimit) as Array<{ chunk_id: number; distance: number }>;

      if (vecRows.length === 0) {
        return [];
      }

      const chunkIds = vecRows.map((row) => Number(row.chunk_id));
      const placeholders = chunkIds.map(() => '?').join(',');
      let query = `
        SELECT id, text, metadata, doc_type
        FROM knowledge_chunks
        WHERE id IN (${placeholders})
      `;
      const params: Array<number | string> = [...chunkIds];

      if (docType) {
        query += ' AND doc_type = ?';
        params.push(docType);
      }

      const chunkRows = this.db.prepare(query).all(...params) as Array<Pick<ChunkRow, 'id' | 'text' | 'metadata' | 'doc_type'>>;
      const chunkMap = new Map<number, Pick<ChunkRow, 'id' | 'text' | 'metadata' | 'doc_type'>>();

      for (const row of chunkRows) {
        chunkMap.set(row.id, row);
      }

      const scored: ScoredChunk[] = [];
      for (const vecRow of vecRows) {
        const chunk = chunkMap.get(Number(vecRow.chunk_id));
        if (!chunk) continue;

        scored.push({
          id: chunk.id,
          text: chunk.text,
          score: 1 - vecRow.distance,
          metadata: this.parseMetadata(chunk.metadata),
          docType: chunk.doc_type,
        });

        if (scored.length >= limit) {
          break;
        }
      }

      return scored;
    } catch (error) {
      console.warn('[KnowledgeVectorStore] Native vec search failed, falling back to JS cosine similarity:', error);
      return null;
    }
  }

  private searchSimilarJS(
    queryEmbedding: number[],
    limit: number,
    docType?: DocType
  ): ScoredChunk[] {
    let query = `
      SELECT id, text, metadata, doc_type, embedding
      FROM knowledge_chunks
      WHERE embedding IS NOT NULL
    `;
    const params: Array<string> = [];

    if (docType) {
      query += ' AND doc_type = ?';
      params.push(docType);
    }

    query += ' ORDER BY doc_id, chunk_index';

    const rows = this.db.prepare(query).all(...params) as Array<Pick<ChunkRow, 'id' | 'text' | 'metadata' | 'doc_type'> & { embedding: Buffer | null }>;
    if (rows.length === 0) {
      return [];
    }

    const dim = queryEmbedding.length;
    const expectedByteLength = dim * 4;
    const scored: Array<ScoredChunk> = [];

    for (const row of rows) {
      if (!row.embedding || row.embedding.byteLength !== expectedByteLength) {
        continue;
      }

      const embedding = this.blobToEmbedding(row.embedding);
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      scored.push({
        id: row.id,
        text: row.text,
        score,
        metadata: this.parseMetadata(row.metadata),
        docType: row.doc_type,
      });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private ensureVecTableForDim(dim: number): boolean {
    if (!this.isValidDim(dim)) {
      return false;
    }

    if (this.ensuredDims.has(dim)) {
      this.vecTableReady = true;
      this.embeddingDim = dim;
      return true;
    }

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_knowledge_${dim} USING vec0(
          chunk_id INTEGER PRIMARY KEY,
          embedding float[${dim}]
        );
      `);

      this.ensuredDims.add(dim);
      this.vecTableReady = true;
      this.embeddingDim = dim;
      return true;
    } catch (error) {
      this.vecTableReady = false;
      console.warn(`[KnowledgeVectorStore] sqlite-vec unavailable for dim=${dim}, using JS fallback:`, error);
      return false;
    }
  }

  private isValidDim(dim: number): boolean {
    return Number.isInteger(dim) && dim > 0 && dim <= 100_000;
  }

  private embeddingToBlob(embedding: number[]): Buffer {
    const float32 = new Float32Array(embedding);
    return Buffer.from(float32.buffer.slice(0));
  }

  private blobToEmbedding(blob: Buffer): number[] {
    const float32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return Array.from(float32);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return -1;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return -1;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private parseMetadata(metadata: string | null): any {
    if (!metadata) {
      return null;
    }

    try {
      return JSON.parse(metadata);
    } catch {
      return metadata;
    }
  }
}
