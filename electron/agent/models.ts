import type { CredentialStore, Models } from '@earendil-works/pi-ai';
import type { CredentialsManager } from '../services/CredentialsManager';
import { connectionNeedsKey, openAiRoot, type Connection } from '../services/aiConnections';
import { loadAgentRuntime } from './loader';
import { GateError, type GateClassify, type GateErrorClass, type GateKind } from './gate';

// The agent's model is a connection (type, host, key) and a model id, both chosen by the user. Pika
// is not tied to a provider: any host of the openai, anthropic or gemini type works, and
// the exact model id typed or fetched is the one that runs. It is registered with pi-ai as it is,
// so an id pi-ai has never heard of runs as itself and is never swapped for another model.

export interface AgentModel {
  models: Models;
  ref: { provider: string; modelId: string };
  supportsImages: boolean;
}
export type AgentModelResult = { ok: true; model: AgentModel } | { ok: false; reason: string };
export interface ModelConfigSource { resolve(): Promise<AgentModelResult> }

/** Answers only for this connection, from Pika's own store. pi-ai's ambient (environment) auth stays off. */
export function createConnectionCredentialStore(connection: Connection): CredentialStore {
  const key = () => connection.apiKey.trim() || (connectionNeedsKey(connection.baseUrl) ? '' : 'none');
  return {
    async read(providerId) {
      return providerId === connection.id && key() ? { type: 'api_key', key: key() } : undefined;
    },
    async list() {
      return key() ? [{ providerId: connection.id, type: 'api_key' as const }] : [];
    },
    async modify() { throw new Error('Agent credentials are read-only'); },
    async delete() { throw new Error('Agent credentials are read-only'); },
  };
}

