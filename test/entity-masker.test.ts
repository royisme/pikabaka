import t from 'tap';
import { maskEntities, restoreEntities } from '../electron/transcript/entityMasker';

function unchanged(t: Tap.Test, inputs: string[]): void {
  for (const input of inputs) {
    const { maskedText, verbatim } = maskEntities(input);
    t.equal(maskedText, input, input);
    t.same(verbatim, [], input);
  }
}

t.test('masks backticked spans', (t) => {
  const { maskedText, verbatim } = maskEntities('Run `make build` before the deploy.');
  t.equal(maskedText, 'Run ⟦0⟧ before the deploy.');
  t.same(verbatim, ['`make build`']);
  unchanged(t, ['An unmatched ` tick stays', 'Two ticks `across\nlines` stay']);
  t.end();
});

t.test('masks URLs and trims trailing punctuation', (t) => {
  let r = maskEntities('Please visit https://example.org/docs/intro for details.');
  t.equal(r.maskedText, 'Please visit ⟦0⟧ for details.');
  t.same(r.verbatim, ['https://example.org/docs/intro']);

  r = maskEntities('Please visit https://example.org.');
  t.equal(r.maskedText, 'Please visit ⟦0⟧.');
  t.same(r.verbatim, ['https://example.org']);

  r = maskEntities('See http://example.org, it is good.');
  t.equal(r.maskedText, 'See ⟦0⟧, it is good.');

  r = maskEntities('请看https://example.org/a，谢谢');
  t.equal(r.maskedText, '请看⟦0⟧，谢谢');
  t.same(r.verbatim, ['https://example.org/a']);

  unchanged(t, ['The protocol is https and nothing else']);
  t.end();
});

t.test('keeps balanced brackets in URLs and trims wrapping ones', (t) => {
  let r = maskEntities('See https://example.org/wiki/Foo_(bar) for details.');
  t.same(r.verbatim, ['https://example.org/wiki/Foo_(bar)']);
  t.equal(r.maskedText, 'See ⟦0⟧ for details.');

  r = maskEntities('please check (https://example.org) now');
  t.equal(r.maskedText, 'please check (⟦0⟧) now');
  t.same(r.verbatim, ['https://example.org']);
  t.end();
});

t.test('masks file paths', (t) => {
  let r = maskEntities('Look in /usr/local/bin for it.');
  t.equal(r.maskedText, 'Look in ⟦0⟧ for it.');
  t.same(r.verbatim, ['/usr/local/bin']);

  r = maskEntities('The log is in /var/log.');
  t.same(r.verbatim, ['/var/log']);
  t.equal(r.maskedText, 'The log is in ⟦0⟧.');

  r = maskEntities('Check ~/Projects/demo/notes.txt now');
  t.same(r.verbatim, ['~/Projects/demo/notes.txt']);

  for (const input of ['Check ~/Projects now', 'Run ./build now', 'See ../parent now']) {
    t.equal(maskEntities(input).verbatim.length, 1, input);
  }

  unchanged(t, ['use and/or/xor here', 'about 1/2/3 of them', 'pick a/b today', 'a lone / slash', 'see /single only']);
  t.end();
});

t.test('masks CLI flags', (t) => {
  let r = maskEntities('Run it with --dry-run now');
  t.equal(r.maskedText, 'Run it with ⟦0⟧ now');
  t.same(r.verbatim, ['--dry-run']);

  r = maskEntities('Run with -c now');
  t.same(r.verbatim, ['-c']);

  for (const [input, flag] of [['rm -rf now', '-rf'], ['tar -czvf now', '-czvf'], ['gcc -Wall now', '-Wall']]) {
    t.same(maskEntities(input).verbatim, [flag], input);
  }

  r = maskEntities('Run with --filter=abc, then test.');
  t.equal(r.maskedText, 'Run with ⟦0⟧, then test.');
  t.same(r.verbatim, ['--filter=abc']);

  r = maskEntities('Run with --message="hello there" now');
  t.equal(r.maskedText, 'Run with ⟦0⟧ now');
  t.same(r.verbatim, ['--message="hello there"']);

  r = maskEntities('Connect with --addr=127.0.0.1:8080 now');
  t.same(r.verbatim, ['--addr=127.0.0.1:8080']);
  t.end();
});

t.test('masks flags glued to CJK text without swallowing it', (t) => {
  let r = maskEntities('执行--dry-run选项');
  t.equal(r.maskedText, '执行⟦0⟧选项');
  t.same(r.verbatim, ['--dry-run']);

  r = maskEntities('执行--output=foo选项');
  t.equal(r.maskedText, '执行⟦0⟧选项');
  t.same(r.verbatim, ['--output=foo']);

  r = maskEntities('执行--url=https://example.org选项');
  t.equal(r.maskedText, '执行⟦0⟧选项');
  t.same(r.verbatim, ['--url=https://example.org']);
  t.end();
});

