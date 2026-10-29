import t from 'tap';
import { resetBufferedTranscriptTurns, type BufferedTranscriptTurn } from '../electron/lib/transcript-assembler';

type Recorded = { segmentId: string; revision: number; speaker: string; text: string; timestampMs: number };

function fakeAppState(buffers: { them: BufferedTranscriptTurn | null; user: BufferedTranscriptTurn | null }) {
  const recorded: Recorded[] = [];
  const state = {
    transcriptTurnBuffers: buffers,
    lastFlushedTranscriptTurns: { them: null, user: null },
    transcriptSegmentRevisions: new Map<string, number>(),
    recentTranslatedTurns: [] as unknown[],
    recordTranscriptSegment: (segment: Recorded) => { recorded.push(segment); },
  };
  return { state, recorded };
}

function turn(overrides: Partial<BufferedTranscriptTurn>): BufferedTranscriptTurn {
  return {
    segmentId: 'seg_1', startedAt: 1000, lastUpdatedAt: 2000, confidence: 0.9,
    text: 'We can start with three sites', flushTimer: null, revision: 1, ...overrides,
  };
}

t.test('a reset writes every turn still being assembled to the record, then clears it', async (t) => {
  const { state, recorded } = fakeAppState({
    them: turn({ segmentId: 'seg_a', revision: 2, text: '  Pricing is   per site ', startedAt: 1500 }),
    user: turn({ segmentId: 'user_b', text: 'Three works for us' }),
  });
  resetBufferedTranscriptTurns(state as any);
  t.same(recorded, [
    { segmentId: 'seg_a', revision: 2, speaker: 'them', text: 'Pricing is per site', timestampMs: 1500 },
    { segmentId: 'user_b', revision: 1, speaker: 'user', text: 'Three works for us', timestampMs: 1000 },
  ]);
  t.equal(state.transcriptTurnBuffers.them, null);
  t.equal(state.transcriptTurnBuffers.user, null);
});

t.test('a reset with nothing pending, or only whitespace, writes nothing', async (t) => {
  const { state, recorded } = fakeAppState({ them: turn({ text: '   ' }), user: null });
  resetBufferedTranscriptTurns(state as any);
  t.same(recorded, []);
});
