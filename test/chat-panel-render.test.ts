import React, { type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'tap';
import {
  CHAT_PANEL_ACTION_BAR_CLASS,
  CHAT_PANEL_CONTROL_BAR_CLASS,
  CHAT_PANEL_DRAG_HANDLE_CLASS,
  CHAT_PANEL_FOOTER_CLASS,
  CHAT_PANEL_FOOTER_CONTROLS_CLASS,
  CHAT_PANEL_INPUT_BASE_CLASS,
  CHAT_PANEL_MESSAGE_SCREENSHOT_IMAGE_CLASS,
  CHAT_PANEL_MESSAGE_SCREENSHOT_PREVIEW_CLASS,
  ChatPanelAttachedScreenshots,
  ChatPanelControlBar,
  ChatPanelMessageScreenshotPreview,
  ChatPanelTextInput,
  getChatPanelModelDisplayName,
  handleChatInputPaste,
  type ChatPanelAttachment,
} from '../src/components/meeting/chatPanelRenderParts';

type ElementMatcher = (element: ReactElement) => boolean;

function isReactElement(node: ReactNode): node is ReactElement {
  return React.isValidElement(node);
}

function collectElements(node: ReactNode, matcher: ElementMatcher, matches: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, matcher, matches));
    return matches;
  }

  if (!isReactElement(node)) return matches;
  if (matcher(node)) matches.push(node);
  collectElements(node.props.children, matcher, matches);
  return matches;
}

const attachments: ChatPanelAttachment[] = [
  { path: '/tmp/screen-1.png', preview: 'data:image/png;base64,one' },
  { path: '/tmp/screen-2.png', preview: 'data:image/png;base64,two' },
];

test('pasted image handler prevents default and calls image paste action only for image clipboard items', (t) => {
  let prevented = 0;
  let pasteCalls = 0;

  handleChatInputPaste(
    {
      clipboardData: { items: [{ type: 'text/plain' }, { type: 'image/png' }] },
      preventDefault: () => {
        prevented += 1;
      },
    },
    () => {
      pasteCalls += 1;
    }
  );

  t.equal(prevented, 1, 'image paste prevents the browser from inserting raw data');
  t.equal(pasteCalls, 1, 'image paste delegates to the screenshot attachment handler');

  handleChatInputPaste(
    {
      clipboardData: { items: [{ type: 'text/plain' }] },
      preventDefault: () => {
        prevented += 1;
      },
    },
    () => {
      pasteCalls += 1;
    }
  );

  t.equal(prevented, 1, 'plain text paste is not intercepted');
  t.equal(pasteCalls, 1, 'plain text paste does not attach screenshots');
  t.end();
});

test('attached screenshots render previews and remove controls with working callbacks', (t) => {
  let nextContext: ChatPanelAttachment[] | undefined;
  const setAttachedContext = (value: React.SetStateAction<ChatPanelAttachment[]>) => {
    nextContext = typeof value === 'function' ? value(attachments) : value;
  };

  const tree = ChatPanelAttachedScreenshots({
    attachedContext: attachments,
    setAttachedContext,
    isLightTheme: true,
    removeAllIcon: 'remove-all-icon',
    removeIcon: 'remove-one-icon',
  });
  const markup = renderToStaticMarkup(tree);

  t.match(markup, /2 screenshots attached/, 'count label is rendered');
  t.match(markup, /src="data:image\/png;base64,one"/, 'first screenshot preview is rendered');
  t.match(markup, /src="data:image\/png;base64,two"/, 'second screenshot preview is rendered');
  t.match(markup, /alt="Screenshot 1"/, 'first preview has accessible alt text');
  t.match(markup, /aria-label="Remove all screenshots"/, 'remove-all control is rendered');
  t.match(markup, /aria-label="Remove screenshot 1"/, 'per-screenshot remove control is rendered');

  const buttons = collectElements(tree, (element) => element.type === 'button');
  t.equal(buttons.length, 3, 'remove-all plus one remove button per preview');

  buttons[0].props.onClick();
  t.same(nextContext, [], 'remove-all clears attached screenshots');

  buttons[1].props.onClick();
  t.same(nextContext, [attachments[1]], 'per-preview remove drops only that screenshot');
  t.end();
});


