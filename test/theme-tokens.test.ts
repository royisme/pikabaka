import t from 'tap';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');

/** The custom properties declared in the first block that starts with `selector {`. */
function declared(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) out.set(m[1], m[2].trim());
  return out;
}

const dark = declared(':root');
const light = declared("[data-theme='light']");

const isColor = (value: string) => /^(#|rgba?\()/.test(value);

// Colours that read the same on both themes, so the dark value is also the light value.
const SHARED = new Set([
  // The brand colours are the same on both themes; the semantic tokens that use them are checked below.
  '--brand-blue',
  '--brand-action',
  '--brand-sky',
  '--brand-cream',
  '--brand-slate',
  '--brand-ink',
  '--accent-spark', // a graphic only (the "done" star), never text
  '--state-success-border',
  '--state-warning-border',
  '--state-danger-border',
]);

t.test('every literal colour token of the dark theme has a light value, so text and surface never mix themes', async (t) => {
  const missing = [...dark]
    .filter(([name, value]) => isColor(value) && !SHARED.has(name) && !light.has(name))
    .map(([name]) => name);
  t.same(missing, []);
});

t.test('the aliases that follow the surface and primary tokens are not redefined with a literal', async (t) => {
  // `--bg-primary: var(--surface)` follows `--surface`; a literal in the light block would split them.
  const aliases = [...dark].filter(([, value]) => value.startsWith('var(--surface') || value === 'var(--primary)').map(([name]) => name);
  t.ok(aliases.length > 0);
  t.same(aliases.filter((name) => light.has(name) && isColor(light.get(name)!)), []);
});

t.test('text on a solid primary fill has its own token in both themes', async (t) => {
  t.ok(dark.has('--on-primary'));
  t.ok(light.has('--on-primary'));
});
