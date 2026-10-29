import { AppState } from "../main"
import { safeHandle } from "./safeHandle"
import { testTranslation } from "../lib/transcript-assembler"

export function registerTranslationHandlers(appState: AppState): void {
  safeHandle("get-transcript-translation-settings", async () => {
    const { CredentialsManager } = require('../services/CredentialsManager');
    const cm = CredentialsManager.getInstance();
    return {
      enabled: cm.getTranscriptTranslationEnabled(),
      provider: cm.getTranscriptTranslationProvider(),
      model: cm.getTranscriptTranslationModel(),
      prompt: cm.getTranscriptTranslationPrompt(),
      displayMode: cm.getTranscriptTranslationDisplayMode(),
      sourceLanguage: cm.getTranscriptTranslationSourceLanguage(),
      targetLanguage: cm.getTranscriptTranslationTargetLanguage(),
    };
  });

  safeHandle("set-transcript-translation-settings", async (_, settings: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    prompt?: string;
    displayMode?: 'original' | 'translated' | 'both';
    sourceLanguage?: string;
    targetLanguage?: string;
  }) => {
    const { CredentialsManager } = require('../services/CredentialsManager');
    const cm = CredentialsManager.getInstance();
    if (typeof settings?.enabled === 'boolean') {
      cm.setTranscriptTranslationEnabled(settings.enabled);
    }
    if (settings?.provider) {
      cm.setTranscriptTranslationProvider(settings.provider);
    }
    if (typeof settings?.model === 'string') {
      cm.setTranscriptTranslationModel(settings.model.trim());
    }
    if (typeof settings?.prompt === 'string') {
      cm.setTranscriptTranslationPrompt(settings.prompt);
    }
    if (settings?.displayMode) {
      cm.setTranscriptTranslationDisplayMode(settings.displayMode);
    }
    if (typeof settings?.sourceLanguage === 'string') {
      cm.setTranscriptTranslationSourceLanguage(settings.sourceLanguage);
    }
    if (typeof settings?.targetLanguage === 'string') {
      cm.setTranscriptTranslationTargetLanguage(settings.targetLanguage);
    }
    return { success: true };
  });

  safeHandle("translate-transcript-segment", async (_, segment: {
    segmentId: string;
    text: string;
    speaker?: 'them' | 'user';
    speakerLabel?: string;
    timestamp?: number;
  }) => {
    return appState.translateTranscriptSegment(segment);
  });

  // Runs a sample through the settings as shown (saved or not) and reports the speed.
  safeHandle("test-transcript-translation", async (_, draft: { provider: string; model: string; prompt?: string; targetLanguage: string }) => {
    if (typeof draft?.provider !== 'string' || typeof draft?.model !== 'string' || typeof draft?.targetLanguage !== 'string') {
      return { success: false, sample: '', error: 'Choose a model and a target language first.' };
    }
    return testTranslation(appState, draft);
  });
}
