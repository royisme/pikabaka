import { RECOGNITION_LANGUAGES } from '../config/languages';

export const DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT =
  'You are a realtime subtitle translator. Preserve meaning, tone, technical terms, product names, numbers, and code tokens exactly when appropriate. Do not summarize, do not add explanations, and do not omit information. Return only the translated sentence(s), with no prefix/suffix and no markdown.';

function languageLabelForKey(key: string | undefined): string | undefined {
  if (!key || key === 'auto') return undefined;
  const entry = RECOGNITION_LANGUAGES[key];
  return entry?.label || key;
}

/** Normalize a language key/code to its base ISO 639 code (e.g. 'english-us' → 'en', 'zh-CN' → 'zh'). */
export function normalizeLanguageToIso639(key: string | undefined): string | undefined {
  if (!key || key === 'auto') return undefined;
  const entry = RECOGNITION_LANGUAGES[key];
  if (entry?.iso639) return entry.iso639.toLowerCase();
  return key.toLowerCase().split(/[-_]/)[0] || undefined;
}

/** Whether two language identifiers refer to the same base language. */
export function isSameLanguage(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeLanguageToIso639(a);
  const nb = normalizeLanguageToIso639(b);
  return !!na && !!nb && na === nb;
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
  opts?: {
    sourceLanguageKey?: string;
    targetLanguageKey?: string;
    detectedLanguageKey?: string;
    context?: Array<{ source: string; translation: string }>;
  }
): string {
  const prompt = basePrompt.trim() || DEFAULT_TRANSCRIPT_TRANSLATION_PROMPT;
  const source = sourceText.trim();
  const targetLabel = languageLabelForKey(opts?.targetLanguageKey);
  const detectedLabel = languageLabelForKey(opts?.detectedLanguageKey);
  const sourceLabel = languageLabelForKey(opts?.sourceLanguageKey);
  const hintLabel = detectedLabel || sourceLabel;

  let direction = '';
  if (targetLabel) {
    direction = `Translate the source text into ${targetLabel}. Auto-detect the source language. If the source is already in ${targetLabel}, return it unchanged verbatim.`;
    if (hintLabel) {
      direction += ` (Likely source language: ${hintLabel}, but trust the actual text.)`;
    }
    direction += '\n\n';
  } else {
    direction = `Translate the source text. Auto-detect the source language. If unsure of target, default to English.\n\n`;
  }

  let contextBlock = '';
  if (opts?.context && opts.context.length > 0) {
    const lines = opts.context
      .map((turn, index) => `[${index + 1}] Source: ${turn.source}\n    Translation: ${turn.translation}`)
      .join('\n');
    contextBlock = `Recent conversation (context for terminology and pronoun consistency ONLY — do not translate or repeat it in your output):\n${lines}\n\n`;
  }

  return `${direction}${contextBlock}${prompt}\n\nSource text:\n${source}\n\nOutput requirements:\n- Return translated text only\n- No explanations\n- No markdown\n- If source already matches the target language, return the source text unchanged`;
}
