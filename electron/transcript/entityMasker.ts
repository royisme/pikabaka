/**
 * Protects technical entities (URLs, paths, CLI flags, code identifiers) from
 * being translated or distorted by an LLM: `maskEntities` swaps them for
 * `⟦0⟧`, `⟦1⟧` placeholders before the request and `restoreEntities` puts them
 * back afterwards. Ported from the OmniVoice `EntityMasker`.
 */

const FILE_EXTENSIONS = [
  'swift', 'py', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'md', 'txt', 'yml', 'yaml', 'toml',
  'plist', 'sh', 'zsh', 'bash', 'c', 'h', 'm', 'mm', 'cc', 'cpp', 'hpp', 'rs', 'go', 'java',
  'kt', 'rb', 'php', 'html', 'css', 'scss', 'xml', 'gguf', 'bin', 'log', 'csv', 'sql', 'db',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'zip', 'gz', 'tar', 'dmg', 'pkg', 'app',
  'lock', 'cfg', 'ini', 'env', 'conf', 'xcodeproj', 'xcworkspace', 'entitlements', 'strings',
];

// Backticked code span.
const BACKTICK = /`[^`\n]+`/gu;

// http(s) URL; stops at whitespace, CJK/curly punctuation, quotes and angle brackets.
const URL_PATTERN = /https?:\/\/[^\s，。、！？；：”’'"<>]+/gu;

// File path. The lookbehind keeps it from starting mid-word, so `and/or/xor` and
// `1/2/3` are not masked. `~/`, `./` and `../` are unambiguous markers and need
// one segment; a bare `/` needs two so that "a/b" in prose stays untouched.
const PATH =
  /(?<![a-zA-Z0-9_.~/-])(?:(?:~\/|\.{1,2}\/)[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*|\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+)/gu;

// CLI flag: `--long`, `-c`, `-rf`, `-Wall`, optionally `=value`. A short flag is
// letters only, so `-1` and `-3.14` never match. No space is needed before the
// flag (CJK transcripts have none). The value is limited to common CLI value
// characters or a quoted string so that CJK text after it is not swallowed; `:`
// is allowed so `--url=https://...` and `--addr=127.0.0.1:8080` stay whole.
const FLAG_VALUE = String.raw`(?:"[^"]+"|'[^']+'|[a-zA-Z0-9_.~/:-]+)`;
const FLAG = new RegExp(
  String.raw`(?<![a-zA-Z0-9_-])(?:--[a-zA-Z0-9_-]+(?:=${FLAG_VALUE})?|-[a-zA-Z]+(?:=${FLAG_VALUE})?)(?![a-zA-Z0-9_-])`,
  'gu',
);

// snake_case, SCREAMING_SNAKE and dunder identifiers (`parse_args`, `__init__`).
const SNAKE =
  /(?<![a-zA-Z0-9_])(?:__[a-zA-Z][a-zA-Z0-9]*__|_*[a-zA-Z][a-zA-Z0-9]*(?:_+[a-zA-Z0-9]+)+_*)(?![a-zA-Z0-9_])/gu;

// Filename with a known extension. The basename needs 2+ characters so "10 a.m."
// is not read as a file named `a` with extension `m`.
const FILE = new RegExp(
  String.raw`(?<![a-zA-Z0-9_.])[a-zA-Z_][a-zA-Z0-9_-]+\.(?:${FILE_EXTENSIONS.join('|')})(?![a-zA-Z0-9_])`,
  'gu',
);

// Dotted member access that looks like code (`config.modelPath`, `self.view.frame`).
// Deliberately narrow so `e.g`, `U.S`, `Mr.Smith` and `okay.So` stay translatable.
const DOTTED =
  /(?<![a-zA-Z0-9_.])[a-zA-Z_][a-zA-Z0-9_]+(?:\.[a-z_][a-zA-Z0-9_]*[A-Z0-9_][a-zA-Z0-9_]*|(?:\.[a-z_][a-zA-Z0-9_]*){2,})(?![a-zA-Z0-9_]|\.[a-zA-Z])/gu;

// camelCase / PascalCase (`swiftVersion`, `OmniVoiceCore`).
const CAMEL = /(?<![a-zA-Z0-9])[a-zA-Z0-9]*[a-z][A-Z][a-zA-Z0-9]*(?![a-zA-Z0-9])/gu;

