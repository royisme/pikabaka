import t from 'tap';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The renderer no longer offers interview practice, a resume or a profile. The words stay out of
 * everything it renders. Lines allowed below are code or comments that never reach the screen.
 */
const ALLOWED: { file: string; line: RegExp; why: string }[] = [
  // The old persisted localStorage keys: only their legacy entries may name them.
  { file: 'src/lib/legacyLocalStorage.ts', line: /interviewer_transcript/, why: 'legacy localStorage keys' },
  // An AbortController method, not the removed feature.
  { file: 'src/components/settings/AudioSettings.tsx', line: /ctx\.resume\(\)/, why: 'AbortController.resume()' },
  // The scroll-follow comment: text scrolling again, not the removed resume.
  { file: 'src/components/ui/RollingTranscript.tsx', line: /resumes following/, why: 'scroll-follow comment' },
];

function rendererFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return rendererFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const leftovers = rendererFiles(path.resolve('src')).flatMap((file) =>
  fs.readFileSync(file, 'utf8').split('\n').flatMap((line, index) =>
    /interview|resume|job description|negotiat/i.test(line)
      && !ALLOWED.some((entry) => file.endsWith(entry.file) && entry.line.test(line))
      ? [`${path.relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`]
      : []));

t.test('the renderer says nothing about interviews, a resume or negotiation', (t) => {
  t.same(leftovers, [], 'neutralise or remove the wording, or add a justified entry to ALLOWED');
  t.end();
});
