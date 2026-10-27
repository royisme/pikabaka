import t from 'tap';
import { MIN_ANSWER_ZONE_PX, MIN_TRANSCRIPT_ZONE_PX, clampSplit, splitBounds } from '../src/lib/splitClamp';

const zones = (totalPx: number, pct: number) => {
  const top = (clampSplit(totalPx, pct) / 100) * totalPx;
  return { top, bottom: totalPx - top };
};

t.test('at the default height the answer zone keeps room for its own controls', async (t) => {
  // 420px window: 376px for the two zones once the 36px bar, the 6px splitter and the 2px shell border are out.
  for (const pct of [20, 40, 55, 80]) {
    const { top, bottom } = zones(376, pct);
    t.ok(bottom >= MIN_ANSWER_ZONE_PX - 0.001, `answer zone at wish ${pct}%: ${bottom}`);
    t.ok(top >= MIN_TRANSCRIPT_ZONE_PX - 0.001, `transcript zone at wish ${pct}%: ${top}`);
  }
});

t.test('a tall window keeps the 20-80 range', async (t) => {
  t.same(splitBounds(1000), { min: 20, max: 100 - MIN_ANSWER_ZONE_PX / 10 });
  t.equal(clampSplit(1000, 5), 20);
  t.equal(clampSplit(1000, 50), 50);
  t.equal(clampSplit(2000, 95), 80);
});

t.test('a window too short for both floors splits in the ratio of the floors, never clipping one zone alone', async (t) => {
  const { min, max } = splitBounds(250);
  t.equal(min, max);
  const { top, bottom } = zones(250, 60);
  t.ok(Math.abs(top / bottom - MIN_TRANSCRIPT_ZONE_PX / MIN_ANSWER_ZONE_PX) < 0.001);
});

t.test('an unknown height changes nothing', async (t) => {
  t.same(splitBounds(0), { min: 20, max: 80 });
  t.equal(clampSplit(0, 55), 55);
  t.equal(clampSplit(NaN, 55), 55);
});
