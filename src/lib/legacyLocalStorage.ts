/** Keys written by earlier builds, mapped to their current names. */
export const LEGACY_LOCALSTORAGE_KEYS: [string, string][] = [
  ["natively_resolved_theme", "pika_resolved_theme"],
  ["natively_interviewer_transcript", "pika_them_transcript"],
  ["natively_hideChatHidesWidget", "pika_hideChatHidesWidget"],
  ["natively_undetectable", "pika_undetectable"],
  ["natively_overlay_opacity", "pika_overlay_opacity"],
  ["natively_last_meeting_start", "pika_last_meeting_start"],
  ["natively_show_profile_toaster", "pika_show_profile_toaster"],
  ["natively_feature_interest", "pika_feature_interest"],
  ["natively_groq_fast_text", "pika_groq_fast_text"],
  ["natively_has_launched", "pika_has_launched"],
  ["natively_user_name", "pika_user_name"],
  ["pika_interviewer_transcript", "pika_them_transcript"],
];

type LocalStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function migrateLegacyLocalStorage(storage: LocalStorageLike): void {
  try {
    for (const [legacy, next] of LEGACY_LOCALSTORAGE_KEYS) {
      const v = storage.getItem(legacy);
      if (v !== null && storage.getItem(next) === null) {
        storage.setItem(next, v);
        storage.removeItem(legacy);
      }
    }
  } catch {
    /* ignore */
  }
}