/** Builds the pi-ai model for a connection and the exact model id. */
export async function buildAgentModel(connection: Connection, modelId: string, supportsImages: boolean): Promise<AgentModel> {
  const runtime = await loadAgentRuntime();
  const input: ('text' | 'image')[] = supportsImages ? ['text', 'image'] : ['text'];
  const common = {
    id: modelId,
    name: modelId,
    provider: connection.id,
    headers: connection.headers,
    input,
    reasoning: false,
    // Unknown for a model Pika was not told about: conservative values, so a request is not refused for asking too much.
    contextWindow: 128_000,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const auth = { apiKey: runtime.ai.envApiKeyAuth(connection.name, []) };
  let provider;
  if (connection.type === 'anthropic') {
    provider = runtime.ai.createProvider({
      id: connection.id, name: connection.name, auth,
      models: [{ ...common, api: 'anthropic-messages', baseUrl: connection.baseUrl }],
      api: runtime.anthropicApi.anthropicMessagesApi(),
    });
  } else if (connection.type === 'gemini') {
    const root = /\/v1(beta|alpha)?$/.test(connection.baseUrl) ? connection.baseUrl : `${connection.baseUrl}/v1beta`;
    provider = runtime.ai.createProvider({
      id: connection.id, name: connection.name, auth,
      models: [{ ...common, api: 'google-generative-ai', baseUrl: root }],
      api: runtime.googleApi.googleGenerativeAIApi(),
    });
  } else {
    const root = openAiRoot(connection.baseUrl);
    provider = runtime.ai.createProvider({
      id: connection.id, name: connection.name, auth,
      models: [{ ...common, api: 'openai-completions', baseUrl: root }],
      api: runtime.openAICompletionsApi.openAICompletionsApi(),
    });
  }
  const models = runtime.models.createModels({
    credentials: createConnectionCredentialStore(connection),
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  models.setProvider(provider);
  return { models, ref: { provider: connection.id, modelId }, supportsImages };
}

/** The agent's own choice, or the exact Quick answers connection and model when it inherits. */
export async function resolveAgentModel(
  credentials: Pick<CredentialsManager, 'getAgentUse' | 'resolveModelUse'>,
): Promise<AgentModelResult> {
  const resolved = credentials.resolveModelUse('agent');
  if ('error' in resolved) return { ok: false, reason: resolved.error };
  const use = credentials.getAgentUse();
  return { ok: true, model: await buildAgentModel(resolved.connection, resolved.model, use.connectionId ? use.supportsImages : false) };
}

// ---- The decision model behind the proactive gate (D4: configurable only) ----

export interface GateCredentials {
  getAgentGateModel(): string;
  getAgentGateBaseUrl(): string;
  getAgentGateApiKey(): string;
}

const GATE_PROVIDER = 'pika-gate';

function isLoopback(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

/** Reads only the gate's own key; a local gateway may run without one. */
export function createGateCredentialStore(credentials: GateCredentials): CredentialStore {
  const key = () => credentials.getAgentGateApiKey().trim() || (isLoopback(credentials.getAgentGateBaseUrl()) ? 'none' : '');
  return {
    async read(providerId) {
      return providerId === GATE_PROVIDER && key() ? { type: 'api_key', key: key() } : undefined;
    },
    async list() {
      return key() ? [{ providerId: GATE_PROVIDER, type: 'api_key' as const }] : [];
    },
    async modify() { throw new Error('Agent credentials are read-only'); },
    async delete() { throw new Error('Agent credentials are read-only'); },
  };
}

/** Maps a failed classification to a short class; the message itself (it can quote the response) is dropped. */
export function gateErrorClass(message: string | undefined): GateErrorClass {
  const text = message ?? '';
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|api key/i.test(text)) return 'auth';
  if (/timeout|timed out|abort/i.test(text)) return 'timeout';
  if (/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network|\b(5\d\d|429)\b/i.test(text)) return 'network';
  return 'bad_response';
}

const GATE_KINDS: GateKind[] = ['answer_question', 'explain_term', 'check_fact', 'action_item', 'nothing'];

/** What the settings screen shows after it sends a made-up conversation to the decision model. */
export interface GateTestResult { success: boolean; help?: number; kind?: GateKind; latencyMs?: number; error?: string }

const GATE_TEST_ERROR: Record<GateErrorClass, string> = {
  timeout: 'The decision model did not answer within 2 seconds.',
  auth: 'The decision model refused the key (401 or 403).',
  network: 'The decision model could not be reached (connection refused, DNS, or a server error).',
  bad_response: 'The host answered, but not in the format this model expects: requests go to the base URL followed by /systemone and need an answer of that kind.',
};

/** Sends an invented question through the decision model the way a meeting does, and reports what it decided. */
export async function testGateModel(credentials: GateCredentials): Promise<GateTestResult> {
  const classify = await createGateClassify(credentials);
  if (!classify) return { success: false, error: 'Set a model and a base URL first (a key is optional for a local address).' };
  const started = Date.now();
  try {
    const answer = await classify(
      { lines: [{ speaker: 'Them', text: 'Could you walk me through the hardest technical decision you owned on the billing project?' }], userLanguage: 'english-us', secondsSinceCard: 600 },
      { signal: AbortSignal.timeout(5_000), timeoutMs: 5_000 },
    );
    return { success: true, help: answer.help, kind: answer.kind, latencyMs: Date.now() - started };
  } catch (error) {
    return { success: false, latencyMs: Date.now() - started, error: error instanceof GateError ? GATE_TEST_ERROR[error.errorClass] : 'The decision model could not be run.' };
  }
}

/** The classifier for the current gate settings, or undefined when it is not configured. */
export async function createGateClassify(credentials: GateCredentials): Promise<GateClassify | undefined> {
  const model = credentials.getAgentGateModel().trim();
  const baseUrl = credentials.getAgentGateBaseUrl().trim();
  const store = createGateCredentialStore(credentials);
  if (!model || !baseUrl || !(await store.read(GATE_PROVIDER))) return undefined;
  const runtime = await loadAgentRuntime();
  const models = runtime.models.createModels({
    credentials: store,
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  models.setProvider(runtime.ai.createProvider({
    id: GATE_PROVIDER,
    name: 'Decision model',
    auth: { apiKey: runtime.ai.envApiKeyAuth('Decision model', []) },
    models: [{
      type: 'classifier',
      id: model,
      name: model,
      api: 'typesafe-system-one',
      provider: GATE_PROVIDER,
      baseUrl,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768,
    }],
    classifiers: { 'typesafe-system-one': runtime.systemOne.typesafeSystemOneApi() },
  }));
  const classifier = models.getModelOfType('classifier', GATE_PROVIDER, model);
  if (!classifier) return undefined;
  return async (input, options) => {
    const result = await models.classify(classifier, {
      state: {
        conversation: input.lines.map(line => ({ speaker: line.speaker, text: line.text })),
        user_language: input.userLanguage,
        seconds_since_last_help: input.secondsSinceCard,
      },
      questions: {
        help: {
          type: 'bool',
          instructions: 'The conversation is a live meeting. Would the user, who is "You", benefit from help from an assistant right now? Help means answering a question put to them, explaining a term, checking a fact or number, or noting an action item.',
          criteria: { true: 'Help would clearly benefit the user right now', false: 'No help is needed right now' },
        },
        kind: {
          type: 'choice',
          instructions: 'What kind of help would fit the latest turn of the other party?',
          criteria: {
            answer_question: 'The other party put a question to the user',
            explain_term: 'The other party used a term or name the user may not know',
            check_fact: 'A fact, figure or claim could be wrong and is worth checking',
            action_item: 'Someone took on a task or a date that should be noted',
            nothing: 'None of these',
          },
        },
      },
    }, { signal: options.signal, timeoutMs: options.timeoutMs, maxRetries: 0 });
    if (result.stopReason === 'aborted') throw new GateError('timeout');
    const help = result.answers.help;
    const kind = result.answers.kind;
    if (result.stopReason === 'error') throw new GateError(gateErrorClass(result.errorMessage));
    if (help?.type !== 'bool' || kind?.type !== 'choice' || !GATE_KINDS.includes(kind.choice as GateKind)) throw new GateError('bad_response');
    return { help: help.probability, kind: kind.choice as GateKind, kindProbability: kind.probabilities[kind.choice] ?? kind.confidence };
  };
}
