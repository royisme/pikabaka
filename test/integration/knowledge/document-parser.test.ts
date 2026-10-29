import t from 'tap';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'node:util';
import { mockRequire } from '../../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import { DocumentParser } from '../../../electron/knowledge/DocumentParser';

// Invented content only: the repository is public, so the DOCX fixture is built in
// the test instead of being committed.
const NAME = 'Alex Example';
const LOCATION = 'Springfield, IL, United States';
const LINKEDIN = 'linkedin.com/in/alex-example';

for (const extension of ['txt', 'md', 'pdf', 'docx']) {
  t.test(`${extension} parser yields while reading or converting and uses stdout without sidecars`, async t => {
    const calls: unknown[][] = [];
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const convert = async (command: string, args: string[], options: unknown) => {
      calls.push([command, args, options]);
      await pending;
      return { stdout: 'Invented parser output.', stderr: '' };
    };
    const asyncExec = Object.assign((command: string, args: string[], options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
      void convert(command, args, options).then(result => callback(null, result.stdout, result.stderr));
    }, { [promisify.custom]: convert });
    const module = mockRequire(path.resolve('electron/knowledge/DocumentParser.ts'), {
      fs: { ...fs, readFileSync: () => { throw new Error('Synchronous file read blocks main'); }, promises: {
        ...fs.promises, readFile: async () => { await pending; return 'Invented parser output.'; },
      } },
      child_process: { execFile: asyncExec as typeof execFile, execFileSync: () => { throw new Error('Synchronous conversion blocks main'); } },
    }) as typeof import('../../../electron/knowledge/DocumentParser');
    const parser = new module.DocumentParser();
    if (extension === 'docx' && process.platform !== 'darwin') {
      await t.rejects(parser.parse('/invented/source.docx'), { message: 'DOCX parsing failed. Please convert the document to .md/.txt format.' });
      return;
    }
    const result = parser.parse(`/invented/source.${extension}`);
    let settled = false;
    void result.then(() => { settled = true; }, () => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    t.equal(settled, false, 'the parser is still waiting while the event loop can run');
    release();
    t.same(await result, { text: 'Invented parser output.', metadata: { format: extension } });
    if (extension === 'docx') t.same(calls, [['textutil', ['-convert', 'txt', '-stdout', '/invented/source.docx'], { encoding: 'utf-8', timeout: 30000 }]]);
    else if (extension === 'pdf') t.same(calls, [['pdftotext', ['/invented/source.pdf', '-'], { encoding: 'utf-8', timeout: 30000 }]]);
    else t.same(calls, []);
  });
}

t.test('DocumentParser extracts the text of a DOCX built from invented content', async (t) => {
  const parser = new DocumentParser();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pika-docx-'));
  t.teardown(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixturePath = path.join(tmpDir, 'resume.docx');

  if (process.platform !== 'darwin') {
    await t.rejects(
      parser.parse(fixturePath),
      { message: 'DOCX parsing failed. Please convert the document to .md/.txt format.' },
      'non-macOS environments fail with the explicit DOCX guidance',
    );
    return;
  }

  const txtPath = path.join(tmpDir, 'resume.txt');
  fs.writeFileSync(txtPath, `${NAME}\n${LOCATION}\n${LINKEDIN}\n`, 'utf-8');
  execFileSync('textutil', ['-convert', 'docx', '-output', fixturePath, txtPath], { timeout: 30000 });

  const changes: string[] = [];
  const watcher = fs.watch(tmpDir, (_event, filename) => { if (filename) changes.push(filename); });
  t.teardown(() => watcher.close());
  // macOS can deliver the fixture writer's events after the watcher starts.
  await new Promise<void>(resolve => setTimeout(resolve, 200));
  changes.length = 0;
  const before = fs.readdirSync(tmpDir).sort();
  const result = await parser.parse(fixturePath);
  await new Promise<void>(resolve => setImmediate(resolve));
  t.same(fs.readdirSync(tmpDir).sort(), before, 'no sidecar remains');
  t.same(changes, [], 'conversion never writes next to the source, even temporarily');

  t.equal(result.metadata.format, 'docx', 'reports docx metadata');
  t.type(result.text, 'string', 'returns extracted text');
  t.ok(result.text.trim().length > 0, 'returns non-empty text');
  t.match(result.text, /Alex\s+Example/i, 'extracts the invented name from the fixture');
  t.match(result.text, /Springfield,\s*IL,\s*United States/i, 'extracts the invented location from the fixture');
  t.match(result.text, /linkedin\.com\/in\/alex-example/i, 'extracts the invented contact line from the fixture');
});
