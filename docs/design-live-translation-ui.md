# Design spec: live translation in the transcript zone

Status: approved by the owner on 2026-10-26, including all six recommendations in section 11 as written and the rule amendment in section 3. Scope: the transcript zone of the overlay (`SplitterShell` top zone) when transcript translation is on. Related: #24, #28, #29-#34, TASKS U6 and R1-R5.

## 1. Point of view

- The screen is a subtitle strip for a phone or video call. It answers one question in under 2 seconds: "What did they just say, in my language?"
- The newest line from the other party is the thing to read. Older lines are context and step back.
- It feels like quiet subtitles: flat text on the glass, no cards, no avatars, no animation, no colour noise.
- It is honest about time. A line that is still being translated says so, and says for how long.
- It is not a chat log, not a dashboard of badges, not a settings page. Controls are few and stay in the zone header.
- Nothing moves under the reader's eyes. Text that has been shown never jumps.

## 2. Information hierarchy

Type scale for the zone (three sizes; no new `text-[Npx]`):

| Role | Size / line-height | Weight | Token |
| --- | --- | --- | --- |
| Translation, newest other-party row | 14px / 20px (`text-sm`) | 500 | `overlay-text-primary` |
| Translation, older rows | 14px / 20px | 400 | `overlay-text-secondary` |
| Source text (translation on), incl. the live partial; own speech ("Me") | 12px / 17px (`text-[12px]`) | 400 | live: `overlay-text-primary`; pending/error: `overlay-text-secondary`; complete: `overlay-text-muted` |
| Source text when translation is off, `original` mode, or same language | 14px / 20px | 400 | `overlay-text-primary` |
| Row meta, slot status, header labels | 11px (`text-[11px]`) | 500 | `overlay-text-muted` |

**Size encodes role, colour encodes state.** Within one display mode a text block never changes size, so state changes do not reflow a row. There are two named exceptions: the same-language collapse and the `translated`-mode source collapse (sections 3 and 4). Both happen only when a row completes, which is almost always the newest row at the pinned bottom. The newest row is marked by weight, contrast and a 2px left rule in `accent-primary`, not by size, so it does not reflow when it becomes "older". Speaker names show only when the speaker changes from the row above ("Them", "Me", or the diarized label), at 11px.

**600px, display mode `both`:**

```
+-- LIVE TRANSCRIPT ---------------------------- ● Listening  [Translate ✓][Auto → 中文 ▾][Aa Original] --+
|  THEM                                                                                                  |
|  我们下周二可以把合同发给你。                                (14 / secondary)                              |
|  We can send you the contract next Tuesday.                 (12 / muted)                              |
|  ME  Sounds good, what about the price?                     (12 / muted, no translation)              |
|▌ THEM                                                                                                  |
|▌ 价格和上次一样,但运费要另算。                               (14 / 500 / primary)  <- newest            |
|▌ Same price as last time, but shipping is extra.           (12 / muted)                              |
|  ◦ live                                                      (11 / muted, slot already reserved)       |
|  and the delivery window is                                 (12 / primary, live partial)              |
+--------------------------------------------------------------------------------------- [↓ 2 new] ----+
```

**380px, display mode `both`:** the header collapses to a status dot, one language chip and an overflow menu (`⋯`) that holds Translate on/off and Show original.

```
+-- TRANSCRIPT -------- ● [→ 中文 ▾][⋯] -+
|  THEM                                  |
|  我们下周二可以把合同发给你。              |
|  We can send you the contract next     |
|  Tuesday.                              |
|▌ 价格和上次一样,但运费要另算。             |
|▌ Same price as last time, but          |
|▌ shipping is extra.                    |
|  ◦ live                                |
|  and the delivery window is            |
+------------------------------ [↓ 2] ---+
```

**Pending and streaming** (the 20px slot exists from the first partial; only its content changes):

```
|▌ THEM                                                |
|▌ Translating · 4s                (11 / muted, slot)  |   <- pending, today
|▌ Can we move the call to Friday?  (12 / secondary)    |
|                                                      |
|▌ 我们能把电话改到                                       |   <- committed (14 / primary)
|▌ 周五吗                            (14 / muted)        |   <- preview, #31 only
|▌ Can we move the call to Friday?                      |
```

