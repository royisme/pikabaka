import { AppState } from "../main"
import { safeHandle, broadcastOpenAICompatibleProvidersChanged } from "./safeHandle"

export function registerModelDiscoveryHandlers(appState: AppState): void {
  // ==========================================
  // Dynamic Model Discovery Handlers
  // ==========================================

  safeHandle("fetch-provider-models", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => {
    try {
      // Fall back to stored key if no key was explicitly provided
      let key = apiKey?.trim();
      if (!key) {
        const { CredentialsManager } = require('../services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        if (provider === 'gemini') key = cm.getGeminiApiKey();
        else if (provider === 'groq') key = cm.getGroqApiKey();
        else if (provider === 'openai') key = cm.getOpenaiApiKey();
        else if (provider === 'claude') key = cm.getClaudeApiKey();
      }

      if (!key) {
        return { success: false, error: 'No API key available. Please save a key first.' };
      }

      const { fetchProviderModels } = require('../utils/modelFetcher');
      const models = await fetchProviderModels(provider, key);
      return { success: true, models };
    } catch (error: any) {
      console.error(`[IPC] Failed to fetch ${provider} models:`, error);
      const msg = error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
      return { success: false, error: msg };
    }
  });

  safeHandle("fetch-openai-compatible-models", async (_, baseUrl: string, apiKey: string) => {
    try {
      const u = (baseUrl || '').trim();
      const k = (apiKey || '').trim();
      if (!u) {
        return { success: false, error: 'Base URL is required' };
      }
      if (!k) {
        return { success: false, error: 'API key is required' };
      }
      const { fetchOpenAICompatibleModels } = require('../utils/modelFetcher');
      const models = await fetchOpenAICompatibleModels(u, k);
      return { success: true, models };
    } catch (error: any) {
      console.error('[IPC] fetch-openai-compatible-models failed:', error);
      const msg = error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
      return { success: false, error: msg };
    }
  });

  safeHandle("get-openai-compatible-providers", async () => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      return CredentialsManager.getInstance().getOpenAICompatibleProviders();
    } catch (error: any) {
      console.error('[IPC] get-openai-compatible-providers failed:', error);
      return [];
    }
  });

  safeHandle("save-openai-compatible-provider", async (_, provider: unknown) => {
    try {
      if (
        typeof provider !== 'object' || provider === null ||
        typeof (provider as any).id !== 'string' ||
        typeof (provider as any).name !== 'string' ||
        typeof (provider as any).baseUrl !== 'string' ||
        typeof (provider as any).apiKey !== 'string'
      ) {
        return { success: false, error: 'Invalid OpenAI-compatible provider payload' };
      }
      const { CredentialsManager } = require('../services/CredentialsManager');
      const p = provider as { id: string; name: string; baseUrl: string; apiKey: string; preferredModel?: string };
      CredentialsManager.getInstance().saveOpenAICompatibleProvider({
        id: p.id,
        name: p.name.trim(),
        baseUrl: p.baseUrl.trim(),
        apiKey: p.apiKey,
        preferredModel: typeof p.preferredModel === 'string' ? p.preferredModel.trim() : undefined,
      });
      broadcastOpenAICompatibleProvidersChanged();
      return { success: true };
    } catch (error: any) {
      console.error('[IPC] save-openai-compatible-provider failed:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("delete-openai-compatible-provider", async (_, id: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().deleteOpenAICompatibleProvider(id);
      broadcastOpenAICompatibleProvidersChanged();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-provider-preferred-model", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string) => {
    try {
      const { CredentialsManager } = require('../services/CredentialsManager');
      CredentialsManager.getInstance().setPreferredModel(provider, modelId);
    } catch (error: any) {
      console.error(`[IPC] Failed to set preferred model for ${provider}:`, error);
    }
  });
}