t.test('does not mask negative numbers as flags', (t) => {
  unchanged(t, ['The value is -1 degrees, or -3.14 exactly.', 'range -10 to 10', 'a well-known idea']);
  t.end();
});

t.test('masks snake_case and dunder identifiers', (t) => {
  let r = maskEntities('Check parse_args and MAX_BUFFER_SIZE here');
  t.equal(r.maskedText, 'Check ⟦0⟧ and ⟦1⟧ here');
  t.same(r.verbatim, ['parse_args', 'MAX_BUFFER_SIZE']);

  r = maskEntities('Define __init__ and __main__ here');
  t.equal(r.maskedText, 'Define ⟦0⟧ and ⟦1⟧ here');
  t.same(r.verbatim, ['__init__', '__main__']);

  t.same(maskEntities('Call _private_helper first').verbatim, ['_private_helper']);

  r = maskEntities('调用parse_args并传入parse_args参数');
  t.equal(r.maskedText, '调用⟦0⟧并传入⟦1⟧参数');
  t.same(r.verbatim, ['parse_args', 'parse_args']);

  unchanged(t, ['plain words only', 'a single_ underscore tail']);
  t.end();
});

t.test('masks filenames and dotted code, not ordinary dotted prose', (t) => {
  t.same(
    maskEntities('Open README.md, set config.modelPath and read self.view.frame.').verbatim,
    ['README.md', 'config.modelPath', 'self.view.frame'],
  );
  t.same(maskEntities('Build main.tsx and logo.png').verbatim, ['main.tsx', 'logo.png']);

  unchanged(t, [
    'See e.g. this',
    'Made in the U.S.',
    'Hi Mr.Smith',
    'okay.So we start',
    'okay.so we start',
    'Meet at 10 a.m. tomorrow',
    'Call before 8 p.m. tonight',
    'a file.unknownext here',
  ]);
  t.end();
});

t.test('masks camelCase and PascalCase', (t) => {
  const r = maskEntities('Check swiftVersion and OmniVoiceCore now');
  t.equal(r.maskedText, 'Check ⟦0⟧ and ⟦1⟧ now');
  t.same(r.verbatim, ['swiftVersion', 'OmniVoiceCore']);
  unchanged(t, ['Hello World again', 'ALLCAPS words']);
  t.end();
});

t.test('numbers placeholders in order of position', (t) => {
  const r = maskEntities('Use `a b`, then https://example.org/x and ./run.sh with --fast.');
  t.equal(r.maskedText, 'Use ⟦0⟧, then ⟦1⟧ and ⟦2⟧ with ⟦3⟧.');
  t.same(r.verbatim, ['`a b`', 'https://example.org/x', './run.sh', '--fast']);
  t.end();
});

t.test('keeps repeated identical entities as separate placeholders', (t) => {
  const r = maskEntities('Use model_path here and model_path there.');
  t.equal(r.maskedText, 'Use ⟦0⟧ here and ⟦1⟧ there.');
  t.same(r.verbatim, ['model_path', 'model_path']);
  t.end();
});

t.test('resolves overlapping matches by earliest start, then longest', (t) => {
  // The path also contains a filename and the URL contains a path; each is one entity.
  let r = maskEntities('Open /srv/app/main_loop.py now');
  t.same(r.verbatim, ['/srv/app/main_loop.py']);

  r = maskEntities('Fetch https://example.org/api/get_user now');
  t.same(r.verbatim, ['https://example.org/api/get_user']);

  // A backticked span swallows the flag and identifier inside it.
  r = maskEntities('Run `tool --fast set_mode` now');
  t.equal(r.maskedText, 'Run ⟦0⟧ now');
  t.same(r.verbatim, ['`tool --fast set_mode`']);

  // The flag value (a URL) starts later than the flag, so the flag wins whole.
  r = maskEntities('Use --src=https://example.org/data now');
  t.same(r.verbatim, ['--src=https://example.org/data']);
  t.end();
});

t.test('handles empty input and text without entities', (t) => {
  t.same(maskEntities(''), { maskedText: '', verbatim: [] });
  unchanged(t, ['Hello there, how are you today?', '你好，今天过得怎么样？']);
  t.end();
});

t.test('keeps ranges correct around CJK and astral characters', (t) => {
  const r = maskEntities('😀调用parse_args😀再看 /usr/bin/env 然后');
  t.equal(r.maskedText, '😀调用⟦0⟧😀再看 ⟦1⟧ 然后');
  t.same(r.verbatim, ['parse_args', '/usr/bin/env']);
  t.end();
});

