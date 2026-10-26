/** The model's name as the overlay shows it; ids it does not know are shown as they are. */
export function modelLabel(modelId: string): string {
  if (modelId.startsWith('ollama-')) return modelId.replace('ollama-', '');
  switch (modelId) {
    case 'gemini-3.1-flash-lite-preview': return 'Gemini 3.1 Flash';
    case 'gemini-3.1-pro-preview': return 'Gemini 3.1 Pro';
    case 'llama-3.3-70b-versatile': return 'Groq Llama 3.3';
    case 'gpt-5.4': return 'GPT 5.4';
    case 'claude-sonnet-4-6': return 'Sonnet 4.6';
    default: return modelId;
  }
}
