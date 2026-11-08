import t from 'tap';
import { isKnownVirtualName, resolveSink, sameDeviceName } from '../../src/lib/virtualOutput';

const dev = (deviceId: string, label: string) => ({ deviceId, label });
const devices = [dev('default', 'Default - Invented Speakers'), dev('a1', 'Invented Speakers'), dev('b2', 'BlackHole 2ch (Virtual)'), dev('c3', 'BlackHole 16ch')];

t.test('sameDeviceName matches by case-insensitive containment in either direction', async (t) => {
  t.equal(sameDeviceName('BlackHole 2ch', 'blackhole 2ch (virtual)'), true);
  t.equal(sameDeviceName('BlackHole 2ch (Virtual)', 'BlackHole 2ch'), true);
  t.equal(sameDeviceName('Invented Speakers', 'BlackHole 2ch'), false);
  t.equal(sameDeviceName('', 'BlackHole 2ch'), false, 'empty never matches');
});

t.test('known virtual driver names', async (t) => {
  for (const name of ['BlackHole 2ch', 'CABLE Input (VB-Audio Virtual Cable)', 'VB-Cable']) t.equal(isKnownVirtualName(name), true, name);
  t.equal(isKnownVirtualName('Invented Speakers'), false);
});

t.test('virtual: the saved label picks the sink, aliases are skipped', async (t) => {
  t.same(resolveSink(devices, 'virtual', 'BlackHole 2ch'), { ok: true, deviceId: 'b2' });
  t.same(resolveSink(devices, 'virtual', 'blackhole 16ch'), { ok: true, deviceId: 'c3' });
  t.same(resolveSink(devices, 'virtual', 'Invented Speakers'), { ok: true, deviceId: 'a1' }, 'the real device, not the Default alias');
});

t.test('virtual: an exact label wins over a longer match', async (t) => {
  const list = [dev('x', 'BlackHole 2ch (Virtual)'), dev('y', 'BlackHole 2ch')];
  t.same(resolveSink(list, 'virtual', 'BlackHole 2ch'), { ok: true, deviceId: 'y' });
});

t.test('virtual: a missing sink is an error and never the default output', async (t) => {
  t.same(resolveSink(devices, 'virtual', 'CABLE Input'), { ok: false, error: "Virtual microphone 'CABLE Input' not found." });
  t.equal(resolveSink(devices, 'virtual', '').ok, false, 'no label chosen');
  const blank = resolveSink([dev('default', ''), dev('a1', '')], 'virtual', 'BlackHole 2ch');
  t.equal(blank.ok, false);
  t.match(blank.ok ? '' : blank.error, /names are not available/);
});

t.test('default: the system default output, no label needed', async (t) => {
  t.same(resolveSink([], 'default', ''), { ok: true, deviceId: '' });
});