test('message screenshot attachments render an inline thumbnail preview', (t) => {
  const tree = ChatPanelMessageScreenshotPreview({
    preview: 'data:image/png;base64,inline-preview',
    isLightTheme: false,
  });
  const markup = renderToStaticMarkup(tree);

  t.match(markup, /data-testid="chat-message-screenshot-preview"/, 'message-level preview container is rendered');
  t.match(markup, /src="data:image\/png;base64,inline-preview"/, 'thumbnail uses the screenshot preview data URI');
  t.match(markup, /alt="Attached screenshot preview"/, 'thumbnail has accessible alt text');
  t.match(CHAT_PANEL_MESSAGE_SCREENSHOT_PREVIEW_CLASS, /max-w-\[220px\]/, 'message preview is a small thumbnail, not a full-size image');
  t.match(CHAT_PANEL_MESSAGE_SCREENSHOT_IMAGE_CLASS, /max-h-28/, 'message preview image height is capped');
  t.end();
});

test('footer and action layout classes keep adaptive wrap/grid/min-height behavior', (t) => {
  t.match(CHAT_PANEL_ACTION_BAR_CLASS, /\bgrid\b/, 'action bar starts as a grid on narrow widths');
  t.match(CHAT_PANEL_ACTION_BAR_CLASS, /min-\[520px\]:flex/, 'action bar switches to flex at larger modal widths');
  t.match(CHAT_PANEL_ACTION_BAR_CLASS, /flex-wrap/, 'action bar can wrap actions instead of overflowing');
  t.match(CHAT_PANEL_FOOTER_CLASS, /min-h-\[96px\]/, 'footer reserves a stable compact minimum height');
  t.match(CHAT_PANEL_FOOTER_CONTROLS_CLASS, /flex-wrap/, 'footer controls wrap on narrow widths');
  t.match(CHAT_PANEL_FOOTER_CONTROLS_CLASS, /min-w-0/, 'footer controls may shrink instead of forcing overflow');
  t.match(CHAT_PANEL_INPUT_BASE_CLASS, /min-h-\[42px\]/, 'input keeps a tappable minimum height');
  t.end();
});

test('model display resolves OpenAI-compatible provider UUIDs to friendly provider names', (t) => {
  const providerId = '45fc9792-9e26-4a54-9999-aaaaaaaaaaaa';
  const display = getChatPanelModelDisplayName(providerId, [
    { id: providerId, name: 'OmniRoute', preferredModel: 'claude-sonnet-4-6' },
  ]);

  t.equal(display, 'OmniRoute • Claude Sonnet 4 6');
  t.notMatch(display, /45fc9792|9e26|4a54|9999|aaaaaaaaaaaa/, 'footer never exposes raw UUID fragments');
  t.end();
});

test('chat input renders and submits on Enter', (t) => {
  let submitted = 0;
  let inputValue = '';
  let pasted = 0;

  const tree = ChatPanelTextInput({
    inputValue: 'hello',
    setInputValue: (value) => {
      inputValue = value;
    },
    handleManualSubmit: () => {
      submitted += 1;
    },
    handleInputPaste: () => {
      pasted += 1;
    },
    inputClass: 'overlay-input-surface overlay-input-text',
    selectiveScreenshotShortcut: ['Ctrl', 'Shift', 'S'],
  });
  const markup = renderToStaticMarkup(tree);
  const input = collectElements(tree, (element) => element.type === 'input')[0];

  t.match(markup, /<input/, 'input element renders');
  t.match(markup, /value="hello"/, 'input receives the current value');
  t.match(markup, /overlay-input-surface overlay-input-text/, 'input keeps overlay styling classes');

  input.props.onChange({ target: { value: 'typed question' } });
  t.equal(inputValue, 'typed question', 'input change callback receives typed value');

  input.props.onKeyDown({ key: 'Escape' });
  t.equal(submitted, 0, 'non-Enter keys do not submit');
  input.props.onKeyDown({ key: 'Enter' });
  t.equal(submitted, 1, 'Enter submits the chat input');

  input.props.onPaste({ clipboardData: { items: [{ type: 'image/png' }] }, preventDefault: () => {} });
  t.equal(pasted, 1, 'input wires paste events to the paste handler');
  t.end();
});


