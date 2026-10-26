import type Database from 'better-sqlite3';
import type { Meeting } from './DatabaseManager';

export function migrateRecordColumns(db: Database.Database): void {
    const columns = db.pragma('table_info(transcripts)') as { name: string }[];
    if (!columns.some(column => column.name === 'segment_id')) {
        db.exec('ALTER TABLE transcripts ADD COLUMN segment_id TEXT');
    }
    if (!columns.some(column => column.name === 'revision')) {
        db.exec('ALTER TABLE transcripts ADD COLUMN revision INTEGER');
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_transcripts_segment ON transcripts(meeting_id, segment_id)');
}

export function createMeeting(db: Database.Database, m: {
    id: string;
    title: string;
    startTimeMs: number;
    createdAt: string;
    calendarEventId?: string | null;
    source?: 'manual' | 'calendar';
}): void {
    db.prepare(`
        INSERT OR IGNORE INTO meetings
            (id, title, start_time, duration_ms, summary_json, created_at, calendar_event_id, source, is_processed)
        VALUES (?, ?, ?, 0, NULL, ?, ?, ?, 0)
    `).run(m.id, m.title, m.startTimeMs, m.createdAt, m.calendarEventId ?? null, m.source ?? 'manual');
}

export function upsertSegment(db: Database.Database, s: {
    meetingId: string;
    segmentId: string;
    revision: number;
    speaker: string;
    text: string;
    timestampMs: number;
}): boolean {
    const result = db.prepare(`
        INSERT INTO transcripts (meeting_id, segment_id, revision, speaker, content, timestamp_ms)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(meeting_id, segment_id) DO UPDATE SET
            content = excluded.content,
            speaker = excluded.speaker,
            revision = excluded.revision
        WHERE excluded.revision > transcripts.revision
    `).run(s.meetingId, s.segmentId, s.revision, s.speaker, s.text, s.timestampMs);
    return result.changes > 0;
}

export function interactionRow(usage: NonNullable<Meeting['usage']>[number]) {
    let metadata = null;
    if (usage.items) {
        metadata = JSON.stringify(usage.items);
    } else if (usage.type === 'followup_questions' && Array.isArray(usage.answer)) {
        metadata = JSON.stringify(usage.answer);
    }
    return {
        type: usage.type,
        timestamp: usage.timestamp,
        user_query: usage.question || null,
        ai_response: Array.isArray(usage.answer) ? null : usage.answer || null,
        metadata_json: metadata
    };
}

export function addInteraction(db: Database.Database, meetingId: string, usage: NonNullable<Meeting['usage']>[number]): void {
    db.prepare(`
        INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json)
        VALUES (@meeting_id, @type, @timestamp, @user_query, @ai_response, @metadata_json)
    `).run({ meeting_id: meetingId, ...interactionRow(usage) });
}

export function completeMeeting(db: Database.Database, id: string, c: {
    title?: string;
    durationMs: number;
    summaryJson?: string | null;
    isProcessed: boolean;
    calendarEventId?: string | null;
    source?: 'manual' | 'calendar';
}): boolean {
    const fields = Object.entries({
        title: c.title,
        duration_ms: c.durationMs,
        summary_json: c.summaryJson,
        is_processed: c.isProcessed ? 1 : 0,
        calendar_event_id: c.calendarEventId,
        source: c.source
    }).filter(([, value]) => value !== undefined);
    const result = db.prepare(`
        UPDATE meetings SET ${fields.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?
    `).run(...fields.map(([, value]) => value), id);
    return result.changes > 0;
}
