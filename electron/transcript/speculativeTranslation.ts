type Entry = {
  text: string;
  startedAt: number;
  partial: string;
  firstTextAt: number | null;
  settled: boolean;
  listeners: Set<(textSoFar: string) => void>;
  promise: Promise<string>;
};

/** A claimed speculative translation: follow it as if the request had just been made. */
export interface ClaimedTranslation {
  startedAt: number;
  /** When the first text arrived, or null if none had when it was claimed. */
  firstTextAt: number | null;
  /**
   * Reports the text so far at once, then each later report, and resolves with the final text (or
   * rejects with the request's error). Safe to call after the request has finished.
   */
  follow(onProgress: (textSoFar: string) => void): Promise<string>;
}

/**
 * Translations started before their turn is flushed, at the moment the speech provider says the
 * utterance ended. They are silent: nothing reaches the screen until the flush claims one. A claim
 * matches only the exact text that was translated; if the turn grew or was merged in the meantime
 * the entry is dropped and the flush makes an ordinary request. Each entry is used at most once.
 */
export class SpeculativeTranslations {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly maxAgeMs = 20_000,
    private readonly maxEntries = 4,
    private readonly now: () => number = Date.now
  ) {}

  /** Starts a translation for `key` unless the same text is already being translated. */
  start(key: string, text: string, run: (onProgress: (textSoFar: string) => void) => Promise<string>): void {
    this.purge();
    const existing = this.entries.get(key);
    if (existing && existing.text === text) return;
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const entry: Entry = { text, startedAt: this.now(), partial: '', firstTextAt: null, settled: false, listeners: new Set(), promise: Promise.resolve('') };
    entry.promise = run((textSoFar) => {
      entry.firstTextAt ??= this.now();
      entry.partial = textSoFar;
      entry.listeners.forEach((listener) => listener(textSoFar));
    }).finally(() => {
      entry.settled = true;
      entry.listeners.clear();
    });
    // A rejection nobody follows (the entry was dropped) must not become an unhandled rejection.
    entry.promise.catch((): void => undefined);
    this.entries.set(key, entry);
  }

  /** Takes the entry for `key` if it translated exactly `text`; otherwise drops it. */
  claim(key: string, text: string): ClaimedTranslation | null {
    this.purge();
    const entry = this.entries.get(key);
    this.entries.delete(key);
    if (!entry || entry.text !== text) return null;
    return {
      startedAt: entry.startedAt,
      firstTextAt: entry.firstTextAt,
      follow: (onProgress) => {
        if (entry.partial) onProgress(entry.partial);
        if (!entry.settled) entry.listeners.add(onProgress);
        return entry.promise;
      },
    };
  }

  discard(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  private purge(): void {
    const cutoff = this.now() - this.maxAgeMs;
    for (const [key, entry] of this.entries) {
      if (entry.startedAt < cutoff) this.entries.delete(key);
    }
  }
}
