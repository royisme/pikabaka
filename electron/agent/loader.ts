async function named<T>(name: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    throw new Error(`Unable to load ${name}`);
  }
}

async function load() {
  const [durable, ai, models, sqlite, chord, schema, google, groq, openai, anthropic] = await Promise.all([
    named('@earendil-works/pi-durable', () => import('@earendil-works/pi-durable')),
    named('@earendil-works/pi-ai', () => import('@earendil-works/pi-ai')),
    named('@earendil-works/pi-ai/models', () => import('@earendil-works/pi-ai/models')),
    named('@earendil-works/pi-durable/storage/sqlite/node', () => import('@earendil-works/pi-durable/storage/sqlite/node')),
    named('@earendil-works/chord/context', () => import('@earendil-works/chord/context')),
    named('typebox', () => import('typebox')),
    named('@earendil-works/pi-ai/providers/google', () => import('@earendil-works/pi-ai/providers/google')),
    named('@earendil-works/pi-ai/providers/groq', () => import('@earendil-works/pi-ai/providers/groq')),
    named('@earendil-works/pi-ai/providers/openai', () => import('@earendil-works/pi-ai/providers/openai')),
    named('@earendil-works/pi-ai/providers/anthropic', () => import('@earendil-works/pi-ai/providers/anthropic')),
  ]);
  return { durable, ai, models, sqlite, chord, Type: schema.Type, google, groq, openai, anthropic };
}

export type AgentRuntime = Awaited<ReturnType<typeof load>>;
let runtime: Promise<AgentRuntime> | undefined;

export function loadAgentRuntime(): Promise<AgentRuntime> {
  return runtime ??= load();
}
