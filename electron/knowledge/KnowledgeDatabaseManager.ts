import Database from 'better-sqlite3';
import { DocumentRow, ChunkRow, DocType, CompanyDossier } from './types';

export class KnowledgeDatabaseManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
  }

  getDb(): Database.Database {
    return this.db;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_type TEXT NOT NULL,
        file_name TEXT,
        raw_text TEXT NOT NULL,
        parsed_data TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        doc_type TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        token_count INTEGER DEFAULT 0,
        embedding BLOB,
        metadata TEXT,
        UNIQUE(doc_id, chunk_index)
      );

      CREATE TABLE IF NOT EXISTS knowledge_company_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL UNIQUE,
        dossier TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS knowledge_negotiation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER,
        jd_id INTEGER,
        script TEXT,
        session_state TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_docs_type ON knowledge_documents(doc_type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);
    `);
  }

  // Documents
  upsertDocument(docType: DocType, fileName: string, rawText: string, parsedData: any): number {
    const upsert = this.db.transaction(() => {
      this.db.prepare('DELETE FROM knowledge_documents WHERE doc_type = ?').run(docType);

      const result = this.db.prepare(`
        INSERT INTO knowledge_documents (doc_type, file_name, raw_text, parsed_data)
        VALUES (?, ?, ?, ?)
      `).run(docType, fileName, rawText, JSON.stringify(parsedData ?? null));

      return Number(result.lastInsertRowid);
    });

    return upsert();
  }

  getDocumentByType(docType: DocType): DocumentRow | null {
    const row = this.db
      .prepare('SELECT * FROM knowledge_documents WHERE doc_type = ? LIMIT 1')
      .get(docType) as DocumentRow | undefined;

    return row ?? null;
  }

  deleteDocumentsByType(docType: DocType): void {
    this.db.prepare('DELETE FROM knowledge_documents WHERE doc_type = ?').run(docType);
  }

  // Chunks
  saveChunks(docId: number, chunks: Array<{ text: string; metadata?: any }>): number[] {
    const insertChunk = this.db.prepare(`
      INSERT INTO knowledge_chunks (doc_id, doc_type, chunk_index, text, token_count, metadata)
      SELECT id, doc_type, ?, ?, ?, ?
      FROM knowledge_documents
      WHERE id = ?
    `);

    const save = this.db.transaction((items: Array<{ text: string; metadata?: any }>) => {
      const ids: number[] = [];

      items.forEach((chunk, index) => {
        const result = insertChunk.run(
          index,
          chunk.text,
          0,
          JSON.stringify(chunk.metadata ?? null),
          docId,
        );

        ids.push(Number(result.lastInsertRowid));
      });

      return ids;
    });

    return save(chunks);
  }

  getChunksForDoc(docId: number): ChunkRow[] {
    return this.db
      .prepare('SELECT * FROM knowledge_chunks WHERE doc_id = ? ORDER BY chunk_index')
      .all(docId) as ChunkRow[];
  }

  getAllChunksByType(docType: DocType): ChunkRow[] {
    return this.db.prepare(`
      SELECT c.*
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON c.doc_id = d.id
      WHERE d.doc_type = ?
      ORDER BY c.chunk_index
    `).all(docType) as ChunkRow[];
  }

  storeChunkEmbedding(chunkId: number, embedding: Buffer): void {
    this.db.prepare('UPDATE knowledge_chunks SET embedding = ? WHERE id = ?').run(embedding, chunkId);
  }

  getChunksWithEmbeddings(docType?: DocType): Array<ChunkRow & { embedding: Buffer }> {
    if (docType) {
      return this.db.prepare(`
        SELECT c.*
        FROM knowledge_chunks c
        JOIN knowledge_documents d ON c.doc_id = d.id
        WHERE d.doc_type = ? AND c.embedding IS NOT NULL
        ORDER BY c.chunk_index
      `).all(docType) as Array<ChunkRow & { embedding: Buffer }>;
    }

    return this.db.prepare(`
      SELECT *
      FROM knowledge_chunks
      WHERE embedding IS NOT NULL
      ORDER BY doc_id, chunk_index
    `).all() as Array<ChunkRow & { embedding: Buffer }>;
  }

  // Company cache
  cacheCompanyDossier(company: string, dossier: CompanyDossier, ttlDays: number = 7): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_company_cache (company_name, dossier, created_at, expires_at)
      VALUES (?, ?, datetime('now'), datetime('now', '+' || ? || ' days'))
    `).run(company, JSON.stringify(dossier), ttlDays);
  }

  getCachedDossier(company: string): CompanyDossier | null {
    const row = this.db.prepare(`
      SELECT dossier
      FROM knowledge_company_cache
      WHERE company_name = ? AND expires_at > datetime('now')
      LIMIT 1
    `).get(company) as { dossier: string } | undefined;

    if (!row) {
      return null;
    }

    try {
      return JSON.parse(row.dossier) as CompanyDossier;
    } catch {
      return null;
    }
  }

  // Negotiation
  saveNegotiationState(profileId: number | null, jdId: number | null, script: any, sessionState: any): void {
    const save = this.db.transaction(() => {
      this.db.prepare('DELETE FROM knowledge_negotiation').run();
      this.db.prepare(`
        INSERT INTO knowledge_negotiation (profile_id, jd_id, script, session_state)
        VALUES (?, ?, ?, ?)
      `).run(profileId, jdId, JSON.stringify(script ?? null), JSON.stringify(sessionState ?? null));
    });

    save();
  }

  getNegotiationState(): { script: any; sessionState: any } | null {
    const row = this.db.prepare(`
      SELECT script, session_state
      FROM knowledge_negotiation
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get() as { script: string | null; session_state: string | null } | undefined;

    if (!row) {
      return null;
    }

    try {
      return {
        script: row.script ? JSON.parse(row.script) : null,
        sessionState: row.session_state ? JSON.parse(row.session_state) : null,
      };
    } catch {
      return null;
    }
  }

  clearNegotiationState(): void {
    this.db.prepare('DELETE FROM knowledge_negotiation').run();
  }
}
