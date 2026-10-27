// With the speakers on, the microphone hears the other party's audio again, so the "Me" stream
// transcribes the same sentences as the "Interviewer" stream. This recognises such a line by its
// words: it repeats, almost word for word, something the other party's stream produced a moment ago.
// It works on text only; real echo cancellation (using the system audio as the reference) belongs in
// the native module. Headphones remove the cause.

// A Han character is a word of its own; everything else is a run of letters, digits and apostrophes.
const WORD = /[\p{Script=Han}]|[\p{L}\p{N}']+/gu;

export function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter(word => word !== "'");
}

export class EchoFilter {
  private readonly recent: Array<{ words: Set<string>; at: number }> = [];

  /**
   * @param windowMs how long a line of the other party can be echoed
   * @param minWords shorter lines are never treated as echo ("yes", "right")
   * @param threshold the share of the line's words that the other party's line has
   */
  constructor(private readonly windowMs = 15_000, private readonly minWords = 4, private readonly threshold = 0.75) {}

  /** The other party's stream produced this (interim or final) text. */
  noteOther(text: string, at: number): void {
    const words = wordsOf(text);
    if (words.length === 0) return;
    this.recent.push({ words: new Set(words), at });
    while (this.recent.length > 40 || (this.recent.length > 0 && at - this.recent[0].at > this.windowMs)) this.recent.shift();
  }

  /** Whether the microphone stream's text repeats what the other party's stream just produced. */
  isEcho(text: string, at: number): boolean {
    const words = wordsOf(text);
    if (words.length < this.minWords) return false;
    return this.recent.some(other => {
      if (at - other.at > this.windowMs) return false;
      const shared = words.filter(word => other.words.has(word)).length;
      return shared / words.length >= this.threshold;
    });
  }
}
