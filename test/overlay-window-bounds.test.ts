import t from 'tap';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  OVERLAY_EXPANDED_MIN_HEIGHT,
  OVERLAY_EXPANDED_MIN_WIDTH,
  OVERLAY_EXPANDED_PREFERRED_MAX_HEIGHT,
  OVERLAY_EXPANDED_PREFERRED_MAX_WIDTH,
  calculateExpandedOverlayBounds,
} from '../electron/helpers/overlayBounds';

t.test('expanded overlay opens at a real usable size instead of collapsed pill height', (t) => {
  const workArea = { x: 0, y: 0, width: 1512, height: 982 };
  const bounds = calculateExpandedOverlayBounds(workArea);

  t.ok(bounds.width >= OVERLAY_EXPANDED_MIN_WIDTH, 'wide enough for the expanded transcript/chat UI');
  t.ok(bounds.height >= OVERLAY_EXPANDED_MIN_HEIGHT, 'tall enough for the expanded transcript/chat UI');
  t.ok(bounds.height > 216, 'never reuses the old collapsed/half-open overlay height');
  t.ok(bounds.x >= workArea.x && bounds.y >= workArea.y, 'starts inside the visible work area');
  t.ok(bounds.x + bounds.width <= workArea.x + workArea.width, 'width fits work area');
  t.ok(bounds.y + bounds.height <= workArea.y + workArea.height, 'height fits work area');
  t.end();
});

t.test('expanded overlay bounds degrade safely on small displays', (t) => {
  const workArea = { x: 10, y: 20, width: 500, height: 320 };
  const bounds = calculateExpandedOverlayBounds(workArea);

  t.ok(bounds.width > 0);
  t.ok(bounds.height > 0);
  t.ok(bounds.width <= Math.floor(workArea.width * 0.92));
  t.ok(bounds.height <= Math.floor(workArea.height * 0.86));
  t.ok(bounds.x >= workArea.x && bounds.y >= workArea.y);
  t.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
  t.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
  t.end();
});


t.test('large displays still open as a compact resizable modal', (t) => {
  const workArea = { x: 0, y: 0, width: 3024, height: 1964 };
  const bounds = calculateExpandedOverlayBounds(workArea);

  t.ok(bounds.width <= OVERLAY_EXPANDED_PREFERRED_MAX_WIDTH, 'ultra-wide displays are capped to compact launch width');
  t.ok(bounds.height <= OVERLAY_EXPANDED_PREFERRED_MAX_HEIGHT, 'tall displays are capped to compact launch height');
  t.ok(bounds.width >= OVERLAY_EXPANDED_MIN_WIDTH, 'still wide enough for transcript/chat columns');
  t.ok(bounds.height >= OVERLAY_EXPANDED_MIN_HEIGHT, 'still tall enough for footer controls');
  t.end();
});

t.test('selective screenshot capture waits until cropper overlay is hidden', (t) => {
  const source = readFileSync(path.join(process.cwd(), 'electron/helpers/CropperWindowHelper.ts'), 'utf8');
  const confirmBlock = source.slice(source.indexOf('const screenBounds = this.toScreenBounds(bounds);'), source.indexOf('this.cancelledListener ='));

  t.match(source, /HIDE_BEFORE_CAPTURE_DELAY_MS/, 'cropper has an explicit hide-before-capture settle delay');
  t.ok(confirmBlock.indexOf('this.hideOrClose();') < confirmBlock.indexOf('this.resolveCurrentSelection(screenBounds);'), 'confirm hides cropper before resolving selection to ScreenshotHelper');
  t.end();
});


t.test('launcher window uses compact calculated bounds instead of fixed 1200x800', (t) => {
  const source = readFileSync(path.join(process.cwd(), 'electron/helpers/WindowHelper.ts'), 'utf8');
  const createWindowBlock = source.slice(source.indexOf('public createWindow(): void'), source.indexOf('// --- 1. Create Launcher Window ---'));

  t.match(createWindowBlock, /calculateExpandedOverlayBounds\(workArea\)/, 'launcher launch size comes from shared compact overlay bounds');
  t.notMatch(createWindowBlock, /const width = 1200/, 'launcher no longer hard-codes old large width');
  t.notMatch(createWindowBlock, /const height = 800/, 'launcher no longer hard-codes old large height');
  t.match(createWindowBlock, /workArea\.y \+ topMargin/, 'top position uses workArea.y, not workArea.x');
  t.end();
});
