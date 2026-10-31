/**
 * The two button looks shared by every settings page. The filled pair (`primary` with
 * `on-primary`) is the commit action of a section; the bordered one is everything else, so a
 * Save reads as a button and the same action looks the same on every page. The keyboard ring is
 * the global :focus-visible rule in `src/index.css`, repeated here so the button keeps it.
 */
export const primaryButton = 'min-h-9 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-on-primary transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButton = 'min-h-9 rounded-lg border border-outline bg-bg-component px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-input hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary disabled:cursor-not-allowed disabled:opacity-50';
