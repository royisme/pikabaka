import t, { Test } from 'tap';
import Database from 'better-sqlite3';
import path from 'node:path';
import { mockRequire } from '../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { Meeting } from '../electron/db/DatabaseManager';
import type { MeetingPersistence } from '../electron/core/MeetingPersistence';
import type { SessionTracker } from '../electron/core/SessionTracker';
import * as record from '../electron/db/meetingRecord';

const summary = { overview: 'Invented release planning.', keyPoints: ['Review the sample build.'], actionItems: ['Test the sample build.'] };
const startTime = 1700000000000;
type MeetingRow = {
  id: string; title: string; start_time: number; duration_ms: number; summary_json: string | null;
  created_at: string; is_processed: number;
};

function harness(t: Test) {
  const db = new Database(':memory:');
  t.teardown(() => db.close());
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, duration_ms INTEGER, summary_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, is_processed INTEGER DEFAULT 1
    );
    CREATE TABLE transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, speaker TEXT, content TEXT, timestamp_ms INTEGER,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
    CREATE TABLE ai_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, type TEXT, timestamp INTEGER,
      user_query TEXT, ai_response TEXT, metadata_json TEXT,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
  `);
  record.migrateRecordColumns(db);
  let now = startTime;
  const realNow = Date.now;
  Date.now = () => now;
  t.teardown(() => { Date.now = realNow; });
  let finished!: () => void;
  const processed = new Promise<void>(resolve => { finished = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls = { fullSaves: 0, completions: 0, titles: 0, summaries: 0 };
  const rows = () => db.prepare('SELECT * FROM meetings ORDER BY id').all() as MeetingRow[];
  const transcripts = () => db.prepare('SELECT * FROM transcripts ORDER BY id').all();
  const interactions = () => db.prepare('SELECT * FROM ai_interactions ORDER BY id').all();
  const fake = {
    createMeeting: (m: Parameters<typeof record.createMeeting>[1]) => record.createMeeting(db, m),
    upsertSegment: (s: Parameters<typeof record.upsertSegment>[1]) => record.upsertSegment(db, s),
    addInteraction: (id: string, usage: NonNullable<Meeting['usage']>[number]) => record.addInteraction(db, id, usage),
    completeMeeting: (id: string, c: Parameters<typeof record.completeMeeting>[2]) => {
      calls.completions++;
      const result = record.completeMeeting(db, id, c);
      if (c.isProcessed) finished();
      return result;
    },
    saveMeeting: (m: Meeting, start: number, duration: number) => {
      calls.fullSaves++;
      db.transaction(() => {
        db.prepare(`INSERT OR REPLACE INTO meetings
          (id, title, start_time, duration_ms, summary_json, created_at, is_processed)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(m.id, m.title, start, duration, JSON.stringify({ legacySummary: m.summary, detailedSummary: m.detailedSummary }),
            m.date, m.isProcessed ? 1 : 0);
        for (const s of m.transcript ?? []) {
          db.prepare('INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms) VALUES (?, ?, ?, ?)')
            .run(m.id, s.speaker, s.text, s.timestamp);
        }
        for (const usage of m.usage ?? []) record.addInteraction(db, m.id, usage);
      })();
      if (m.isProcessed) finished();
    },
    getMeetingDetails: (id: string): Meeting | null => {
      const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as MeetingRow | undefined;
      if (!row) return null;
      return {
        id, title: row.title, date: row.created_at, startTimeMs: row.start_time,
        duration: `${Math.floor(row.duration_ms / 60000)}:${Math.floor(row.duration_ms % 60000 / 1000).toString().padStart(2, '0')}`,
        summary: '',
        transcript: db.prepare('SELECT speaker, content AS text, timestamp_ms AS timestamp FROM transcripts WHERE meeting_id = ? ORDER BY timestamp_ms').all(id) as NonNullable<Meeting['transcript']>,
        usage: [],
      };
    },
    getUnprocessedMeetings: () => rows().filter(row => row.is_processed === 0).map(row => ({ id: row.id })),
    deleteMeeting: (id: string) => db.prepare('DELETE FROM meetings WHERE id = ?').run(id).changes > 0,
  };
  class FakeLLMHelper {
    async generateMeetingSummary(prompt: string, _context: string) {
      await gate;
      if (prompt.startsWith('Generate a concise 3-6 word title')) {
        calls.titles++;
        return 'Generated sample title';
      }
      calls.summaries++;
      return JSON.stringify(summary);
    }
  }
  const core = (file: string) => path.join(process.cwd(), 'electron/core', file);
  const mocks = {
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    [path.join(process.cwd(), 'electron/db/DatabaseManager.ts')]: { DatabaseManager: { getInstance: () => fake } },
    [core('LLMHelper.ts')]: { LLMHelper: FakeLLMHelper },
  };
  const { SessionTracker: Tracker } = mockRequire(core('SessionTracker.ts'), mocks) as { SessionTracker: typeof SessionTracker };
  const { MeetingPersistence: Persistence } = mockRequire(core('MeetingPersistence.ts'), mocks) as { MeetingPersistence: typeof MeetingPersistence };
  const session = new Tracker();
  const persistence = new Persistence(session, new FakeLLMHelper() as unknown as ConstructorParameters<typeof Persistence>[1]);
  const seed = (id: string) => {
    for (let i = 1; i <= 3; i++) {
      fake.upsertSegment({ meetingId: id, segmentId: `segment-${i}`, revision: i, speaker: 'user', text: `Assembled sample line ${i}.`, timestampMs: startTime + i * 1500 });
      session.addTranscript({ speaker: 'user', text: `Raw sample fragment ${i}.`, timestamp: startTime + i * 1500, final: true });
    }
  };
  return { db, fake, session, persistence, rows, transcripts, interactions, seed, calls, release, processed, advance: (ms: number) => { now += ms; } };
}

