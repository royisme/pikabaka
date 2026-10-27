const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'e.g', 'i.e', 'st', 'no']);

// A sentence ends at . ! ? or an ellipsis followed by a space or the end, or at a full-width mark (no space needed).
const SENTENCE_END = /[.!?…]+["')\]]*(?=\s|$)|[。！？]+["'”’）」』]*/g;

/** Splits a turn into the text up to its last finished sentence and the unfinished rest after it. */
export function splitAtLastSentence(text: string): { finished: string; rest: string } {
  let end = 0;
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const index = match.index ?? 0;
    if (match[0][0] === '.') {
      const word = text.slice(start, index).match(/([A-Za-z.]+)$/)?.[1]?.toLowerCase();
      if (word && (word.length === 1 || ABBREVIATIONS.has(word))) continue;
    }
    end = index + match[0].length;
    start = end;
  }
  return { finished: text.slice(0, end).trim(), rest: text.slice(end).trim() };
}
