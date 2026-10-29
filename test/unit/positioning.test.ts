import t from 'tap';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.resolve(file), 'utf8');

t.test('the shipped description and docs do not present Pika as an interview copilot', (t) => {
    const description = (JSON.parse(read('package.json')) as { description: string }).description;
    t.notMatch(description, /interview/i, 'the package description');
    for (const file of ['README.md', 'PRODUCT.md']) {
        const text = read(file);
        t.notMatch(text, /interview copilot/i, `${file} does not use the interview-copilot name`);
        // A struck-through question that records the decision may name it; no other line may offer it.
        const offers = text.split('\n').filter((line) => /interview (practice|prep|rehearsal)/i.test(line) && !line.includes('~~'));
        t.same(offers, [], `${file} does not offer interview practice`);
    }
    t.match(read('README.md'), /live-translation and meeting assistant/, 'the README leads with live translation and meetings');
    t.end();
});
