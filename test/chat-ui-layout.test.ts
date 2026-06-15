import t from 'tap';
import {
  DEFAULT_TRANSCRIPT_SPLIT,
  MAX_TRANSCRIPT_SPLIT,
  MIN_CHAT_PANE_PX,
  MIN_TRANSCRIPT_PANE_PX,
  MIN_TRANSCRIPT_SPLIT,
  SPLITTER_STORAGE_KEY,
  SPLITTER_STORAGE_VERSION,
  SPLITTER_STORAGE_VERSION_KEY,
  SPLITTER_THICKNESS_PX,
  calculateSplitterBounds,
  clampSplitterPosition,
  persistSplitterPosition,
  readStoredSplitterPosition,
} from '../src/components/meeting/chatLayout';

class MemoryStorage {
  public readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.has(key) ? this.values.get(key) || null : null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

t.test('bad or stale localStorage resets to current default and storage version', (t) => {
  const storage = new MemoryStorage();
  storage.values.set(SPLITTER_STORAGE_VERSION_KEY, 'old-layout-version');
  storage.values.set(SPLITTER_STORAGE_KEY, '52');

  t.equal(readStoredSplitterPosition(storage), DEFAULT_TRANSCRIPT_SPLIT);
  t.equal(storage.getItem(SPLITTER_STORAGE_KEY), String(DEFAULT_TRANSCRIPT_SPLIT));
  t.equal(storage.getItem(SPLITTER_STORAGE_VERSION_KEY), SPLITTER_STORAGE_VERSION);

  storage.values.set(SPLITTER_STORAGE_VERSION_KEY, SPLITTER_STORAGE_VERSION);
  storage.values.set(SPLITTER_STORAGE_KEY, 'not-a-number');

  t.equal(readStoredSplitterPosition(storage), DEFAULT_TRANSCRIPT_SPLIT);
  t.equal(storage.getItem(SPLITTER_STORAGE_KEY), String(DEFAULT_TRANSCRIPT_SPLIT));
  t.end();
});

t.test('splitter persistence clamps invalid, too-small, and too-large values', (t) => {
  const storage = new MemoryStorage();

  t.equal(clampSplitterPosition(Number.NaN), DEFAULT_TRANSCRIPT_SPLIT);
  t.equal(persistSplitterPosition(storage, 1), MIN_TRANSCRIPT_SPLIT);
  t.equal(storage.getItem(SPLITTER_STORAGE_KEY), String(MIN_TRANSCRIPT_SPLIT));

  t.equal(persistSplitterPosition(storage, 999), MAX_TRANSCRIPT_SPLIT);
  t.equal(storage.getItem(SPLITTER_STORAGE_KEY), String(MAX_TRANSCRIPT_SPLIT));
  t.equal(storage.getItem(SPLITTER_STORAGE_VERSION_KEY), SPLITTER_STORAGE_VERSION);
  t.end();
});

t.test('small content heights keep at least the minimum transcript pane and give chat the remainder', (t) => {
  const height = 320;
  const layout = calculateSplitterBounds(height, MAX_TRANSCRIPT_SPLIT);

  t.equal(layout.minTranscriptSplit, (MIN_TRANSCRIPT_PANE_PX / height) * 100);
  t.equal(layout.maxTranscriptSplit, layout.minTranscriptSplit);
  t.equal(layout.safeSplitterPosition, layout.minTranscriptSplit);
  t.equal(layout.transcriptPanePx, MIN_TRANSCRIPT_PANE_PX);
  t.equal(layout.chatPanePx, height - MIN_TRANSCRIPT_PANE_PX - SPLITTER_THICKNESS_PX);
  t.ok(layout.chatPanePx < MIN_CHAT_PANE_PX, 'chat pane uses remaining space when both minimums cannot fit');
  t.end();
});

t.test('large content heights reserve the minimum chat pane', (t) => {
  const height = 900;
  const layout = calculateSplitterBounds(height, MAX_TRANSCRIPT_SPLIT);

  t.equal(layout.maxTranscriptSplit, ((height - SPLITTER_THICKNESS_PX - MIN_CHAT_PANE_PX) / height) * 100);
  t.equal(layout.safeSplitterPosition, layout.maxTranscriptSplit);
  t.equal(layout.chatPanePx, MIN_CHAT_PANE_PX);
  t.ok(layout.transcriptPanePx > MIN_TRANSCRIPT_PANE_PX);
  t.end();
});

t.test('transcript cannot crush chat when requested split is oversized', (t) => {
  const height = 700;
  const layout = calculateSplitterBounds(height, 90);

  t.equal(layout.safeSplitterPosition, layout.maxTranscriptSplit);
  t.equal(Math.round(layout.chatPanePx), MIN_CHAT_PANE_PX);
  t.equal(layout.safeSplitterPosition, ((height - SPLITTER_THICKNESS_PX - MIN_CHAT_PANE_PX) / height) * 100);
  t.end();
});

t.test('resize updates maximum split as more height becomes available', (t) => {
  const compact = calculateSplitterBounds(700, MAX_TRANSCRIPT_SPLIT);
  const tall = calculateSplitterBounds(1200, MAX_TRANSCRIPT_SPLIT);

  t.ok(tall.maxTranscriptSplit > compact.maxTranscriptSplit);
  t.equal(compact.chatPanePx, MIN_CHAT_PANE_PX);
  t.equal(tall.maxTranscriptSplit, MAX_TRANSCRIPT_SPLIT);
  t.equal(tall.safeSplitterPosition, MAX_TRANSCRIPT_SPLIT);
  t.ok(tall.chatPanePx > MIN_CHAT_PANE_PX);
  t.end();
});
