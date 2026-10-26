import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentEventStream, Conversation, Harness, EntryRecord } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import type { AgentRuntime } from './loader';
import type { AgentModel, ModelConfigSource } from './models';
import type { MeetingToolDeps } from './tools/meetingTools';
import { loadAgentRuntime } from './loader';
import { meetingContext, MEETING_INSTRUCTIONS } from './context';
import { createMeetingTools } from './tools/meetingTools';
import { gateLogFile } from './gateLog';

export interface AgentDeps extends MeetingToolDeps {
  userDataDir: string;
  getModelConfigSource(): ModelConfigSource;
}
export type MeetingAgentEvent = { meetingId: string } & (
  | { type: 'run_started' | 'run_settled' }
  | { type: 'text_delta' | 'text_final'; text: string }
  | { type: 'tool_started' | 'tool_finished'; toolName: string }
  | { type: 'run_failed'; errorClass: string }
);
export interface ThreadLine { id: string; role: 'user' | 'assistant' | 'tool'; text: string }

export function reportAgentError(error: unknown, meetingId?: string): void {
  const name = error instanceof Error ? error.constructor.name : '';
  const errorClass = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ModelsError', 'SessionFailed', 'AbortError'].includes(name) ? name : 'AgentError';
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    && error.status >= 100 && error.status <= 599 ? error.status : undefined;
  console.warn('[MeetingAgent]', { meetingId, errorClass, status });
}

export interface MeetingStore {
  harness: Harness;
  conversation: Conversation;
}
interface OwnedStore extends MeetingStore {
  runtime: AgentRuntime;
  events: AgentEventStream;
  accepting: boolean;
  busy: boolean;
  active?: AgentModel;
  selectModel(model: AgentModel): Promise<void>;
  pending: { requestId: string; model: AgentModel }[];
  admission: Promise<unknown>;
  admissionCancel: AbortController;
  releaseBoundary?: () => void;
}
interface Slot {
  accepting: boolean;
  opening: Promise<OwnedStore>;
  closing?: Promise<void>;
}

function thread(entries: readonly EntryRecord[]): ThreadLine[] {
  return entries.flatMap(entry => (entry.model ?? []).flatMap((message, index): ThreadLine[] => {
    const id = `${entry.id}:${index}`;
    if (message.role === 'user') {
      const text = typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('');
      return [{ id, role: 'user', text }];
    }
    if (message.role !== 'assistant') return [];
    return message.content.flatMap((block, blockIndex): ThreadLine[] => {
      if (block.type === 'text') return [{ id: `${id}:${blockIndex}`, role: 'assistant', text: block.text }];
      if (block.type === 'toolCall') return [{ id: `${id}:${blockIndex}`, role: 'tool', text: block.name }];
      return [];
    });
  }));
}

export class MeetingAgent {
  private readonly stores = new Map<string, Slot>();
  private readonly stopped = new Set<string>();
  private readonly listeners = new Set<(event: MeetingAgentEvent) => void | Promise<void>>();
  private shuttingDown = false;
  private clearing: Promise<void> | undefined;
  private readonly deleted = new Set<string>();

  constructor(private readonly deps: AgentDeps) {}

