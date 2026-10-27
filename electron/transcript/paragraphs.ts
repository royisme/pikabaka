export interface ParagraphRow {
  segmentId: string;
  revision: number;
  text: string;
  /** When the row was first shown. */
  firstAt: number;
  /** When the row's text last changed. */
  changedAt: number;
}

/** A paragraph is made when its oldest row is this old... */
export const PARAGRAPH_AFTER_MS = 60_000;
/** ...or when this many rows wait. */
export const PARAGRAPH_AFTER_ROWS = 10;
/** A row that changed more recently than this is still in play and is left for the next paragraph. */
export const PARAGRAPH_SETTLE_MS = 10_000;

/**
 * The rows of the other party that were shown sentence by sentence and have not been joined into a
 * paragraph yet. A minute after the first of them, the settled ones are translated again as one
 * paragraph, which has the context that a sentence translated alone lacks.
 */
export class ParagraphQueue {
  private rows: ParagraphRow[] = [];

  /** Adds a row, or updates it when its text or revision changed. */
  note(segmentId: string, revision: number, text: string, now: number): void {
    const existing = this.rows.find((row) => row.segmentId === segmentId);
    if (!existing) {
      this.rows.push({ segmentId, revision, text, firstAt: now, changedAt: now });
      return;
    }
    if (existing.text !== text || existing.revision !== revision) {
      existing.text = text;
      existing.revision = revision;
      existing.changedAt = now;
    }
  }

  /** The rows to join now (oldest first), or null when it is not time. They leave the queue. */
  takeDue(now: number): ParagraphRow[] | null {
    const settled: ParagraphRow[] = [];
    for (const row of this.rows) {
      if (now - row.changedAt < PARAGRAPH_SETTLE_MS) break;
      settled.push(row);
    }
    if (settled.length < 2) return null;
    if (now - settled[0].firstAt < PARAGRAPH_AFTER_MS && settled.length < PARAGRAPH_AFTER_ROWS) return null;
    this.rows = this.rows.slice(settled.length);
    return settled;
  }

  size(): number {
    return this.rows.length;
  }

  clear(): void {
    this.rows = [];
  }
}
