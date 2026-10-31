import t from 'tap';
import { SendLag } from '../../electron/lib/send-lag';

t.test('the summary counts chunks, the longest gap and gaps over 300 ms per stream', async t => {
  const lag = new SendLag();
  lag.start();
  lag.noteChunk('user', 1000, 0.5);
  lag.noteChunk('user', 1020, 2);
  lag.noteChunk('user', 1520, 1);
  lag.noteChunk('them', 1000, 0.1);
  const summary = lag.summary();
  t.match(summary, 'Me 3 chunks, longest gap 500 ms, 1 gaps over 300 ms, slowest write 2.0 ms');
  t.match(summary, 'Other party 1 chunks, longest gap 0 ms, 0 gaps');
});