  private file(meetingId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(meetingId)) throw new Error('Invalid meeting id');
    return path.join(this.deps.userDataDir, 'agent', `${meetingId}.sqlite`);
  }

  onEvent(listener: (event: MeetingAgentEvent) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: MeetingAgentEvent): void {
    for (const listener of this.listeners) {
      try {
        void Promise.resolve(listener(event)).catch(error => reportAgentError(error, event.meetingId));
      } catch (error) { reportAgentError(error, event.meetingId); }
    }
  }

  open(meetingId: string): Promise<MeetingStore> {
    return this.openOwned(meetingId, false);
  }

  private openOwned(meetingId: string, details: boolean): Promise<OwnedStore> {
    this.file(meetingId);
    if (this.deleted.has(meetingId)) return Promise.reject(new Error('Agent store was deleted'));
    const existing = this.stores.get(meetingId);
    if (existing) return existing.closing ? Promise.reject(new Error('Agent store is closing')) : existing.opening;
    if (this.shuttingDown || this.clearing) return Promise.reject(new Error('Agent is stopping'));
    if (details) this.stopped.add(meetingId);
    const slot: Slot = { accepting: !this.stopped.has(meetingId), opening: undefined! };
    slot.opening = this.createStore(meetingId, slot).catch(error => {
      this.stores.delete(meetingId);
      reportAgentError(error, meetingId);
      throw new Error('Agent store unavailable');
    });
    this.stores.set(meetingId, slot);
    return slot.opening;
  }

  private async createStore(meetingId: string, slot: Slot): Promise<OwnedStore> {
    const runtime = await loadAgentRuntime();
    const context = runtime.chord.BACKGROUND_CONTEXT;
    await mkdir(path.dirname(this.file(meetingId)), { recursive: true });
    const storage = await runtime.sqlite.openNodeSqliteStorage(this.file(meetingId));
    const registry = runtime.durable.createRegistry();
    const tools = createMeetingTools(runtime, meetingId, this.deps);
    const images = runtime.durable.defineExtension({ name: 'meeting.images', tools: [tools.screenshot] });
    const emptyModels = runtime.models.createModels();
    let owned: OwnedStore | undefined;
    const nextRun = async () => {
      if (!owned) return;
      const next = owned.pending.shift();
      owned.busy = next !== undefined;
      if (next) await owned.selectModel(next.model);
    };
    const finishRun = async (context: Context) => {
      if (!owned) return;
      const store = owned;
      let release: () => void;
      const boundary = new Promise<void>(resolve => { release = resolve; });
      // Fence admission through the final commit: no submit may change the model between yield and run_end.
      const switching = store.admission.then(async () => {
        context.abortSignal?.throwIfAborted();
        store.releaseBoundary = release!;
        await nextRun();
      });
      store.admission = switching.then(() => boundary, () => { release!(); });
      await runtime.chord.awaitWithContext(switching, context);
    };
    registry.install(runtime.durable.defineExtension({
      name: 'meeting.chat',
      tools: tools.transcript,
      sections: [runtime.durable.section('meeting', () => MEETING_INSTRUCTIONS, { tag: false })],
      hooks: [runtime.durable.hook(runtime.durable.GenerationTask, {
        beforeRequest: meetingContext(meetingId, this.deps.recentSegments, runtime),
        onYield: async (_answer, _api, context) => { await finishRun(context); return undefined; },
        afterResponse: async (message, _api, context) => {
          if (message.stopReason === 'error' || message.stopReason === 'aborted') await finishRun(context);
        },
      })],
    }));
    let harness: Harness | undefined;
    try {
      harness = await runtime.durable.Harness.open(storage, {
        registry,
        models: () => owned?.active?.models ?? emptyModels,
        settings: () => ({
          compaction: { enabled: false },
          afterFailedRun: 'continue',
          followUpMode: 'one-at-a-time',
          retry: { maxRetries: 0 },
        }),
        identity: { attribution: null },
        onReport: error => reportAgentError(error, meetingId),
      }, context);
      const conversation = await harness.root(context);
      // abortTask does not start scheduling. Mark EVERY recovered task before any scheduler-enabling call.
      const recovered = await harness.inspect(context);
      for (const task of recovered.tasks) await harness.abortTask(task.record.id, context);
      for (const input of recovered.submissions) await harness.abortSubmission(input.id, context);
      if (recovered.tasks.length || recovered.submissions.length) await conversation.abort(context, { background: true });
      const events = await runtime.durable.watchEvents(harness, conversation.id, context);
      owned = {
        runtime, harness, conversation, events, accepting: slot.accepting, busy: false, pending: [], admission: Promise.resolve(), admissionCancel: new AbortController(),
        async selectModel(model) {
          owned!.active = model;
          if (model.supportsImages) registry.install(images);
          else registry.uninstall(images);
          await conversation.configure({ model: model.ref }, context);
        },
      };
      events.start(async batch => {
        for (const event of batch) {
          if (event.type === 'run_start') owned!.busy = true;
          if (event.type === 'run_end') { owned!.releaseBoundary?.(); owned!.releaseBoundary = undefined; }
          this.forward(meetingId, event);
        }
      });
      void harness.closed.then(() => {
        owned!.accepting = false;
        owned!.releaseBoundary?.();
        if (this.stores.get(meetingId) === slot && !slot.closing) this.stores.delete(meetingId);
      });
      return owned;
    } catch (error) {
      if (harness) await harness.close(context);
      else await storage.close(context);
      throw error;
    }
  }

  private forward(meetingId: string, event: AgentEvent): void {
    if (event.type === 'run_start') this.emit({ meetingId, type: 'run_started' });
    if (event.type === 'run_end') this.emit({ meetingId, type: 'run_settled' });
    if (event.type === 'task_failed') this.emit({ meetingId, type: 'run_failed', errorClass: 'AgentRunError' });
    if (event.type === 'submission' && event.record.status === 'unanswered' && event.record.reason !== 'aborted') {
      this.emit({ meetingId, type: 'run_failed', errorClass: 'AgentRunError' });
    }
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
      this.emit({ meetingId, type: event.type === 'tool_execution_start' ? 'tool_started' : 'tool_finished', toolName: event.toolName });
    }
    if (event.type === 'message_update') {
      for (const change of event.changes) if (change.type === 'text_delta') this.emit({ meetingId, type: 'text_delta', text: change.delta });
    }
    if (event.type === 'message_end') {
      for (const line of thread([event.entry])) if (line.role === 'assistant') this.emit({ meetingId, type: 'text_final', text: line.text });
    }
  }

  async submit(meetingId: string, text: string, opts: { requestId?: string; mode?: 'followup' | 'steer' } = {}): Promise<{ ok: true; requestId: string } | { ok: false; reason: string }> {
    if (this.stopped.has(meetingId) || this.shuttingDown || this.clearing) return { ok: false, reason: 'The meeting agent has stopped' };
    if (!text.trim()) return { ok: false, reason: 'Message must not be empty' };
    const requestId = opts.requestId ?? randomUUID();
    try {
      const store = await this.openOwned(meetingId, false);
      const admission = store.admission.then(async () => {
        if (!store.accepting || !this.stores.get(meetingId)?.accepting) return { ok: false, reason: 'The meeting agent has stopped' } as const;
        const context = store.runtime.chord.BACKGROUND_CONTEXT;
        const duplicate = await store.conversation.commit(tx => tx.submissionByRequest(store.conversation.id, requestId), context);
        if (duplicate) return { ok: true, requestId } as const;
        const resolved = await store.runtime.chord.awaitWithContext(
          this.deps.getModelConfigSource().resolve(),
          store.runtime.chord.withAbortSignal(store.admissionCancel.signal, context),
        );
        if (resolved.ok === false) return { ok: false, reason: resolved.reason } as const;
        if (!store.accepting || !this.stores.get(meetingId)?.accepting) return { ok: false, reason: 'The meeting agent has stopped' } as const;
        if (!store.busy) {
          await store.selectModel(resolved.model);
          store.busy = true;
        } else if (opts.mode !== 'steer') {
          store.pending.push({ requestId, model: resolved.model });
        }
        await store.conversation.submit({ type: 'input', content: text, requestId, whenBusy: opts.mode === 'steer' ? 'steer' : 'followUp' }, context);
        return { ok: true, requestId } as const;
      });
      store.admission = admission.catch(() => {});
      return await admission;
    } catch (error) {
      reportAgentError(error, meetingId);
      return { ok: false, reason: 'Agent submission failed' };
    }
  }

  async abort(meetingId: string): Promise<void> {
    const slot = this.stores.get(meetingId);
    if (!slot || slot.closing) return;
    const store = await slot.opening;
    store.admissionCancel.abort();
    const aborting = store.admission.then(async () => {
      store.pending = [];
      await store.conversation.abort(store.runtime.chord.BACKGROUND_CONTEXT, { background: true });
      store.busy = false;
      store.admissionCancel = new AbortController();
    });
    store.admission = aborting.catch(() => {});
    await aborting;
  }

  async getThread(meetingId: string): Promise<ThreadLine[]> {
    const store = await this.openOwned(meetingId, true);
    const entries: EntryRecord[] = [];
    let cursor;
    do {
      const page = await store.conversation.entries({ order: 'ascending' }, 256, cursor, store.runtime.chord.BACKGROUND_CONTEXT);
      entries.push(...page.items);
      cursor = page.next;
    } while (cursor);
    return thread(entries);
  }

  async status(meetingId: string): Promise<'closed' | 'stopping' | 'idle' | 'running'> {
    const slot = this.stores.get(meetingId);
    if (!slot) return 'closed';
    if (slot.closing) return 'stopping';
    const store = await slot.opening;
    const inspection = await store.harness.inspect(store.runtime.chord.BACKGROUND_CONTEXT);
    return inspection.tasks.length || inspection.submissions.length ? 'running' : 'idle';
  }

  async openForDetails(meetingId: string): Promise<MeetingStore> {
    return this.openOwned(meetingId, true);
  }

  stop(meetingId: string): Promise<void> { return this.stopWithin(meetingId, 3000); }

  private stopWithin(meetingId: string, timeoutMs: number): Promise<void> {
    this.stopped.add(meetingId);
    const slot = this.stores.get(meetingId);
    if (!slot) return Promise.resolve();
    slot.accepting = false;
    if (!slot.closing) {
      slot.closing = (async () => {
        const store = await slot.opening;
        store.accepting = false;
        store.admissionCancel.abort();
        const context = store.runtime.chord.BACKGROUND_CONTEXT;
        await store.admission;
        store.pending = [];
        try { await store.conversation.abort(context, { background: true }); }
        finally {
          await store.events.stop();
          await store.harness.close(context);
          this.stores.delete(meetingId);
        }
      })();
      // Keep ownership until close actually finishes, even if a caller's deadline expires.
      void slot.closing.catch(error => reportAgentError(error, meetingId));
    }
    return this.bounded(slot.closing, timeoutMs);
  }

  private async bounded(work: Promise<void>, timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Agent shutdown timed out')), timeoutMs);
      })]);
    } finally { clearTimeout(timer!); }
  }

  async stopAll(timeoutMs: number): Promise<void> {
    this.shuttingDown = true;
    await Promise.all([...this.stores.keys()].map(id => this.stopWithin(id, timeoutMs).catch(error => reportAgentError(error, id))));
  }

  async deleteStore(meetingId: string): Promise<void> {
    const file = this.file(meetingId);
    this.deleted.add(meetingId);
    await this.stop(meetingId);
    await Promise.all(['', '-wal', '-shm'].map(suffix => rm(file + suffix, { force: true })));
    await rm(gateLogFile(this.deps.userDataDir, meetingId), { force: true });
  }

  deleteAllStores(): Promise<void> {
    if (this.clearing) return this.clearing;
    this.clearing = (async () => {
      const directory = path.join(this.deps.userDataDir, 'agent');
      const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [] as string[];
        throw error;
      });
      const diskIds = files.flatMap(file => {
        const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\.(?:sqlite(?:-wal|-shm)?|gate\.jsonl)$/.exec(file);
        return match ? [match[1]] : [];
      });
      const ids = new Set([...this.stores.keys(), ...diskIds]);
      await Promise.all([...ids].map(id => this.deleteStore(id)));
    })().finally(() => { this.clearing = undefined; });
    return this.clearing;
  }
}
