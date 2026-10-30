import t from 'tap';
import { AudioStats } from '../../electron/lib/audio-stats';

t.test('the summary counts final lines and words per stream and what the echo filter dropped, then resets', async t => {
  const stats = new AudioStats();
  stats.noteFinal('user', 8);
  stats.noteFinal('user', 4);
  stats.noteFinal('them', 10);
  stats.noteEchoDropped(true, 5);
  stats.noteEchoDropped(false, 3);
  stats.noteEchoDropped(false, 2);
  const summary = stats.summary();
  t.match(summary, 'Me 2 final lines, 12 words (6.0 per line)');
  t.match(summary, 'Other party 1 final lines, 10 words (10.0 per line)');
  t.match(summary, 'echo filter dropped 1 final lines (5 words) and 2 interim lines');
  stats.reset();
  t.match(stats.summary(), 'Me 0 final lines, 0 words;');
  t.notMatch(stats.summary(), 'per line');
});
