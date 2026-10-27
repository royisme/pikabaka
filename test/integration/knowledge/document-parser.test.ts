import t from 'tap';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { DocumentParser } from '../../../electron/knowledge/DocumentParser';

// Invented content only: the repository is public, so the DOCX fixture is built in
// the test instead of being committed.
const NAME = 'Alex Example';
const LOCATION = 'Springfield, IL, United States';
const LINKEDIN = 'linkedin.com/in/alex-example';

t.test('DocumentParser extracts the text of a DOCX built from invented content', async (t) => {
  const parser = new DocumentParser();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pika-docx-'));
  t.teardown(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixturePath = path.join(tmpDir, 'resume.docx');

  if (process.platform !== 'darwin') {
    await t.rejects(
      parser.parse(fixturePath),
      { message: 'DOCX parsing failed. Please convert your resume to .md/.txt format.' },
      'non-macOS environments fail with the explicit DOCX guidance',
    );
    return;
  }

  const txtPath = path.join(tmpDir, 'resume.txt');
  fs.writeFileSync(txtPath, `${NAME}\n${LOCATION}\n${LINKEDIN}\n`, 'utf-8');
  execFileSync('textutil', ['-convert', 'docx', '-output', fixturePath, txtPath], { timeout: 30000 });

  const result = await parser.parse(fixturePath);

  t.equal(result.metadata.format, 'docx', 'reports docx metadata');
  t.type(result.text, 'string', 'returns extracted text');
  t.ok(result.text.trim().length > 0, 'returns non-empty text');
  t.match(result.text, /Alex\s+Example/i, 'extracts the invented name from the fixture');
  t.match(result.text, /Springfield,\s*IL,\s*United States/i, 'extracts the invented location from the fixture');
  t.match(result.text, /linkedin\.com\/in\/alex-example/i, 'extracts the invented contact line from the fixture');
});
