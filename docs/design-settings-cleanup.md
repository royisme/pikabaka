# Settings cleanup

Status: decided by the owner on 2026-10-27, built on branch `settings-cleanup` (stacked on `update-card`). The evidence is a source-only audit of the Settings panel and every keyboard shortcut at commit `b73679c`. This file holds the decisions; `TASKS.md` has the steps and `PROGRESS.md` what landed.

The owner's rules for this change: use the audit's recommendation, delete what is not needed, and do not care about users of old versions. So there is no migration, no alias for a removed id and no tolerated leftover value. A stale `keybinds.json` entry for an id that no longer exists is ignored by the existing loader, and that is enough.

## What the audit found about shortcuts

- All 22 managed shortcuts had a working handler; the problem was not dead code but how many there were. All were OS-wide global, six of them even in launcher mode, so they could collide with other apps during a call.
- Three of them did the same thing (`Mod+1`, `Mod+5`, `Mod+Enter` all ran "What to say"; the label of `Mod+5`, "Answer / Record", promised a recording that never happens).
- The recorder in Settings is click-only, has no cancel or clear, records Escape as a key, swaps a conflicting binding silently, and a failed OS registration is only logged.

## Decision: shortcuts

Default-bound, global, overlay mode (only Toggle Visibility is global in launcher mode too):

| id | keys | what |
| --- | --- | --- |
| `general:toggle-visibility` | `Mod+B` | show or hide the window |
| `general:toggle-mouse-passthrough` | `Mod+Shift+B` | click-through on or off |
| `chat:whatToAnswer` | `Mod+1` | What to say |
| `general:selective-screenshot` | `Mod+Shift+H` | capture a chosen area |
| `translation:toggle` | `Mod+Alt+T` (Windows `Ctrl+Shift+F9`) | live translation on or off |
| `general:reset-cancel` | `Mod+R` | stop generating |

Kept but unbound by default (a user can bind them in Settings): `translation:toggle-original`, `window:move-up`, `window:move-down`, `window:move-left`, `window:move-right`.

Removed with their handlers, hints and Settings rows (every one still has a visible button or a typed request): `general:process-screenshots`, `general:capture-and-process`, `general:take-screenshot`, `chat:clarify`, `chat:dynamicAction4`, `chat:followUp`, `chat:answer`, `chat:codeHint`, `chat:brainstorm`, `chat:scrollUp`, `chat:scrollDown`. Also removed: the renderer's orphan mappings (`autoAnswerMode`, `shorten`, `recap`, `app:toggle-global-overlay` in `src/hooks/useShortcuts.ts`), the load-time id aliases in `KeybindManager` (`chat:recap`, `chat:followup`), the unused `src/components/settings/Sidebar.tsx`, and the DEV-only `Mod+S` donation shortcut in `SupportToaster.tsx`. The DEV update shortcuts in `UpdateBanner.tsx` stay.

The recorder stays editable (a read-only list would leave a user with no way out of a collision), but it is fixed:

- It is a real button: Enter or Space (or a click) starts recording. Escape cancels without saving, and a Clear button unbinds.
- A binding that another Pika action already uses is refused with a message that names that action. It is never swapped silently.
- If the OS refuses a global registration (another app owns the chord), the row says so in words and the value is not saved. At startup, a binding that fails to register shows the same words in Settings (`registered` flag on the list the main process returns).
- The shortcut IPC channels keep their names; the responses gain an `error` text and the list gains `registered`. These are additive.

Persisted shape: `userData/keybinds.json` stays a full array of `{ id, accelerator }`. Nothing new is stored.

## Decision: copy that was false, and one bug

- Soniox: the Save button looked its key up in a table that had no Soniox entry, so it always saved an empty string. One shared table now serves the field, the enabled check and the click. No Get-API-Key link is shown for Soniox (no verified URL).
- Proactive help: the copy said the default is "Log only"; the code default is on. The copy now says what the code does, and the test result wording no longer says "A card would show" when it only compared a threshold. The defaults themselves do not change.
- Speech test and labels: a "Connected" test says what it checked (the key is accepted), not the selected model or language. ElevenLabs no longer counts a network failure as success. Deepgram and OpenAI descriptions match the runtime (streaming, configurable model).
- Stealth copy: the dead "Supported apps here" button is removed; the wording is qualified by platform and separates the window disguise from capture exclusion, and says that the disguise applies immediately. No behaviour changes.
- Other wording that did not match the code: "Interviewer Transcript" hides the whole transcript, "AI response language" does not cover everything it says, the translation source hint is not "only a hint", and About says transcription runs locally. Fixed to say what the code does. The key `pika_interviewer_transcript` keeps its name.

## Steps

1. A, copy and the Soniox bug (the two sections above). Files: `src/components/SettingsOverlay.tsx`, `src/components/settings/ProactiveHelpSettings.tsx`, `src/components/AboutSection.tsx`, `electron/ipc/stt.ts`.
2. B, shortcuts and recorder (the first sections). Files: `electron/services/KeybindManager.ts`, `electron/main.ts`, `src/hooks/useShortcuts.ts`, `src/components/PikaInterface.tsx`, `src/components/ui/KeyRecorder.tsx`, the shortcut part of `src/components/SettingsOverlay.tsx`, preload and types for the keybind channels, `README.md`, `docs/`.
3. C, after A and B are merged into the branch: audio settings reordered (devices and permissions first, then a short translation setup; advanced segmentation and prompts collapsed; the workspace choice moved next to the agent) and the retired opacity preview removed.

## Not in this change

Changing proactive-help defaults, translation language synchronization between Settings and the overlay, splitting `SettingsOverlay.tsx` into files beyond what step C needs, STT or LLM behaviour, content protection and window flags.

## What the owner must check by hand

Automated checks cannot do these, and the agent did not run them:

1. With another app focused, press each of the six default shortcuts. Try a chord another app owns and confirm Settings says so in words.
2. In Settings, record a shortcut with the keyboard only, cancel with Escape, clear one, and try a chord Pika already uses.
3. Soniox: enter a key, press Save, restart, and confirm it is stored. This needs a real Soniox account.
4. Read the new wording in Settings against what you see.
5. Step C: the audio page in both themes at the normal Settings width.