t.test('stop and repeated processing complete in place without rewriting recorded children', async t => {
  const h = harness(t);
  const id = h.persistence.startMeeting()!;
  t.equal(h.session.getMeetingId(), id);
  h.seed(id);
  h.session.pushUsage({ type: 'chat', timestamp: startTime + 100, question: 'Sample question?', answer: 'Sample answer.' });
  const original = h.rows()[0];
  const transcripts = h.transcripts();
  const interactions = h.interactions();
  const snapshot = {
    transcript: [...h.session.getFullTranscript()], usage: [...h.session.getFullUsage()],
    startTime, durationMs: 6000, context: h.session.getFullSessionContext(),
  };
  h.advance(6000);
  t.equal(await h.persistence.stopMeeting(), id);
  t.equal(h.session.getMeetingId(), null);
  t.match(h.rows(), [{ title: 'Processing...', is_processed: 0, duration_ms: 6000 }]);
  t.same(JSON.parse(h.rows()[0].summary_json!), {
    legacySummary: 'Generating summary...', detailedSummary: { actionItems: [], keyPoints: [] },
  });
  t.same(h.transcripts(), transcripts, 'placeholder preserves assembled rows rather than raw STT fragments');
  t.equal(interactions.length, 1, 'usage was committed before stop');
  t.same(h.interactions(), interactions, 'stop does not duplicate usage');
  h.release();
  await h.processed;
  const completed = h.rows();
  t.equal(completed.length, 1);
  t.match(completed[0], { title: 'Generated sample title', is_processed: 1, start_time: original.start_time, created_at: original.created_at });
  t.same(JSON.parse(completed[0].summary_json!), { legacySummary: 'See detailed summary', detailedSummary: summary });
  t.equal(h.transcripts().length, 3);
  t.same(h.transcripts(), transcripts, 'processing preserves ids, segment ids, revisions and text');
  await h.persistence['processAndSaveMeeting'](snapshot, id);
  t.same(h.rows(), completed, 'second completion leaves the same meeting');
  t.same(h.transcripts(), transcripts, 'second completion leaves the same three transcript rows');
  t.same(h.interactions(), interactions, 'second completion leaves usage alone');
  t.equal(h.calls.fullSaves, 0);
});

t.test('a meeting under one second deletes its row and children', async t => {
  const h = harness(t);
  const id = h.persistence.startMeeting()!;
  h.seed(id);
  h.session.pushUsage({ type: 'chat', timestamp: startTime, answer: 'Sample answer.' });
  h.advance(999);
  t.equal(await h.persistence.stopMeeting(), null);
  t.same(h.rows(), []);
  t.same(h.transcripts(), []);
  t.same(h.interactions(), []);
  t.equal(h.session.getMeetingId(), null);
  t.equal(h.calls.completions, 0);
  t.equal(h.calls.fullSaves, 0);
});

for (const title of ['Untitled Session', 'Processing...', 'Sample review']) {
  t.test(`recovery preserves committed records, start time and a provided title (${title})`, async t => {
    const h = harness(t);
    h.fake.createMeeting({ id: 'crashed', title, startTimeMs: startTime, createdAt: '2020-01-01T00:00:00.000Z' });
    h.seed('crashed');
    h.fake.addInteraction('crashed', { type: 'chat', timestamp: startTime, answer: 'Sample answer.' });
    const original = h.rows()[0];
    const transcripts = h.transcripts();
    const interactions = h.interactions();
    h.release();
    await h.persistence.recoverUnprocessedMeetings();
    const completed = h.rows();
    t.equal(completed.length, 1);
    t.match(completed[0], {
      is_processed: 1, duration_ms: 4500, start_time: original.start_time, created_at: original.created_at,
      title: title === 'Sample review' ? title : 'Generated sample title',
    });
    t.same(JSON.parse(completed[0].summary_json!), { legacySummary: 'See detailed summary', detailedSummary: summary });
    t.same(h.transcripts(), transcripts);
    t.same(h.interactions(), interactions);
    const calls = { ...h.calls };
    await h.persistence.recoverUnprocessedMeetings();
    t.same(h.rows(), completed, 'second recovery changes nothing');
    t.same(h.transcripts(), transcripts);
    t.same(h.interactions(), interactions);
    t.same(h.calls, calls, 'second recovery does not call the LLM or writer');
    t.equal(h.calls.titles, title === 'Sample review' ? 0 : 1);
    t.equal(h.calls.fullSaves, 0);
  });
}

