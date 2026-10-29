import t from 'tap';
import { announcementKey, nextAnnouncement } from '../src/lib/transcriptAnnounce';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  segmentId: id,
  sourceText: `source ${id}`,
  translatedText: `translation ${id}`,
  translationState: 'complete' as const,
  speaker: 'them' as const,
  revision: 1,
  translatedRevision: 1,
  ...over,
});

t.test('announces the newest complete translation once', async (t) => {
  const rows = [row('a'), row('b')];
  const first = nextAnnouncement(rows, new Set());
  t.equal(first?.text, 'translation b');
  t.same(first?.keys, [announcementKey(rows[0]), announcementKey(rows[1])], 'the older one is marked, not read');
  t.equal(nextAnnouncement(rows, new Set(first!.keys)), null, 'nothing left to read');
});

t.test('never reads pending, failed, own, stale or same-language rows', async (t) => {
  const none = [
    row('p', { translationState: 'pending', translatedText: undefined }),
    row('e', { translationState: 'error' }),
    row('me', { speaker: 'user' }),
    row('st', { revision: 2, translatedRevision: 1 }),
    row('same', { translatedText: 'source same' }),
  ];
  t.equal(nextAnnouncement(none, new Set()), null);
});

t.test('a new revision of an announced row is announced again', async (t) => {
  const v1 = row('a');
  const seen = new Set([announcementKey(v1)]);
  const v2 = row('a', { revision: 2, translatedRevision: 2, translatedText: 'translation a again' });
  t.equal(nextAnnouncement([v2], seen)?.text, 'translation a again');
});
