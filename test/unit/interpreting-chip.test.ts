import t from 'tap';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { interpretingLabel, interpretingTitle } from '../../src/lib/interpretingChip';
import OverlayTopBar from '../../src/components/meeting/OverlayTopBar';
import type { InterpretingState } from '../../electron/interpreting/InterpretingSession';

t.test('state to label', async (t) => {
  t.equal(interpretingLabel({ phase: 'idle' }), 'Talk');
  t.equal(interpretingLabel({ phase: 'listening' }), '● Listening');
  t.equal(interpretingLabel({ phase: 'translating' }), 'Translating');
  t.equal(interpretingLabel({ phase: 'voicing' }), 'Voicing');
  t.equal(interpretingLabel({ phase: 'speaking' }), 'Speaking');
  t.equal(interpretingLabel({ phase: 'error', error: 'x' }), '▲ Failed');
});

t.test('title: the real error, or the instruction with the shortcut', async (t) => {
  t.equal(interpretingTitle({ phase: 'error', error: "Virtual microphone 'X' not found." }, '⌘⌥I'), "Virtual microphone 'X' not found.");
  t.equal(interpretingTitle({ phase: 'listening' }, '⌘⌥I'), 'Press again to send · ⌘⌥I');
  t.equal(interpretingTitle({ phase: 'idle' }, ''), 'Talk');
});

const noop = () => {};
const bar = (interpreting: InterpretingState | undefined, microphoneMuted = false) =>
  renderToStaticMarkup(
    React.createElement(OverlayTopBar, {
      status: { chip: 'Listening', chipShort: 'Live', dot: 'success', level: 'ok', action: null } as never,
      hasRows: true, onFixAudio: noop, microphoneMuted, onToggleMicrophoneMute: noop, interpreting, onToggleTalk: noop, talkKeys: ['⌘', '⌥', 'I'],
      displayMode: 'both', translationEnabled: true, translationConfigured: true, theirLanguage: 'en', myLanguage: 'en', targetLanguage: 'en',
      languageOptions: [], onToggleTranslation: noop, onChangeSpokenLanguage: noop, onChangeTargetLanguage: noop, onToggleOriginal: noop,
      onSetUpTranslation: noop, modelName: 'm', isMousePassthrough: false, toggleOriginalKeys: [], toggleTranslationKeys: [], onHide: noop,
      onQuit: noop, onOpenModelSelector: noop, onOpenSettings: noop, onToggleMousePassthrough: noop, onOpenLauncher: noop,
    }),
  );

t.test('the control is hidden when interpreting is off and shows the label otherwise', async (t) => {
  t.notMatch(bar({ phase: 'off' }), /aria-label="Talk/);
  t.notMatch(bar(undefined), /aria-label="Talk/);
  const idle = bar({ phase: 'idle' });
  t.match(idle, /aria-label="Talk: idle"/);
  t.match(idle, />Talk</);
  t.match(bar({ phase: 'listening' }), /aria-pressed="true"[^>]*aria-label="Talk: listening"/);
});

t.test('error shows the triangle and the real message in the title', async (t) => {
  const html = bar({ phase: 'error', error: 'Invented failure' });
  t.match(html, />▲ Failed</);
  t.match(html, /title="Invented failure"/);
});

t.test('muted: the control is disabled with the unmute hint, and its width class does not change by state', async (t) => {
  const muted = bar({ phase: 'idle' }, true);
  t.match(muted, /title="Unmute the microphone to talk"[^>]*disabled/);
  const width = (html: string) => /class="[^"]*min-\[560px\]:min-w-\[96px\][^"]*"/.test(html);
  for (const phase of ['idle', 'listening', 'translating', 'voicing', 'speaking', 'error'] as const) t.ok(width(bar({ phase })), phase);
});
