import t from 'tap';
import Database from 'better-sqlite3';
import type { Meeting } from '../electron/db/DatabaseManager';
import {
  migrateRecordColumns,
  createMeeting,
  upsertSegment,
  interactionRow,
  addInteraction,
  completeMeeting,
} from '../electron/db/meetingRecord';

function openDatabase() {
  const db = new Database(':memory:');
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
  `);
  return db;
}

const meeting = {
  id: 'meeting-one',
  title: 'Invented planning session',
  startTimeMs: 1000,
  createdAt: '2026-01-01T00:00:01.000Z',
};
const segment = {
  meetingId: meeting.id,
  segmentId: 'segment-one',
  revision: 1,
  speaker: 'user',
  text: 'The sample launch is Monday.',
  timestampMs: 1200,
};

t.test('migration is idempotent and legacy NULL identities do not conflict', (t) => {
  const db = openDatabase();
  t.teardown(() => db.close());
  t.equal(db.pragma('foreign_keys', { simple: true }), 1, 'cascade constraints are enabled');
  createMeeting(db, meeting);
  db.prepare('INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms) VALUES (?, ?, ?, ?)')
    .run(meeting.id, 'user', 'An invented legacy line.', 1100);

  migrateRecordColumns(db);
  const legacyRows = db.prepare('SELECT * FROM transcripts').all();
  t.match(legacyRows, [{ segment_id: null, revision: null }]);
  migrateRecordColumns(db);
  t.same(db.prepare('SELECT * FROM transcripts').all(), legacyRows, 'second migration leaves rows intact');
  t.equal(upsertSegment(db, segment), true);
  db.prepare('INSERT INTO transcripts (meeting_id, content) VALUES (?, ?)')
    .run(meeting.id, 'Another invented legacy line.');
  t.equal(db.prepare('SELECT count(*) FROM transcripts').pluck().get(), 3);
  t.same(db.prepare('SELECT * FROM transcripts WHERE id = 1').get(), legacyRows[0]);
  t.equal(db.prepare("SELECT count(*) FROM pragma_index_list('transcripts') WHERE name = 'idx_transcripts_segment' AND [unique] = 1").pluck().get(), 1);
  t.end();
});

t.test('only newer revisions update a segment, preserving its row and first timestamp', (t) => {
  const db = openDatabase();
  t.teardown(() => db.close());
  migrateRecordColumns(db);
  createMeeting(db, meeting);
  t.equal(upsertSegment(db, segment), true, 'new segment inserts');
  t.same(db.prepare('SELECT * FROM transcripts').get(), {
    id: 1, meeting_id: meeting.id, segment_id: segment.segmentId, revision: 1,
    speaker: 'user', content: segment.text, timestamp_ms: 1200,
  });
  t.equal(upsertSegment(db, {
    ...segment, revision: 2, speaker: 'other', text: 'The sample launch is Tuesday.', timestampMs: 2400,
  }), true, 'newer revision updates');
  t.equal(upsertSegment(db, { ...segment, text: 'Stale sample text.' }), false, 'older revision ignored');
  t.equal(upsertSegment(db, { ...segment, revision: 2, text: 'Duplicate sample text.' }), false, 'equal revision ignored');
  t.same(db.prepare('SELECT * FROM transcripts').all(), [{
    id: 1, meeting_id: meeting.id, segment_id: segment.segmentId, revision: 2,
    speaker: 'other', content: 'The sample launch is Tuesday.', timestamp_ms: 1200,
  }]);
  t.end();
});

t.test('segment identities are unique within each meeting, not across meetings', (t) => {
  const db = openDatabase();
  t.teardown(() => db.close());
  migrateRecordColumns(db);
  createMeeting(db, meeting);
  createMeeting(db, { ...meeting, id: 'meeting-two' });
  t.equal(upsertSegment(db, segment), true);
  t.equal(upsertSegment(db, { ...segment, segmentId: 'segment-two' }), true);
  t.equal(db.prepare('SELECT count(*) FROM transcripts WHERE meeting_id = ?').pluck().get(meeting.id), 2);
  t.equal(upsertSegment(db, { ...segment, meetingId: 'meeting-two' }), true);
  t.equal(db.prepare('SELECT count(*) FROM transcripts WHERE segment_id = ?').pluck().get(segment.segmentId), 2);
  t.throws(() => upsertSegment(db, { ...segment, meetingId: 'unknown' }), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
  t.end();
});

t.test('creating a meeting twice preserves the initial row and its children', (t) => {
  const db = openDatabase();
  t.teardown(() => db.close());
  migrateRecordColumns(db);
  createMeeting(db, meeting);
  const expected = {
    id: meeting.id, title: meeting.title, start_time: 1000, duration_ms: 0, summary_json: null,
    created_at: meeting.createdAt, is_processed: 0,
  };
  t.same(db.prepare('SELECT * FROM meetings').get(), expected);
  upsertSegment(db, segment);
  addInteraction(db, meeting.id, { type: 'chat', timestamp: 1300, answer: 'An invented response.' });
  const transcripts = db.prepare('SELECT * FROM transcripts').all();
  const interactions = db.prepare('SELECT * FROM ai_interactions').all();
  createMeeting(db, { ...meeting, title: 'Do not overwrite', startTimeMs: 9000 });
  t.same(db.prepare('SELECT * FROM meetings').all(), [expected]);
  t.same(db.prepare('SELECT * FROM transcripts').all(), transcripts);
  t.same(db.prepare('SELECT * FROM ai_interactions').all(), interactions);
  t.end();
});

t.test('completion is repeatable, updates only given fields and never rewrites children', (t) => {
  const db = openDatabase();
  t.teardown(() => db.close());
  migrateRecordColumns(db);
  createMeeting(db, meeting);
  upsertSegment(db, segment);
  upsertSegment(db, { ...segment, segmentId: 'segment-two' });
  addInteraction(db, meeting.id, { type: 'assist', timestamp: 1500, question: 'Invented question?', answer: 'Invented answer.' });
  addInteraction(db, meeting.id, { type: 'followup_questions', timestamp: 1600, items: ['Invented follow-up?'] });
  const transcripts = db.prepare('SELECT * FROM transcripts').all();
  const interactions = db.prepare('SELECT * FROM ai_interactions').all();
  const completion = { title: 'Finished sample', durationMs: 5000, summaryJson: '{"overview":"Invented summary"}', isProcessed: true };
  t.equal(completeMeeting(db, meeting.id, completion), true);
  const completed = db.prepare('SELECT * FROM meetings').get();
  t.same(completed, {
    id: meeting.id, title: 'Finished sample', start_time: 1000, duration_ms: 5000,
    summary_json: completion.summaryJson, created_at: meeting.createdAt,
    is_processed: 1,
  });
  t.equal(completeMeeting(db, meeting.id, completion), true);
  t.same(db.prepare('SELECT * FROM meetings').all(), [completed], 'repeated completion changes no stored values');
  t.same(db.prepare('SELECT * FROM transcripts').all(), transcripts);
  t.same(db.prepare('SELECT * FROM ai_interactions').all(), interactions);
  t.equal(completeMeeting(db, meeting.id, {
    title: '', durationMs: 6000, summaryJson: null, isProcessed: false,
  }), true);
  t.match(db.prepare('SELECT * FROM meetings').get(), {
    title: '', duration_ms: 6000, summary_json: null, is_processed: 0,
  }, 'explicit empty and null values clear fields');
  t.equal(completeMeeting(db, meeting.id, {
    title: undefined, durationMs: 7000, summaryJson: undefined, isProcessed: true,
  }), true);
  t.match(db.prepare('SELECT * FROM meetings').get(), {
    title: '', duration_ms: 7000, summary_json: null, is_processed: 1,
  }, 'undefined fields stay unchanged');
  t.equal(completeMeeting(db, 'unknown', completion), false);
  t.equal(db.prepare('SELECT count(*) FROM meetings').pluck().get(), 1, 'unknown id is not inserted');
  t.same(db.prepare('SELECT * FROM transcripts').all(), transcripts);
  t.same(db.prepare('SELECT * FROM ai_interactions').all(), interactions);
  t.end();
});

t.test('record writers leave unowned nullable columns and existing values untouched', (t) => {
  const db = openDatabase();
  t.teardown(() => db.close());
  db.exec('ALTER TABLE meetings ADD COLUMN unused_event_id TEXT');
  db.exec('ALTER TABLE meetings ADD COLUMN unused_origin TEXT');
  const schema = db.pragma('table_info(meetings)');
  createMeeting(db, meeting);
  db.prepare('UPDATE meetings SET unused_event_id = ?, unused_origin = ? WHERE id = ?')
    .run('sample-event', 'sample-origin', meeting.id);
  createMeeting(db, { ...meeting, title: 'Do not overwrite' });
  for (let i = 0; i < 2; i++) {
    completeMeeting(db, meeting.id, { durationMs: 5000, isProcessed: true });
    t.match(db.prepare('SELECT * FROM meetings WHERE id = ?').get(meeting.id), {
      title: meeting.title, start_time: meeting.startTimeMs, created_at: meeting.createdAt,
      unused_event_id: 'sample-event', unused_origin: 'sample-origin',
    });
  }
  createMeeting(db, { ...meeting, id: 'meeting-two' });
  t.match(db.prepare('SELECT * FROM meetings WHERE id = ?').get('meeting-two'), {
    unused_event_id: null, unused_origin: null,
  });
  t.same(db.pragma('table_info(meetings)'), schema, 'no column is changed or removed');
  t.end();
});

t.test('interaction normalization preserves all legacy usage shapes', (t) => {
  const db = openDatabase();
  t.teardown(() => db.close());
  migrateRecordColumns(db);
  createMeeting(db, meeting);
  type Usage = NonNullable<Meeting['usage']>[number];
  // Legacy runtime answers can be arrays even though Meeting types them as strings.
  const arrayAnswer = { type: 'followup_questions', timestamp: 20, answer: ['Sample question?'] } as unknown as Usage;
  const cases = [
    {
      usage: { type: 'assist', timestamp: 10, items: ['Sample item'], question: 'Sample prompt?', answer: 'Sample answer.' } as Usage,
      expected: { type: 'assist', timestamp: 10, user_query: 'Sample prompt?', ai_response: 'Sample answer.', metadata_json: '["Sample item"]' },
    },
    {
      usage: arrayAnswer,
      expected: { type: 'followup_questions', timestamp: 20, user_query: null, ai_response: null, metadata_json: '["Sample question?"]' },
    },
    {
      usage: { ...arrayAnswer, items: [] },
      expected: { type: 'followup_questions', timestamp: 20, user_query: null, ai_response: null, metadata_json: '[]' },
    },
    {
      usage: { ...arrayAnswer, type: 'chat' } as Usage,
      expected: { type: 'chat', timestamp: 20, user_query: null, ai_response: null, metadata_json: null },
    },
    {
      usage: { type: 'chat', timestamp: 30, question: 'Sample prompt?', answer: 'Plain sample answer.' } as Usage,
      expected: { type: 'chat', timestamp: 30, user_query: 'Sample prompt?', ai_response: 'Plain sample answer.', metadata_json: null },
    },
    {
      usage: { type: 'followup_questions', timestamp: 40, answer: 'Text question?' } as Usage,
      expected: { type: 'followup_questions', timestamp: 40, user_query: null, ai_response: 'Text question?', metadata_json: null },
    },
    {
      usage: { type: 'followup', timestamp: 50, question: '', answer: '' } as Usage,
      expected: { type: 'followup', timestamp: 50, user_query: null, ai_response: null, metadata_json: null },
    },
    {
      usage: { type: 'assist', timestamp: 60 } as Usage,
      expected: { type: 'assist', timestamp: 60, user_query: null, ai_response: null, metadata_json: null },
    },
  ];
  for (const { usage, expected } of cases) {
    t.same(interactionRow(usage), expected);
    addInteraction(db, meeting.id, usage);
  }
  t.same(db.prepare('SELECT meeting_id, type, timestamp, user_query, ai_response, metadata_json FROM ai_interactions ORDER BY id').all(),
    cases.map(({ expected }) => ({ meeting_id: meeting.id, ...expected })));
  t.end();
});
