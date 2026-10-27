import { randomUUID } from 'node:crypto';

// The approval broker. Pika's local tools call `request()` inside `execute()`, before any side
// effect, and do nothing unless it resolves to true. An approval is for that one call only: it is
// bound to the request id it was created for, lives in memory, and is denied when the meeting
// stops, the run is aborted or the app quits. It carries what the user must see to decide.

export interface ApprovalRequest {
  id: string;
  meetingId: string;
  tool: 'bash' | 'write' | 'edit' | 'read';
  /** The exact command, or the path. */
  target: string;
  /** For write and edit: the full new content, or the old and new text. */
  detail?: string;
  folder: string;
  /** True when the path is outside the meeting folder. */
  outside?: boolean;
}

interface Pending { request: ApprovalRequest; resolve: (allowed: boolean) => void }

export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(event: { type: 'requested'; request: ApprovalRequest } | { type: 'settled'; id: string; allowed: boolean }) => void>();

  onEvent(listener: (event: { type: 'requested'; request: ApprovalRequest } | { type: 'settled'; id: string; allowed: boolean }) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: { type: 'requested'; request: ApprovalRequest } | { type: 'settled'; id: string; allowed: boolean }): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* a listener must not break the broker */ }
    }
  }

  /** Waits for the user. Resolves false when denied, or when the signal aborts first. */
  request(input: Omit<ApprovalRequest, 'id'>, signal?: AbortSignal): Promise<boolean> {
    const request: ApprovalRequest = { id: randomUUID(), ...input };
    return new Promise<boolean>(resolve => {
      if (signal?.aborted) { resolve(false); return; }
      const settle = (allowed: boolean) => {
        if (!this.pending.delete(request.id)) return;
        signal?.removeEventListener('abort', onAbort);
        this.emit({ type: 'settled', id: request.id, allowed });
        resolve(allowed);
      };
      const onAbort = () => settle(false);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(request.id, { request, resolve: settle });
      this.emit({ type: 'requested', request });
    });
  }

  /** The user's answer. An unknown or already settled id does nothing. */
  respond(id: string, allowed: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.resolve(allowed);
    return true;
  }

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map(entry => entry.request);
  }

  /** Denies everything waiting (for one meeting, or all of them). */
  denyAll(meetingId?: string): void {
    for (const entry of [...this.pending.values()]) {
      if (!meetingId || entry.request.meetingId === meetingId) entry.resolve(false);
    }
  }
}
