# PROGRESS

What is done, what is broken, what is unverified. `TASKS.md` is what to do next; GitHub issues hold the evidence. Add to the top when a step lands or something breaks.

## 2026-10-26: R1 timing, R2 streaming, T9 tokens in the slot (branch `translation-streaming`, issues #29, #30)

Done (covers R1, R2 and T9; R4's module is on the branch below it)
- **Streaming (R2, T9).** `translateTranscriptText` takes an optional `onProgress`; with it, each of the six providers (OpenAI, Claude, Gemini, Groq, Ollama, OpenAI-compatible) is requested as a stream and read through small adapters in `electron/transcript/translationStream.ts` (OpenAI-shaped chunks, Anthropic `text_delta` events, Gemini chunks, Ollama NDJSON with lines split across chunks and multi-byte characters). The first text is reported at once, later text at most every 80 ms. If a stream fails before any text (an endpoint that cannot stream), the request is made once more without streaming; after text has been shown the failure stands. The main process sends the text so far as `translationState: 'streaming'` events; the row shows it as the translation, in the reserved line, growing downward.
- **Timing (R1).** Every translation logs one line of numbers: provider, model, flush gap (end of speech to request start), first-token time, total time, source and output length, streamed or not, outcome. No text is logged.
- **R3 / T10 decision.** A streamed LLM answer is append-only, so what is shown is already committed; a separate preview is only needed when text is translated before its source is final (#33). R3 and T10 stay open for that, not for this.
- **R4 (the masker module) is ported, not wired.** `electron/transcript/entityMasker.ts` and its 153 tests came from a subagent and were re-run here (all pass), with a smoke test of URL, path, flag, snake_case, CJK-glued flag and a model that reorders or drops a placeholder. It is not in the request path: transcripts are speech, which rarely contains URLs, paths or flags, and masking changes the prompt for every request. Wire it when a real transcript shows the need.
- Verified: both `tsc --noEmit` checks exit 0; tap 652 of 652 (adapter and timing tests with fake streams; no real provider was called).
- Not verified: any real provider. The wire formats are written from the SDK types and the documented stream shapes, and the SDK types accept them, but a live OpenAI, Anthropic, Gemini, Groq, Ollama or compatible endpoint was not called; the fallback to non-streaming and the 80 ms throttle have not been seen in the running app. The latency numbers for #29 do not exist yet: run a short call with each provider and read the `[Translation] timing` lines.
- Known cost: a streaming request sends one IPC event per throttle tick; a long translation is a few dozen events.

## 2026-10-26: U7 overlay height and splitter (branch `overlay-size`, issues #22, #26)

Done
- The overlay opens at 420px tall (was `max(current, 216)`, and a fresh window is 1px tall, so 216), or at the height the user last left it: a resize is saved to `overlay-size.json` in the user data folder (500 ms after it settles; anything under 200px is not remembered) and read the next time the overlay opens. It never exceeds the screen's work area.
- The splitter is `no-drag` (so the overlay's drag region should no longer take its mouse events), is a `role="separator"` with a value, is keyboard-resizable (arrow keys, 2% a step, 10% with Shift) and resets on double-click. The 1-second IPC poll for the passthrough state is replaced by the existing change event.
- The default split is 55% for the transcript while translation is on and 40% otherwise, until the user moves it; the split was written to `localStorage` on every launch before, so a default could never be told from a choice. Double-click on the splitter forgets the user's split.
- Verified: both `tsc --noEmit` checks exit 0; tap 477 of 477. No new unit test: the window code imports Electron and the splitter change is event wiring.
- Not verified: everything visible. The opening height; that the splitter now drags on both platforms (U0 was never run, so this was inferred from the Electron drag-region rule, not observed); that `resized` fires on Windows and macOS after a drag; the 55% default with translation on.
- Not done from the issue: a `min-h` for the message area and collapsing the chips and footer when the window is short. The input and footer stay visible and the answer list gives way first, which seemed the safer failure for a short window; at 420px there is room.

## 2026-10-26: U8 conversation-area gaps (branch `conversation-gaps`, issue #27)

Done (checklist of #27)
- [x] Copy is visible: the latest finished answer has a "Copy" button under it; older answers keep the hover button, now also shown on keyboard focus and named ("Copy answer").
- [x] Enter no longer submits during IME composition (done in U3). The fake placeholder is a real `placeholder`, the input uses the sans font, and it has an accessible name.
- [x] The action row no longer clips its first chip at 380px: it scrolls from the start when it overflows and stays centred when it fits (auto margins on the first and last child).
- [x] Stop needs a second press within 3 seconds (the button turns red and says "Press again to stop and quit").
- [x] Model, Settings, Click-through (with `aria-pressed`) and Send have accessible names.
- [x] Failures are `isError` messages in the danger colour, without the emoji prefix.
- [x] `SuggestionOverlay` (no importers) is deleted; `KeyBadge` is now used by the primary button.
- Verified: both `tsc --noEmit` checks exit 0; tap 477 of 477 (no new test: markup and styling).
- Not done: stopping a running stream and a Retry on a failed answer (both need the main process to cancel or replay the request; `resetCancel` still only hides the dots); the 24px/32px logo that opens the dashboard mid-call. Not verified: any of this in the running app, including the 380px row, the error colour on both themes and the Stop arming.
- The shortcut hint that was drawn inside the empty input ("⌘⇧H for selective screenshot") is gone with the fake placeholder; the shortcut still works and is listed in Settings.

## 2026-10-26: U3 one primary action (branch `one-primary-action`, issue #23)

Done
- "Guide me" and "Answer" were the same action. There is now one primary button, "What to say", in the primary colour with its shortcut shown (`KeyBadge`, the first real use of that component). Clarify, Recap/Ideas and Follow-up stay as secondary chips.
- The dead push-to-talk UI is gone: the "Stop" and "Listening…" branches and the `isManualRecording`, `manualTranscript`, `voiceInput` and `handleAnswerNow` props through `PikaInterface`, `ChatColumn` and `ChatPanel`.
- Typed text goes with Enter (as before); Enter no longer submits while an IME is composing. The hint under attached screenshots now says "Type a question and press Enter, or use What to say" instead of the wrong "click Answer".
- Verified: both `tsc --noEmit` checks exit 0; tap 477 of 477 (no new test: the change is markup and prop removal, with no logic to assert).
- Not verified: the layout at 380px (the primary button with its key badge is wider than the old chips; the row still scrolls horizontally and is not fixed until U8); the IME guard with a real Chinese or Japanese input method.
- Left in place: the `chat:answer` shortcut (Cmd+5) still exists and still runs what-to-say, so two shortcuts do the same thing; and `useMeetingAudio` still keeps the unused manual-recording state. Both are worth deleting in a separate step with the owner's say-so, since they touch the shortcut table and the audio hook.

## 2026-10-26: T7 global translation shortcuts (branch `translation-shortcuts`, epic #38)

Done
- Two new rebindable global shortcuts (owner approved 2026-10-26): `translation:toggle` (turn translation on or off) and `translation:toggle-original` (show or hide the original text). macOS and Linux default to Cmd/Ctrl+Alt+T and Cmd/Ctrl+Alt+O; Windows defaults to Ctrl+Shift+F9 and Ctrl+Shift+F10 because Ctrl+Alt is AltGr on many layouts. They register in overlay mode only, like the other chat shortcuts, so they work while the overlay is not focused.
- Flow: main process `onShortcutTriggered` sends `global-shortcut` with `toggleTranslation` or `toggleOriginal`; the overlay calls the same `saveTranslationSettings` as the header buttons. The translation toggle does nothing while no model is set.
- Settings > Shortcuts lists both so they can be rebound (`useShortcuts` maps both ids in both directions).
- Verified: both `tsc --noEmit` checks exit 0; tap passes. No new unit test: `KeybindManager` imports Electron and cannot be loaded by the tap runner.
- Not verified: that either shortcut fires while another app has focus (macOS and Windows); that Cmd+Alt+T or Cmd+Alt+O is free of a system or other-app binding on the owner's machine; the Windows defaults on a real keyboard (the spec asked for them to be picked on one); the rebinding UI with F-keys (the key recorder was not checked for F9/F10).

## 2026-10-26: T8 error reason on the translation event (branch `translation-error-reason`, epic #38)

Done
- A failed translation now carries a reason. `classifyTranslationError` (`electron/transcript/translationError.ts`) reduces any error to `timeout`, `auth`, `rate-limit`, `network` or `other` from the status, code, name and message. Only that reason leaves the function: the main process logs the reason alone (it used to log the provider's message, which can echo the request) and sends it on the `native-audio-transcript` event as the optional `translationError`. The `error` return of the manual-translate call is the reason too.
- The renderer keeps the reason while the state is `error` and clears it on retry. The failed slot reads "Translation failed · timed out" (or "check the API key", "rate limited", "no connection"; nothing extra for `other`).
- This is the additive IPC payload change the owner approved on 2026-10-26; old readers ignore the field. Types updated in `electron/preload/types.ts` and `src/types/electron.d.ts`.
- Verified: both `tsc --noEmit` checks exit 0; tap passes (23 new assertions for the classifier, slot reasons and the segment field).
- Not verified: against real providers. The classifier was written from the error shapes the code expects (HTTP status, Node error codes, `AbortError`, message wording); a real OpenAI, Gemini, Claude, Groq or Ollama failure may land in `other`. Check it by breaking a key and by switching the network off.

## 2026-10-26: T6 announcer and keyboard (branch `transcript-a11y`, epic #38)

Done
- The transcript list is now `role="log"` with `aria-live="off"` and one tab stop (`tabIndex=0`). The browser's own keys scroll it (arrows, Page Up/Down, Home, End); reaching the bottom resumes following through the scroll handler from T2. Enter on the focused list opens or closes the newest other-party row.
- A visually hidden polite region announces each finished, current translation of the other party once (`nextAnnouncement`, `src/lib/transcriptAnnounce.ts`). Partial text, pending, failed, stale, same-language and own-speech rows are never read; a burst announces only the newest and marks the older ones. What is on screen when the list first appears is not read out.
- Verified: both `tsc --noEmit` checks exit 0; tap passes (6 new assertions for what is and is not announced).
- Not verified: with VoiceOver (macOS) or NVDA (Windows): that the announcement is read once, that tab order reaches the list from the header controls, and that Enter on the focused list behaves as intended. No screen reader was run.
- Not done: the spec's custom key handling beyond Enter (40px steps, Cmd+Up/Down interplay with the answer list); the browser defaults are used.

## 2026-10-26: T5 header controls and status dot (branch `transcript-header`, epic #38)

Done
- The transcript zone header carries the controls (`TranscriptHeaderControls`, shown through a new `leftHeader` slot in `SplitterShell`): an STT status dot with its label (label text from 480px up, always as screen-reader text), a Translate toggle (`aria-pressed`), a target-language select, and an Original toggle (`both` and `translated`; it never writes `original`). When no translation model is set, the header shows one button, "Set up translation", which opens Settings. Below 480px the buttons keep their icons and accessible names and lose their words.
- Changes save through the existing `set-transcript-translation-settings` channel and update the screen at once; if the save fails the saved settings are read back. Language names come from `getRecognitionLanguages`, the same list Settings uses.
- The STT chip below the list is gone; a failing STT shows its error as one line, and the troubleshooting box stays.
- Verified: both `tsc --noEmit` checks exit 0; tap passes (3 new assertions for the Original toggle).
- Not verified: how the header fits at 380px with "Live Transcript" and four controls (estimated about 272px of 356px from the class sizes, not measured); the native `<select>` inside the translucent overlay window; that Settings and the header stay in step when Settings changes a value mid-call (the header corrects on the next transcript event); the "Set up translation" path with no model set.
- "Configured" means a model is set. A provider that supplies a default model (OpenAI-compatible with a preferred model) and an empty model field reads as not configured here.

## 2026-10-26: T4 revision-safe translations (branch `revision-safe-translation`, issue #37)

Done
- `translatedRevision` records which revision of the source a translation is for. `isTranslationStale` is true when they differ. `hasUsableTranslation` now shows a stale translation only while a new request is pending (muted, with an inline "· updating"); a stale translation with no request behind it is hidden, and a failed redo shows "Translation failed" rather than the old translation.
- Verified: both `tsc --noEmit` checks exit 0; tap 443 of 443 (13 new assertions: reopened turn goes stale and recovers, never stale without revisions, hidden when complete or skipped, failed redo, current translation).
- Not verified: how "updating" looks in the running app, and a real reopened turn from second-pass correction (tests use hand-built events; the main process was not changed).

## 2026-10-26: T3 reserved slot and line states (branch `translation-slot`, epic #38)

Done
- `rowSlot` (`src/lib/transcriptRow.ts`): the 20px line above the source text exists from the first live words ("◦ Live"), then "Translating" (with "· Ns" once it has waited 3 seconds), then holds the translation; or "Translation failed" with a warning icon and a Retry button. No slot when translation is off, the mode is `original`, the row is own speech, or the row was skipped or is the same language (the same-language collapse is the spec's named exception).
- `TranscriptSegment` gains `speaker` and `receivedAt` (renderer clock at the latest `pending` event; a reopened turn starts a new wait). Own speech is now identified by `speaker === 'user'`, not by the label "Me".
- `useMeetingTranscript` returns `translationEnabled`: from the saved settings (enabled and a model set) at start, then from each final event (`skipped` means off, anything else means on). It reaches the rows through `TranscriptColumn` and `TranscriptPanel`.
- The live partial is 12px with the slot when translation is on, and 14px with no slot when it is off or the mode is `original`, so it keeps its size when it becomes a final row.
- One timer, 1 tick per second, runs only while some translation is pending.
- Verified: both `tsc --noEmit` checks exit 0; tap 423 of 423 (30 new assertions: slot present for live, pending and complete; elapsed time from 3s; no slot cases; `receivedAt` and `speaker` in `upsertTranscriptSegment`; `translationEnabledAfterEvent`).
- Not verified: that a late one-line translation moves nothing above it. The unit tests prove the slot exists in every state and the layout classes were chosen to match (slot `min-h-[20px]`, translation line 20px, source 12px in both); the pixels are the owner's hand check. A translation that wraps to two lines still grows its row downward, by design.
- Not verified: the "Translating" and "failed" lines in the running app at 380px and 600px; that `translationEnabled` is right when the settings are changed in the Settings window mid-call (it corrects itself on the next final event); an OpenAI-compatible provider with an empty model but a preferred model reads as off until its first event.
- With translation off the live partial no longer shows a "Live" marker (it would add a line that disappears on final). The header status dot (T5) will carry that.

## 2026-10-26: T2 one scroll container and the follow rule (branch `transcript-follow`, epic #38)

Done
- The transcript zone has one scroller: the row list in `RollingTranscript`, `h-full` inside the zone. `TranscriptPanel` no longer scrolls and the `max-h-[280px]` cap is gone; the STT status chip and the troubleshooting box are `shrink-0` rows below the list instead of scrolling with it.
- Following is a ref set from scroll events (`isNearBottom`, 32px). While following, any content change (row, live partial, translation, revision, expanding a row) pins the bottom with an instant `scrollTop`; no smooth scroll. Scrolling up stops it; returning within 32px or the jump button resumes it.
- The jump button floats over the list (`absolute`, so it moves nothing) and shows "↓ N new" (N = rows added since following stopped; partial and translation updates add none), "↓ Latest" when N is 0, and "↓ N" below 480px window width. Its accessible name carries the count.
- `nextTranscriptScroll` and `countNewRows` are pure functions in `src/lib/answerScroll.ts`.
- Verified: both `tsc --noEmit` checks exit 0; tap 393 of 393 (8 new assertions covering pin, hold, resume and the count).
- Not verified: scroll behaviour in the running app (a live call, scrolling up mid-stream, the button at 380px and 600px); whether Chromium scroll anchoring keeps a late translation from moving the row being read (the spec assumes it; untested here); the zone resizing while following (no `ResizeObserver`, so the bottom is not re-pinned when the window or splitter changes).
- Not done here, still T6: `role="log"`, `aria-live="off"`, the End and arrow keys. The list still has `aria-live="polite"`, which re-announces rows as they change.

## 2026-10-26: T1 flat rows, translation first (branch `transcript-rows`, issue #36)

Done
- `src/lib/transcriptRow.ts`: what a row shows per display mode. `both`: translation (14px) above source (12px, muted). `translated`: translation only, source after a click on the row. `original`: source only. A row whose translation is pending or failed shows the source (12px) under a "Translating…" or "Translation failed [Retry]" line. Own speech ("Me") is one muted 12px source line and is never translated.
- `RollingTranscript.tsx` rewritten as flat rows: no cards, avatars, gradients, spinners or `text-[9px]`/`[10px]`. The newest other-party row has weight 500 and a 2px accent rule. The live partial is at full contrast (the `opacity-90`/`opacity-80` is gone). Speaker name shows only when the speaker changes. Language, time and Translate/Retranslate appear when a row is expanded; Retry is visible on a failed row. Unused props `isActive` and `surfaceStyle` removed from the component and from `TranscriptPanel`.
- Verified: both `tsc --noEmit` checks exit 0; tap 385 of 385 (18 new assertions in `test/transcript-row.test.ts`: per-mode choice, expand, pending, error, skipped, same language, blank translation).
- Not verified: how it looks and reads at 380px and 600px, light and dark; the 14px size on a real call. The scroll code in this file is unchanged (T2); the slot that reserves height for a late translation is T3, so a translation arriving still replaces the "Translating…" line and can change the row height until T3 lands.
- The default `displayMode` is `both` inside the component, but `useMeetingTranscript` starts with `original` until the saved setting loads, so a user whose saved mode is `original` still sees no translation (that is their setting).

## 2026-10-26: live translation UI spec (branch `translation-ui-spec`, epic #38)

Done
- Design spec written by an Opus subagent: `docs/design-live-translation-ui.md` (no code). Read in full for the build plan, scroll rules and open questions; the claims about current code below were checked in source before filing issues.
- Found in source: `displayMode` reaches `RollingTranscript` but is never read (#36); the row shows the source as the main line at 13px and the translation below it at 12px italic; a reopened turn keeps the translation of its old text (`transcriptSegments.ts:80`, #37).
- Filed #36, #37 and the tracking issue #38; `TASKS.md` section T holds the ten steps.

Unverified
- Everything about how the translation view looks and reads on a real call. The 14px size is an assumption to check.
- The spec's claim that Chromium scroll anchoring absorbs late translations without moving what the user reads; it has not been tried in this app.
- The spec's Windows shortcut suggestions (`Ctrl+Shift+F9/F10`).

## 2026-10-26: U2 no synthetic user bubble (branch `drop-synthetic-bubble`, issue #21)

Done
- `src/lib/userEcho.ts`: a typed prompt is echoed as the user turn; a quick action echoes nothing, or only the attached screenshot (empty text) when one is attached. `submitPrompt` now takes `echoPrompt` (default true) instead of `addUserMessage`; what-to-say passes false; code hint and brainstorm use the same helper, so their fixed sentences ("Give me a code hint for this", "Brainstorm with this context") are gone too.
- Verified: both `tsc --noEmit` checks exit 0; tap 367 of 367 (8 new assertions in `test/user-echo.test.ts`).
- Not verified: how it looks. A screenshot-only bubble still renders the "Screenshot attached" label with a rule under it and no text; check it in the running app. The "Re: ..." line from #21 is not done; it moved to U5.
- Clarify, recap, follow-up questions and brainstorm without a screenshot never added a bubble (they use their own IPC channels); only what-to-say went through `submitPrompt` with the default.

## 2026-10-26: U1 scroll-follow (branch `fix-scroll-follow`, issue #20)

Done
- `src/lib/answerScroll.ts`: pure rule. A message not yet shown scrolls its start into view once; later growth of the same message follows only while the reader is within 32px of the bottom. `PikaInterface` applies it to the answer list through `scrollContainerRef`; no smooth scroll per token. The unused `messagesEndRef` prop chain (`PikaInterface`, `ChatColumn`, `ChatPanel`) is removed, and message wrappers carry `data-message-id`.
- Verified: `tsc --noEmit` exit 0 (renderer and Electron), tap 359 of 359 (13 new assertions in `test/answer-scroll.test.ts`, covering the 32px boundary, new message, same message followed or not, empty list).
- Not verified: the behaviour in the running app (long streaming answer at 380px and 600px, scrolling up mid-stream, collapse and re-expand). The DOM wiring (scroll listener, `getBoundingClientRect` offset) has no automated test. `MeetingChatOverlay` and `GlobalChatOverlay` still scroll to the end on every message change; they are other surfaces and were not touched.

## 2026-10-26: rules, issues, queue

Done
- Critique of the overlay conversation area (design review of the code plus a detector run; score 14/40, snapshot kept locally in `.impeccable/critique/`, not committed). Two P0 and five P1 findings, filed as issues #20 to #27 under epic #28.
- Comparison with the OmniVoice project for live translation. Filed as issues #29 to #33 under epic #34. Decision: port ideas to TypeScript, no Swift rewrite (OmniVoice is macOS 26+ only; Pika also targets Windows).
- Tooling issue #35: lint checks only that files parse, CI skips lint and tests, no `typecheck` script.
- Rule set written from the relire project, adapted: `AGENTS.md`, `CLAUDE.md` (imports `AGENTS.md`), `RULES.md`, `docs/conventions.md`, `docs/development.md`, `docs/architecture.md`, `TASKS.md`. Committed on branch `project-rules` (`TASKS.md` S1). `AGENTS.md` and `CLAUDE.md` are matched by `.gitignore` (lines 199-200) and the owner chose to keep them ignored, so they exist in this checkout only and the commit holds the other documents.

Verified (2026-10-26, local checkout, no install run)
- `tsc --noEmit` for the renderer: exit 0.
- `tsc -p electron/tsconfig.json --noEmit`: exit 0.
- tap over `test/**/*.test.ts`: 346 of 346 passed. STT and LLM providers are not exercised by these tests.
- Issue evidence checked in source: `PikaInterface.tsx:60` unconditional `scrollIntoView`; `useMeetingChat.ts:455` `addUserMessage = true` by default; `handleAnswerNow` is `handleWhatToSay`; translation is one non-streaming request per flushed turn (`LLMHelper.ts` request bodies set `stream: false`); `SuggestionOverlay` and `KeyBadge` have no importers; `no-scrollbar` has no CSS rule.

Unverified
- Lint: not run. `eslint` is not declared in `package.json` (only a peer in the lockfile) and is not installed here, and `pnpm run` starts an install in this checkout (`docs/development.md`, "pnpm caveat"). The rule set is empty anyway (#35).
- Everything about how the overlay looks and behaves in the running app: the first-show height (#22), whether the splitter drags (#26), chips clipping at 380px (#27). These come from reading code.
- Translation latency: not measured (#29). The estimate "flush delay plus one LLM round trip" is read from code.
- The OmniVoice `EntityMasker` source was read for its first 40 lines only; `StablePrefixTracker` was read in full.
- Windows behaviour, and the old `docs/UI_DESIGN_AUDIT.md` claims about z-index, radius and spacing.

Broken or stale
- `docs/UI_DESIGN_AUDIT.md` (2026-04-27) is out of date (`TASKS.md` S4).
- The old `CLAUDE.md` said there is no test framework; there is one (tap, `test/`). Replaced.
- `.impeccable/` and `eva-skill/` are untracked in the working tree and are not part of this change.
