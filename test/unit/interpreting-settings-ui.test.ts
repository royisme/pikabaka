import t from 'tap';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FIRST_ENABLE_POINTS, noticeNeeded, outputNames, preselectOutput } from '../../src/lib/interpretingSettingsUi';
import InterpretingNoticeDialog from '../../src/components/settings/InterpretingNoticeDialog';

t.test('noticeNeeded asks until a time is stored, and again once it is cleared', async (t) => {
  t.equal(noticeNeeded({}), true);
  t.equal(noticeNeeded({ noticeAcceptedAt: '2026-01-02T03:04:05.000Z' }), false);
  t.equal(noticeNeeded({ noticeAcceptedAt: '' }), true);
});

t.test('outputNames drops aliases and unnamed devices and merges repeats', async (t) => {
  const devices = [
    { deviceId: 'default', label: 'Default - Invented Speakers' },
    { deviceId: 'a', label: 'Invented Speakers' },
    { deviceId: 'b', label: 'BlackHole 2ch' },
    { deviceId: 'c', label: 'BlackHole 2ch' },
    { deviceId: 'd', label: '' },
  ];
  t.same(outputNames(devices), ['Invented Speakers', 'BlackHole 2ch']);
});

t.test('preselectOutput keeps the saved name, else proposes a known virtual driver, else nothing', async (t) => {
  const names = ['Invented Speakers', 'CABLE Input (VB-Audio Virtual Cable)'];
  t.equal(preselectOutput('Invented Speakers', names), 'Invented Speakers');
  t.equal(preselectOutput('', names), 'CABLE Input (VB-Audio Virtual Cable)');
  t.equal(preselectOutput('', ['Invented Speakers']), '');
});

t.test('the notice dialog lists every point and keeps Turn on disabled until it is understood', async (t) => {
  const html = renderToStaticMarkup(React.createElement(InterpretingNoticeDialog, { onConfirm: () => {}, onCancel: () => {} }));
  t.equal(FIRST_ENABLE_POINTS.length, 4);
  t.match(html, /Before you turn on Interpreting/);
  t.match(html, /Tell the people in the call/);
  t.match(html, /<button[^>]*disabled=""[^>]*>Turn on<\/button>/);
  t.match(html, /Cancel/);
});
