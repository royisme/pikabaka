import t from 'tap';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { askAboutLineText, challengeCardText } from '../../src/lib/transcriptAsk';
import TranscriptNotes from '../../src/components/ui/RollingTranscript';
import type { TranscriptSegment } from '../../src/lib/transcriptSegments';

const row = (segmentId: string, speaker: 'them' | 'user'): TranscriptSegment => ({
  segmentId, sourceText: `Invented ${segmentId}`, timestamp: 1, speakerLabel: speaker === 'them' ? 'Them' : 'You', translationState: 'skipped', speaker, revision: 1,
});

t.test('askAboutLineText quotes the line as the other party\'s words and leaves room to type', async (t) => {
  t.equal(askAboutLineText({ sourceText: '  Invented line  ' }), 'About what they said "Invented line": ');
});

t.test('the ask button shows on other-party rows only, and only when a handler is given', async (t) => {
  const segments = [row('a', 'them'), row('b', 'user'), row('c', 'them')];
  const withHandler = renderToStaticMarkup(React.createElement(TranscriptNotes, { segments, displayMode: 'original', onAskSegment: () => {} }));
  t.equal(withHandler.split('data-ask-line').length - 1, 2);
  const without = renderToStaticMarkup(React.createElement(TranscriptNotes, { segments, displayMode: 'original' }));
  t.equal(without.split('data-ask-line').length - 1, 0);
  t.match(withHandler, /opacity-0[^"]*group-hover:opacity-100/, 'hidden until hover or focus');
});

t.test('challengeCardText carries the card and its trigger line, or the card alone', async (t) => {
  const card = { text: 'Invented suggestion', segmentId: 'a' };
  t.equal(
    challengeCardText(card, [row('a', 'them')]),
    'Pika suggested "Invented suggestion" for what they said "Invented a", but that is not right: ',
  );
  t.equal(challengeCardText(card, [row('z', 'them')]), 'Pika suggested "Invented suggestion", but that is not right: ');
});
