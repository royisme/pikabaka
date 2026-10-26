import type { CredentialStore, Models, Model, Api } from '@earendil-works/pi-ai';
import type { CredentialsManager } from '../services/CredentialsManager';
import type { LLMHelper } from '../core/LLMHelper';
import { loadAgentRuntime } from './loader';
import { GateError, type GateClassify, type GateErrorClass, type GateKind } from './gate';

type Credentials = Pick<CredentialsManager,
  'getGeminiApiKey' | 'getGroqApiKey' | 'getOpenaiApiKey' | 'getClaudeApiKey'>;

export function createAgentCredentialStore(credentials: Credentials): CredentialStore {
  const readers: Record<string, () => string | undefined> = {
    google: () => credentials.getGeminiApiKey(),
    groq: () => credentials.getGroqApiKey(),
    openai: () => credentials.getOpenaiApiKey(),
    anthropic: () => credentials.getClaudeApiKey(),
  };
  return {
    async read(providerId) {
      const key = Object.hasOwn(readers, providerId) ? readers[providerId]()?.trim() : undefined;
      return key ? { type: 'api_key', key } : undefined;
    },
    async list() {
      return Object.keys(readers).filter(id => readers[id]()?.trim()).map(providerId => ({ providerId, type: 'api_key' as const }));
    },
    async modify() { throw new Error('Agent credentials are read-only'); },
    async delete() { throw new Error('Agent credentials are read-only'); },
  };
}

export const AGENT_MODELS = [
  { pikaProvider: 'gemini', pikaModel: 'gemini-3.1-flash-lite-preview', provider: 'google', modelId: 'gemini-3.1-flash-lite-preview', supportsTools: true, supportsImages: true },
  { pikaProvider: 'gemini', pikaModel: 'gemini-3.1-pro-preview', provider: 'google', modelId: 'gemini-3.1-pro-preview', supportsTools: true, supportsImages: true },
  { pikaProvider: 'groq', pikaModel: 'llama-3.3-70b-versatile', provider: 'groq', modelId: 'llama-3.3-70b-versatile', supportsTools: true, supportsImages: false },
  { pikaProvider: 'openai', pikaModel: 'gpt-5.4', provider: 'openai', modelId: 'gpt-5.4', supportsTools: true, supportsImages: true },
  { pikaProvider: 'claude', pikaModel: 'claude-sonnet-4-6', provider: 'anthropic', modelId: 'claude-sonnet-4-6', supportsTools: true, supportsImages: true },
] as const;

export interface AgentModel {
  models: Models;
  ref: { provider: string; modelId: string };
  supportsImages: boolean;
}
export type AgentModelResult = { ok: true; model: AgentModel } | { ok: false; reason: string };
export interface ModelConfigSource { resolve(): Promise<AgentModelResult> }

// Returning undefined from the store alone allows ambient auth. Deny it at the collection boundary too.
export async function createAgentModels(credentials: Credentials): Promise<Models> {
  const runtime = await loadAgentRuntime();
  const models = runtime.models.createModels({
    credentials: createAgentCredentialStore(credentials),
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  models.setProvider(runtime.google.googleProvider());
  models.setProvider(runtime.groq.groqProvider());
  models.setProvider(runtime.openai.openaiProvider());
  models.setProvider(runtime.anthropic.anthropicProvider());
  return models;
}

// Pika lets the user pick any model of a provider; the agent runs the picked model when pi-ai knows it,
// otherwise that provider's default, so a key is all that decides whether the agent works.
function providerOf(id: string): 'google' | 'groq' | 'openai' | 'anthropic' | undefined {
  if (id.startsWith('gemini-') || id.startsWith('models/')) return 'google';
  if (id.startsWith('claude-')) return 'anthropic';
  if (id.startsWith('gpt-') || id.startsWith('o1-') || id.startsWith('o3-') || id.includes('openai')) return 'openai';
  if (id.startsWith('llama-') || id.startsWith('mixtral-') || id.startsWith('gemma-')) return 'groq';
  return undefined;
}

export async function resolveAgentModel(
  llmHelper: Pick<LLMHelper, 'getCurrentModel' | 'isUsingOllama'>,
  credentials?: CredentialsManager,
): Promise<AgentModelResult> {
  const unsupported = { ok: false, reason: 'The agent does not support this model' } as const;
  if (llmHelper.isUsingOllama()) return unsupported;
  const id = llmHelper.getCurrentModel();
  const cm = credentials ?? (await import('../services/CredentialsManager.js')).CredentialsManager.getInstance();
  if (cm.getMergedLlmCustomProviders().some(provider => provider.id === id)) return unsupported;
  const provider = providerOf(id);
  const fallback = AGENT_MODELS.find(entry => entry.provider === provider);
  if (!provider || !fallback?.supportsTools) return unsupported;
  const credential = await createAgentCredentialStore(cm).read(provider);
  if (credential?.type !== 'api_key' || !credential.key) return { ok: false, reason: 'API key not configured for the agent' };
  const models = await createAgentModels(cm);
  const modelId = models.getModel(provider, id) ? id : fallback.modelId;
  const catalogModel: Model<Api> | undefined = models.getModel(provider, modelId);
  if (!catalogModel) return unsupported;
  return { ok: true, model: { models, ref: { provider, modelId }, supportsImages: fallback.supportsImages } };
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