**Error and not configured:**

```
|  THEM                                                 |
|  ⚠ Translation failed   [Retry]   (11, danger tone + icon + text; reason such as "timeout" only after step 8)
|  Can we move the call to Friday?  (12 / secondary)
+-- LIVE TRANSCRIPT ------------- ● Listening  [Set up translation] --+   <- not configured: header only
|  Can we move the call to Friday?  (14 / primary, original only)     |
```

## 3. Original and translation

Decision: **translation first, source beneath in the quiet style.** The owner reads the language he understands; the source is there to check names, numbers and terms. It is never removed silently.

| Persisted `displayMode` | Row shows |
| --- | --- |
| `both` (default once translation is on) | translation (14) above source (12, muted) |
| `translated` | translation only; source appears when the row is expanded (click the row, or Enter on the focused list expands the newest row) |
| `original` | source only at 14px; no slot |

From the first partial, a row is laid out as `[slot 20px+] [source 12px]`. The slot holds "live", then "Translating", then the translation. The source keeps its size and only its colour moves from primary (live) to secondary (pending) to muted (complete). In `translated` mode the source line is still in the DOM while pending, so the user can read it, and it collapses only once the translation is complete. This is a deliberate reflow on completion (see section 2).

One-gesture toggle: the header button **"Aa Original"** (pressed state shown with a check and `aria-pressed`) flips `both` ↔ `translated`. From `original` it goes to `both`. The header never writes `original`. The "Original only" option stays in Settings because it is a released value. One key: section 8.

Why not a three-way cycle: mid-call the only question is "do I need the source now"; cycling makes the user count presses.

**Own speech ("Me")** is not translated: one 12px muted line, source only. The owner knows what he said, the main process never translates `user` today, and Occam rules out a speculative option. Manual Translate stays in the expanded row.

**Rule challenged: "The answer is the most prominent thing" (conventions, Overlay UI).** On a call there is often no answer, and the translation is what must be read. Amendment: *when translation is on and no answer is streaming or pinned, the newest translated line is the most prominent text; while an answer exists, the answer leads.* The answer's lead sentence (U5) stays larger than 14px, so they never compete.

## 4. Segment state machine

