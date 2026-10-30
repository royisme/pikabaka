import t from 'tap';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareSmells, countSmells, main } from '../../scripts/smell-ratchet.js';

/**
 * The ratchet is only useful if the numbers it prints match the files it reads and if a rise is
 * refused while a drop is accepted. A temporary tree keeps the runs away from the real source.
 */

const repoRoot = path.resolve('.');
const committedLedger = path.join(repoRoot, 'scripts', 'smell-ledger.json');
const largeFile = (lines: number) => `${Array.from({ length: lines }, (_, index) => `// line ${index + 1}`).join('\n')}\n`;

function makeTree(t: { teardown: (cleanup: () => void) => void }) {
    const root = mkdtempSync(path.join(tmpdir(), 'pika-smell-ratchet-'));
    t.teardown(() => rmSync(root, { recursive: true, force: true }));

    mkdirSync(path.join(root, 'electron'));
    mkdirSync(path.join(root, 'src', 'node_modules'), { recursive: true });
    mkdirSync(path.join(root, 'src', '.git'), { recursive: true });
    mkdirSync(path.join(root, 'src', 'lib'), { recursive: true });

    writeFileSync(path.join(root, 'src', 'lib', 'nested.ts'), 'export const nested = 1;\n');
    writeFileSync(path.join(root, 'src', 'any.ts'), [
        'const first: any = 1;',
        'const second = first as any;',
        'const third: Array<any> = [];',
        '// @ts-ignore',
        'const fourth = second;',
        '// @ts-expect-error',
        'const fifth = fourth;',
        '',
    ].join('\n'));
    writeFileSync(path.join(root, 'src', 'component.tsx'), 'export const answer = 42;\n');
    writeFileSync(path.join(root, 'src', 'types.d.ts'), 'const ignored: any = 1;\n');
    writeFileSync(path.join(root, 'src', 'notes.js'), 'const ignored: any = 1;\n');
    writeFileSync(path.join(root, 'src', 'node_modules', 'ignored.ts'), 'const ignored: any = 1;\n');
    writeFileSync(path.join(root, 'src', '.git', 'ignored.ts'), 'const ignored: any = 1;\n');
    writeFileSync(path.join(root, 'src', 'alpha.ts'), largeFile(801));
    writeFileSync(path.join(root, 'src', 'large.ts'), largeFile(801));
    writeFileSync(path.join(root, 'src', 'zeta.ts'), largeFile(900));
    writeFileSync(path.join(root, 'electron', 'small.ts'), 'export const answer = 42;');

    return root;
}

function writeLedger(file: string, ledger: Record<string, unknown>) {
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

function runMain(argv: string[], root: string, ledgerPath: string) {
    const output: string[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (...args: unknown[]) => { output.push(args.join(' ')); };
    console.error = (...args: unknown[]) => { output.push(args.join(' ')); };
    try {
        return { code: main(argv, { root, ledgerPath }) as number, output: output.join('\n') };
    } finally {
        console.log = log;
        console.error = error;
    }
}

t.test('countSmells counts any, suppressed comments and large files, and skips what it must', (t) => {
    const current = countSmells(makeTree(t));

    t.equal(current.any, 3, 'three any occurrences; .d.ts, .js, node_modules and .git are not read');
    t.equal(current.tsSuppress, 2, 'one ignore and one expect-error');
    t.equal(current.filesOver800Lines, 3, 'three files are over the limit');
    t.same(
        current.largeFiles,
        [
            { file: 'src/zeta.ts', lines: 900 },
            { file: 'src/alpha.ts', lines: 801 },
            { file: 'src/large.ts', lines: 801 },
        ],
        'the large files are named, biggest first and ties by path',
    );
    t.end();
});

t.test('the repository is at or below its committed ledger', (t) => {
    const ledger = JSON.parse(readFileSync(committedLedger, 'utf8'));
    const current = countSmells(repoRoot);

    t.same(compareSmells(current, ledger).failures, [], 'today\'s numbers fit scripts/smell-ledger.json');
    t.equal(current.filesOver800Lines, current.largeFiles.length, 'the count matches the list');
    t.end();
});

t.test('main exits 1 on a rise and 0 on a drop', (t) => {
    const root = makeTree(t);
    const ledgerPath = path.join(root, 'ledger.json');

    writeLedger(ledgerPath, { any: 2, tsSuppress: 2, filesOver800Lines: 3 });
    const rise = runMain([], root, ledgerPath);
    t.equal(rise.code, 1, 'a rise is a failed run');
    t.match(rise.output, /rose above the ledger/, 'the rise is named');
    t.match(rise.output, /\+1/, 'the size of the rise is named');

    writeLedger(ledgerPath, { any: 5, tsSuppress: 4, filesOver800Lines: 3 });
    const drop = runMain([], root, ledgerPath);
    t.equal(drop.code, 0, 'a drop passes');
    t.match(drop.output, /can be lowered/, 'the drop is reported for the next update');
    t.notMatch(drop.output, /rose above the ledger/, 'nothing failed');
    t.end();
});

t.test('--update writes the current numbers and the next run passes', (t) => {
    const root = makeTree(t);
    const ledgerPath = path.join(root, 'ledger.json');

    const update = runMain(['--update'], root, ledgerPath);
    t.equal(update.code, 0, 'the update passes');
    t.equal(update.output, 'smell-ratchet: ledger updated (any 3, tsSuppress 2, files over 800 lines 3)', 'the new numbers are printed');

    const written = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    t.same(written, {
        any: 3,
        tsSuppress: 2,
        filesOver800Lines: 3,
        largeFiles: [
            { file: 'src/zeta.ts', lines: 900 },
            { file: 'src/alpha.ts', lines: 801 },
            { file: 'src/large.ts', lines: 801 },
        ],
    }, 'the ledger holds the measured numbers');

    const next = runMain([], root, ledgerPath);
    t.equal(next.code, 0, 'the next run is clean');
    t.match(next.output, /no smell rose above the ledger/, 'nothing rose');
    t.end();
});

t.test('a missing or malformed ledger fails loudly', (t) => {
    const root = makeTree(t);

    const missing = runMain([], root, path.join(root, 'absent.json'));
    t.equal(missing.code, 1, 'a missing ledger fails');
    t.match(missing.output, /cannot read absent\.json/, 'the file is named');

    const malformedPath = path.join(root, 'malformed.json');
    writeLedger(malformedPath, {});
    const malformed = runMain([], root, malformedPath);
    t.equal(malformed.code, 1, 'a malformed ledger fails');
    t.match(malformed.output, /no integer "any"/, 'the missing number is named');
    t.end();
});

t.test('the command line itself exits 1 on a rise and 0 on a drop', (t) => {
    const root = makeTree(t);
    mkdirSync(path.join(root, 'scripts'));
    copyFileSync(path.join(repoRoot, 'scripts', 'smell-ratchet.js'), path.join(root, 'scripts', 'smell-ratchet.js'));
    const ledgerPath = path.join(root, 'scripts', 'smell-ledger.json');
    const run = () => spawnSync(process.execPath, [path.join(root, 'scripts', 'smell-ratchet.js')], { cwd: root, encoding: 'utf8' });

    writeLedger(ledgerPath, { any: 2, tsSuppress: 2, filesOver800Lines: 3 });
    t.equal(run().status, 1, 'a rise exits 1');
    writeLedger(ledgerPath, { any: 5, tsSuppress: 4, filesOver800Lines: 3 });
    t.equal(run().status, 0, 'a drop exits 0');
    t.end();
});
