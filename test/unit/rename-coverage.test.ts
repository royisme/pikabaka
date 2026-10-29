import t from 'tap';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Lines where lowercase "interviewer" must stay, with the reason. Keep this list short: a new
 * entry needs a reason that survives the rename (a string a model reads, or the old stored value).
 */
const ALLOWED: { file: string; line: RegExp; why: string }[] = [
  // Prompt text the models read; X5-2 rewrites it (not part of the rename).
  { file: 'electron/llm/prompts.ts', line: /interviewer/, why: 'built-in prompt text' },
  { file: 'electron/llm/TemporalContextBuilder.ts', line: /You are responding to the interviewer/, why: 'prompt text' },
  { file: 'src/hooks/useMeetingChat.ts', line: /latest interviewer context/, why: 'prompt text sent to the model' },
  { file: 'electron/core/LLMHelper.ts', line: /brainstorm_script/, why: 'prompt text' },
  // The old stored value: only the migration that replaces it may name it.
  { file: 'electron/db/DatabaseManager.ts', line: /interviewer/, why: 'migration and its comment' },
  // The old persisted localStorage keys: only their legacy entries may name them.
  { file: 'src/lib/legacyLocalStorage.ts', line: /interviewer_transcript/, why: 'legacy localStorage keys' },
];

function productionFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return productionFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

// Case-sensitive: the prompt-side labels are "INTERVIEWER" and UI copy is "Interviewer"; neither
// is the speaker value, and the labels move in X5-2.
const leftovers = ['electron', 'src'].flatMap((root) =>
  productionFiles(path.resolve(root))
    .flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
      .flatMap((line, index) => line.includes('interviewer')
        && !ALLOWED.some((entry) => file.endsWith(entry.file) && entry.line.test(line))
        ? [`${path.relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`]
        : []))
);

t.test('no production file still uses the interviewer speaker value', (t) => {
  t.same(leftovers, [], 'rename every occurrence, or add a justified entry to ALLOWED');
  t.end();
});