test('chat control bar is only a draggable AI chat pane header', (t) => {
  let called = 0;
  const tree = ChatPanelControlBar({
    isProcessing: true,
    isPaused: false,
    onTogglePause: () => { called += 1; },
    onStop: () => { called += 1; },
  });

  const root = collectElements(tree, (element) => element.props.className === CHAT_PANEL_CONTROL_BAR_CLASS)[0];
  t.ok(String(root.props.className).includes('draggable-area'), 'AI chat header is a drag region');

  const dragHandle = collectElements(tree, (element) => element.props['aria-label'] === 'Drag AI chat pane')[0];
  t.ok(String(dragHandle.props.className).includes(CHAT_PANEL_DRAG_HANDLE_CLASS), 'explicit AI chat drag handle is rendered');

  const buttons = collectElements(tree, (element) => element.type === 'button');
  t.equal(buttons.length, 0, 'AI chat header does not duplicate top-level Pause/Stop buttons');
  t.equal(called, 0, 'duplicate run-control callbacks are not wired in the pane header');
  t.end();
});


test('chat message scroll area can shrink inside responsive columns', (t) => {
  const chatPanelSource = readFileSync(path.join(process.cwd(), 'src/components/meeting/ChatPanel.tsx'), 'utf8');
  t.match(chatPanelSource, /flex-1 min-h-0 overflow-y-auto/, 'message area uses min-h-0 so footer/input stay reachable at small heights');
  t.end();
});


test('transcript pane stays compact and removes dashed empty-state pointers', (t) => {
  const transcriptPanelSource = readFileSync(path.join(process.cwd(), 'src/components/meeting/TranscriptPanel.tsx'), 'utf8');
  const rollingTranscriptSource = readFileSync(path.join(process.cwd(), 'src/components/ui/RollingTranscript.tsx'), 'utf8');

  t.notMatch(transcriptPanelSource, /border-dashed/, 'empty transcript placeholder has no dashed corner pointers');
  t.match(transcriptPanelSource, /items-center justify-center/, 'empty state remains centered');
  t.match(transcriptPanelSource, /title=\{statusTitle\}/, 'full STT status/error remains available as title');
  t.match(transcriptPanelSource, /max-w-full/, 'STT chip is constrained to the transcript column width');
  t.match(transcriptPanelSource, /truncate/, 'STT status truncates instead of wrapping');
  t.notMatch(rollingTranscriptSource, /max-h-\[280px\]/, 'rolling transcript no longer has old fixed max height');
  t.match(rollingTranscriptSource, /h-full min-h-0 w-full overflow-y-auto/, 'rolling transcript fills pane and scrolls internally');
  t.end();
});


test('chat message layout stays compact in small resizable columns', (t) => {
  const chatPanelSource = readFileSync(path.join(process.cwd(), 'src/components/meeting/ChatPanel.tsx'), 'utf8');

  t.match(chatPanelSource, /px-3 py-2 space-y-1\.5/, 'message scroll area uses compact padding and gaps');
  t.match(chatPanelSource, /text-\[13px\] leading-\[1\.45\]/, 'message bubbles use compact readable text');
  t.match(chatPanelSource, /max-w-\[92%\]/, 'assistant/system messages use more of the resizable chat column');
  t.match(chatPanelSource, /ChatPanelMessageScreenshotPreview/, 'submitted screenshots render a thumbnail preview in the message');
  t.end();
});
