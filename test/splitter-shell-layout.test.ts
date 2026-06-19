import t from 'tap';
import {
  SPLITTER_CONTENT_CLASS,
  SPLITTER_LEFT_SECTION_CLASS,
  SPLITTER_ORIENTATION,
  SPLITTER_PANE_BODY_CLASS,
  SPLITTER_RIGHT_SECTION_CLASS,
  SPLITTER_SHELL_CLASS,
  ZONE_HEADER_CLASS,
  SPLITTER_STACKED_CONTENT_CLASS,
  STACKED_LAYOUT_WIDTH_PX,
} from '../src/components/meeting/SplitterShell';

t.test('splitter shell lays live transcript and AI chat out as columns', (t) => {
  t.equal(SPLITTER_ORIENTATION, 'vertical', 'vertical splitter divides columns left/right');
  t.match(SPLITTER_CONTENT_CLASS, /flex-row/, 'pane content is a row of columns, not stacked rows');
  t.match(SPLITTER_LEFT_SECTION_CLASS, /min-w-0/, 'left column can shrink without overflowing');
  t.match(SPLITTER_RIGHT_SECTION_CLASS, /min-w-0/, 'right column can shrink without overflowing');
  t.match(SPLITTER_PANE_BODY_CLASS, /min-w-0/, 'pane bodies allow content to shrink/scroll');
  t.match(SPLITTER_SHELL_CLASS, /min-w-0/, 'modal shell participates in small-width layouts');
  t.match(ZONE_HEADER_CLASS, /draggable-area/, 'live transcript and AI chat headers are draggable');
  t.end();
});


t.test('splitter shell stacks panes on narrow overlays', (t) => {
  t.match(SPLITTER_STACKED_CONTENT_CLASS, /flex-col/, 'narrow overlays stack transcript above chat');
  t.ok(STACKED_LAYOUT_WIDTH_PX <= 900, 'stacked fallback starts before medium overlays become cramped');
  t.end();
});
