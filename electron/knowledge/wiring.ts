import type Database from "better-sqlite3"
import { KnowledgeOrchestrator } from "./KnowledgeOrchestrator"
import { KnowledgeDatabaseManager } from "./KnowledgeDatabaseManager"
import type { RAGManager } from "../rag/RAGManager"
import type { LLMHelper } from "../core/LLMHelper"

/** Builds the orchestrator, gives it the embedding pipeline of the RAG manager and attaches it to the LLM helper. */
export function createKnowledgeOrchestrator(
  sqliteDb: Database.Database,
  getRagManager: () => RAGManager | null,
  llmHelper: LLMHelper,
): KnowledgeOrchestrator {
  const orchestrator = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(sqliteDb));

  // Embedding function — lazily delegate to the cascaded EmbeddingPipeline
  // (OpenAI → Gemini → Ollama → Local bundled model).
  // We await waitForReady() so uploads during boot wait for the pipeline
  // instead of immediately throwing 'not ready'.
  orchestrator.setEmbeddingStatusFn(() => getRagManager()?.getEmbeddingPipeline().getStatus() ?? null);
  orchestrator.setEmbedFn(async (text: string) => {
    const pipeline = getRagManager()?.getEmbeddingPipeline();
    if (!pipeline) throw new Error('RAG pipeline not available');
    await pipeline.waitForReady();
    const { providerName, dimensions } = pipeline.getStatus();
    if (!providerName || !dimensions) throw new Error('Embedding provider not initialized');
    const embedding = await pipeline.getEmbedding(text);
    return { embedding, provider: providerName, dimensions };
  });
  orchestrator.setEmbedQueryFn(async (text: string) => {
    const pipeline = getRagManager()?.getEmbeddingPipeline();
    if (!pipeline) throw new Error('RAG pipeline not available');
    await pipeline.waitForReady();
    const { providerName, dimensions } = pipeline.getStatus();
    if (!providerName || !dimensions) throw new Error('Embedding provider not initialized');
    const embedding = await pipeline.getEmbeddingForQuery(text);
    return { embedding, provider: providerName, dimensions };
  });

  llmHelper.setKnowledgeOrchestrator(orchestrator);
  return orchestrator;
}
