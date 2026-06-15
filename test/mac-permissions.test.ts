import t from 'tap';
import {
  buildPermissionStatusReport,
  getScreenCapturePermissionMessage,
  isMediaAccessGranted,
  normalizeMediaAccessStatus,
  parseMacCodeSignatureStatus,
} from '../electron/lib/mac-permissions';

t.test('normalizes granted and authorized media statuses as granted', (t) => {
  t.equal(normalizeMediaAccessStatus('granted'), 'granted');
  t.equal(normalizeMediaAccessStatus('authorized'), 'granted');
  t.equal(isMediaAccessGranted('granted'), true);
  t.equal(isMediaAccessGranted('authorized'), true);
  t.end();
});

t.test('treats limited as allowed but marked limited', (t) => {
  const report = buildPermissionStatusReport('limited', 'screen');
  t.equal(report.status, 'limited');
  t.equal(report.granted, true);
  t.equal(report.limited, true);
  t.match(report.message || '', /limited Screen Recording access/);
  t.end();
});

t.test('marks authorized screen status as restart-required instead of not granted', (t) => {
  const report = buildPermissionStatusReport('authorized', 'screen');
  t.equal(report.status, 'granted');
  t.equal(report.granted, true);
  t.equal(report.restartRequired, true);
  t.match(report.message || '', /quit and reopen Pika/);
  t.end();
});

t.test('screen capture failure after macOS grant reports restart and reset guidance', (t) => {
  t.match(getScreenCapturePermissionMessage('authorized'), /Screen Recording is allowed/);
  t.match(getScreenCapturePermissionMessage('authorized'), /remove Pika/);
  t.match(getScreenCapturePermissionMessage('denied'), /grant Screen Recording permission/);
  t.match(getScreenCapturePermissionMessage('denied'), /toggle is already on/);
  t.end();
});

t.test('detects ad-hoc cdhash-only macOS signatures', (t) => {
  const status = parseMacCodeSignatureStatus(`Executable=/Applications/Pika.app/Contents/MacOS/Pika
Identifier=com.royisme.pika
Signature=adhoc
TeamIdentifier=not set
`);

  t.equal(status.isAdHoc, true);
  t.equal(status.hasTeamIdentifier, false);
  t.end();
});

t.test('detects stable Apple Development macOS signatures', (t) => {
  const status = parseMacCodeSignatureStatus(`Executable=/Applications/Pika.app/Contents/MacOS/Pika
Identifier=com.royisme.pika
Authority=Apple Development: nmifun0@gmail.com (MM8NNFG575)
TeamIdentifier=MM8NNFG575
`);

  t.equal(status.isAdHoc, false);
  t.equal(status.hasTeamIdentifier, true);
  t.equal(status.teamIdentifier, 'MM8NNFG575');
  t.match(status.authority || '', /Apple Development/);
  t.end();
});
