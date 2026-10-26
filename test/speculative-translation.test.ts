import t from 'tap';
import { SpeculativeTranslations } from '../electron/transcript/speculativeTranslation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

t.test('a claim for the same text follows the running request, replaying what it already has', async (t) => {
  const spec = new SpeculativeTranslations();
  const request = deferred<string>();
  let report!: (text: string) => void;
  spec.start('s1', 'hello there', (onProgress) => { report = onProgress; return request.promise; });
  report('Bon');
  const claimed = spec.claim('s1', 'hello there');
  t.ok(claimed);
  const seen: string[] = [];
  const done = claimed!.follow((text) => seen.push(text));
  t.same(seen, ['Bon'], 'the text so far is replayed at once');
  report('Bonjour');
  request.resolve('Bonjour à tous');
  t.equal(await done, 'Bonjour à tous');
  t.same(seen, ['Bon', 'Bonjour']);
  t.equal(spec.size(), 0, 'an entry is used once');
});

t.test('a claim after the request finished resolves at once with its result', async (t) => {
  const spec = new SpeculativeTranslations();
  spec.start('s1', 'hello', (onProgress) => { onProgress('Bon'); return Promise.resolve('Bonjour'); });
  await new Promise((r) => setTimeout(r, 0));
  const seen: string[] = [];
  t.equal(await spec.claim('s1', 'hello')!.follow((text) => seen.push(text)), 'Bonjour');
  t.same(seen, ['Bon']);
});

t.test('a claim for different text misses and drops the entry', async (t) => {
  const spec = new SpeculativeTranslations();
  spec.start('s1', 'hello there', () => Promise.resolve('x'));
  t.equal(spec.claim('s1', 'hello there everyone'), null, 'the turn grew after the translation started');
  t.equal(spec.size(), 0);
  t.equal(spec.claim('unknown', 'hello'), null);
});

t.test('starting the same text twice makes one request; new text replaces the old entry', async (t) => {
  const spec = new SpeculativeTranslations();
  let calls = 0;
  const run = () => { calls++; return Promise.resolve('x'); };
  spec.start('s1', 'hello there', run);
  spec.start('s1', 'hello there', run);
  t.equal(calls, 1);
  spec.start('s1', 'hello there again', run);
  t.equal(calls, 2);
  t.equal(spec.claim('s1', 'hello there'), null, 'the first text was replaced');
  t.ok(spec.claim('s1', 'hello there again') === null, 'and the entry for the first claim is gone as well');
});

t.test('a failing request rejects its follower and never becomes an unhandled rejection', async (t) => {
  const spec = new SpeculativeTranslations();
  spec.start('s1', 'hello there', () => Promise.reject(new Error('boom')));
  const claimed = spec.claim('s1', 'hello there');
  await t.rejects(claimed!.follow(() => undefined), /boom/);
  spec.start('s2', 'dropped one', () => Promise.reject(new Error('never followed')));
  spec.discard('s2');
  await new Promise((r) => setTimeout(r, 5));
  t.pass('no unhandled rejection');
});

t.test('entries older than the maximum age are not claimed, and the map is capped', async (t) => {
  let clock = 1000;
  const spec = new SpeculativeTranslations(20_000, 2, () => clock);
  spec.start('old', 'hello there', () => Promise.resolve('x'));
  clock += 20_001;
  t.equal(spec.claim('old', 'hello there'), null);
  spec.start('a', 'one one one', () => Promise.resolve('x'));
  spec.start('b', 'two two two', () => Promise.resolve('x'));
  spec.start('c', 'three three three', () => Promise.resolve('x'));
  t.equal(spec.size(), 2, 'the oldest entry made room');
  t.equal(spec.claim('a', 'one one one'), null);
  t.ok(spec.claim('c', 'three three three'));
});

t.test('clear drops everything', async (t) => {
  const spec = new SpeculativeTranslations();
  spec.start('s1', 'hello there', () => Promise.resolve('x'));
  spec.clear();
  t.equal(spec.claim('s1', 'hello there'), null);
});
