import { RECOGNITION_LANGUAGES } from '../config/languages';

export const DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT =
  'You are a realtime subtitle translator. Preserve meaning, tone, technical terms, product names, numbers, and code tokens exactly when appropriate. Do not summarize, do not add explanations, and do not omit information. Return only the translated sentence(s), with no prefix/suffix and no markdown.';

function languageLabelForKey(key: string | undefined): string | undefined {
  if (!key || key === 'auto') return undefined;
  const entry = RECOGNITION_LANGUAGES[key];
  return entry?.label || key;
}

export function isTranscriptTranslationConfigured(
  enabled: boolean,
  model: string,
  prompt: string
): boolean {
  return !!enabled && !!model.trim() && !!prompt.trim();
}

export function buildTranscriptTranslationPrompt(
  basePrompt: string,
  sourceText: string,
  opts?: { sourceLanguageKey?: string; targetLanguageKey?: string }
): string {
  const prompt = basePrompt.trim() || DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT;
  const source = sourceText.trim();
  const targetLabel = languageLabelForKey(opts?.targetLanguageKey);
  const sourceLabel = languageLabelForKey(opts?.sourceLanguageKey);

  let direction = '';
  if (targetLabel) {
    if (sourceLabel) {
      direction = `Translate from ${sourceLabel} to ${targetLabel}.\n\n`;
    } else {
      direction = `Translate into ${targetLabel}. Infer the source language from the text.\n\n`;
    }
  }

  return `${direction}${prompt}\n\nSource text:\n${source}\n\nOutput requirements:\n- Return translated text only\n- No explanations\n- No markdown`;
}
