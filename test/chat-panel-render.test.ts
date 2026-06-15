import React, { type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'tap';
import {
  CHAT_PANEL_ACTION_BAR_CLASS,
  CHAT_PANEL_CONTROL_BAR_CLASS,
  CHAT_PANEL_DRAG_HANDLE_CLASS,
  CHAT_PANEL_FOOTER_CLASS,
  CHAT_PANEL_FOOTER_CONTROLS_CLASS,
  CHAT_PANEL_INPUT_BASE_CLASS,
  ChatPanelAttachedScreenshots,
  ChatPanelControlBar,
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

test('footer and action layout classes keep adaptive wrap/grid/min-height behavior', (t) => {
  t.match(CHAT_PANEL_ACTION_BAR_CLASS, /\bgrid\b/, 'action bar starts as a grid on narrow widths');
  t.match(CHAT_PANEL_ACTION_BAR_CLASS, /min-\[520px\]:flex/, 'action bar switches to flex at larger modal widths');
  t.match(CHAT_PANEL_ACTION_BAR_CLASS, /flex-wrap/, 'action bar can wrap actions instead of overflowing');
  t.match(CHAT_PANEL_FOOTER_CLASS, /min-h-\[118px\]/, 'footer reserves a stable minimum height');
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


test('chat control bar exposes draggable handle plus no-drag pause and stop controls', (t) => {
  let paused = 0;
  let stopped = 0;
  let collapsed = 0;
  let home = 0;
  const tree = ChatPanelControlBar({
    isProcessing: true,
    isPaused: false,
    onTogglePause: () => { paused += 1; },
    onStop: () => { stopped += 1; },
    onToggleCollapse: () => { collapsed += 1; },
    onOpenLauncher: () => { home += 1; },
  });

  const root = collectElements(tree, (element) => element.props.className === CHAT_PANEL_CONTROL_BAR_CLASS)[0];
  t.ok(String(root.props.className).includes('draggable-area'), 'control bar is a drag region');

  const dragHandle = collectElements(tree, (element) => element.props['aria-label'] === 'Drag chat window')[0];
  t.ok(String(dragHandle.props.className).includes(CHAT_PANEL_DRAG_HANDLE_CLASS), 'explicit drag handle is rendered');

  const buttons = collectElements(tree, (element) => element.type === 'button');
  t.equal(buttons.length, 4, 'pause, stop, hide, and home buttons render');
  buttons.forEach((button) => t.match(String(button.props.className), /no-drag/, 'interactive control is not draggable'));

  buttons[0].props.onClick();
  buttons[1].props.onClick();
  buttons[2].props.onClick();
  buttons[3].props.onClick();
  t.equal(paused, 1);
  t.equal(stopped, 1);
  t.equal(collapsed, 1);
  t.equal(home, 1);
  t.end();
});
