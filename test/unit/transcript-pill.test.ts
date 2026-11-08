import t from 'tap';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newestPreview } from '../../src/lib/answerScroll';
import { NewRowsPill } from '../../src/components/ui/RollingTranscript';

t.test('newestPreview is the newest row on one line, or empty', async (t) => {
  t.equal(newestPreview([]), '');
  t.equal(newestPreview([{ sourceText: 'Invented first' }, { sourceText: '  Invented\nsecond   line ' }]), 'Invented second line');
});

t.test('the pill shows the count and a truncated preview at a fixed width', async (t) => {
  const html = renderToStaticMarkup(React.createElement(NewRowsPill, { count: 3, preview: 'Invented newest line', onClick: () => {} }));
  t.match(html, /aria-label="Jump to latest, 3 new lines"/);
  t.match(html, /data-pill-preview="true"[^>]*>Invented newest line</);
  t.match(html, /truncate/);
  t.match(html, /\bw-44\b/);
  const none = renderToStaticMarkup(React.createElement(NewRowsPill, { count: 0, preview: '', onClick: () => {} }));
  t.match(none, />Latest</);
  t.notMatch(none, /data-pill-preview/);
});
