export function sanitizeChatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const withoutHtml = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const providerMatch = withoutHtml.match(/OpenAI-compatible provider ([^ ]+) failed \((\d+)\)/i);
  if (providerMatch) {
    const [, provider, statusCode] = providerMatch;
    const retryHint = Number(statusCode) >= 500
      ? 'Provider server error. Try again, switch models, or check the provider status.'
      : 'Check provider settings and try again.';
    return `OpenAI-compatible provider ${provider} failed (${statusCode}). ${retryHint}`;
  }

  if (/Internal Server Error/i.test(withoutHtml) && /nginx/i.test(withoutHtml)) {
    return 'Provider server returned 500 Internal Server Error. Try again or switch providers.';
  }

  return withoutHtml || 'Unknown error';
}
