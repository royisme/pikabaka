import type { CredentialStore, Models, Model, Api } from '@earendil-works/pi-ai';
import type { CredentialsManager } from '../services/CredentialsManager';
import type { LLMHelper } from '../core/LLMHelper';
import { loadAgentRuntime } from './loader';

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

export async function resolveAgentModel(
  llmHelper: Pick<LLMHelper, 'getCurrentModel' | 'isUsingOllama'>,
  credentials?: CredentialsManager,
): Promise<AgentModelResult> {
  const unsupported = { ok: false, reason: 'The agent does not support this model' } as const;
  if (llmHelper.isUsingOllama()) return unsupported;
  const id = llmHelper.getCurrentModel();
  const cm = credentials ?? (await import('../services/CredentialsManager.js')).CredentialsManager.getInstance();
  if (cm.getMergedLlmCustomProviders().some(provider => provider.id === id)) return unsupported;
  const entry = AGENT_MODELS.find(entry => entry.pikaModel === id);
  if (!entry?.supportsTools) return unsupported;
  const credential = await createAgentCredentialStore(cm).read(entry.provider);
  if (credential?.type !== 'api_key' || !credential.key) return { ok: false, reason: 'API key not configured for the agent' };
  const models = await createAgentModels(cm);
  const catalogModel: Model<Api> | undefined = models.getModel(entry.provider, entry.modelId);
  if (!catalogModel) return unsupported;
  return { ok: true, model: { models, ref: { provider: entry.provider, modelId: entry.modelId }, supportsImages: entry.supportsImages } };
}
