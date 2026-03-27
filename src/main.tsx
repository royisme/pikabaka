import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

const LEGACY_LOCALSTORAGE_KEYS: [string, string][] = [
  ["natively_resolved_theme", "pika_resolved_theme"],
  ["natively_interviewer_transcript", "pika_interviewer_transcript"],
  ["natively_hideChatHidesWidget", "pika_hideChatHidesWidget"],
  ["natively_undetectable", "pika_undetectable"],
  ["natively_overlay_opacity", "pika_overlay_opacity"],
  ["natively_last_meeting_start", "pika_last_meeting_start"],
  ["natively_show_profile_toaster", "pika_show_profile_toaster"],
  ["natively_feature_interest", "pika_feature_interest"],
  ["natively_groq_fast_text", "pika_groq_fast_text"],
  ["natively_has_launched", "pika_has_launched"],
  ["natively_user_name", "pika_user_name"],
];

function migrateLegacyLocalStorage(): void {
  try {
    for (const [legacy, next] of LEGACY_LOCALSTORAGE_KEYS) {
      const v = localStorage.getItem(legacy);
      if (v !== null && localStorage.getItem(next) === null) {
        localStorage.setItem(next, v);
        localStorage.removeItem(legacy);
      }
    }
  } catch {
    /* ignore */
  }
}

migrateLegacyLocalStorage();

const THEME_CACHE_KEY = "pika_resolved_theme";

// Set platform attribute synchronously — before React renders — so CSS selectors
// like html[data-platform="win32"] work immediately without a flash on first paint.
document.documentElement.setAttribute(
  'data-platform',
  window.electronAPI?.platform ?? process?.platform ?? ''
);

// Step 1: Apply cached theme synchronously — before React renders.
// This ensures useResolvedTheme()'s initial useState read sees the correct value.
const cachedTheme = localStorage.getItem(THEME_CACHE_KEY) as 'light' | 'dark' | null;
document.documentElement.setAttribute('data-theme', cachedTheme ?? 'dark');

// Step 2: Confirm/correct from main process (authoritative) and keep cache in sync.
if (window.electronAPI?.getThemeMode) {
  window.electronAPI.getThemeMode().then(({ resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem(THEME_CACHE_KEY, resolved);
  });

  window.electronAPI?.onThemeChanged?.(({ resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem(THEME_CACHE_KEY, resolved);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
