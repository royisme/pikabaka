import t from 'tap';
import { preprocessTranscript } from '../../electron/rag/TranscriptPreprocessor';

const segment = (speaker: string, timestamp: number, text: string) => ({ speaker, text, timestamp });

t.test('speaker labels for indexing: them and speaker become Speaker, user becomes You', (t) => {
  const cleaned = preprocessTranscript([
    segment('them', 1000, 'The shipment leaves on Monday morning.'),
    segment('user', 4000, 'That works for the whole team here.'),
    segment('speaker', 7000, 'The price stays the same this quarter.'),
  ]);
  t.same(cleaned.map((row) => row.speaker), ['Speaker', 'You', 'Speaker']);
  t.end();
});
