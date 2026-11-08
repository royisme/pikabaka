/**
 * Talk windows for interpreting mode. Pure state: no Electron, no timers.
 * A window collects the latest text of every own-speech segment that started
 * inside it; the session closes it after GRACE_MS and speaks `collect()` once.
 */

/** How long a window stays open after the second press, for the last STT finals. */
export const GRACE_MS = 1000;

export interface OwnTurn {
  segmentId: string;
  revision: number;
  text: string;
  startedAt: number;
}

interface Window {
  openedAt: number;
  closed: boolean;
  segments: Map<string, OwnTurn>;
}

export class TalkWindows {
  private windows: Window[] = [];

  constructor(private readonly now: () => number) {}

  /** Start a window. An earlier window that is not closed yet keeps collecting. */
  open(): void {
    this.windows.push({ openedAt: this.now(), closed: false, segments: new Map() });
  }

  /** Stop collecting for the oldest window that is still open. */
  close(): void {
    const w = this.windows.find((x) => !x.closed);
    if (w) w.closed = true;
  }

  /**
   * A segment goes to the newest open window that opened at or before the
   * segment started. Anything else (before every open window, or no open
   * window) is ignored.
   */
  noteOwnTurn(turn: OwnTurn): void {
    let target: Window | undefined;
    for (const w of this.windows) {
      if (!w.closed && w.openedAt <= turn.startedAt) target = w;
    }
    if (!target) return;
    const prev = target.segments.get(turn.segmentId);
    if (!prev || turn.revision >= prev.revision) target.segments.set(turn.segmentId, turn);
  }

  /**
   * Turns of the oldest window, once it is closed, in startedAt order; removes
   * it. Returns null while the oldest window is still open or none exists, so
   * a later window never overtakes an earlier one.
   */
  collectTurns(): OwnTurn[] | null {
    const first = this.windows[0];
    if (!first || !first.closed) return null;
    this.windows.shift();
    return [...first.segments.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  /** The text of `collectTurns()`, joined. */
  collect(): string | null {
    const turns = this.collectTurns();
    if (!turns) return null;
    return turns.map((s) => s.text.trim()).filter((s) => s.length > 0).join(' ');
  }

  /** Drop every window without speaking. */
  reset(): void {
    this.windows = [];
  }
}
