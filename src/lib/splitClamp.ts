/**
 * Pixel floors for the two zones of the overlay. They include each zone's fixed chrome, so a zone
 * is never squeezed below the height its own controls need (the answer zone's chips, input and
 * footer are about 205px; the transcript zone keeps its header and a few lines). When the overlay
 * layout loses chrome these numbers go down with it.
 */
export const MIN_TRANSCRIPT_ZONE_PX = 100;
export const MIN_ANSWER_ZONE_PX = 215;

/** The split is never closer to an edge than this, whatever the window height. */
const MIN_PCT = 20;
const MAX_PCT = 80;

/** Bounds, in percent of the zones' combined height, inside which the split keeps both zones above their floors. */
export function splitBounds(totalPx: number): { min: number; max: number } {
  if (!(totalPx > 0)) return { min: MIN_PCT, max: MAX_PCT };
  const min = Math.max(MIN_PCT, (MIN_TRANSCRIPT_ZONE_PX / totalPx) * 100);
  const max = Math.min(MAX_PCT, 100 - (MIN_ANSWER_ZONE_PX / totalPx) * 100);
  if (min <= max) return { min, max };
  // Too short for both floors: share what there is in the ratio of the floors, so neither zone is the one that clips.
  const shared = (MIN_TRANSCRIPT_ZONE_PX / (MIN_TRANSCRIPT_ZONE_PX + MIN_ANSWER_ZONE_PX)) * 100;
  return { min: shared, max: shared };
}

export function clampSplit(totalPx: number, pct: number): number {
  const { min, max } = splitBounds(totalPx);
  return Math.min(max, Math.max(min, pct));
}
