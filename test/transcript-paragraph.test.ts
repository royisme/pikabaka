import t from 'tap';
import { ParagraphQueue, PARAGRAPH_AFTER_MS, PARAGRAPH_SETTLE_MS } from '../electron/transcript/paragraphs';
import { upsertTranscriptSegment, type TranscriptSegment } from '../src/lib/transcriptSegments';

t.test('nothing is joined before a minute has passed, unless many rows wait', async (t) => {
  const queue = new ParagraphQueue();
  for (let i = 0; i < 4; i++) queue.note(`s${i}`, 1, `Sentence number ${i}.`, i * 5_000);
  t.equal(queue.takeDue(30_000), null, 'four rows, thirty seconds');
  t.equal(queue.size(), 4);
  const due = queue.takeDue(PARAGRAPH_AFTER_MS + 1_000);
  t.same(due?.map((row) => row.segmentId), ['s0', 's1', 's2', 's3']);
  t.equal(queue.size(), 0);
});

t.test('ten waiting rows are joined before the minute is up', async (t) => {
  const queue = new ParagraphQueue();
  for (let i = 0; i < 10; i++) queue.note(`s${i}`, 1, `Line ${i}.`, i * 1_000);
  t.equal(queue.takeDue(9_000 + PARAGRAPH_SETTLE_MS)?.length, 10);
});

t.test('a row that changed lately is left for the next paragraph', async (t) => {
  const queue = new ParagraphQueue();
  queue.note('a', 1, 'First sentence.', 0);
  queue.note('b', 1, 'Second sentence.', 10_000);
  queue.note('c', 1, 'Third sentence.', 62_000);
  const due = queue.takeDue(65_000);
  t.same(due?.map((row) => row.segmentId), ['a', 'b']);
  t.same(queue.size(), 1);
  queue.note('c', 2, 'Third sentence, extended.', 64_000);
  t.equal(queue.takeDue(66_000), null, 'one row is never a paragraph');
});

t.test('a changed row keeps its place and its first time', async (t) => {
  const queue = new ParagraphQueue();
  queue.note('a', 1, 'One.', 0);
  queue.note('b', 1, 'Two.', 1_000);
  queue.note('a', 2, 'One, longer.', 2_000);
  const due = queue.takeDue(70_000);
  t.same(due?.map((row) => [row.segmentId, row.text]), [['a', 'One, longer.'], ['b', 'Two.']]);
});

const row = (segmentId: string, source: string, timestamp: number): TranscriptSegment => ({
  segmentId, sourceText: source, translatedText: `T:${source}`, timestamp, speakerLabel: 'Interviewer',
  translationState: 'complete', revision: 1, translatedRevision: 1, speaker: 'interviewer',
});
const paragraphEvent = { final: true, text: 'A. B. C.', sourceText: 'A. B. C.', translatedText: 'P', segmentId: 'para1', speaker: 'interviewer' as const, translationState: 'complete' as const, revision: 1, timestamp: 99 };

t.test('a paragraph takes the place of the rows it replaces, at the first one', async (t) => {
  const rows = [row('s1', 'A.', 10), row('s2', 'B.', 20), row('s3', 'C.', 30), row('s4', 'D.', 40)];
  const next = upsertTranscriptSegment(rows, { ...paragraphEvent, replaces: ['s1', 's2', 's3'] });
  t.same(next.map((r) => r.segmentId), ['para1', 's4']);
  t.equal(next[0].timestamp, 10, 'it keeps the time of the first row');
  t.equal(next[0].translatedText, 'P');
});

t.test('a paragraph whose rows are gone is dropped, and a later report updates it in place', async (t) => {
  t.same(upsertTranscriptSegment([row('s9', 'Z.', 1)], { ...paragraphEvent, replaces: ['s1', 's2'] }).map((r) => r.segmentId), ['s9']);
  const once = upsertTranscriptSegment([row('s1', 'A.', 10), row('s2', 'B.', 20)], { ...paragraphEvent, replaces: ['s1', 's2'] });
  const again = upsertTranscriptSegment(once, { ...paragraphEvent, translatedText: 'P2', translationState: 'complete' });
  t.same(again.map((r) => [r.segmentId, r.translatedText]), [['para1', 'P2']]);
});
