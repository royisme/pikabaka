import { execFile } from 'node:child_process';
import { mkdir, realpath, rename, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Where the agent's commands run: one fixed root chosen in Settings, a folder per day, and in it a
// folder per meeting. The folder is created on first use (a silent meeting leaves none), named
// `<HHmm> <short id>` and renamed once to `<HHmm> <title>` after the meeting stops.

const folders = new Map<string, string>();

function pad(value: number): string { return String(value).padStart(2, '0'); }

/** A folder-safe name: no separators, no control characters, no leading dots, at most 60 characters. */
export function sanitizeTitle(title: string): string {
  return title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 60).trim();
}

export function dayFolderName(startTimeMs: number): { day: string; time: string } {
  const date = new Date(startTimeMs);
  return { day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}${pad(date.getMinutes())}` };
}

export async function validateRoot(root: string): Promise<string | undefined> {
  if (!root || !path.isAbsolute(root)) return 'Choose a folder';
  try {
    if (!(await stat(root)).isDirectory()) return 'That is not a folder';
  } catch {
    return 'That folder does not exist';
  }
  return undefined;
}

/** The meeting's folder, created if needed. Throws when the root is unset or unusable. */
export async function meetingFolder(root: string, meetingId: string, startTimeMs: number): Promise<string> {
  const known = folders.get(meetingId);
  if (known) return known;
  const problem = await validateRoot(root);
  if (problem) throw new Error(problem);
  const { day, time } = dayFolderName(startTimeMs);
  const dir = path.join(root, day, `${time} ${meetingId.slice(0, 6)}`);
  await mkdir(dir, { recursive: true });
  folders.set(meetingId, dir);
  return dir;
}

/** Renames the folder once to carry the title. The short id stays when the name is taken. A missing folder is fine. */
export async function renameMeetingFolder(meetingId: string, title: string): Promise<void> {
  const dir = folders.get(meetingId);
  const name = sanitizeTitle(title);
  if (!dir || !name) return;
  const time = path.basename(dir).split(' ')[0];
  const target = path.join(path.dirname(dir), `${time} ${name}`);
  if (target === dir) return;
  try {
    await stat(target);
    return;
  } catch {
    // free to use
  }
  await rename(dir, target);
  folders.set(meetingId, target);
}

/**
 * Resolves a path the model gave against the meeting folder and follows symlinks. `inside` says
 * whether it stays in the folder; `refused` is Pika's own data folder, which is never reachable.
 */
export async function resolveToolPath(folder: string, requested: string, dataDir: string): Promise<{ resolved: string; inside: boolean; refused: boolean }> {
  const absolute = path.resolve(folder, requested);
  // The target may not exist yet (write): resolve its deepest existing parent.
  let existing = absolute;
  const rest: string[] = [];
  for (;;) {
    try {
      existing = await realpath(existing);
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }
  const resolved = path.join(existing, ...rest);
  const within = (base: string, target: string) => target === base || target.startsWith(base + path.sep);
  const realFolder = await realpath(folder).catch(() => folder);
  const realData = await realpath(dataDir).catch(() => dataDir);
  return { resolved, inside: within(realFolder, resolved), refused: within(realData, resolved) };
}

let loginPath: Promise<string> | undefined;

/** A packaged app started from Finder has a minimal PATH; ask the login shell once. */
export function shellPath(): Promise<string> {
  loginPath ??= new Promise(resolve => {
    const shell = process.env.SHELL || '/bin/zsh';
    execFile(shell, ['-ilc', 'printf %s "$PATH"'], { timeout: 4000 }, (error, stdout) => {
      resolve(!error && stdout.trim() ? stdout.trim() : process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin');
    });
  });
  return loginPath;
}

/** The only environment a command gets: no Pika keys and no provider variables. */
export async function commandEnv(): Promise<NodeJS.ProcessEnv> {
  return { PATH: await shellPath(), HOME: os.homedir(), LANG: process.env.LANG || 'en_US.UTF-8' };
}
