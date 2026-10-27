import t from 'tap';
import { getOverlayAppearance, type OverlayTheme } from '../src/lib/overlayAppearance';

const shellAlpha = (opacity: number, theme: OverlayTheme) => {
  const { backgroundColor } = getOverlayAppearance(opacity, theme).shellStyle;
  const match = String(backgroundColor).match(/^rgba\(\d+, \d+, \d+, ([\d.]+)\)$/);
  if (!match) throw new Error('Expected an rgba shell background');
  return Number(match[1]);
};

t.test('dark shell opacity maps linearly to its legibility range', async (t) => {
  t.equal(shellAlpha(0.35, 'dark'), 0.95, 'minimum slider value gives the floor');
  t.equal(shellAlpha(1, 'dark'), 0.985, 'maximum slider value gives the ceiling');
  t.ok(Math.abs(shellAlpha(0.675, 'dark') - 0.9675) < 1e-12, 'midpoint gives halfway alpha');
  t.equal(shellAlpha(0.1, 'dark'), 0.95, 'below the stored range clamps to the floor');
  t.equal(shellAlpha(2, 'dark'), 0.985, 'above the stored range clamps to the ceiling');
});

t.test('light shell opacity maps linearly to its legibility range', async (t) => {
  t.equal(shellAlpha(0.35, 'light'), 0.94, 'minimum slider value gives the floor');
  t.equal(shellAlpha(1, 'light'), 0.985, 'maximum slider value gives the ceiling');
  t.ok(Math.abs(shellAlpha(0.675, 'light') - 0.9625) < 1e-12, 'midpoint gives halfway alpha');
  t.equal(shellAlpha(0.1, 'light'), 0.94, 'below the stored range clamps to the floor');
  t.equal(shellAlpha(2, 'light'), 0.985, 'above the stored range clamps to the ceiling');
});
