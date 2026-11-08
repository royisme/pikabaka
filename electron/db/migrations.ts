import type Database from 'better-sqlite3';
import * as meetingRecord from './meetingRecord';

/**
 * Known embedding dimension tiers.
 * Used by the v8 migration, delete operations, and table provisioning.
 */
export const KNOWN_DIMS: readonly number[] = [768, 1536, 3072];

// ============================================
// PRAGMA user_version Migration System
// ============================================
// Each version is applied exactly once, in order.
// New migrations append a new `if (version < N)` block.
// ============================================

export function runMigrations(db: Database.Database, ensureVecTableForDim: (dim: number) => void): void {
    const version = (db.pragma('user_version', { simple: true }) as number) || 0;
    console.log(`[DatabaseManager] Current schema version: ${version}`);

    // Version 0 → 1: Initial schema (all core tables)
    if (version < 1) {
        console.log('[DatabaseManager] Applying migration v0 → v1: Initial schema');
        db.exec(`
            CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                title TEXT,
                start_time INTEGER,
                duration_ms INTEGER,
                summary_json TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                is_processed INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS transcripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT,
                speaker TEXT,
                content TEXT,
                timestamp_ms INTEGER,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS ai_interactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT,
                type TEXT,
                timestamp INTEGER,
                user_query TEXT,
                ai_response TEXT,
                metadata_json TEXT,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                speaker TEXT,
                start_timestamp_ms INTEGER,
                end_timestamp_ms INTEGER,
                cleaned_text TEXT NOT NULL,
                token_count INTEGER NOT NULL,
                embedding BLOB,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chunk_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT NOT NULL UNIQUE,
                summary_text TEXT NOT NULL,
                embedding BLOB,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS embedding_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT NOT NULL,
                chunk_id INTEGER,
                status TEXT DEFAULT 'pending',
                retry_count INTEGER DEFAULT 0,
                error_message TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                processed_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_meeting ON chunks(meeting_id);
        `);
        db.pragma('user_version = 1');
    }

    // Version 1 → 2: Add columns for existing installs (safe for fresh installs too)
    if (version < 2) {
        console.log('[DatabaseManager] Applying migration v1 → v2: Add meetings columns');
        // For fresh installs these columns already exist from v1, so we guard with try/catch.
        // Unlike the old code, these are versioned and run exactly once.
        const columnsToAdd = [
            "ALTER TABLE meetings ADD COLUMN is_processed INTEGER DEFAULT 1"
        ];
        for (const sql of columnsToAdd) {
            try { db.exec(sql); } catch (e) { /* Column already exists from v1 CREATE */ }
        }
        db.pragma('user_version = 2');
    }

    // Versions 3 and 4 used to create single-table vec0 tables with no vector dimension, which
    // sqlite-vec rejects. v8 drops them and provisions the per-dimension tables, so they only
    // advance the version.
    if (version < 3) db.pragma('user_version = 3');
    if (version < 4) db.pragma('user_version = 4');

    // Version 4 → 5: Add embedding provider and dimensions columns
    if (version < 5) {
        console.log('[DatabaseManager] Applying migration v4 → v5: Add embedding provider/dimensions columns');
        const columnsToAdd = [
            "ALTER TABLE meetings ADD COLUMN embedding_provider TEXT",
            "ALTER TABLE meetings ADD COLUMN embedding_dimensions INTEGER"
        ];
        for (const sql of columnsToAdd) {
            try { db.exec(sql); } catch (e) { /* Column already exists */ }
        }
        db.pragma('user_version = 5');
    }

    // Version 5 → 6: Add app_state table for KV storage (Ollama pull state, etc)
    if (version < 6) {
        console.log('[DatabaseManager] Applying migration v5 → v6: Add app_state table');
        db.exec(`
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
        db.pragma('user_version = 6');
    }

    // Version 6 → 7: Add indexes on transcripts and ai_interactions meeting_id
    // (Previously missing — causes O(N) full-table scans when fetching meeting details)
    if (version < 7) {
        console.log('[DatabaseManager] Applying migration v6 → v7: Add meeting_id indexes');
        try {
            db.exec('CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id);');
            db.exec('CREATE INDEX IF NOT EXISTS idx_ai_interactions_meeting ON ai_interactions(meeting_id, timestamp);');
            console.log('[DatabaseManager] Meeting ID indexes created successfully');
        } catch (e) {
            console.error('[DatabaseManager] Failed to create indexes (non-fatal):', e);
        }
        db.pragma('user_version = 7');
    }

    // Version 7 → 8: Provision per-dimension vec0 tables (NOTE: this v8 ran in two broken
    // iterations for some users — first with float[1536] single table, then with correct per-dim
    // tables. The v9 migration below corrects any v8 that used the old broken schema.)
    if (version < 8) {
        console.log('[DatabaseManager] Applying migration v7 → v8: Provision per-dimension vec0 tables');
        // Drop the legacy single-dim tables from v3/v4 if they exist and are unusable
        try { db.exec('DROP TABLE IF EXISTS vec_chunks;'); } catch (_) {}
        try { db.exec('DROP TABLE IF EXISTS vec_summaries;'); } catch (_) {}

        for (const dim of KNOWN_DIMS) {
            ensureVecTableForDim(dim);
        }
        console.log('[DatabaseManager] v8 migration: per-dimension vec0 tables provisioned');
        db.pragma('user_version = 8');
    }

    // Version 8 → 9: Ensure per-dimension tables exist.
    // Required for DBs already at v8 but with the old broken float[1536] single-table schema,
    // or with the first incorrect v8 migration that didn't provision KNOWN_DIMS tables.
    if (version < 9) {
        console.log('[DatabaseManager] Applying migration v8 → v9: Ensure per-dimension vec0 tables exist');
        // Drop old single-dim orphan tables if they exist (float[1536] schema)
        try { db.exec('DROP TABLE IF EXISTS vec_chunks;'); } catch (_) {}
        try { db.exec('DROP TABLE IF EXISTS vec_summaries;'); } catch (_) {}

        let allOk = true;
        for (const dim of KNOWN_DIMS) {
            ensureVecTableForDim(dim);
            // Verify the table actually exists after provisioning
            try {
                db.prepare(`SELECT count(*) FROM vec_chunks_${dim} LIMIT 1`).get();
            } catch (e) {
                console.error(`[DatabaseManager] v9: vec_chunks_${dim} still missing after provisioning:`, e);
                allOk = false;
            }
        }
        if (allOk) {
            console.log('[DatabaseManager] v9 migration: all per-dimension vec0 tables verified ✓');
        } else {
            console.warn('[DatabaseManager] v9 migration: some tables missing — sqlite-vec extension may not be loaded');
        }
        db.pragma('user_version = 9');
    }

    // Version 9 → 10: Add UNIQUE constraint on embedding_queue(meeting_id, chunk_id).
    // This enables INSERT OR IGNORE in EmbeddingPipeline.queueMeeting() to silently
    // skip duplicate rows when queueMeeting() is called more than once for the same meeting.
    // SQLite doesn't support ADD CONSTRAINT on existing tables, so we recreate the table
    // using the standard rename-create-copy-drop pattern.
    if (version < 10) {
        console.log('[DatabaseManager] Applying migration v9 → v10: Add UNIQUE constraint to embedding_queue');
        try {
            // Wrap all steps in an explicit better-sqlite3 transaction for atomicity.
            // If any step throws, the entire migration is rolled back cleanly —
            // preventing the dangerous half-renamed table state that a bare exec() chain would leave.
            const migrate = db.transaction(() => {
                // Step 1: Rename the existing table to a temp name
                db.exec('ALTER TABLE embedding_queue RENAME TO embedding_queue_old;');

                // Step 2: Recreate with the UNIQUE(meeting_id, chunk_id) constraint
                db.exec(`
                    CREATE TABLE embedding_queue (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        meeting_id TEXT NOT NULL,
                        chunk_id INTEGER,
                        status TEXT DEFAULT 'pending',
                        retry_count INTEGER DEFAULT 0,
                        error_message TEXT,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        processed_at TEXT,
                        UNIQUE(meeting_id, chunk_id)
                    );
                `);

                // Step 3: Copy rows; INSERT OR IGNORE silently drops any pre-existing duplicates
                db.exec(`
                    INSERT OR IGNORE INTO embedding_queue
                        (id, meeting_id, chunk_id, status, retry_count, error_message, created_at, processed_at)
                    SELECT id, meeting_id, chunk_id, status, retry_count, error_message, created_at, processed_at
                    FROM embedding_queue_old;
                `);

                // Step 4: Drop the backup
                db.exec('DROP TABLE embedding_queue_old;');
            });
            migrate();
            console.log('[DatabaseManager] v10 migration: embedding_queue UNIQUE constraint added ✓');
        } catch (e) {
            console.error('[DatabaseManager] v10 migration failed — table structure unchanged:', e);
            // user_version still advances. We do NOT retry — a failed rename leaves
            // embedding_queue_old behind; retrying would cause "table already exists".
            // In the failure case, INSERT OR IGNORE in queueMeeting() will still work
            // for natural uniqueness (same meeting queued twice picks up existing rows),
            // just without DB-enforced deduplication.
        }
        db.pragma('user_version = 10');
    }

    // Version 10 → 11: Persist transcript segments by identity and revision.
    if (version < 11) {
        console.log('[DatabaseManager] Applying migration v10 → v11: Add transcript segment identity');
        meetingRecord.migrateRecordColumns(db);
        db.pragma('user_version = 11');
    }

    // Version 11 → 12: no schema change; the other party's speaker value is `them`.
    if (version < 12) {
        db.pragma('user_version = 12');
    }

    // Tables the removed interview feature wrote.
    db.exec('DROP TABLE IF EXISTS user_profile; DROP TABLE IF EXISTS resume_nodes;');

    console.log('[DatabaseManager] Migrations completed.');
}
