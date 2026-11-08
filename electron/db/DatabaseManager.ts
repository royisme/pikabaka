
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import * as sqliteVec from 'sqlite-vec';
import * as meetingRecord from './meetingRecord';
import { KNOWN_DIMS, runMigrations } from './migrations';
import { VectorStore } from '../rag/VectorStore';

import type { Meeting, MeetingSummaryUpdates } from './types';

interface SegmentRow {
    segmentId: string; revision: number | null; speaker: string; text: string; timestampMs: number;
}

interface MeetingRow {
    id: string;
    title: string;
    start_time: number;
    duration_ms: number;
    summary_json: string | null;
    created_at: string;
    is_processed: number;
}

interface TranscriptRow {
    speaker: string;
    content: string;
    timestamp_ms: number;
}

interface InteractionRow {
    id: number;
    type: 'assist' | 'followup' | 'chat' | 'followup_questions';
    timestamp: number;
    // Nullable columns, typed as the Meeting fields they feed (T02 reshapes Meeting).
    user_query: string;
    ai_response: string;
    metadata_json: string | null;
}

export class DatabaseManager {
    private static instance: DatabaseManager;
    private db: Database.Database | null = null;
    private dbPath: string;
    private resolvedExtPath: string = '';

    private constructor() {
        const userDataPath = app.getPath('userData');
        const pikaDb = path.join(userDataPath, 'pika.db');
        const legacyDb = path.join(userDataPath, 'natively.db');
        if (!fs.existsSync(pikaDb) && fs.existsSync(legacyDb)) {
            try {
                fs.renameSync(legacyDb, pikaDb);
                console.log('[DatabaseManager] Migrated natively.db to pika.db');
            } catch (e) {
                console.warn('[DatabaseManager] Could not migrate legacy database file:', e);
            }
        }
        this.dbPath = pikaDb;
        this.init();
    }

