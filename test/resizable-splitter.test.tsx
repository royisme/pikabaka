import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'tap';
import ResizableSplitter from '../src/components/ui/ResizableSplitter';

test('resizable splitter has a visible accessible handle for Live Transcript / AI Chat separation', (t) => {
  const markup = renderToStaticMarkup(
    <ResizableSplitter
      position={35}
      min={20}
      max={70}
      orientation="vertical"
      onPositionChange={() => {}}
    />
  );

  t.match(markup, /role="separator"/, 'splitter is exposed as a separator');
  t.match(markup, /aria-label="Resize Live Transcript and AI Chat panes"/, 'splitter explains what it resizes');
  t.match(markup, /aria-orientation="vertical"/, 'splitter has the expected vertical orientation');
  t.match(markup, /aria-valuenow="35"/, 'splitter exposes the current pane split');
  t.match(markup, /tabindex="0"/, 'splitter can be focused for keyboard resizing');
  t.match(markup, /w-2\.5 cursor-col-resize/, 'splitter has a larger mouse hit area than the old hairline');
  t.end();
});
