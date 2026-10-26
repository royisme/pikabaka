import { readFile, readdir, stat } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import type { GateDecision } from './gate';

// One JSON line per decision, beside the meeting's agent store. A line carries ids, numbers and the
// outcome, never speech text. Deleting the meeting deletes the file with its store.
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export function gateLogFile(userDataDir: string, meetingId: string): string {
  if (!ID.test(meetingId)) throw new Error('Invalid meeting id');
  return path.join(userDataDir, 'agent', `${meetingId}.gate.jsonl`);
}

export function appendGateDecision(userDataDir: string, decision: GateDecision): void {
  appendFileSync(gateLogFile(userDataDir, decision.meetingId), JSON.stringify(decision) + '\n');
}

export async function readGateDecisions(userDataDir: string, meetingId: string, limit: number): Promise<GateDecision[]> {
  const text = await readFile(gateLogFile(userDataDir, meetingId), 'utf8').catch(() => '');
  const lines = text.split('\n').filter(Boolean).slice(-limit);
  return lines.flatMap(line => {
    try { return [JSON.parse(line) as GateDecision]; } catch { return []; }
  }).reverse();
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
