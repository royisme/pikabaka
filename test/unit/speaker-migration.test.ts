import t, { type Test } from 'tap';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { DatabaseManager as Manager } from '../../electron/db/DatabaseManager';

const modulePath = path.resolve('electron/db/DatabaseManager.ts');
const backupOf = (dbPath: string) => `${dbPath}.before-them`;

function tempDir(t: Test): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pika-them-'));
    t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

/** Opens the real DatabaseManager against `dir` as its userData path. */
function openManager(dir: string, t: Test): Manager {
    const { DatabaseManager } = mockRequire(modulePath, {
        electron: { app: { getPath: () => dir } },
    }) as { DatabaseManager: typeof Manager };
    Reflect.set(DatabaseManager, 'instance', undefined);
    const manager = DatabaseManager.getInstance();
    t.teardown(() => { try { manager.getDb()?.close(); } catch { /* closed between opens */ } });
    return manager;
}

const versionOf = (db: Database.Database) => db.pragma('user_version', { simple: true }) as number;

const speakers = (db: Database.Database, table: 'transcripts' | 'chunks') =>
    (db.prepare(`SELECT speaker FROM ${table} ORDER BY id`).all() as { speaker: string }[]).map((row) => row.speaker);

/** A v11 database (before the speaker rename) with the two speaker columns and three other values. */
function seedOldDatabase(dir: string): string {
    const dbPath = path.join(dir, 'pika.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE transcripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, segment_id TEXT, revision INTEGER,
            speaker TEXT, content TEXT, timestamp_ms INTEGER, UNIQUE(meeting_id, segment_id)
        );
        CREATE TABLE chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
            speaker TEXT, start_timestamp_ms INTEGER, end_timestamp_ms INTEGER,
            cleaned_text TEXT NOT NULL, token_count INTEGER NOT NULL, embedding BLOB
        );
    `);
    const transcript = db.prepare(
        'INSERT INTO transcripts (meeting_id, segment_id, revision, speaker, content, timestamp_ms) VALUES (?, ?, ?, ?, ?, ?)'
    );
    transcript.run('m1', 's1', 1, 'interviewer', 'Invented amber lantern line.', 1000);
    transcript.run('m1', 's2', 1, 'user', 'Invented cobalt lantern reply.', 2000);
    transcript.run('m1', 's3', 1, 'assistant', 'Invented violet suggestion.', 3000);
    const chunk = db.prepare(
        'INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    chunk.run('m1', 0, 'interviewer', 1000, 2000, 'Invented amber lantern line.', 4);
    chunk.run('m1', 1, 'user', 2000, 3000, 'Invented cobalt lantern reply.', 4);
    db.pragma('user_version = 11');
    db.close();
    return dbPath;
}

t.test('opening a v11 database renames interviewer to them once, keeping a backup', (t) => {
    const dir = tempDir(t);
    const dbPath = seedOldDatabase(dir);
    const manager = openManager(dir, t);
    const db = manager.getDb()!;

    t.equal(versionOf(db), 12, 'the schema version is bumped');
    t.same(speakers(db, 'transcripts'), ['them', 'user', 'assistant'], 'transcripts migrated; user and assistant are untouched');
    t.same(speakers(db, 'chunks'), ['them', 'user'], 'chunks migrated; user is untouched');

    const backup = backupOf(dbPath);
    t.ok(fs.existsSync(backup), 'the backup file exists next to the database');
    const backupDb = new Database(backup, { readonly: true });
    t.equal(versionOf(backupDb), 11, 'the backup is the database from before the migration');
    t.same(speakers(backupDb, 'transcripts'), ['interviewer', 'user', 'assistant'], 'the backup still holds the old value');
    backupDb.close();

    const before = fs.statSync(backup);
    const bytes = fs.readFileSync(backup);
    db.close();

    const reopened = openManager(dir, t);
    t.equal(versionOf(reopened.getDb()!), 12);
    t.same(speakers(reopened.getDb()!, 'transcripts'), ['them', 'user', 'assistant'], 'a second open changes nothing');
    t.equal(fs.statSync(backup).mtimeMs, before.mtimeMs, 'a second open does not rewrite the backup');
    t.same(fs.readFileSync(backup), bytes, 'the backup content is unchanged');
    t.end();
});

t.test('a backup that cannot be written leaves the old value and version, and runs at the next start', (t) => {
    const dir = tempDir(t);
    const dbPath = seedOldDatabase(dir);
    const backup = backupOf(dbPath);
    fs.mkdirSync(backup);

    const manager = openManager(dir, t);
    const db = manager.getDb()!;
    t.equal(versionOf(db), 11, 'the version is not bumped without a backup');
    t.same(speakers(db, 'transcripts'), ['interviewer', 'user', 'assistant'], 'the rows keep the old value');
    t.same(speakers(db, 'chunks'), ['interviewer', 'user'], 'the chunks keep the old value');
    db.close();

    fs.rmdirSync(backup);
    const retried = openManager(dir, t);
    t.equal(versionOf(retried.getDb()!), 12, 'the next start migrates');
    t.same(speakers(retried.getDb()!, 'transcripts'), ['them', 'user', 'assistant']);
    t.ok(fs.statSync(backup).isFile(), 'the retry writes the backup');
    t.end();
});

t.test('a fresh database migrates with no old rows and writes no backup', (t) => {
    const dir = tempDir(t);
    const manager = openManager(dir, t);
    const db = manager.getDb()!;

    t.equal(versionOf(db), 12, 'a new database is fully migrated');
    t.same(db.prepare('SELECT COUNT(*) AS count FROM transcripts').get(), { count: 0 });
    t.same(db.prepare('SELECT COUNT(*) AS count FROM chunks').get(), { count: 0 });

    t.notOk(fs.existsSync(path.join(dir, 'pika.db.before-them')), 'a new install has nothing to back up');
    t.end();
});

t.test('old rows in the chunks table alone still trigger the backup and the rename', (t) => {
    const dir = tempDir(t);
    const dbPath = seedOldDatabase(dir);
    const seeded = new Database(dbPath);
    seeded.prepare("UPDATE transcripts SET speaker = 'user'").run();
    seeded.close();

    const db = openManager(dir, t).getDb()!;
    t.same(speakers(db, 'chunks'), ['them', 'user'], 'the chunks are migrated');
    t.ok(fs.existsSync(backupOf(dbPath)), 'the backup is written because chunks held the old value');
    t.end();
});
