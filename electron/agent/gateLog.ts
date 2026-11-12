import { readFile, readdir, stat } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import type { GateDecision } from './gate';

// One JSON line per decision, beside the meeting's agent store. A line carries ids, numbers and the
// outcome, never speech text. Deleting the meeting deletes the file with its store. A shown decision is
// followed by one `card: true` line that says what became of its card; readers of decisions skip it.
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export function gateLogFile(userDataDir: string, meetingId: string): string {
  if (!ID.test(meetingId)) throw new Error('Invalid meeting id');
  return path.join(userDataDir, 'agent', `${meetingId}.gate.jsonl`);
}

/** What became of the card for a shown decision. Ids, numbers and the outcome only. */
export interface CardOutcome {
  card: true;
  time: number;
  meetingId: string;
  segmentId: string;
  outcome: 'drafted' | 'skip' | 'timeout' | `error:${string}`;
  cardLatencyMs: number;
}

export function appendCardOutcome(userDataDir: string, outcome: CardOutcome): void {
  appendFileSync(gateLogFile(userDataDir, outcome.meetingId), JSON.stringify(outcome) + '\n');
}

export function appendGateDecision(userDataDir: string, decision: GateDecision): void {
  appendFileSync(gateLogFile(userDataDir, decision.meetingId), JSON.stringify(decision) + '\n');
}

export async function readGateDecisions(userDataDir: string, meetingId: string, limit: number): Promise<GateDecision[]> {
  const text = await readFile(gateLogFile(userDataDir, meetingId), 'utf8').catch(() => '');
  const decisions = text.split('\n').filter(Boolean).flatMap(line => {
    try {
      const entry = JSON.parse(line) as GateDecision | CardOutcome;
      return 'card' in entry ? [] : [entry];
    } catch { return []; }
  });
  return decisions.slice(-limit).reverse();
}

/** The meeting whose gate log was written last, for when no meeting runs. */
export async function latestGateMeeting(userDataDir: string): Promise<string | undefined> {
  const directory = path.join(userDataDir, 'agent');
  const names = await readdir(directory).catch(() => [] as string[]);
  let best: { id: string; mtime: number } | undefined;
  for (const name of names) {
    const match = /^(.+)\.gate\.jsonl$/.exec(name);
    if (!match || !ID.test(match[1])) continue;
    const info = await stat(path.join(directory, name)).catch((): undefined => undefined);
    if (info && (!best || info.mtimeMs > best.mtime)) best = { id: match[1], mtime: info.mtimeMs };
  }
  return best?.id;
}