t.test('mask then restore round-trips', (t) => {
  const input = 'Run `swift build` with --verbose on /usr/local/bin, see https://example.org/a.';
  const { maskedText, verbatim } = maskEntities(input);
  t.same(restoreEntities(maskedText, verbatim), { text: input, complete: true });
  t.end();
});

t.test('restores all placeholders and reports complete', (t) => {
  const r = restoreEntities('请访问 ⟦0⟧ 并使用 ⟦1⟧。', ['https://example.org', '--fast']);
  t.equal(r.text, '请访问 https://example.org 并使用 --fast。');
  t.equal(r.complete, true);
  t.end();
});

t.test('restore with no placeholders', (t) => {
  t.same(restoreEntities('你好世界', []), { text: '你好世界', complete: true });
  t.same(restoreEntities('共 3 个', []), { text: '共 3 个', complete: true });
  t.same(restoreEntities('', []), { text: '', complete: true });
  t.end();
});

t.test('restore reports incomplete when a placeholder is missing', (t) => {
  const r = restoreEntities('请使用 ⟦0⟧。', ['model_path', '--fast']);
  t.equal(r.text, '请使用 model_path。');
  t.equal(r.complete, false);

  // Every placeholder dropped, including when the model returned no bracket at all.
  t.same(restoreEntities('请使用它。', ['model_path']), { text: '请使用它。', complete: false });
  t.end();
});

t.test('restore reports incomplete when a placeholder is duplicated', (t) => {
  const r = restoreEntities('⟦0⟧ 和 ⟦0⟧ 以及 ⟦1⟧', ['a_b', 'c_d']);
  t.equal(r.text, 'a_b 和 a_b 以及 c_d');
  t.equal(r.complete, false);
  t.end();
});

t.test('restore drops unknown indexes and reports incomplete', (t) => {
  let r = restoreEntities('结果 ⟦99⟧ 还有 ⟦0⟧', ['test_x']);
  t.equal(r.text, '结果 还有 test_x');
  t.equal(r.complete, false);

  r = restoreEntities('⟦5⟧ 结束', []);
  t.equal(r.text, '结束');
  t.equal(r.complete, false);
  t.end();
});

t.test('restore accepts placeholders in any order', (t) => {
  const r = restoreEntities('先 ⟦1⟧ 再 ⟦0⟧', ['first_one', 'second_one']);
  t.equal(r.text, '先 second_one 再 first_one');
  t.equal(r.complete, true);
  t.end();
});

t.test('restore tolerates inner whitespace and a lost bracket', (t) => {
  let r = restoreEntities('使用 ⟦ 0 ⟧ 和 ⟦1 ⟧', ['model_path', '--verbose']);
  t.equal(r.text, '使用 model_path 和 --verbose');
  t.equal(r.complete, true);

  r = restoreEntities('结果 ⟦0⟧ 和 broken 0⟧ 以及 ⟦unclosed', ['valid_token']);
  t.equal(r.text, '结果 valid_token 和 broken valid_token 以及 unclosed');
  t.equal(r.complete, false);

  r = restoreEntities('用 0⟧ 和 ⟦1', ['a_b', 'c_d']);
  t.same(r, { text: '用 a_b 和 c_d', complete: true });
  t.end();
});

t.test('restore never leaves stray brackets and never throws', (t) => {
  for (const input of ['⟦abc⟧', '⟦', '⟧', '⟦⟧', 'x ⟦ y', '⟦99999999999999999999⟧', '⟦-1⟧']) {
    const r = restoreEntities(input, ['v_a']);
    t.notMatch(r.text, /[⟦⟧]/u, input);
    t.equal(r.complete, false, input);
  }
  t.equal(restoreEntities('⟦abc⟧', []).text, 'abc');
  t.same(restoreEntities('⟦⟦0⟧⟧', ['v_a']), { text: 'v_a', complete: true });
  t.end();
});

t.test('restore keeps placeholders adjacent to CJK punctuation', (t) => {
  const r = restoreEntities('请运行⟦0⟧，然后打开⟦1⟧。（见⟦2⟧）', ['run_all', '~/Notes', '--help']);
  t.equal(r.text, '请运行run_all，然后打开~/Notes。（见--help）');
  t.equal(r.complete, true);
  t.end();
});

t.test('restore does not treat bracket characters inside entities as strays', (t) => {
  const r = restoreEntities('用 ⟦0⟧', ['`a ⟦b⟧`']);
  t.equal(r.text, '用 `a ⟦b⟧`');
  t.equal(r.complete, true);
  t.end();
});
