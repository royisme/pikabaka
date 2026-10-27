async function named<T>(name: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    throw new Error(`Unable to load ${name}`);
  }
}

async function load() {
  const [durable, ai, models, sqlite, chord, schema, openAICompletionsApi, anthropicApi, googleApi, systemOne] = await Promise.all([
    named('@earendil-works/pi-durable', () => import('@earendil-works/pi-durable')),
    named('@earendil-works/pi-ai', () => import('@earendil-works/pi-ai')),
    named('@earendil-works/pi-ai/models', () => import('@earendil-works/pi-ai/models')),
    named('@earendil-works/pi-durable/storage/sqlite/node', () => import('@earendil-works/pi-durable/storage/sqlite/node')),
    named('@earendil-works/chord/context', () => import('@earendil-works/chord/context')),
    named('typebox', () => import('typebox')),
    named('@earendil-works/pi-ai/api/openai-completions.lazy', () => import('@earendil-works/pi-ai/api/openai-completions.lazy')),
    named('@earendil-works/pi-ai/api/anthropic-messages.lazy', () => import('@earendil-works/pi-ai/api/anthropic-messages.lazy')),
    named('@earendil-works/pi-ai/api/google-generative-ai.lazy', () => import('@earendil-works/pi-ai/api/google-generative-ai.lazy')),
    named('@earendil-works/pi-ai/api/typesafe-system-one.lazy', () => import('@earendil-works/pi-ai/api/typesafe-system-one.lazy')),
  ]);
  return { durable, ai, models, sqlite, chord, Type: schema.Type, openAICompletionsApi, anthropicApi, googleApi, systemOne };
}

export type AgentRuntime = Awaited<ReturnType<typeof load>>;
let runtime: Promise<AgentRuntime> | undefined;

export function loadAgentRuntime(): Promise<AgentRuntime> {
  return runtime ??= load();
}
