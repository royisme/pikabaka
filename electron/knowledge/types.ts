// electron/knowledge/types.ts
// Shared types for the Knowledge store.

export enum DocType {
  /** Facts the user wrote about themselves, one per line. */
  NOTES = 'notes',
  /** An imported document the user chose. */
  MATERIAL = 'material',
}

// ─── Knowledge Engine Types ──────────────────────────────────

export type DocumentIndexState = 'indexing' | 'indexed' | 'needs-reindex' | 'failed' | 'not-indexed';

export interface ImportedDocument {
  id: number;
  name: string;
  kind: 'txt' | 'md' | 'docx';
  importedAt: string;
  passages: number;
  state: DocumentIndexState;
  provider: string | null;
  dimensions: number | null;
  indexedAt: string | null;
  error: string | null;
}

export interface NotesIndexStatus {
  state: 'indexed' | 'not-indexed' | 'unknown' | 'needs-reindex';
  provider: string | null;
  dimensions: number | null;
  indexedAt: string | null;
  error: string | null;
}

export interface KnowledgeStatus {
  notesIndex?: NotesIndexStatus | null;
}

export interface KnowledgeResult {
  systemPromptInjection?: string;
  contextBlock?: string;
  /** The user's materials were searched and nothing relevant was found: the answer must not invent personal facts. */
  knowledgeMiss?: boolean;
}

// ─── Function Types (injected from main.ts) ──────────────────

export interface KnowledgeEmbedding {
  embedding: number[];
  provider: string;
  dimensions: number;
}

export type EmbedFn = (text: string) => Promise<KnowledgeEmbedding>;
export type EmbedQueryFn = EmbedFn;

/** A passage of the user's notes or documents, quoted as data: no candidate framing. */
export interface MaterialPassage {
  text: string;
  source: string;
  score: number;
}

// ─── Database Row Types ──────────────────────────────────────

export interface DocumentRow {
  id: number;
  doc_type: string;
  file_name: string;
  raw_text: string;
  parsed_data: string; // JSON string
  created_at: string;
  updated_at: string;
  is_active?: number;  // 0 or 1
  label?: string;
  embedding_provider?: string | null;
  embedding_dimensions?: number | null;
  indexed_at?: string | null;
  index_error?: string | null;
}

export interface ChunkRow {
  id: number;
  doc_id: number;
  doc_type: string;
  chunk_index: number;
  text: string;
  token_count: number;
  embedding: Buffer | null;
  metadata: string; // JSON string
}
