// Counts what each speech stream delivered during a meeting, so a call that "lost words" can be told apart:
// a stream that delivered little, or lines the echo filter dropped. Numbers only: no text is kept or logged.

type Speaker = 'them' | 'user';

interface StreamCount {
  finalLines: number;
  finalWords: number;
}

export class AudioStats {
  private streams: Record<Speaker, StreamCount> = { them: { finalLines: 0, finalWords: 0 }, user: { finalLines: 0, finalWords: 0 } };
  private echoDroppedFinalLines = 0;
  private echoDroppedFinalWords = 0;
  private echoDroppedInterimLines = 0;

  reset(): void {
    this.streams = { them: { finalLines: 0, finalWords: 0 }, user: { finalLines: 0, finalWords: 0 } };
    this.echoDroppedFinalLines = 0;
    this.echoDroppedFinalWords = 0;
    this.echoDroppedInterimLines = 0;
  }

  /** A final line that reached the transcript. */
  noteFinal(speaker: Speaker, words: number): void {
    this.streams[speaker].finalLines += 1;
    this.streams[speaker].finalWords += words;
  }

  /** A microphone line the echo filter dropped. */
  noteEchoDropped(isFinal: boolean, words: number): void {
    if (isFinal) {
      this.echoDroppedFinalLines += 1;
      this.echoDroppedFinalWords += words;
    } else {
      this.echoDroppedInterimLines += 1;
    }
  }

  summary(): string {
    const stream = (name: string, count: StreamCount) =>
      `${name} ${count.finalLines} final lines, ${count.finalWords} words` +
      (count.finalLines ? ` (${(count.finalWords / count.finalLines).toFixed(1)} per line)` : '');
    return (
      `[Main] Meeting audio stats: ${stream('Me', this.streams.user)}; ${stream('Other party', this.streams.them)}; ` +
      `echo filter dropped ${this.echoDroppedFinalLines} final lines (${this.echoDroppedFinalWords} words) and ${this.echoDroppedInterimLines} interim lines`
    );
  }
}

/** The one meeting running at a time. */
export const audioStats = new AudioStats();
