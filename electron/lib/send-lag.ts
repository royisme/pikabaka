// Where could audio wait before it reaches the speech service? This measures the two places on our side: the main
// process's event loop (a busy loop delays every audio chunk) and the gaps between the chunks the native module hands
// over, with the time each write took. Numbers only: no audio and no text.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

type Stream = 'them' | 'user';
const SLOW_GAP_MS = 300;

interface StreamCount { chunks: number; last: number; maxGap: number; slowGaps: number; slowestWrite: number }
const empty = (): StreamCount => ({ chunks: 0, last: 0, maxGap: 0, slowGaps: 0, slowestWrite: 0 });

export class SendLag {
  private loop = monitorEventLoopDelay({ resolution: 10 });
  private streams: Record<Stream, StreamCount> = { them: empty(), user: empty() };

  start(): void {
    this.loop.disable();
    this.loop.reset();
    this.loop.enable();
    this.streams = { them: empty(), user: empty() };
  }

  /** A chunk reached JavaScript at `now` (ms) and took `writeMs` to hand on. */
  noteChunk(stream: Stream, now: number, writeMs: number): void {
    const count = this.streams[stream];
    if (count.last) {
      const gap = now - count.last;
      count.maxGap = Math.max(count.maxGap, gap);
      if (gap > SLOW_GAP_MS) count.slowGaps += 1;
    }
    count.last = now;
    count.chunks += 1;
    count.slowestWrite = Math.max(count.slowestWrite, writeMs);
  }

  /** Time a write and note it. */
  timed(stream: Stream, write: () => void): void {
    const start = performance.now();
    write();
    this.noteChunk(stream, Date.now(), performance.now() - start);
  }

  summary(): string {
    const ms = (nanoseconds: number) => Math.round(nanoseconds / 1e6);
    const stream = (name: string, count: StreamCount) =>
      `${name} ${count.chunks} chunks, longest gap ${count.maxGap} ms, ${count.slowGaps} gaps over ${SLOW_GAP_MS} ms, slowest write ${count.slowestWrite.toFixed(1)} ms`;
    const loop = this.loop;
    const text =
      `[Main] Send lag: event loop p50 ${ms(loop.percentile(50))} ms, p99 ${ms(loop.percentile(99))} ms, max ${ms(loop.max)} ms (each includes the 10 ms timer); ` +
      `${stream('Me', this.streams.user)}; ${stream('Other party', this.streams.them)}`;
    this.loop.disable();
    return text;
  }
}

/** The one meeting running at a time. */
export const sendLag = new SendLag();
