import t from 'tap';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newestFailedIndex, translationFailing, type RowSlot } from '../../src/lib/transcriptRow';
import { SlotLine } from '../../src/components/ui/RollingTranscript';
import OverlayTopBar from '../../src/components/meeting/OverlayTopBar';

const failed: RowSlot = { kind: 'failed', reason: 'timeout' };

t.test('only the newest failed row is a full failure', async (t) => {
  t.equal(newestFailedIndex([failed, { kind: 'translation' }, failed, null]), 2);
  t.equal(newestFailedIndex([{ kind: 'live' }, null]), -1);
  const full = renderToStaticMarkup(React.createElement(SlotLine, { slot: failed, onRetry: () => {} }));
  t.match(full, /Translation failed · timed out/);
  t.match(full, />Retry</);
  const quiet = renderToStaticMarkup(React.createElement(SlotLine, { slot: failed, onRetry: () => {}, quiet: true }));
  t.notMatch(quiet, /Retry|timed out/);
  t.match(quiet, /sr-only">Translation failed</);
});

t.test('translation is failing until a later row translates', async (t) => {
  const r = (translationState: 'error' | 'complete' | 'pending' | 'skipped', speaker: 'them' | 'user' = 'them') => ({ speaker, translationState });
  t.equal(translationFailing([]), false);
  t.equal(translationFailing([r('complete'), r('error')]), true);
  t.equal(translationFailing([r('error'), r('complete')]), false);
  t.equal(translationFailing([r('error'), r('pending'), r('complete', 'user')]), true);
});

const noop = () => {};
const bar = (translationFailing: boolean) =>
  renderToStaticMarkup(
    React.createElement(OverlayTopBar, {
      status: { chip: 'Listening', chipShort: 'Live', dot: 'success', level: 'ok', action: null } as never,
      hasRows: true, onFixAudio: noop, microphoneMuted: false, onToggleMicrophoneMute: noop,
      displayMode: 'both', translationEnabled: true, translationConfigured: true, translationFailing, theirLanguage: 'en', myLanguage: 'en', targetLanguage: 'en',
      languageOptions: [], onToggleTranslation: noop, onChangeSpokenLanguage: noop, onChangeTargetLanguage: noop, onToggleOriginal: noop,
      onSetUpTranslation: noop, modelName: 'm', isMousePassthrough: false, toggleOriginalKeys: [], toggleTranslationKeys: [], onHide: noop,
      onQuit: noop, onOpenModelSelector: noop, onOpenSettings: noop, onToggleMousePassthrough: noop, onOpenLauncher: noop,
    }),
  );

t.test('the Translate button carries a triangle from 480px while translation fails', async (t) => {
  t.match(bar(true), /data-translation-failing="true"[^>]*>▲</);
  t.match(bar(true), /min-\[480px\]:inline[^>]*>▲/);
  t.notMatch(bar(false), /data-translation-failing/);
});
