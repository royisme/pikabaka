import t from 'tap';
import { shouldShowTopPillRunControls } from '../src/components/ui/topPillControls';

t.test('top pill run controls only show in collapsed state to avoid duplicate pause stop drag controls', (t) => {
  t.equal(shouldShowTopPillRunControls(true, true), false, 'expanded overlay hides top-pill run controls because chat header owns them');
  t.equal(shouldShowTopPillRunControls(true, false), false, 'expanded overlay keeps quit separate from run controls');
  t.equal(shouldShowTopPillRunControls(false, true), true, 'collapsed overlay keeps compact pause/stop/drag available');
  t.equal(shouldShowTopPillRunControls(false, false), false, 'no handlers means no controls');
  t.end();
});
