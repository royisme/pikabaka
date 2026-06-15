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

t.test('small content widths keep at least the minimum transcript column and give chat the remainder', (t) => {
  const width = 420;
  const layout = calculateSplitterBounds(width, MAX_TRANSCRIPT_SPLIT);

  t.equal(layout.minTranscriptSplit, (MIN_TRANSCRIPT_PANE_PX / width) * 100);
  t.equal(layout.maxTranscriptSplit, layout.minTranscriptSplit);
  t.equal(layout.safeSplitterPosition, layout.minTranscriptSplit);
  t.equal(layout.transcriptPanePx, MIN_TRANSCRIPT_PANE_PX);
  t.equal(layout.chatPanePx, width - MIN_TRANSCRIPT_PANE_PX - SPLITTER_THICKNESS_PX);
  t.ok(layout.chatPanePx < MIN_CHAT_PANE_PX, 'chat column uses remaining space when both minimums cannot fit');
  t.end();
});

t.test('large content widths reserve at least the compact chat column minimum', (t) => {
  const width = 1100;
  const layout = calculateSplitterBounds(width, MAX_TRANSCRIPT_SPLIT);
  const requestedMax = ((width - SPLITTER_THICKNESS_PX - MIN_CHAT_PANE_PX) / width) * 100;

  t.equal(layout.maxTranscriptSplit, Math.min(MAX_TRANSCRIPT_SPLIT, requestedMax));
  t.equal(layout.safeSplitterPosition, layout.maxTranscriptSplit);
  t.ok(layout.chatPanePx >= MIN_CHAT_PANE_PX, 'chat column gets at least the compact minimum width');
  t.ok(layout.transcriptPanePx > MIN_TRANSCRIPT_PANE_PX);
  t.end();
});

t.test('transcript column cannot crush chat when requested split is oversized', (t) => {
  const width = 900;
  const layout = calculateSplitterBounds(width, 90);

  t.equal(layout.safeSplitterPosition, layout.maxTranscriptSplit);
  const requestedMax = ((width - SPLITTER_THICKNESS_PX - MIN_CHAT_PANE_PX) / width) * 100;
  t.equal(layout.maxTranscriptSplit, Math.min(MAX_TRANSCRIPT_SPLIT, requestedMax));
  t.ok(layout.chatPanePx >= MIN_CHAT_PANE_PX, 'chat keeps at least its minimum width when possible');
  t.end();
});

t.test('resize updates maximum split as more width becomes available', (t) => {
  const compact = calculateSplitterBounds(900, MAX_TRANSCRIPT_SPLIT);
  const wide = calculateSplitterBounds(1400, MAX_TRANSCRIPT_SPLIT);

  t.ok(wide.maxTranscriptSplit >= compact.maxTranscriptSplit);
  t.ok(compact.chatPanePx >= MIN_CHAT_PANE_PX, 'compact width still keeps chat at or above its minimum');
  t.equal(wide.maxTranscriptSplit, MAX_TRANSCRIPT_SPLIT);
  t.equal(wide.safeSplitterPosition, MAX_TRANSCRIPT_SPLIT);
  t.ok(wide.chatPanePx > MIN_CHAT_PANE_PX);
  t.end();
});


t.test('column minimums stay compact enough for smaller overlays', (t) => {
  t.ok(MIN_TRANSCRIPT_PANE_PX <= 180, 'transcript column can shrink compactly');
  t.ok(MIN_CHAT_PANE_PX <= 300, 'chat column can shrink compactly');
  t.end();
});
