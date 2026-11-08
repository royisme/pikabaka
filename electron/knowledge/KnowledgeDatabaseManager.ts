import Database from 'better-sqlite3';
import { DocumentRow, ChunkRow, DocType } from './types';

export interface KnowledgeChunkInput {
  text: string;
  metadata?: { docType: DocType; section: string };
}

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
    // Tables the removed interview feature wrote; existing installs lose them.
    this.db.exec(`
      DROP TABLE IF EXISTS knowledge_company_cache;
      DROP TABLE IF EXISTS knowledge_negotiation;
      DROP TABLE IF EXISTS interview_sessions;

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

      CREATE INDEX IF NOT EXISTS idx_knowledge_docs_type ON knowledge_documents(doc_type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);
    `);

    // Migration: add multi-JD support columns
    try {
      this.db.exec(`ALTER TABLE knowledge_documents ADD COLUMN is_active INTEGER DEFAULT 0`);
    } catch { /* column already exists */ }

    try {
      this.db.exec(`ALTER TABLE knowledge_documents ADD COLUMN label TEXT`);
    } catch { /* column already exists */ }

    for (const column of ['embedding_provider TEXT', 'embedding_dimensions INTEGER', 'indexed_at TEXT', 'index_error TEXT']) {
      try {
        this.db.exec(`ALTER TABLE knowledge_documents ADD COLUMN ${column}`);
      } catch { /* column already exists */ }
    }
  }

  // Documents
  upsertDocument(docType: DocType, fileName: string, rawText: string, parsedData: unknown): number {
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

  insertDocument(docType: DocType, fileName: string, rawText: string, parsedData: unknown): number {
    const result = this.db.prepare(`
      INSERT INTO knowledge_documents (doc_type, file_name, raw_text, parsed_data, label, is_active)
      VALUES (?, ?, ?, ?, NULL, 0)
    `).run(docType, fileName, rawText, JSON.stringify(parsedData ?? null));

    return Number(result.lastInsertRowid);
  }

  getDocumentById(docId: number): DocumentRow | null {
    return this.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(docId) as DocumentRow | undefined ?? null;
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

  getAllDocumentsByType(docType: DocType): DocumentRow[] {
    return this.db
      .prepare('SELECT * FROM knowledge_documents WHERE doc_type = ? ORDER BY created_at DESC')
      .all(docType) as DocumentRow[];
  }

  deleteDocumentById(docId: number): void {
    const del = this.db.transaction(() => {
      this.db.prepare('DELETE FROM knowledge_chunks WHERE doc_id = ?').run(docId);
      this.db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(docId);
    });
    del();
  }

  // Chunks
  saveChunks(docId: number, chunks: KnowledgeChunkInput[]): number[] {
    const insertChunk = this.db.prepare(`
      INSERT INTO knowledge_chunks (doc_id, doc_type, chunk_index, text, token_count, metadata)
      SELECT id, doc_type, ?, ?, ?, ?
      FROM knowledge_documents
      WHERE id = ?
    `);

    const save = this.db.transaction((items: KnowledgeChunkInput[]) => {
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

  /** Each passage's own document name or label, keyed by chunk id. */
  getChunkSources(docTypes: DocType[]): Map<number, string> {
    const rows = this.db.prepare(`
      SELECT c.id, d.label, d.file_name
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.doc_id
      WHERE d.doc_type IN (${docTypes.map(() => '?').join(',')})
    `).all(...docTypes) as Array<{ id: number; label: string | null; file_name: string }>;
    return new Map(rows.map((row) => [row.id, row.label || row.file_name]));
  }

  getChunksForDoc(docId: number): ChunkRow[] {
    return this.db
      .prepare('SELECT * FROM knowledge_chunks WHERE doc_id = ? ORDER BY chunk_index')
      .all(docId) as ChunkRow[];
  }
}
