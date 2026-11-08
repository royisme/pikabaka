// ProcessingHelper.ts

import { AppState } from "../main"
import { LLMHelper } from "../core/LLMHelper"
import { CredentialsManager } from "../services/CredentialsManager"
import { buildEmbeddingConfig } from "../rag/embeddingConfig"
import { app } from "electron"
// import dotenv from "dotenv" // Removed static import

if (!app.isPackaged) {
  require("dotenv").config()
}

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper

  constructor(appState: AppState) {
    this.appState = appState

    this.llmHelper = new LLMHelper()
  }

  /**
   * Load stored credentials from CredentialsManager
   * Should be called after app.whenReady() when CredentialsManager is initialized
   */
  public loadStoredCredentials(): void {
    const credManager = CredentialsManager.getInstance();

    // CRITICAL: Re-initialize IntelligenceManager now that keys are loaded
    // This fixes the issue where buttons don't work in production because of late key loading
    this.appState.getIntelligenceManager().initializeLLMs();

    // CRITICAL: Initialize RAGManager (Embeddings) with loaded keys
    // This fixes "RAG unavailable" in production where process.env is empty
    const ragManager = this.appState.getRAGManager();
    if (ragManager) {
      console.log("[ProcessingHelper] Initializing RAGManager embeddings with available keys");
      ragManager.initializeEmbeddings(buildEmbeddingConfig(credManager));

      // CRITICAL: Retry pending embeddings now that we have a key
      // This ensures any meetings that failed or were queued during startup get processed
      console.log("[ProcessingHelper] Retrying pending embeddings...");
      ragManager.retryPendingEmbeddings().catch(console.error);

      // CRITICAL: Ensure demo meeting has chunks
      ragManager.ensureDemoMeetingProcessed().catch(console.error);

      // CRITICAL: Cleanup stale queue items to prevent "Chunk not found" errors
      ragManager.cleanupStaleQueueItems();
    }

    // Load Languages
    const aiResponseLanguage = credManager.getAiResponseLanguage();
    
    if (aiResponseLanguage) {
      this.llmHelper.setAiResponseLanguage(aiResponseLanguage);
    }
  }

  public getLLMHelper() {
    return this.llmHelper;
  }
}