| State | Trigger (today / new) | User sees | Motion | Layout |
| --- | --- | --- | --- | --- |
| listening | interviewer partial event | live partial at 12px primary (full contrast; drop today's `opacity-90` + `opacity-80`), slot shows "◦ live" | none | slot (`min-h-[20px]`) reserved now; source grows downward only |
| pending | final with `translationState: 'pending'` | source 12px secondary; slot "Translating", after 3s "· Ns" (1s tick) | none | same slot, same source size: 0px shift |
| streaming (#30) | `translationState: 'streaming'` + token event | committed tokens fill the slot at 14px | none; text appends | slot grows downward only |
| committed + preview (#31) | `committed`, `preview` | committed at 14 primary, preview inline after it at 14 muted | none | committed is append-only and never moves; the preview is replaced wholesale |
| complete | `translationState: 'complete'` | translation 14px in the slot; source colour to muted | none | slot keeps its height or grows; never shrinks below 20px |
| revised | same `segmentId`, higher `revision` | new source in place; the old translation stays in the slot, same 14px but muted, followed by an inline 11px "· updating"; replaced when the new revision's translation lands | none | row keeps its position (keyed by `segmentId`); no move to the bottom |
| skipped, same language | `complete` with `translatedText === sourceText` (today) | the slot collapses and the source renders as translation-role text (14px primary), no marker | none | collapse on completion (section 2 exception) |
| error | `translationState: 'error'` | slot: warning icon + "Translation failed" + visible **Retry** (generic today; reason after step 8) | none | uses the slot |
| not configured | derived from settings: `enabled === false` or model empty | original-only rows; the header shows "Set up translation" | none | no slots |

Facts from today's code:

- Not-configured arrives as `skipped`; same-language arrives as `complete` with equal text. The renderer derives not-configured from `getTranscriptTranslationSettings` (already exposed). No new IPC value.
- **Bug:** a reopened turn emits `pending` with `translatedText: undefined`, and `upsertTranscriptSegment` keeps the old `translatedText`, so the old translation sits under new source as if current. Fix: renderer-only `translatedRevision`; a translation is current only when `translatedRevision === revision`.
- `seg.timestamp` is turn start. Elapsed time uses a renderer-stamped `receivedAt` (arrival of `pending`), so long turns do not look stale.
- **Bug:** `RollingTranscript` never reads its `displayMode` prop; every mode renders as `both` today.

No motion and no spinners (the row `Loader2 animate-spin` is removed), so reduced motion has nothing to reduce.

## 5. Scroll rules

1. **One scroll container**: the row list inside `RollingTranscript`. Remove `overflow-y-auto` from `TranscriptPanel` and the `max-h-[280px]` from the list. The list fills the zone (`flex-1 min-h-0 overflow-y-auto`). The STT status chip and the troubleshooting box leave the scroll area (section 6).
2. **Following** = `isNearBottom` from `src/lib/answerScroll.ts` (bottom closer than 32px), measured on each `scroll` event.
3. **On any content change** (new row, partial text, translation arriving, revision): if following, set `scrollTop = scrollHeight` instantly in a layout effect. Never use smooth scroll. The answer list's "show-start" rule does not apply: a transcript row is short and its end is the news.
4. **Auto-follow stops** the moment the user scrolls more than 32px up (wheel, drag, keys). It **resumes** when the user returns within 32px, presses End, or uses the jump control. It does not resume on a timer.
5. **Jump to latest** is a pill pinned bottom-right with `position: absolute` inside the zone, so it never moves layout. It shows only while not following. Label: "↓ N new" (N = new rows since following stopped; partial updates and translation completions do not count). At 380px it shows "↓ N". Accessible name: "Jump to latest, N new lines".
6. **Visible lines**: the zone shows what its height allows. At the default split the target is the last 3 rows plus the live partial. History is reached by scrolling the same container. There is no drawer and no second list.
7. **Out-of-order completion and revisions** never move what the user is reading. Slots are reserved (section 4), so a one-line translation causes no shift. Taller translations or revisions above the viewport are absorbed by Chromium scroll anchoring. Do not set `overflow-anchor: none` anywhere in the zone.
8. **Keyboard**: the list is one tab stop (`tabIndex=0`, `role="log"` with an explicit `aria-live="off"`, because `role="log"` is implicitly polite and would re-announce every row). Up/Down scroll 40px, PageUp/PageDown one viewport, Home to top, End jumps to latest and resumes follow. Enter expands or collapses the newest other-party row (time, detected language, source in `translated` mode, Translate/Retranslate). Any row can be expanded by click. Retry buttons are ordinary buttons in the tab order. Global Cmd+Up/Down keep scrolling the answer list.

The decision is a pure function, `nextTranscriptScroll({following, contentChanged}) → 'pin' | 'hold'`, next to `answerScroll.ts`, with a unit test.

## 6. Latency and status

- **Header status dot** (moved from the bottom chip into `ZoneHeader`). Colour plus label, never colour alone: `● Listening` (success), `● No audio` (warning, opens the existing troubleshooting text as a header popover, not an inline row), `● Translation error` (danger, after 2 consecutive errors; the label is a button that opens translation settings). At 380px the label is hidden and becomes the dot's `title` and accessible name.
- **Per-line**: only the pending slot shows time ("Translating · 6s"; after 15s "Translating · slow (15s)"). The UI invents no timeout; the main process decides errors. Completed lines show no latency; exact times are in the #29 logs.

## 7. Controls

All controls sit in the zone header, right-aligned, wrapped in `no-drag` (the header is inside `draggable-area`). They are quiet, 11px text buttons with `border-border-subtle`. The zone has no primary action, except one case: when translation is not configured, **"Set up translation"** is the zone's single primary action (accent outline). Today it opens Settings (`toggleSettingsWindow` takes no section). Landing directly on the translation section needs a new optional argument, which is a small IPC addition for step 5.

| Control | 600px | 380px | Writes |
| --- | --- | --- | --- |
| Translate on/off | `[Translate ✓]` toggle | in `⋯` | `enabled` |
| Language | `[Auto → 中文 ▾]` menu: target list, plus source hint | `[→ 中文 ▾]` | `targetLanguage`, `sourceLanguage` |
| Show original | `[Aa Original]` pressed/unpressed | in `⋯` | `displayMode` `both`/`translated` |

- Every change writes through the existing `set-transcript-translation-settings` (no new contract). Local state alone would be overwritten: `useMeetingTranscript` copies `displayMode` from every payload.
- Turning translation on while `displayMode` is `original` also sets `both`, or "on" looks like nothing happened.
- Released defaults stay: `enabled: false`, target `chinese`, source `auto`. Provider and model stay in Settings; the language menu footer shows the model name read-only.
- Menus render in a portal (the zone has `overflow-hidden`).

## 8. Accessibility, i18n, IME

- **aria-live**: remove `aria-live` from the scroll container. Add one visually hidden `aria-live="polite"` region that announces "Them: <translation>" once per `segmentId + revision` when a translation is complete. A revision is announced only if its text changed. Partials, tokens, previews and own speech are not announced. Errors are announced once via the header status.
- **Focus order**: header controls (status, Translate, Language, Original) → transcript list (one stop) → any visible Retry → jump pill → answer zone.
- **Shortcuts**. Taken globally (`KeybindManager`): Cmd+B, Cmd+Shift+B, Cmd+(Shift+)Enter, Cmd+R, Cmd+(Shift+)H, Cmd+1-7, Cmd+Up/Down, Cmd+Shift+arrows; locally Cmd+K, Cmd+S. The overlay is usually unfocused during a call, so toggles must be global, and plain Cmd+letter would steal call-app keys. Proposed: `CommandOrControl+Alt+O` show/hide original, `CommandOrControl+Alt+T` translation on/off, rebindable (new keybind ids need the owner). End (local) jumps to latest.
- **Contrast**: readable text never uses `text-text-tertiary`. The muted floor is `--overlay-text-muted` on `--overlay-transcript-bg` (0.34 alpha) over the shell. The owner checks 4.5:1 for 12px source text in dark and light themes (`[data-theme='light']`), with a white and a black window behind the overlay.
- **CJK and mixed scripts**: `break-words`, and a `lang` attribute on each text block (detected language on source, target on translation). The language menu has no text input; any future one follows the IME guard.

## 9. Data contract

Renderer `TranscriptSegment` (in-memory, not persisted; extend `src/lib/transcriptSegments.ts`):

| Field | Source today | Status |
| --- | --- | --- |
| `segmentId`, `revision` | event | exists |
| `sourceText` | event `sourceText` | exists |
| `speaker: 'interviewer' \| 'user'` | event `speaker` (dropped today; `speakerLabel === 'Me'` is used instead) | new, renderer-only |
| `speakerLabel` | event | exists |
| `detectedLanguage` | event | exists |
| `translationState` | `pending \| complete \| skipped \| error` | `streaming` is new (#30) |
| `translatedText` | event | exists; becomes `committed` once #31 lands |
| `translatedRevision` | set from event `revision` on `complete` | new, renderer-only |
| `committed`, `preview` | token event keyed by `segmentId + revision` | new (#30, #31) |
| `translationError` | not sent (only logged) | new optional string on the `error` payload; short reason, no transcript text |
| `timestamp` (turn start), `receivedAt` | event / renderer clock | `receivedAt` is new, renderer-only |

Reducer rules (unit-tested): an event with a lower `revision` is dropped (exists). A higher revision keeps the old translation but marks it stale (`translatedRevision < revision`). Token events for a stale revision are dropped. `committed` only appends. `preview` is replaced.

Zone-level props: `settings: {enabled, targetLanguage, sourceLanguage, displayMode, modelConfigured}` from `getTranscriptTranslationSettings`.

## 10. Build plan

Steps 1-6 deliver value with today's non-streaming pipeline. They overlap U6 (#24), which waits on U4. Steps 1-4 proceed without U4: they change row internals and scrolling, not the zone's position.

1. **Flat rows, translation first, honour `displayMode`.** `RollingTranscript.tsx`. Rows are flat with no cards or avatars; `displayMode` is finally read; sizes 11/12/14 only; the live partial is at full contrast. *Accept:* `translated` hides source, `both` puts translation above source, and no `text-[9px]`/`[10px]` remains in the file. **Owner checks at 380 and 600px.**
2. **One scroll container and the follow rule.** `TranscriptPanel.tsx`, `RollingTranscript.tsx`, `src/lib/answerScroll.ts` (add `nextTranscriptScroll`), `test/answer-scroll.test.ts`. *Accept:* no nested `overflow-y-auto`; the unit test covers pin, hold and resume; the jump pill shows the count. **Owner checks on a live call.**
3. **Reserved slot and line states** (pending with elapsed time, error with Retry, same-language, not-configured). `RollingTranscript.tsx`, `transcriptSegments.ts` (`receivedAt`, `speaker`), `useMeetingTranscript.ts`. *Accept:* a late translation of a one-line text causes 0px shift of the rows above it (checked by a reducer test plus a hand check).
4. **Revision-safe translations.** `transcriptSegments.ts`, `useMeetingTranscript.ts`, `test/transcript-translation.test.ts`. *Accept:* a test shows a reopened turn marks its old translation as "updating" and never shows it as current.
5. **Zone header controls and status dot.** `SplitterShell.tsx` (`ZoneHeader` takes children), `TranscriptColumn.tsx`, `TranscriptPanel.tsx`, `useMeetingTranscript.ts`; reuse `set-transcript-translation-settings`. *Accept:* toggles persist across the next transcript event; "Set up translation" opens Settings. **Owner checks at 380px.**
6. **Announcer and keyboard.** `RollingTranscript.tsx`. *Accept:* the list has `aria-live="off"`; VoiceOver reads each complete translation once and no partials; End resumes follow.
7. **Global toggles** (needs owner approval: new keybind ids). `electron/services/KeybindManager.ts`, `src/hooks/useShortcuts.ts`, `PikaInterface.tsx`. *Accept:* Cmd+Alt+O and Cmd+Alt+T work while the overlay is unfocused.
8. **Error reason on the payload.** `transcript-assembler.ts` (error branch), `src/types/electron.d.ts`. *Accept:* the slot shows "timeout" or "auth" instead of a generic message, and logs carry no text.
9. **Streaming tokens in the slot.** Depends on #29 and #30. `transcriptSegments.ts`, `useMeetingTranscript.ts`, `electron/preload.ts`, `electron.d.ts`. *Accept:* the first token shows within the time measured on #30; a superseded revision writes nothing (test).
10. **Committed and preview rendering.** Depends on #31, later #33. `RollingTranscript.tsx`, `transcriptSegments.ts`. *Accept:* reducer test shows committed only appends and preview is replaced; **owner checks** that committed text never moves.

## 11. Open questions for the owner

1. **Zone position and size when translating (U4/#28).** Recommendation: keep the transcript above the answer. When translation is on, the default split gives the transcript 55% and the user's own split is persisted. Adopt the rule amendment in section 3.
2. **Own-speech translation.** Recommendation: no. Own lines stay source-only and muted, with manual Translate on expand. Revisit only after a real use.
3. **Translation text size.** Is 14px enough mid-call? Recommendation: ship 14px, check on a real call (step 1), and move to 16px only if it fails, as one token change.
4. **Global shortcuts.** Recommendation: approve two new rebindable ids, Cmd+Alt+O and Cmd+Alt+T on macOS. On Windows, Ctrl+Alt acts as AltGr on many layouts and can swallow typed characters, so the Windows default should be Ctrl+Shift+F9 / F10 (pick on a real keyboard).
5. **Cost in `original` mode.** When translation is enabled but the mode is `original`, requests still run. Recommendation: keep them running, so toggling to `both` shows translated history at once. The cost is one short request per turn.
6. **Error reason on the IPC payload (step 8)** is an additive change to an existing event. Recommendation: approve it. It is optional and old readers ignore it.
