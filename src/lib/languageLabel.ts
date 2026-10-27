const SHORT_LABELS: Record<string, string> = {
  chinese: '中文',
  japanese: '日本語',
  korean: '한국어',
  russian: 'RU',
  spanish: 'ES',
  french: 'FR',
  german: 'DE',
  italian: 'IT',
  portuguese: 'PT',
  turkish: 'TR',
};

/**
 * A language in at most four characters, for the top bar where "Chinese (Simplified)" would be
 * cut off. The menu behind it shows the full names. Every `english-*` variant is "EN".
 */
export function shortLanguageLabel(value: string, fullLabel?: string): string {
  if (value.startsWith('english')) return 'EN';
  const known = SHORT_LABELS[value];
  if (known) return known;
  const letters = (fullLabel || value).replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
  return letters || value.slice(0, 4);
}
