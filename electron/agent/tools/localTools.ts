import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Context } from '@earendil-works/chord';
import type { AgentRuntime } from '../loader';
import type { ApprovalBroker } from '../approval';
import { commandEnv, meetingFolder, resolveToolPath } from '../workspace';

// Pika's own local tools. Every call asks the user first (ApprovalBroker), inside execute() and
// before any side effect; they are not declared replay-safe, so after a crash the model is told the
// call was interrupted and it is never run again. Failures are reduced to short messages: command
// output, file contents and paths are never logged.

export interface LocalToolDeps {
  broker: ApprovalBroker;
  /** The workspace root from Settings; empty when unset. */
  getRoot(): string;
  getStartTimeMs(meetingId: string): number;
  /** Pika's own data folder: never reachable. */
  dataDir: string;
}

const MAX_OUTPUT = 20_000;
const MAX_READ = 50_000;
const COMMAND_TIMEOUT_MS = 60_000;

export function createLocalTools(runtime: AgentRuntime, meetingId: string, deps: LocalToolDeps) {
  const { defineTool } = runtime.durable;
  const { Type } = runtime;
  const text = (value: string, isError = false) => ({ ...(isError ? { isError: true } : {}), output: [{ type: 'text' as const, text: value }] });

  async function folder(): Promise<string> {
    try {
      return await meetingFolder(deps.getRoot(), meetingId, deps.getStartTimeMs(meetingId));
    } catch (error) {
      throw new Error(deps.getRoot() ? (error as Error).message : 'No workspace folder is set. Choose one in Settings.');
    }
  }

  async function ask(context: Context, input: { tool: 'bash' | 'write' | 'edit' | 'read'; target: string; detail?: string; folder: string; outside?: boolean }): Promise<boolean> {
    return deps.broker.request({ meetingId, ...input }, context.abortSignal);
  }

  const bash = defineTool({
    name: 'bash',
    description: 'Run a shell command in the meeting folder. The user must allow every command first. Returns the exit code and the combined output (at most 20,000 characters).',
    parameters: Type.Object({ command: Type.String({ minLength: 1, maxLength: 4000 }) }),
    callers: ['model'],
    execute: async (args, _api, context) => {
      let cwd: string;
      try { cwd = await folder(); } catch (error) { return text((error as Error).message, true); }
      if (!(await ask(context, { tool: 'bash', target: args.command, folder: cwd }))) return text('The user did not allow this command. Do not run it again unless the user asks.', true);
      const env = await commandEnv();
      return new Promise(resolve => {
        const child = spawn('/bin/bash', ['-c', args.command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const collect = (chunk: Buffer) => { if (output.length < MAX_OUTPUT) output += chunk.toString('utf8'); };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const stop = () => { child.kill('SIGKILL'); };
        const timer = setTimeout(stop, COMMAND_TIMEOUT_MS);
        context.abortSignal?.addEventListener('abort', stop, { once: true });
        child.on('error', () => { clearTimeout(timer); resolve(text('The command could not be started.', true)); });
        child.on('close', (code, signal) => {
          clearTimeout(timer);
          const head = signal ? `Stopped (${signal}).` : `Exit code ${code}.`;
          resolve(text(`${head}\n${output.slice(0, MAX_OUTPUT)}${output.length > MAX_OUTPUT ? '\n[output cut]' : ''}`, code !== 0));
        });
      });
    },
  });

  async function pathFor(requested: string): Promise<{ cwd: string; resolved: string; outside: boolean } | { error: string }> {
    let cwd: string;
    try { cwd = await folder(); } catch (error) { return { error: (error as Error).message }; }
    const { resolved, inside, refused } = await resolveToolPath(cwd, requested, deps.dataDir);
    if (refused) return { error: "Pika's own data folder cannot be used." };
    return { cwd, resolved, outside: !inside };
  }

  const read = defineTool({
    name: 'read',
    description: 'Read a text file. The path is relative to the meeting folder. The user must allow every read first. Returns at most 50,000 characters.',
    parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 1000 }) }),
    callers: ['model'],
    execute: async (args, _api, context) => {
      const target = await pathFor(args.path);
      if ('error' in target) return text(target.error, true);
      if (!(await ask(context, { tool: 'read', target: target.resolved, folder: target.cwd, outside: target.outside }))) return text('The user did not allow this read.', true);
      try {
        const content = await readFile(target.resolved, 'utf8');
        return text(content.length > MAX_READ ? `${content.slice(0, MAX_READ)}\n[cut]` : content);
      } catch {
        return text('The file could not be read.', true);
      }
    },
  });

  const write = defineTool({
    name: 'write',
    description: 'Write a text file, replacing it if it exists. The path is relative to the meeting folder. The user must allow every write first.',
    parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 1000 }), content: Type.String({ maxLength: 200_000 }) }),
    callers: ['model'],
    execute: async (args, _api, context) => {
      const target = await pathFor(args.path);
      if ('error' in target) return text(target.error, true);
      if (!(await ask(context, { tool: 'write', target: target.resolved, detail: args.content, folder: target.cwd, outside: target.outside }))) return text('The user did not allow this write.', true);
      try {
        await mkdir(path.dirname(target.resolved), { recursive: true });
        await writeFile(target.resolved, args.content, 'utf8');
        return text('Written.');
      } catch {
        return text('The file could not be written.', true);
      }
    },
  });

  const edit = defineTool({
    name: 'edit',
    description: 'Replace one exact piece of text in a file. The text must occur exactly once. The user must allow every edit first.',
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 1000 }),
      oldText: Type.String({ minLength: 1, maxLength: 100_000 }),
      newText: Type.String({ maxLength: 100_000 }),
    }),
    callers: ['model'],
    execute: async (args, _api, context) => {
      const target = await pathFor(args.path);
      if ('error' in target) return text(target.error, true);
      let current: string;
      try { current = await readFile(target.resolved, 'utf8'); } catch { return text('The file could not be read.', true); }
      const first = current.indexOf(args.oldText);
      if (first === -1 || current.indexOf(args.oldText, first + 1) !== -1) return text('The text to replace must occur exactly once in the file.', true);
      const detail = `- ${args.oldText.split('\n').join('\n- ')}\n+ ${args.newText.split('\n').join('\n+ ')}`;
      if (!(await ask(context, { tool: 'edit', target: target.resolved, detail, folder: target.cwd, outside: target.outside }))) return text('The user did not allow this edit.', true);
      try {
        // The file may have changed while the user decided: check again, then write.
        current = await readFile(target.resolved, 'utf8');
        const at = current.indexOf(args.oldText);
        if (at === -1 || current.indexOf(args.oldText, at + 1) !== -1) return text('The file changed while waiting. Nothing was edited.', true);
        await writeFile(target.resolved, current.slice(0, at) + args.newText + current.slice(at + args.oldText.length), 'utf8');
        return text('Edited.');
      } catch {
        return text('The file could not be written.', true);
      }
    },
  });

  return [bash, read, write, edit];
}
