import t from 'tap';
import fs from 'node:fs';
import path from 'node:path';
import { primaryButton, secondaryButton } from '../../src/components/settings/buttonStyles';

const settingsDir = path.resolve('src/components/settings');

t.test('the shared primary button is the filled pair and the secondary keeps a visible border', (t) => {
  t.ok(primaryButton.includes('bg-primary'), 'the primary action is filled with the base family');
  t.ok(primaryButton.includes('text-on-primary'), 'its label uses the paired text colour');
  t.notOk(primaryButton.includes('text-white'), 'never white text on a primary fill');
  t.ok(primaryButton.includes('min-h-9') && primaryButton.includes('text-xs'), 'the settings button size and label size');
  t.ok(secondaryButton.includes('border-outline'), 'the border is a visible token: border-subtle is transparent in dark');
  t.notOk(secondaryButton.includes('border-border-subtle'), 'the invisible border is not used');
  t.end();
});

t.test('no settings page keeps its own copy of the quiet button classes', (t) => {
  const files = fs.readdirSync(settingsDir).filter((name) => name.endsWith('.tsx'));
  const copies = files.flatMap((name) =>
    fs.readFileSync(path.join(settingsDir, name), 'utf8').split('\n').flatMap((line, index) =>
      /const (smallButton|quietButton)\s*=/.test(line) ? [`${name}:${index + 1}`] : []));
  t.same(copies, [], 'each page uses src/components/settings/buttonStyles.ts');
  t.end();
});
