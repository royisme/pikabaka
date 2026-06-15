import t from 'tap';
import {
  OVERLAY_EXPANDED_MIN_HEIGHT,
  OVERLAY_EXPANDED_MIN_WIDTH,
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
