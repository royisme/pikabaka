// The proactive gate: after each other-party segment it asks a classifier whether the user would
// benefit from help right now. Pure scheduling logic; the model, the record and the clock come in
// through GateDeps. Nothing here imports pi-*, and nothing logs speech.

export type GateMode = 'log' | 'on' | 'off';
export type GateKind = 'answer_question' | 'explain_term' | 'check_fact' | 'action_item' | 'nothing';
export type GateOutcome = 'shown' | 'logged' | 'below_threshold' | 'cooldown' | 'stale' | 'superseded' | `error:${string}`;
export type GateErrorClass = 'timeout' | 'auth' | 'network' | 'bad_response';

export class GateError extends Error {
  constructor(readonly errorClass: GateErrorClass) {
    super(errorClass);
    this.name = 'GateError';
  }
}

export interface GateLine { speaker: 'Them' | 'You'; text: string }
export interface GateInput { lines: GateLine[]; userLanguage: string; secondsSinceCard: number }
export interface GateAnswer { help: number; kind: GateKind; kindProbability: number }
export type GateClassify = (input: GateInput, options: { signal: AbortSignal; timeoutMs: number }) => Promise<GateAnswer>;

export interface GateSettings { mode: GateMode; threshold: number; cooldownSeconds: number; model: string }
export interface GateSegmentRef { meetingId: string; segmentId: string; revision: number }

/** One decision. It never carries speech text. */
export interface GateDecision extends GateSegmentRef {
  time: number;
  model: string;
  threshold: number;
  cooldownSeconds: number;
  help?: number;
  kind?: GateKind;
  kindProbability?: number;
  latencyMs?: number;
  outcome: GateOutcome;
}

export interface GateStatus {
  mode: GateMode;
  configured: boolean;
  state: 'ok' | 'unavailable' | 'unconfigured';
  reason?: string;
  lastDecision?: GateDecision;
}

export interface GateDeps {
  /** Undefined when the decision model is not configured. */
  getClassifier(): GateClassify | undefined;
  getSettings(): GateSettings;
  now(): number;
  getSegmentRevision(meetingId: string, segmentId: string): number | undefined;
  isMeetingActive(meetingId: string): boolean;
  getLines(meetingId: string): GateLine[];
  getUserLanguage(): string;
  log(decision: GateDecision): void;
}

export const GATE_DEADLINE_MS = 2000;
export const GATE_MAX_AGE_MS = 20_000;
const LASTING_FAILURES = 3;
const KEEP_DECISIONS = 200;

const REASONS: Record<GateErrorClass, string> = {
  timeout: 'The decision model did not answer in time',
  auth: 'Authentication failed',
  network: 'The decision model could not be reached',
  bad_response: 'The decision model sent an unusable answer',
};

interface Queued extends GateSegmentRef { queuedAt: number }

export class Gate {
  private inFlight: { ref: Queued; controller: AbortController } | null = null;
  private pending: Queued | null = null;
  private lastShownAt: number | null = null;
  private failures = 0;
  private unavailable: string | null = null;
  private readonly decisions: GateDecision[] = [];
  private readonly listeners = new Set<(decision: GateDecision) => void>();

  constructor(private readonly deps: GateDeps) {}

