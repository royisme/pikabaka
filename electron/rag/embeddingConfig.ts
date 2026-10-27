import { CredentialsManager } from '../services/CredentialsManager';
import type { AppAPIConfig } from './EmbeddingProviderResolver';

/** Startup, Ollama readiness and Settings must resolve the same embedding choice. */
export function buildEmbeddingConfig(cm = CredentialsManager.getInstance()): AppAPIConfig {
  const use = cm.getEmbeddingUse();
  const connection = use.connectionId ? cm.resolveConnection(use.connectionId) : undefined;
  if (use.connectionId && !connection) throw new Error('The connection chosen for embeddings no longer exists');
  return {
    openaiKey: cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY || undefined,
    geminiKey: cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined,
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    selected: connection ? { connection, model: use.model } : undefined,
  };
}