// A placeholder as a model may return it: whole, with inner whitespace, or with
// one bracket lost. Groups 1-3 hold the digits of each form.
const PLACEHOLDER = /⟦\s*([0-9]+)\s*⟧|⟦\s*([0-9]+)|([0-9]+)\s*⟧/gu;

// Sentence punctuation that trails a URL, path or flag without belonging to it.
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set(['.', ',', ';', ':', '!', '?']);

// A closing bracket is trimmed only when unbalanced inside the match, so
// "(https://a.com)" loses its `)` but ".../Foo_(bar)" keeps it.
const CLOSER_TO_OPENER: Readonly<Record<string, string>> = {
  ')': '(',
  ']': '[',
  '）': '（',
  '】': '【',
};

interface Span {
  start: number;
  end: number;
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

function collectSpans(regex: RegExp, text: string, spans: Span[], trim = false): void {
  for (const match of text.matchAll(regex)) {
    const start = match.index;
    let end = start + match[0].length;
    if (trim) {
      while (end > start) {
        const last = text[end - 1];
        if (TRAILING_PUNCTUATION.has(last)) {
          end -= 1;
          continue;
        }
        const opener = CLOSER_TO_OPENER[last];
        if (opener) {
          const inner = text.slice(start, end);
          if (count(inner, last) > count(inner, opener)) {
            end -= 1;
            continue;
          }
        }
        break;
      }
      if (end === start) continue;
    }
    spans.push({ start, end });
  }
}

export function maskEntities(text: string): { maskedText: string; verbatim: string[] } {
  if (!text) return { maskedText: '', verbatim: [] };

  const spans: Span[] = [];
  collectSpans(BACKTICK, text, spans);
  collectSpans(URL_PATTERN,text, spans, true);
  collectSpans(PATH, text, spans, true);
  collectSpans(FLAG, text, spans, true);
  collectSpans(SNAKE, text, spans);
  collectSpans(FILE, text, spans);
  collectSpans(DOTTED, text, spans);
  collectSpans(CAMEL, text, spans);

  // Overlaps: the earliest start wins, and the longest span at that start.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);

  const verbatim: string[] = [];
  let maskedText = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    maskedText += `${text.slice(cursor, span.start)}⟦${verbatim.length}⟧`;
    verbatim.push(text.slice(span.start, span.end));
    cursor = span.end;
  }
  if (verbatim.length === 0) return { maskedText: text, verbatim };
  return { maskedText: maskedText + text.slice(cursor), verbatim };
}

/**
 * Restores placeholders in a translation. Tolerates inner whitespace
 * (`⟦ 0 ⟧`) and a lost bracket (`0⟧`, `⟦0`), drops placeholders with an unknown
 * index, and strips any other stray bracket, so `text` never contains `⟦` or `⟧`
 * from the model. `complete` is false when a placeholder is missing, duplicated
 * or unknown, so the caller can retry once without masking.
 */
export function restoreEntities(
  translated: string,
  verbatim: string[],
): { text: string; complete: boolean } {
  const seen = new Array<number>(verbatim.length).fill(0);
  let unknown = false;
  let text = '';
  let cursor = 0;

  const stripBrackets = (s: string): string => s.replace(/[⟦⟧]/gu, '');

  for (const match of translated.matchAll(PLACEHOLDER)) {
    const start = match.index;
    let end = start + match[0].length;
    text += stripBrackets(translated.slice(cursor, start));

    const digits = match[1] ?? match[2] ?? match[3];
    const index = Number(digits);
    if (index < verbatim.length) {
      seen[index] += 1;
      text += verbatim[index];
    } else {
      unknown = true;
      if (match[1] !== undefined) {
        // A whole placeholder with no entity is dropped, along with one
        // following space when it sat between spaces, so no double space remains.
        if (translated[end] === ' ' && (start === 0 || /\s/u.test(translated[start - 1]))) {
          end += 1;
        }
      } else {
        // A half-bracketed number that is not an index is most likely real text.
        text += digits;
      }
    }
    cursor = end;
  }
  text += stripBrackets(translated.slice(cursor));

  return { text, complete: !unknown && seen.every((n) => n === 1) };
}