    public static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
    }

    private init() {
        try {
            console.log(`[DatabaseManager] Initializing database at ${this.dbPath}`);
            // Ensure directory exists (though userData usually does)
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[DatabaseManager] Created directory: ${dir}`);
            } else {
                console.log(`[DatabaseManager] Directory exists: ${dir}`);
                try {
                    const files = fs.readdirSync(dir);
                    console.log(`[DatabaseManager] Directory contents:`, files);
                    const dbExists = fs.existsSync(this.dbPath);
                    if (dbExists) {
                        const stats = fs.statSync(this.dbPath);
                        console.log(`[DatabaseManager] Found existing DB. Size: ${stats.size} bytes`);
                    } else {
                        console.log(`[DatabaseManager] No existing DB found at ${this.dbPath}. Creating new one.`);
                    }
                } catch (e) {
                    console.error('[DatabaseManager] Error checking directory/file:', e);
                }
            }

            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');

            // Load sqlite-vec extension for native vector search
            try {
                // 1. sqlite-vec's getLoadablePath() returns a path inside app.asar
                //    (e.g. .../app.asar/node_modules/sqlite-vec-darwin-arm64/vec0.dylib)
                //    but dlopen() needs real files on disk, not files inside the asar archive.
                //    electron-builder's asarUnpack puts them in app.asar.unpacked instead.
                // 2. better-sqlite3's loadExtension() auto-appends the platform extension
                //    (.dylib/.so/.dll), so we strip it to avoid vec0.dylib.dylib.
                let extPath = sqliteVec.getLoadablePath();
                extPath = extPath.replace('app.asar', 'app.asar.unpacked');
                extPath = extPath.replace(/\.(dylib|so|dll)$/, '');
                this.db.loadExtension(extPath);
                this.resolvedExtPath = extPath; // Store for worker thread access
                console.log('[DatabaseManager] sqlite-vec extension loaded successfully');
            } catch (extErr) {
                console.error('[DatabaseManager] Failed to load sqlite-vec extension:', extErr);
                console.warn('[DatabaseManager] Vector search will fall back to JS cosine similarity');
            }

            runMigrations(this.db, (dim) => this.ensureVecTableForDim(dim));
        } catch (error) {
            console.error('[DatabaseManager] Failed to initialize database:', error);
            throw error;
        }
    }

    // ============================================
    // System KV Store (app_state)
    // ============================================

    public getAppState(key: string): string | null {
        if (!this.db) return null;
        try {
            const stmt = this.db.prepare<[string], { value: string }>('SELECT value FROM app_state WHERE key = ?');
            const row = stmt.get(key);
            return row ? row.value : null;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to get app_state for key: ${key}`, error);
            return null;
        }
    }

    public setAppState(key: string, value: string): void {
        if (!this.db) return;
        try {
            const stmt = this.db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
            stmt.run(key, value);
        } catch (error) {
            console.error(`[DatabaseManager] Failed to set app_state for key: ${key}`, error);
        }
    }

    /**
     * Known embedding dimension tiers.
     * Used by the v8 migration, delete operations, and table provisioning.
     * When a new provider dimension is encountered at runtime, ensureVecTableForDim() handles it.
     */
    public static readonly KNOWN_DIMS: readonly number[] = KNOWN_DIMS;

    /** Cache: dimensions for which vec0 tables have already been verified/created this session. */
    private ensuredDims = new Set<number>();

    /**
     * Lazily create a per-dimension vec0 table pair if not already present.
     * Called by v8 migration and at runtime when a new embedding dimension is first seen.
     * Uses an in-memory cache to avoid redundant CREATE TABLE IF NOT EXISTS on every insert.
     */
    public ensureVecTableForDim(dim: number): void {
        if (this.ensuredDims.has(dim)) return; // Already verified this session
        if (!this.db) return;
        // Guard against SQL injection: dim must be a positive integer
        if (!Number.isInteger(dim) || dim <= 0 || dim > 100_000) {
            console.error(`[DatabaseManager] Invalid dimension for vec0 table: ${dim}`);
            return;
        }
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_${dim} USING vec0(
                    chunk_id INTEGER PRIMARY KEY,
                    embedding float[${dim}]
                );
            `);
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries_${dim} USING vec0(
                    summary_id INTEGER PRIMARY KEY,
                    embedding float[${dim}]
                );
            `);
            this.ensuredDims.add(dim);
            console.log(`[DatabaseManager] Ensured vec0 tables for dim=${dim}`);
        } catch (e) {
            console.error(`[DatabaseManager] Failed to create vec0 tables for dim=${dim}:`, e);
        }
    }

    // ============================================
    // Public API
    // ============================================

    /**
     * Expose the raw database instance for external managers (e.g. ProfileDatabaseManager).
     */
    public getDb(): Database.Database | null {
        return this.db;
    }

    /** Path to the SQLite database file on disk. Used by worker threads. */
    public getDbPath(): string {
        return this.dbPath;
    }

    /**
     * Resolved sqlite-vec extension path (without platform file suffix).
     * Used by worker threads that open their own DB connection.
     */
    public getExtPath(): string {
        return this.resolvedExtPath;
    }

    public createMeeting(meeting: Parameters<typeof meetingRecord.createMeeting>[1]): void {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            return;
        }
        meetingRecord.createMeeting(this.db, meeting);
    }

    public upsertSegment(segment: Parameters<typeof meetingRecord.upsertSegment>[1]): boolean {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            return false;
        }
        return meetingRecord.upsertSegment(this.db, segment);
    }

    public getSegmentRevision(meetingId: string, segmentId: string): number | undefined {
        if (!this.db) return undefined;
        const row = this.db.prepare<[string, string], { revision: number | null }>('SELECT revision FROM transcripts WHERE meeting_id = ? AND segment_id = ?')
            .get(meetingId, segmentId);
        return row?.revision ?? undefined;
    }

    public getRecentSegments(meetingId: string, sinceMs: number): SegmentRow[] {
        if (!this.db) throw new Error('Database not initialized');
        return this.db.prepare<[string, number], SegmentRow>(`
            SELECT COALESCE(segment_id, CAST(id AS TEXT)) AS segmentId, revision,
                   speaker, content AS text, timestamp_ms AS timestampMs
            FROM transcripts WHERE meeting_id = ? AND timestamp_ms >= ?
            ORDER BY timestamp_ms ASC, id ASC
        `).all(meetingId, sinceMs);
    }

    public searchSegments(meetingId: string, query: string, limit: number): SegmentRow[] {
        if (!this.db) throw new Error('Database not initialized');
        if (!query.trim()) return [];
        return this.db.prepare<[string, string, number], SegmentRow>(`
            SELECT COALESCE(segment_id, CAST(id AS TEXT)) AS segmentId, revision,
                   speaker, content AS text, timestamp_ms AS timestampMs
            FROM transcripts WHERE meeting_id = ? AND instr(lower(content), lower(?)) > 0
            ORDER BY timestamp_ms DESC, id DESC LIMIT ?
        `).all(meetingId, query, Math.max(1, Math.min(8, Math.trunc(limit))));
    }

    public addInteraction(meetingId: string, usage: NonNullable<Meeting['usage']>[number]): void {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            return;
        }
        meetingRecord.addInteraction(this.db, meetingId, usage);
    }

    public completeMeeting(id: string, completion: Parameters<typeof meetingRecord.completeMeeting>[2]): boolean {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            return false;
        }
        return meetingRecord.completeMeeting(this.db, id, completion);
    }

    public saveMeeting(meeting: Meeting, startTimeMs: number, durationMs: number) {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            return;
        }

        const insertMeeting = this.db.prepare(`
            INSERT OR REPLACE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, is_processed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const insertTranscript = this.db.prepare(`
            INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
            VALUES (?, ?, ?, ?)
        `);

        const insertInteraction = this.db.prepare(`
            INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json)
            VALUES (@meeting_id, @type, @timestamp, @user_query, @ai_response, @metadata_json)
        `);

        const summaryJson = JSON.stringify({
            legacySummary: meeting.summary,
            detailedSummary: meeting.detailedSummary
        });

        const runTransaction = this.db.transaction(() => {
            // 1. Insert Meeting
            insertMeeting.run(
                meeting.id,
                meeting.title,
                startTimeMs,
                durationMs,
                summaryJson,
                meeting.date, // Using the ISO string as created_at for sorting simply
                meeting.isProcessed ? 1 : 0
            );

            // 2. Insert Transcript
            if (meeting.transcript) {
                for (const segment of meeting.transcript) {
                    insertTranscript.run(
                        meeting.id,
                        segment.speaker,
                        segment.text,
                        segment.timestamp
                    );
                }
            }

            // 3. Insert Interactions
            if (meeting.usage) {
                for (const usage of meeting.usage) {
                    insertInteraction.run({ meeting_id: meeting.id, ...meetingRecord.interactionRow(usage) });
                }
            }
        });

        try {
            runTransaction();
            console.log(`[DatabaseManager] Successfully saved meeting ${meeting.id}`);
        } catch (err) {
            console.error(`[DatabaseManager] Failed to save meeting ${meeting.id}`, err);
            throw err;
        }
    }

    public updateMeetingTitle(id: string, title: string): boolean {
        if (!this.db) return false;
        try {
            const stmt = this.db.prepare('UPDATE meetings SET title = ? WHERE id = ?');
            const info = stmt.run(title, id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to update title for meeting ${id}:`, error);
            return false;
        }
    }

    public updateMeetingSummary(id: string, updates: MeetingSummaryUpdates): boolean {
        if (!this.db) return false;

        try {
            // 1. Get current summary_json
            const row = this.db.prepare<[string], Pick<MeetingRow, 'summary_json'>>('SELECT summary_json FROM meetings WHERE id = ?').get(id);
            if (!row) return false;

            const existingData = JSON.parse(row.summary_json || '{}');
            const currentDetailed = existingData.detailedSummary || {};

            // 2. Merge updates
            const newDetailed = {
                ...currentDetailed,
                ...updates
            };

            // Should likely filter out undefined updates if spread doesn't handle them how we want, 
            // but spread over undefined is fine. We want to overwrite if provided.
            // If updates.overview is empty string, it overwrites. 
            // If updates.overview is undefined, we use ...updates trick:
            // Actually spread only includes own enumerable properties. If I pass { overview: "new" }, it works.

            // However, we need to be careful not to wipe legacySummary if it exists
            const newData = {
                ...existingData,
                detailedSummary: newDetailed
            };

            const jsonStr = JSON.stringify(newData);

            // 3. Write back
            const stmt = this.db.prepare('UPDATE meetings SET summary_json = ? WHERE id = ?');
            const info = stmt.run(jsonStr, id);
            return info.changes > 0;

        } catch (error) {
            console.error(`[DatabaseManager] Failed to update summary for meeting ${id}:`, error);
            return false;
        }
    }

    public getRecentMeetings(limit: number = 50): Meeting[] {
        if (!this.db) return [];

        const stmt = this.db.prepare<[number], MeetingRow>(`
            SELECT * FROM meetings 
            ORDER BY created_at DESC 
            LIMIT ?
        `);

        const rows = stmt.all(limit);

        return rows.map(row => {
            const summaryData = JSON.parse(row.summary_json || '{}');

            // Format duration string if needed, but we typically store ms
            // Let's recreate the 'duration' string "MM:SS" from duration_ms
            const minutes = Math.floor(row.duration_ms / 60000);
            const seconds = Math.floor((row.duration_ms % 60000) / 1000);
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            return {
                id: row.id,
                title: row.title,
                date: row.created_at, // Use the stored ISO string
                duration: durationStr,
                summary: summaryData.legacySummary || '',
                detailedSummary: summaryData.detailedSummary,
                // We don't load full transcript/usage for list view to keep it light
                transcript: [],
                usage: []
            };
        });
    }

    public getMeetingDetails(id: string): Meeting | null {
        if (!this.db) return null;

        const meetingStmt = this.db.prepare<[string], MeetingRow>('SELECT * FROM meetings WHERE id = ?');
        const meetingRow = meetingStmt.get(id);

        if (!meetingRow) return null;

        // Get Transcript
        const transcriptStmt = this.db.prepare<[string], TranscriptRow>('SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY timestamp_ms ASC');
        const transcriptRows = transcriptStmt.all(id);

        // Get Usage
        const usageStmt = this.db.prepare<[string], InteractionRow>('SELECT * FROM ai_interactions WHERE meeting_id = ? ORDER BY timestamp ASC');
        const usageRows = usageStmt.all(id);

        // Reconstruct
        const summaryData = JSON.parse(meetingRow.summary_json || '{}');
        const minutes = Math.floor(meetingRow.duration_ms / 60000);
        const seconds = Math.floor((meetingRow.duration_ms % 60000) / 1000);
        const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const transcript = transcriptRows.map(row => ({
            speaker: row.speaker,
            text: row.content,
            timestamp: row.timestamp_ms
        }));

        const usage = usageRows.map(row => {
            let items: string[] | undefined;
            let answer = row.ai_response;

            if (row.metadata_json) {
                try {
                    const parsed = JSON.parse(row.metadata_json);
                    if (Array.isArray(parsed)) {
                        items = parsed;
                        // Special case: for 'followup_questions', earlier we treated 'answer' as the array in memory
                        // UI expects appropriate field. If type is 'followup_questions', usually answer is null and items has the questions.
                    }
                } catch (e) { console.warn('[DatabaseManager] Failed to parse metadata_json for interaction:', row?.id, e); }
            }

            return {
                type: row.type,
                timestamp: row.timestamp,
                question: row.user_query,
                answer: answer,
                items: items
            };
        });

        return {
            id: meetingRow.id,
            title: meetingRow.title,
            date: meetingRow.created_at,
            startTimeMs: meetingRow.start_time,
            duration: durationStr,
            summary: summaryData.legacySummary || '',
            detailedSummary: summaryData.detailedSummary,
            transcript: transcript,
            usage: usage
        };
    }

    public deleteMeeting(id: string): boolean {
        if (!this.db) return false;

        try {
            const stmt = this.db.prepare('DELETE FROM meetings WHERE id = ?');
            const info = stmt.run(id);
            console.log(`[DatabaseManager] Deleted meeting ${id}. Changes: ${info.changes}`);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to delete meeting ${id}:`, error);
            return false;
        }
    }

    public getUnprocessedMeetings(): Meeting[] {
        if (!this.db) return [];

        // is_processed = 0 means false
        const stmt = this.db.prepare<[], MeetingRow>(`
            SELECT * FROM meetings 
            WHERE is_processed = 0 
            ORDER BY created_at DESC
        `);

        const rows = stmt.all();

        return rows.map(row => {
            // Reconstruct minimal meeting object for processing
            // We mainly need ID to fetch transcripts later
            const summaryData = JSON.parse(row.summary_json || '{}');
            const minutes = Math.floor(row.duration_ms / 60000);
            const seconds = Math.floor((row.duration_ms % 60000) / 1000);
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            return {
                id: row.id,
                title: row.title,
                date: row.created_at,
                duration: durationStr,
                summary: summaryData.legacySummary || '',
                detailedSummary: summaryData.detailedSummary,
                isProcessed: false,
                transcript: [], // Fetched separately via getMeetingDetails or manually if needed
                usage: []
            };
        });
    }

    public clearAllData(): boolean {
        if (!this.db) return false;

        try {
            // Clear all tables atomically (order matters due to foreign keys,
            // but SQLite handles cascades). Using a transaction ensures we never
            // end up in a half-cleared state if one statement fails.
            this.db.transaction(() => {
                try {
                    VectorStore.clearNativeVectors(this.db!);
                } catch {
                    // The SQL flush still works when an existing vec0 table cannot be opened.
                    console.warn('[DatabaseManager] Could not clear native meeting vectors');
                }
                this.db!.exec('DELETE FROM embedding_queue');
                this.db!.exec('DELETE FROM chunk_summaries');
                this.db!.exec('DELETE FROM chunks');
                this.db!.exec('DELETE FROM ai_interactions');
                this.db!.exec('DELETE FROM transcripts');
                this.db!.exec('DELETE FROM meetings');

                // Dormant interview data goes with Clear all data: a stored resume or job description
                // and its passages and vectors. Notes and imported materials are kept. Guarded by table existence so an older database still flushes.
                const tables = new Set((this.db!.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all()).map(row => row.name));
                if (tables.has('knowledge_chunks')) {
                    for (const name of tables) {
                        if (/^vec_knowledge_\d+$/.test(name)) {
                            this.db!.prepare(`DELETE FROM ${name} WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_type IN ('resume', 'jd'))`).run();
                        }
                    }
                    this.db!.exec("DELETE FROM knowledge_chunks WHERE doc_type IN ('resume', 'jd')");
                }
                if (tables.has('knowledge_documents')) this.db!.exec("DELETE FROM knowledge_documents WHERE doc_type IN ('resume', 'jd')");
            })();

            console.log('[DatabaseManager] All data cleared from database.');
            return true;
        } catch (error) {
            console.error('[DatabaseManager] Failed to clear all data:', error);
            return false;
        }
    }

    public seedDemoMeeting() {
        if (!this.db) return;

        // Check if demo meeting already exists
        const existing = this.db.prepare('SELECT id FROM meetings WHERE id = ?').get('demo-meeting');
        if (existing) {
            console.log('[DatabaseManager] Demo meeting already exists, skipping seed.');
            return;
        }

        // Do NOT flush all meetings. Preserving user data is critical.
        // If we really need to clean up old demo data, we should delete only that ID.
        // this.deleteMeeting('demo-meeting'); // Optional safety if we wanted to force update

        const demoId = 'demo-meeting';

        // Set date to today 9:30 AM
        const today = new Date();
        today.setHours(9, 30, 0, 0);

        const durationMs = 300000; // 5 min

        const summaryMarkdown = `# Overview

Pika is a real-time AI meeting assistant designed to help you stay focused, informed, and fast-moving during calls. Get live insights while you speak, instant answers to questions, and structured notes after every meeting.

# Getting Started

### Start a Session
Click **Start Session** from the dashboard.

### During a Meeting
- Use the **quick action buttons** for real-time assistance
- Show or hide Pika at any time:
  - **Mac**: Cmd + B
  - **Windows**: Ctrl + B
- Move the widget anywhere on your screen by hovering over the top pill and dragging

# Main Features

## Quick Action Buttons
- **Reply**: Suggests what to say to the other party's latest words.
- **Ask**: Suggests the one question that most changes what happens next.
- **Catch up**: Summarizes what was said in the last few minutes.
- **Answer**: Type a question about the call or the screen.

## Meeting Insights (Launcher)
- **Smart Note Taking**: Automatically captures key points, action items, and structured summaries.
- **Summary**: A concise high-level brief of the entire meeting.
- **Transcript**: Full real-time speech-to-text transcript, available during and after the call.
- **Usage**: Track your interaction history and see how Pika assisted you.

## Live Insights
Click **Live Insights** during a call to view:
- Real-time questions and prompts
- Detected keywords and topics
- Context-aware suggestions based on the conversation
- Click any insight to get an instant response.

## AI Chat
- Type your question and press **Enter** or click **Submit**
- Enable **Smart Mode** for advanced reasoning and coding assistance

## Screenshots
- **Full Screen Screenshot**: Cmd + H
- **Selective Screenshot**: Cmd + Shift + H

# Making the Most of Pika

### Custom Context
Upload resumes, project briefs, sales scripts, or other documents to tailor responses to your workflow. (coming soon).

### Language Preferences
Go to **Settings → Language Preferences** to:
- Change input and output language
- Enable real-time translation during calls

### Undetectability
Unlock the **Undetectability** add-on to keep Pika invisible during screen sharing.

# Interface Basics

- **Dashboard**: Start meetings and view recent activity
- **Start Session**: Begin a new meeting instantly
- **Settings**: Configure API keys, language, and visibility
- **History**: Review past meetings, notes, and transcripts

# API Setup

1. Open **Settings**
2. Open **Provider setup**
3. Add your API keys:
   - **Gemini**
   - **Groq**
4. To enable real-time transcription, open **Audio & Translation** and select the location of your **Google Cloud service account JSON file**.

If you don’t already have one, follow the steps below to create it.

# Creating a Google Speech-to-Text Service Account

## 1. Create or Select a Project
- Open **Google Cloud Console**
- Create a new project or select an existing one
- Ensure billing is enabled

## 2. Enable Speech-to-Text API
- Go to **APIs & Services → Library**
- Enable **Speech-to-Text API**

## 3. Create a Service Account
- Navigate to **IAM & Admin → Service Accounts**
- Click **Create Service Account**
- **Name**: pika-stt
- **Description**: optional

## 4. Assign Permissions
- Grant the following role: **Speech-to-Text User** (\`roles/speech.client\`)

## 5. Create a JSON Key
- Open the service account
- Go to **Keys → Add Key → Create new key**
- Select **JSON**
- Download the file

**Once downloaded, return to Settings → Audio & Translation in Pika and select this file to complete setup.**

# Free Google Cloud Credit (New Users)

New Google Cloud accounts receive **$300 in free credits**, valid for 90 days.

To activate:
1. Visit [cloud.google.com](https://cloud.google.com)
2. Click **Get started for free**
3. Sign in with a Google account
4. Add billing details (card required)
5. Activate the free trial

The credit can be used for Speech-to-Text and is sufficient for extended testing and regular usage.

# Support

If you need help with setup or usage, contact us anytime at:
pika.contact@gmail.com`;

        const demoMeeting: Meeting = {
            id: demoId,
            title: "Pika Demo & Guide",
            date: today.toISOString(),
            duration: "5:00",
            summary: "Complete guide to using Pika - your real-time AI meeting assistant.",
            detailedSummary: {
                overview: summaryMarkdown,
                actionItems: [],
                keyPoints: []
            },
            transcript: [
                { speaker: 'them', text: "Welcome to Pika! Let me show you how it works.", timestamp: 0 },
                { speaker: 'user', text: "Thanks! I'm excited to try it out.", timestamp: 5000 },
                { speaker: 'them', text: "You have three quick action buttons. 'Reply' listens to the conversation and suggests what you should say.", timestamp: 10000 },
                { speaker: 'user', text: "That sounds helpful for interviews.", timestamp: 18000 },
                { speaker: 'them', text: "Check out the 'How to Use' section in the notes for API setup instructions.", timestamp: 20000 },
                { speaker: 'them', text: "'Ask' suggests a question to get missing information. 'Catch up' summarizes what was said recently.", timestamp: 22000 },
                { speaker: 'user', text: "What about typing a question?", timestamp: 30000 },
                { speaker: 'them', text: "Type a question in the box and press Enter to get an instant response.", timestamp: 35000 },
                { speaker: 'user', text: "Can I take screenshots during calls?", timestamp: 45000 },
                { speaker: 'them', text: "Yes! Press Cmd+H for full screen or Cmd+Shift+H to select an area. The AI will analyze it and help you.", timestamp: 50000 },
                { speaker: 'user', text: "How do I hide Pika during screen share?", timestamp: 60000 },
                { speaker: 'them', text: "Press Cmd+B to toggle visibility anytime. You can also enable 'Hide from screen share' in Settings.", timestamp: 65000 },
                { speaker: 'user', text: "This is amazing. What happens after the call?", timestamp: 75000 },
                { speaker: 'them', text: "You get detailed meeting notes with action items, key points, full transcript, and a log of all AI interactions.", timestamp: 80000 }
            ],
            usage: [
                { type: 'assist', timestamp: 15000, question: 'What features does Pika have?', answer: 'Pika offers quick action buttons, screenshot analysis, real-time transcription, and comprehensive meeting notes.' },
                { type: 'followup', timestamp: 40000, question: 'How do the action buttons work?', answer: 'Each button serves a specific purpose: suggest a reply, suggest a question to ask, or catch up on what was said.' }
            ],
            isProcessed: true
        };

        this.saveMeeting(demoMeeting, today.getTime(), durationMs);
        console.log('[DatabaseManager] Seeded demo meeting.');
    }
}