  onDecision(listener: (decision: GateDecision) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Called for every flushed other-party segment. Never throws into the transcript path. */
  onSegment(ref: GateSegmentRef): void {
    try {
      const settings = this.deps.getSettings();
      if (settings.mode === 'off' || !this.deps.getClassifier()) return;
      const queued: Queued = { ...ref, queuedAt: this.deps.now() };
      if (this.inFlight) {
        if (this.pending) this.record(this.pending, settings, 'superseded');
        this.pending = queued;
        return;
      }
      void this.run(queued);
    } catch {
      // The gate must never disturb the transcript.
    }
  }

  /** The meeting stopped: drop what waits and let a request in flight finish as stale. */
  stop(meetingId: string): void {
    if (this.pending?.meetingId === meetingId) this.pending = null;
    if (this.inFlight?.ref.meetingId === meetingId) this.inFlight.controller.abort();
  }

  status(): GateStatus {
    const settings = this.deps.getSettings();
    const configured = this.deps.getClassifier() !== undefined;
    const lastDecision = this.decisions[this.decisions.length - 1];
    if (!configured) return { mode: settings.mode, configured, state: 'unconfigured', lastDecision };
    if (this.unavailable) return { mode: settings.mode, configured, state: 'unavailable', reason: this.unavailable, lastDecision };
    return { mode: settings.mode, configured, state: 'ok', lastDecision };
  }

  recent(limit: number): GateDecision[] {
    return this.decisions.slice(-limit).reverse();
  }

  private record(ref: GateSegmentRef, settings: GateSettings, outcome: GateOutcome, extra: Partial<GateDecision> = {}): GateDecision {
    const decision: GateDecision = {
      time: this.deps.now(),
      meetingId: ref.meetingId,
      segmentId: ref.segmentId,
      revision: ref.revision,
      model: settings.model,
      threshold: settings.threshold,
      cooldownSeconds: settings.cooldownSeconds,
      ...extra,
      outcome,
    };
    this.decisions.push(decision);
    if (this.decisions.length > KEEP_DECISIONS) this.decisions.shift();
    try { this.deps.log(decision); } catch { /* a full disk must not stop the gate */ }
    return decision;
  }

  private async run(ref: Queued): Promise<void> {
    const settings = this.deps.getSettings();
    const classify = this.deps.getClassifier();
    const controller = new AbortController();
    this.inFlight = { ref, controller };
    const started = this.deps.now();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, GATE_DEADLINE_MS);
    try {
      if (!classify) return;
      const input: GateInput = {
        lines: this.deps.getLines(ref.meetingId),
        userLanguage: this.deps.getUserLanguage(),
        secondsSinceCard: this.lastShownAt === null ? 0 : Math.round((started - this.lastShownAt) / 1000),
      };
      let answer: GateAnswer;
      try {
        answer = await classify(input, { signal: controller.signal, timeoutMs: GATE_DEADLINE_MS });
      } catch (error) {
        if (controller.signal.aborted && !timedOut) {
          this.record(ref, settings, 'stale', { latencyMs: this.deps.now() - started });
        } else {
          this.fail(ref, settings, timedOut ? 'timeout' : error instanceof GateError ? error.errorClass : 'bad_response', started);
        }
        return;
      }
      this.failures = 0;
      this.unavailable = null;
      this.settle(ref, settings, answer, started);
    } finally {
      clearTimeout(timer);
      this.inFlight = null;
      const next = this.pending;
      this.pending = null;
      if (next) void this.run(next);
    }
  }

  private fail(ref: Queued, settings: GateSettings, errorClass: GateErrorClass, started: number): void {
    this.failures += 1;
    if (errorClass === 'auth' || this.failures >= LASTING_FAILURES) this.unavailable = REASONS[errorClass];
    this.record(ref, settings, `error:${errorClass}`, { latencyMs: this.deps.now() - started });
  }

  private settle(ref: Queued, settings: GateSettings, answer: GateAnswer, started: number): void {
    const now = this.deps.now();
    const details = { help: answer.help, kind: answer.kind, kindProbability: answer.kindProbability, latencyMs: now - started };
    const latest = this.deps.getSegmentRevision(ref.meetingId, ref.segmentId);
    if (!this.deps.isMeetingActive(ref.meetingId) || (latest !== undefined && latest > ref.revision) || now - ref.queuedAt > GATE_MAX_AGE_MS) {
      this.record(ref, settings, 'stale', details);
      return;
    }
    if (answer.help < settings.threshold || answer.kind === 'nothing') {
      this.record(ref, settings, 'below_threshold', details);
      return;
    }
    if (this.lastShownAt !== null && now - this.lastShownAt < settings.cooldownSeconds * 1000) {
      this.record(ref, settings, 'cooldown', details);
      return;
    }
    if (settings.mode === 'on') {
      this.lastShownAt = now;
      const decision = this.record(ref, settings, 'shown', details);
      for (const listener of this.listeners) {
        try { listener(decision); } catch { /* a listener must not stop the gate */ }
      }
      return;
    }
    this.record(ref, settings, 'logged', details);
  }
}
