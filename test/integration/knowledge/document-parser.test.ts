import t from 'tap';
import * as path from 'path';
import { DocumentParser } from '../../../electron/knowledge/DocumentParser';

const fixturePath = path.resolve(process.cwd(), 'test/sample/myresume_socitiabank_bi.docx');

t.test('DocumentParser parses the sample resume fixture', async (t) => {
  const parser = new DocumentParser();

  if (process.platform !== 'darwin') {
    await t.rejects(
      parser.parse(fixturePath),
      { message: 'DOCX parsing failed. Please convert your resume to .md/.txt format.' },
      'non-macOS environments fail with the explicit DOCX guidance',
    );
    return;
  }

  const result = await parser.parse(fixturePath);

  t.equal(result.metadata.format, 'docx', 'reports docx metadata');
  t.type(result.text, 'string', 'returns extracted text');
  t.ok(result.text.trim().length > 0, 'returns non-empty text');
  t.match(result.text, /Roy\s+\(Shaoqing\)\s+Zhu/i, 'extracts the candidate name from the fixture');
  t.match(result.text, /Waterloo, ON, Canada/i, 'extracts profile/location text');
  t.match(result.text, /linkedin\.com\/in\//i, 'extracts contact details from the fixture');
});