for (const durationMs of [0, 12000]) {
  t.test(`recovery without startTimeMs uses date and preserves a nonzero duration (${durationMs})`, async t => {
    const h = harness(t);
    h.fake.createMeeting({ id: 'stopped', title: 'Processing...', startTimeMs: startTime, createdAt: new Date(startTime).toISOString() });
    h.seed('stopped');
    record.completeMeeting(h.db, 'stopped', { durationMs, isProcessed: false });
    const getDetails = h.fake.getMeetingDetails;
    h.fake.getMeetingDetails = (id: string) => {
      const details = getDetails(id)!;
      delete details.startTimeMs;
      return details;
    };
    h.release();
    await h.persistence.recoverUnprocessedMeetings();
    t.match(h.rows()[0], { duration_ms: durationMs || 4500, start_time: startTime, is_processed: 1 });
  });
}

t.test('recovery skips a meeting that starts while recovery is processing another row', async t => {
  const h = harness(t);
  h.fake.createMeeting({ id: 'a-crashed', title: 'Untitled Session', startTimeMs: startTime, createdAt: new Date(startTime).toISOString() });
  h.fake.createMeeting({ id: 'z-active', title: 'Untitled Session', startTimeMs: startTime, createdAt: new Date(startTime).toISOString() });
  h.seed('a-crashed');
  const recovering = h.persistence.recoverUnprocessedMeetings();
  h.session.startSession('z-active', startTime);
  const active = h.rows()[1];
  h.release();
  await recovering;
  t.same(h.rows()[1], active);
  t.equal(h.rows()[0].is_processed, 1);
  t.equal(h.calls.completions, 1);
});

t.test('recovery skips an already active meeting', async t => {
  const h = harness(t);
  const id = h.persistence.startMeeting()!;
  h.seed(id);
  const original = h.rows();
  const transcripts = h.transcripts();
  h.release();
  await h.persistence.recoverUnprocessedMeetings();
  t.same(h.rows(), original);
  t.same(h.transcripts(), transcripts);
  t.equal(h.calls.completions, 0);
  t.equal(h.calls.titles, 0);
});

t.test('usage is recorded immediately, stops after reset, and survives recorder failures', t => {
  const h = harness(t);
  h.persistence.startMeeting();
  h.session.pushUsage({ type: 'chat', timestamp: startTime, question: 'Sample question?', answer: 'Sample answer.' });
  t.equal(h.interactions().length, 1);
  h.session.logUsage('assist', 'Another sample question?', 'Another sample answer.');
  t.equal(h.interactions().length, 2);
  h.session.reset();
  h.session.pushUsage({ type: 'chat', timestamp: startTime, answer: 'Outside a meeting.' });
  h.session.logUsage('chat', 'Outside question?', 'Outside answer.');
  t.equal(h.interactions().length, 2);
  h.session.startSession('unwritten', startTime);
  const errors: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  t.teardown(() => { console.error = realError; });
  h.session.setUsageRecorder(() => { throw new Error('Recorder unavailable'); });
  t.doesNotThrow(() => h.session.pushUsage({ type: 'chat', timestamp: startTime, answer: 'Private sample answer.' }));
  t.doesNotThrow(() => h.session.logUsage('chat', 'Private sample question?', 'Private sample answer.'));
  t.equal(errors.length, 2);
  t.notMatch(JSON.stringify(errors), /Private sample/);
  h.session.setUsageRecorder(null);
  h.session.pushUsage({ type: 'chat', timestamp: startTime });
  t.equal(errors.length, 2);
  t.end();
});

for (const failure of ['throw', 'no-row']) {
  t.test(`stop falls back to a full save when createMeeting has ${failure}`, async t => {
    const h = harness(t);
    h.fake.createMeeting = () => {
      if (failure === 'throw') throw new Error('Sample database unavailable');
    };
    const startedId = h.persistence.startMeeting();
    t.equal(h.session.getMeetingId(), startedId);
    if (failure === 'throw') t.equal(startedId, null);
    h.session.addTranscript({ speaker: 'user', text: 'Fallback sample transcript.', timestamp: startTime, final: true });
    h.session.pushUsage({ type: 'chat', timestamp: startTime, answer: 'Fallback sample answer.' });
    h.advance(2000);
    const id = await h.persistence.stopMeeting();
    t.ok(id);
    if (startedId) t.equal(id, startedId);
    t.match(h.rows(), [{ id, title: 'Processing...', is_processed: 0 }]);
    t.equal(h.transcripts().length, 1);
    t.equal(h.interactions().length, 1);
    h.release();
    await h.processed;
    t.match(h.rows(), [{ id, title: 'Generated sample title', is_processed: 1 }]);
    t.equal(h.rows().length, 1);
    t.equal(h.transcripts().length, 1);
    t.equal(h.interactions().length, 1);
    t.equal(h.calls.fullSaves, 2);
  });
}
