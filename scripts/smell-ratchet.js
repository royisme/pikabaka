'use strict';

// Ratchet for the code smells listed in docs/design-code-health.md: the ledger holds today's
// numbers, and a run fails when any number is higher. Lower numbers are reported so the ledger can
// be written down at the new level; --update does that write.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LEDGER_PATH = path.join(__dirname, 'smell-ledger.json');
const SOURCE_DIRS = ['electron', 'src'];
const LARGE_FILE_LINES = 800;

const ANY_PATTERNS = [/:\s*any\b/g, /\bas\s+any\b/g, /<\s*any\s*>/g];
const SUPPRESS_PATTERN = /@ts-(?:ignore|expect-error)\b/g;

const METRICS = [
  { key: 'any', label: '": any", "as any", "<any>" occurrences' },
  { key: 'tsSuppress', label: '`@ts-ignore` / `@ts-expect-error` occurrences' },
  { key: 'filesOver800Lines', label: `files over ${LARGE_FILE_LINES} lines` },
];

function isSourceFile(file) {
  return /\.tsx?$/.test(file) && !/\.d\.ts$/.test(file);
}

function walkSourceFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (isSourceFile(entry.name)) found.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  };
  for (const dir of SOURCE_DIRS) walk(path.join(root, dir));
  return found.sort();
}

function sourceFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '-z', '--', ...SOURCE_DIRS], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(isSourceFile);
  } catch {
    // Not a git checkout (a test's temporary directory): read the two source trees directly.
    return walkSourceFiles(root);
  }
}

function countLines(text) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

function countSmells(root) {
  let any = 0;
  let tsSuppress = 0;
  const largeFiles = [];

  for (const file of sourceFiles(root)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const pattern of ANY_PATTERNS) any += (text.match(pattern) || []).length;
    tsSuppress += (text.match(SUPPRESS_PATTERN) || []).length;
    const lines = countLines(text);
    if (lines > LARGE_FILE_LINES) largeFiles.push({ file, lines });
  }

  largeFiles.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
  return { any, tsSuppress, filesOver800Lines: largeFiles.length, largeFiles };
}

function compareSmells(current, ledger) {
  const failures = [];
  const improvements = [];

  for (const { key, label } of METRICS) {
    const now = current[key];
    const was = ledger[key];
    if (now > was) failures.push(`${label}: ${now} now, ledger ${was} (+${now - was})`);
    else if (now < was) improvements.push(`${label}: ${now} now, ledger ${was} (-${was - now})`);
  }

  return { failures, improvements };
}

function readLedger(ledgerPath) {
  const name = path.basename(ledgerPath);
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${name} (${error.message}); run with --update to seed it`);
  }
  for (const { key } of METRICS) {
    if (!Number.isInteger(ledger[key])) {
      throw new Error(`${name} has no integer "${key}"; run with --update to rewrite it`);
    }
  }
  return ledger;
}

function formatLargeFiles(files) {
  return files.map(({ file, lines }) => `${file} (${lines})`).join(', ');
}

function writeLedger(ledgerPath, current) {
  const ledger = {
    any: current.any,
    tsSuppress: current.tsSuppress,
    filesOver800Lines: current.filesOver800Lines,
    largeFiles: current.largeFiles,
  };
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

function main(argv, { root, ledgerPath }) {
  const current = countSmells(root);

  if (argv.includes('--update')) {
    writeLedger(ledgerPath, current);
    console.log(
      `smell-ratchet: ledger updated (any ${current.any}, tsSuppress ${current.tsSuppress}, files over ${LARGE_FILE_LINES} lines ${current.filesOver800Lines})`,
    );
    return 0;
  }

  let ledger;
  try {
    ledger = readLedger(ledgerPath);
  } catch (error) {
    console.error(`smell-ratchet: ${error.message}`);
    return 1;
  }

  const { failures, improvements } = compareSmells(current, ledger);

  if (failures.length > 0) {
    console.error('smell-ratchet: a smell rose above the ledger:');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(`Files over ${LARGE_FILE_LINES} lines (${current.filesOver800Lines}): ${formatLargeFiles(current.largeFiles)}`);
    console.error('Fix the new smell, or record a deliberate raise with: node scripts/smell-ratchet.js --update');
    return 1;
  }

  if (improvements.length > 0) {
    console.log('smell-ratchet: the ledger can be lowered:');
    for (const improvement of improvements) console.log(`  - ${improvement}`);
    console.log('Record it with: node scripts/smell-ratchet.js --update');
  } else {
    console.log('smell-ratchet: no smell rose above the ledger.');
  }
  console.log(`Files over ${LARGE_FILE_LINES} lines (${current.filesOver800Lines}): ${formatLargeFiles(current.largeFiles)}`);
  return 0;
}

/* c8 ignore next -- covered by the lint run, not by the unit test */
if (require.main === module) process.exitCode = main(process.argv.slice(2), { root: ROOT, ledgerPath: LEDGER_PATH });

module.exports = { countSmells, compareSmells, countLines, main, METRICS };
