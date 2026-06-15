export interface OverlayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayBounds extends OverlayWorkArea {}

export const OVERLAY_EXPANDED_MIN_WIDTH = 640;
export const OVERLAY_EXPANDED_MIN_HEIGHT = 440;
export const OVERLAY_EXPANDED_WIDTH_RATIO = 0.46;
export const OVERLAY_EXPANDED_HEIGHT_RATIO = 0.42;
export const OVERLAY_EXPANDED_MAX_WIDTH_RATIO = 0.72;
export const OVERLAY_EXPANDED_MAX_HEIGHT_RATIO = 0.68;
export const OVERLAY_EXPANDED_PREFERRED_MAX_WIDTH = 960;
export const OVERLAY_EXPANDED_PREFERRED_MAX_HEIGHT = 600;

function fitDimension(
  total: number,
  preferredRatio: number,
  minimum: number,
  maximumRatio: number,
  preferredMaximum: number,
): number {
  const ratioMax = Math.max(1, Math.floor(total * maximumRatio));
  const max = Math.max(1, Math.min(ratioMax, preferredMaximum));
  const min = Math.min(minimum, max);
  const preferred = Math.min(Math.floor(total * preferredRatio), preferredMaximum);
  return Math.min(Math.max(preferred, min), max);
}

export function calculateExpandedOverlayBounds(workArea: OverlayWorkArea): OverlayBounds {
  const width = fitDimension(
    workArea.width,
    OVERLAY_EXPANDED_WIDTH_RATIO,
    OVERLAY_EXPANDED_MIN_WIDTH,
    OVERLAY_EXPANDED_MAX_WIDTH_RATIO,
    OVERLAY_EXPANDED_PREFERRED_MAX_WIDTH,
  );
  const height = fitDimension(
    workArea.height,
    OVERLAY_EXPANDED_HEIGHT_RATIO,
    OVERLAY_EXPANDED_MIN_HEIGHT,
    OVERLAY_EXPANDED_MAX_HEIGHT_RATIO,
    OVERLAY_EXPANDED_PREFERRED_MAX_HEIGHT,
  );

  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}
