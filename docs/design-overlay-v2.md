# Design spec: overlay v2, the minimum bar for a qualified overlay

Status: proposal; six owner decisions open (§10). Scope: the meeting overlay. Builds on `docs/design-live-translation-ui.md` ("the translation spec"), which it amends in two places marked **Amends**.

Tags: **[code]** file:line; **[shot]** measured on the owner's screenshot (1212×812 at 2x ≈ 606×406 CSS px, window y≈13-419 of 420); **[calc]** WCAG maths on token values, not measured; **[rec]** recommendation. Only [shot] numbers were seen in the running app.

## 1. Verdict on the screenshot

| # | Failure | Pixel evidence [shot] | Cause [code] | Root cause | Kind |
| --- | --- | --- | --- | --- | --- |
| 1 | Answer-zone footer clipped | The shell's bottom-right corner cuts through the model button and Send | Answer-zone fixed chrome ≈205px: header 29 (`SplitterShell.tsx:19`), list padding 28 (`ChatPanel.tsx:392`), chips 54 (`:506`), input 42 (`:575`), footer 52 (`:528,586`). At 420px with the 55% split (`PikaInterface.tsx:44`) the zone gets ≈158px and is `overflow-hidden` (`SplitterShell.tsx:55`) | Percentage split with no pixel floor. `PROGRESS.md` U7 "at 420px there is room" is wrong at 55% | **Implementation bug** |
| 2 | Chrome is ≈73% of the height | ≈306 of 420px are pill band, headers, splitter, chips, input, footer, padding; content gets ≈114px | `TopPill.tsx:30` (8 + 44px), gap 8 (`PikaInterface.tsx:146`), two `ZoneHeader`s, three bottom rows | Rows added one at a time, no height budget | **Design wrong** |
| 3 | Wrong primary; status shown twice | The only filled accent is "What to say", useless with no transcript. Header "No system audio signal" and the amber box say the same; the box is taller than the transcript area | `TranscriptHeaderControls.tsx:39-43`, `TranscriptPanel.tsx:64-81`, `ChatPanel.tsx:509` | No single state model. Translation spec §6 put the help in a popover; T5 kept the box | **Design wrong** + **spec not implemented** |
| 4 | Background noise | Glyphs under the panel are faint, 1.1-1.25:1 (one spot 1.6:1, unexplained). The noise comes from: a ~60px transparent band around the pill, where the terminal shows at full contrast; near-white 1px header rules and dashed box edge (luminance 227 ≈ Tailwind default `#e5e7eb`); a 3.1:1 placeholder; empty zones where background text is the only texture | `border-border-subtle/50` (`SplitterShell.tsx:19`, `TranscriptPanel.tsx:51`) generates no CSS (bare `var()` colour cannot take `/50`; not in `dist/assets/index-*.css`), so `border-b` falls back to the preflight default. Box bottom edge missing: `transcriptStyle` sets only `borderBottomColor` (`overlayAppearance.ts:119`). Placeholder: `text-text-tertiary` | In dark theme not opacity (shell alpha 0.92-0.975, `overlayAppearance.ts:104`) but bands, broken hairlines and emptiness. In light theme opacity is the cause: floor 0.74 gives 1.9:1 [calc] | **Bug** (hairlines) + **design wrong** |
| 5 | Header controls overflow | "Chinese (Simp" is truncated at 600px. Below 480px the status loses its words and becomes colour only | `max-w-[110px]` (`TranscriptHeaderControls.tsx:61`), `hidden min-[480px]:inline` (`:41`) | The spec's short label `→ 中文` and its `⋯` overflow (translation spec §2, §7) were not built | **Spec not implemented** |

Corrections to the brief:
- The zone labels are legible ("LIVE TRANSCRIPT" ≈ 6:1 [shot]); the problem is that they exist.
- The blur does nothing: glyphs under the panel are pixel-sharp [shot]. `backdrop-filter` in a transparent window cannot sample the desktop; only alpha protects.
- Not in the screenshot: the overlay opens at meeting start (`main.ts:820`) and audio starts 5-7s later (`main.ts:834-837`), so a normal start shows a red "STT disconnected" (`useMeetingAudio.ts:116`). And disconnected, the worst state, never gets troubleshooting (`useMeetingAudio.ts:129`).

## 2. Acceptance bar

"Qualified" means every check holds at window widths 380, 600 and 1000 (1000 only after a manual resize: `WindowHelper.ts:501` reopens at 600) and heights 420 and 700, in light and dark themes. Contrast checks use macOS Digital Color Meter set to "sRGB, 8-bit": sample two pixels, then compare.

| # | Check | Target | Source |
| --- | --- | --- | --- |
| Q1 | No clipped control | Every control's full outline is inside the shell at height ≥ 420, at any splitter position; Send sits ≥ 8px above the shell's bottom edge | [rec] |
| Q2 | No truncated control | No ellipsis on any button, select or chip at 380px. Truncation is allowed only for transcript or answer text | [rec], translation spec §7 |
| Q3 | Chrome budget | At 420px tall, chrome (everything except the two content areas) is ≤ 140px (33%), and each content area is ≥ 112px (5 lines of 20px plus 12px padding) | [rec], derived in §5 |
| Q4 | One most prominent thing | Squint test: blur the screenshot or stand 2m back. The first thing you see matches the "primary" column of §3 for that state | [rec] |
| Q5 | One filled accent | Exactly one filled accent-coloured control on screen, or none | [rec] |
| Q6 | Status shown once | Each condition's words appear in one place only (chip or zone line, never both) | [rec] |
| Q7 | Background stays behind | Slider at minimum, over a white page of black 16px text and over a terminal of white text: ghost glyph vs panel differs by ≤ 13 levels of 255 in dark, ≤ 16 in light (≈ 1.15:1), and no background word is readable at arm's length | [calc]: 11-13 and 15 levels at the §4 floors |
| Q8 | No transparent band | Inside the window, the only transparent pixels are the shell's outer corner radius. No control sits on bare desktop | [rec] |
| Q9 | Text contrast | All text ≤ 14px, placeholders included, is ≥ 4.5:1 against its surface, over white and over black desktop, in both themes | [calc] table in §4 |
| Q10 | Text size | Nothing to be read is under 11px; button labels are 12px. `grep -E 'text-\[(9\|10\|10\.5\|11\.5\|13)px\]'` over the overlay files finds 0 | conventions + [rec] |
| Q11 | Empty states | No empty area shows a box or dashed border. Empty copy is one line at 600px (at most two at 380px), top-left, 12px muted | [rec] |
| Q12 | Hairlines | A divider samples ≤ 20 levels brighter than the panel next to it (dark) or ≤ 20 darker (light). Today: +196 | [shot] / [rec] |
| Q13 | Wide window | At 1000px no transcript or answer line is wider than 680px; text stays left-aligned and controls stay at the edges | [rec] |
| Q14 | Status moves nothing | Two screenshots, before and after the status changes (live → no audio): the transcript rows and the right-hand bar controls are at the same pixels | conventions "Layout" |

## 3. State matrix

The frame: a 36px top bar (status, translation controls, `⋯`, Hide, Stop) replacing the pill and both zone headers (Owner Q1); the transcript area; a 1px splitter; the answer area; a two-row composer. Wireframes are 600px, plus 380px where it differs.

**(a) Starting / not listening.** Primary: nothing urgent. Quiet: everything. Hidden: translation controls if not configured (one "Set up translation" text button instead). Next action: none, wait (starting); "Open Pika" (not listening).
```
╭─────────────────────────────────────────────────────────────────╮
│ ○ Starting audio…                 [文 Translate ✓][→ 中文 ▾] ⋯ ˄ ■ │ 36
├─────────────────────────────────────────────────────────────────┤
│ Connecting to call audio. This takes a few seconds.             │ 12px muted
│                                                                 │
├──────────────────────────────── ═ ──────────────────────────────┤
│ Ask about your screen now, or wait for the call.                │
│                                                                 │
│ [⚡ What to say ⌘1] [Clarify] [Recap] [Follow-up]  (all quiet)   │ 28
│ [ Ask about the call or the screen…                         (→)]│ 36
╰─────────────────────────────────────────────────────────────────╯
```

**(b) No call audio** (the screenshot). Primary: **Fix audio**. Quiet: What to say (outline style, same place). Hidden: tips and raw error (in the chip popover). Next action: Fix audio.
```
╭─────────────────────────────────────────────────────────────────╮
│ ● (amber dot, no words)           [文 Translate ✓][→ 中文 ▾] ⋯ ˄ ■ │
├─────────────────────────────────────────────────────────────────┤
│ ▲ No sound from the call yet                                    │ 14px primary
│   If they are talking, Pika is not receiving it. Check that the │ 12px secondary
│   call plays on your output device and that Pika has Screen &   │
│   System Audio Recording permission.                            │
│   [ Fix audio ]                                    (filled)     │ 28
├──────────────────────────────── ═ ──────────────────────────────┤
│ What to say needs their words first.                            │
│ [⚡ What to say ⌘1] [Clarify] [Recap] [Follow-up]  (quiet)       │
│ [ Ask about the call or the screen…                         (→)]│
╰─────────────────────────────────────────────────────────────────╯
380:
╭──────────────────────────────────────╮
│ ●                 [→ 中文 ▾]  ⋯  ˄  ■ │
├──────────────────────────────────────┤
│ ▲ No sound from the call yet         │
│   If they are talking, check the     │
│   output device and permission.      │
│   [ Fix audio ]                      │
├───────────────── ═ ──────────────────┤
│ [⚡ What to say ⌘1] [◇][↻][?]         │  secondary chips icon-only
│ [ Ask about the call…           (→)] │
╰──────────────────────────────────────╯
```

**(c) Audio OK, nobody has spoken.** Primary: none. Quiet: everything (a calm, ready screen). Hidden: help text. Next action: none.
```
│ ● Listening                       [文 Translate ✓][→ 中文 ▾] ⋯ ˄ ■ │  neutral dot
│ Listening. Their words appear here in 中文.                      │
├──────────────────────────────── ═ ──────────────────────────────┤
│ When they ask something, press ⌘1 for what to say.              │
```

**(d) Live call, translation on, other party speaking.** Primary: the newest translated line (14px/500, 2px accent rule; translation spec §2). Quiet: older rows, chips. Filled control: What to say. Next action: ⌘1 when a question lands.
```
╭─────────────────────────────────────────────────────────────────╮
│ ● Live                            [文 Translate ✓][→ 中文 ▾] ⋯ ˄ ■ │
├─────────────────────────────────────────────────────────────────┤
│ THEM                                                            │
│ 我们下周二可以把合同发给你。                       (14 / secondary)
│ We can send you the contract next Tuesday.        (12 / muted)  │
│▌价格和上次一样,但运费要另算。                       (14/500/primary)
│▌Same price as last time, but shipping is extra.                 │
│  ◦ live  and the delivery window is                             │
├──────────────────────────────── ═ ──────────────────────────────┤
│ (previous answer, or the one-line empty copy)                   │
│ [⚡ What to say ⌘1] [Clarify] [Recap] [Follow-up]     (filled)   │
│ [ Ask about the call or the screen…                         (→)]│
╰─────────────────────────────────────────────────────────────────╯
380: bar = "● Live   [→ 中文 ▾] ⋯ ˄ ■"; Translate and Original live in ⋯.
```

**(e) Answer streaming.** Primary: the answer, with a 16px lead sentence (U5). Quiet: the transcript; the newest row drops to weight 400 while the answer exists. Hidden: nothing. Next action: read. The primary button reads "Answering…" in place, same width, disabled. There is no Stop, because the main process cannot cancel yet (U8; Owner Q6).
```
├──────────────────────────────── ═ ──────────────────────────────┤
│ Re: Same price as last time, but shipping is extra.   (11 muted) │
│ Ask what the shipping cost is and whether it is fixed.  (16/500)  │
│ They said price is unchanged; shipping is the open term …  (14)  │
│ [⚡ Answering…        ] [Clarify] [Recap] [Follow-up]             │
```

**(f) Transcription stopped / permission missing.** Primary: **Fix audio** (danger dot and icon; the words stay in primary text). Quiet: what to say, still usable on the existing rows. Hidden: tips (in the popover). Next action: Fix audio.
```
│ ✕ Transcription stopped [Fix audio]  [文 Translate ✓][→ 中文 ▾] ⋯ ˄ ■ │  rows exist: chip carries it
│ THEM                                                             │
│ … earlier rows unchanged …                                       │
── or, when the zone is empty ──
│ ✕ Transcription stopped                                          │
│   ScreenCaptureKit: permission denied          (real lastError)   │
│   [ Fix audio ]                                                  │
```

## 4. Background legibility

Facts: dark shell alpha is 0.92-0.975 (`overlayAppearance.ts:104`), 0.961 at the default slider 0.84, so a white glyph behind is ≤ 1.24:1 [calc] (1.1-1.25:1 [shot]). Light is 0.74-0.975 (`:50`): a black glyph shows at 1.9:1 at the minimum [calc]. Light never redefines `--text-tertiary` (1.3-1.9:1 [calc]). Blur is inert.

Decisions [rec]:
1. **Remove the transparent band** (Owner Q1): the window becomes the shell. Collapsing already hides the window (`PikaInterface.tsx:54`), so there is no pill-only state to design.
2. **Alpha floors.** Shell alpha becomes dark 0.95-0.985, light 0.94-0.985: worst ghost 1.14-1.15:1 [calc]. The slider keeps its stored range 0.35-1 (`pika_overlay_opacity`, no migration) and maps linearly onto it. Its minimum is the floor; nothing below is allowed.
3. **Delete `backdrop-filter`** on shell and pill (`overlayAppearance.ts:53,60,107,114`, `index.css:372,397`): cost, no effect.
4. **No text-protection layer**: above 0.94 it adds nothing. Delete the zone tints (`SplitterShell.tsx:43,55`).
5. **Hairlines** use `--overlay-border-soft` through a real class. The overlay never uses `text-text-*`.

| Token | Dark now → proposed | Light now → proposed | Why |
| --- | --- | --- | --- |
| Shell alpha (min-max) | 0.92-0.975 → **0.95-0.985** | 0.74-0.975 → **0.94-0.985** | Q7 |
| Pill alpha | removed with the pill | removed | Q8 |
| `--overlay-text-muted` | 0.80 (5.5-6.8:1) keep | 0.74 (3.2-4.7:1) → **0.82** (5.4-5.9:1) | Q9 |
| Placeholder | `--overlay-text-placeholder` 0.64 (4.1-4.8:1) → **use muted** | 0.60 (2.1-2.8:1) → **use muted** | Q9 |
| Warning and danger | text OK in dark (4.0-8.1:1) | **2.6-3.6:1: dot, icon, border only**; words in `overlay-text-primary` | Q9 |
| Hairline | gray-200 (bug) → `--overlay-border-soft` | same | Q12 |

## 5. Header and chrome budget

**Rule** [rec]: at 420px tall, chrome ≤ 140px, each content area ≥ 112px, and the splitter clamps in pixels, not 20-80% (`PikaInterface.tsx:27`).

| Part | Today [code] | Proposed |
| --- | --- | --- |
| Pill band (8 + 44 + 8) | 60 | 0 (merged) |
| Shell border | 2 | 2 |
| Top bar / transcript header | 33 | 36 |
| Status banner | 0-56 (amber box) | 0 (chip or zone line) |
| Splitter | 6 | 6 (1px line) |
| Answer header | 29 | 0 |
| Answer list padding | 28 | 8 (top only) |
| Chips row | 54 | 8 + 28 + 6 = 42 |
| Input | 42 | 36, Send inside |
| Footer + bottom padding | 52 | 0 + 8 |
| **Total chrome** | **≈306 (73%)** | **≈138 (33%)** |

At 420px: content = 420 − 138 = 282px. At the 55% split the transcript area gets 155px and the answer area 127px. At 40% they get 113 and 169. Both are ≥ 112, so Q3 holds at both defaults.

Overlay `minHeight` becomes 360 (138 + 2×112); today it is 1 (`WindowHelper.ts:211`). Collapsing hides the window, so the floor is safe; verify `updateContentDimensions` never asks for less.

- **Top bar** (36px, `draggable-area`, controls `no-drag`). Left: status chip. Right: Translate, `→ 中文 ▾`, `⋯`, Hide (chevron), Stop (■, two-press arm from `TopPill.tsx:21`). Below 480px, Translate and Original move into `⋯` and the status keeps a ≤ 12-character label, never colour only. At 380 the right group is ≈190px, leaving ≈150px for status.
- **`⋯` menu** (portal): Show original ⌥⌘O, Translate ⌥⌘T (below 480), Model ▸, Settings, Click-through, Open Pika window. The logo button and the footer row leave the chrome.
- **Composer.** Row 1 (28px): primary plus secondary chips; below 480px the secondary chips are icon-only 28px buttons with names (≈232px at 380, no scrolling). Row 2 (36px): input with Send inside its right edge. Below 400px tall, row 1 folds into a 28px ⚡ button left of the input.

## 6. One status component

Replace `sttStatus` and `sttNeedsTroubleshooting` with one pure, unit-tested `audioStatus(health, isConnected, meetingStartedAt, noSystemAudioSince, now)` returning `{ key, level, chip, zone, action }`. Its words render in one place (Q6): **the chip** when the transcript area has rows, **the zone line** when it is empty (the chip then shows only the dot, with a screen-reader label). **Amends** translation spec §6: the action is a visible button; the popover keeps only details (real `lastError`, tips, "Open audio settings").

| Key | Condition [code basis] | Level | Chip | Zone line (empty area) | Action |
| --- | --- | --- | --- | --- | --- |
| `off` | `!meetingActive` | info | ○ Not listening | Not listening. Start a meeting from the Pika window. | Open Pika |
| `starting` | `meetingActive && !isConnected`, < 10s since start (`main.ts:834`) | info | ○ Starting audio… | Connecting to call audio. This takes a few seconds. | none |
| `waiting` | connected, no chunk, < 8s (`useMeetingAudio.ts:133`) | info | ○ Waiting for audio | Waiting for sound from the call. | none |
| `listening` | `hasRecentSystemAudioChunk`, no recent transcript | info, neutral dot (was amber) | ● Listening | Listening. Their words appear here [in 中文]. | none |
| `live` | `hasRecentInterviewerTranscript` | ok, success dot, no pulse | ● Live | (rows) | none |
| `no-audio` | connected, no chunk ≥ 8s, no `lastError` | warn, amber dot and ▲ | ▲ No call audio · [Fix audio] | **No sound from the call yet.** If they are talking, Pika is not receiving it. Check that the call plays on your output device and that Pika has Screen & System Audio Recording permission. | Fix audio |
| `stopped` | `lastError`, or `!isConnected` ≥ 10s after start | blocking, danger dot and ✕ | ✕ Transcription stopped · [Fix audio] | **Transcription stopped.** {lastError, two lines, full text in the popover} | Fix audio |

- 380px labels: "Not listening", "Starting…", "Waiting…", "Listening", "Live", "No audio", "Stopped".
- **Fix audio** opens Settings; landing on the audio section needs an optional `section` argument (Owner Q5).
- Translation errors share the chip; the higher severity wins ("▲ Translation failing · [Check model]" after 2 consecutive errors, translation spec §6).
- Delete the amber box (`TranscriptPanel.tsx:64-81`), the `lastError` line (`:60-62`), `showSttErrorDetail`, the word "STT", `text-amber-*`, and the dot's `animate-pulse`.
- Gap: the mic-permission failure is broadcast as `meeting-audio-error` (`main.ts:815`) and nothing listens to it. File an issue.

## 7. Empty states

Each empty state is one line of text at 12/17, `overlay-text-muted`, with 12px top and 16px left padding (12px below 480). There is no box, border or icon, except ▲ or ✕ for warn and blocking. The area keeps its split height; nothing reflows when the first content arrives. With the floors in §4, an empty area reads as calm panel, not as a window onto the terminal.

| State | Transcript area | Answer area |
| --- | --- | --- |
| (a) off / starting | per §6 | Ask about your screen now, or wait for the call. |
| (b) no audio | §6 block: 14px title, 12px help, Fix audio (≈ 92px, fits the 113px minimum) | What to say needs their words first. Type a question to ask anyway. |
| (c) listening | Listening. Their words appear here [in 中文]. | When they ask something, press {⌘1} for what to say. |
| (d) live, no answer yet | (rows) | Press {⌘1} after a question for what to say. |
| (f) stopped, no rows | §6 block | You can still type a question or attach a screenshot {⌘⇧H}. |

`{…}` is a `KeyBadge` from the user's shortcut config (`useShortcuts.ts:41,63`), never hard-coded.

## 8. Type, spacing, colour

**Type scale**: four sizes, one family. Each size is new where noted and replaces the sizes listed.

| px / line-height | Weight | Use |
| --- | --- | --- |
| 11/16 | 500 | Status chip, speaker label, slot, key badges, meta |
| 12/17 | 400 or 500 | Source line, empty states, button and chip labels (was 10.5, `ChatPanel.tsx:509-523`), help text |
| 14/20 | 400 or 500 | Translation, transcript with translation off, answer body (14/22), input, zone titles in §6 |
| 16/24 | 500 | Answer lead sentence (U5) |

Removed from the overlay: 9, 10, 10.5, 11.5 and 13px. Zone labels are removed, not resized.

**Spacing** (4px grid): steps 4, 6 (between chips), 8, 12, 16. Horizontal padding 16px (12 below 480). Fixed heights: bar 36, controls 28, input 36, splitter hit 6. Text measure ≤ 680px (Q13).

**Colour**: surfaces `overlay-panel` (§4 alpha), `overlay-chip`, `overlay-input`; text `overlay-text-primary/secondary/muted` only; `state-success/warning/danger` for dot, icon and border (words of 12px+ in dark only). The primary fill becomes one token, `--overlay-action` = the existing hover value `#0071E3` (white text 4.7:1 [calc]; today's resting `#007AFF` is 4.0:1 and fails Q9 at 12px; `ChatPanel.tsx:509,694`). A moved value, not a new colour. KeyBadge keys on it use white ≥ 0.9 alpha: today `bg-white/8` generates nothing and the key "1" (`white/60`) is far below 4.5:1 (`KeyBadge.tsx:37-39`).

**Delete**: `ZoneHeader` and its labels; `TopPill` as a band and the logo button; zone tints; the dashed placeholder; the amber box; the footer row (model, settings, click-through to `⋯`; Send into the input); the `bg-slate-400` bounce dots (`ChatPanel.tsx:448-453`; busy shows on the button); `backdrop-filter` on shell and pill; every overlay `border-border-subtle/NN` (`SettingsOverlay.tsx` has the same bug: separate fix). Follow-up outside this plan: hard-coded `rgba(10,14,28,…)` and `blue-*` in the knowledge-context cards (`ChatPanel.tsx:458-500`).

## 9. Build plan

Ordered by user value; one branch and one PR each; every step runs the `docs/development.md` checks; every step needs the owner's look at 380/600 except V11 and V12. Files: PI `PikaInterface.tsx`, SS `SplitterShell.tsx`, TP `TranscriptPanel.tsx`, TH `TranscriptHeaderControls.tsx`, CP `ChatPanel.tsx`.

| # | Step | Files | Acceptance | `TASKS.md` |
| --- | --- | --- | --- | --- |
| V1 | `fix(overlay): answer zone never clips`: pure `clampSplit(heightPx, pct)` + test; `minHeight` 360 | PI, SS, `ResizableSplitter.tsx`, `WindowHelper.ts`, new `src/lib/splitClamp.ts` | Test: each zone ≥ 112 at 360/420/700; Q1 at 420 / 55% | Finishes **U7** |
| V2 | `fix(overlay): hairlines use the border token` | SS, TP, CP | No `border-border-subtle/` left; Q12 | New |
| V3 | `feat(overlay): one audio status`: `audioStatus()` + test, chip, zone line, popover; amber box gone | `useMeetingAudio.ts`, new `src/lib/audioStatus.ts`, TH, TP | Test covers every §6 row; Q6, Q14 | New; **amends** translation spec §6 |
| V4 | `feat(overlay): primary action follows the state` | CP, PI | Q4, Q5 in all 6 states | Amends **U3** |
| V5 | `feat(overlay): one-line empty states` | TP, CP | Q11; copy as §7 | Part of **U6** |
| V6 | `fix(overlay): legibility floor`: alpha ranges, no blur, light muted 0.82, placeholder = muted, `--overlay-action` | `overlayAppearance.ts`, `index.css`, overlay files | Test: shell alpha at slider 0.35 ≥ 0.95 dark / 0.94 light; Q7, Q9 | New; **owner Q2** |
| V7 | `feat(overlay): header controls as specified`: `→ 中文`, `⋯` below 480 | TH, menu in a portal | Q2 at 380 and 600 | Completes **T5** (spec §7) |
| V8 | `feat(overlay): two-row composer` | CP | Composer ≤ 86px; all actions reachable at 380, no scroll | Amends **U8** |
| V9 | `feat(overlay): top bar replaces pill and zone headers` | PI, `TopPill.tsx`, SS | Q3 (chrome ≤ 140 at 420), Q8 | Is **U4**'s layout; supersedes rest of **U6**; **owner Q1** |
| V10 | `style(overlay): four-size type scale` | CP, SS, TH, `KeyBadge.tsx` | Q10 grep = 0 | **Replaces U9** (no longer blocked) |
| V11 | `docs: overlay rules and DESIGN.md tokens` (budget, status-once, legibility floor) | `docs/conventions.md`, `DESIGN.md` | Rules quote Q3, Q6, Q7 | Is **S3** (DESIGN half) |
| V12 | Critique re-run on Q1-Q14, 380/600/1000, both themes, 6 states | none | Every Q ticked or filed | Is **U10** |

V1 and V2 are small and remove the two visible bugs, so ship them first. V3 to V5 fix the screenshot's state, V6 fixes the light theme, and V7 to V10 are structure.

## 10. Open questions for the owner

1. **Top bar instead of the pill and both zone headers** (V9); the bar alone saves ≈86px at 420 (the whole plan ≈168), Hide and Stop unchanged. *Recommend: yes.*
2. **Slider range** maps onto 0.95-0.985 dark, 0.94-0.985 light; a user at 35% gets a more opaque panel; no stored value changes. *Recommend: yes; see-through text is a defect, not a preference.*
3. **Native vibrancy** (macOS `vibrancy`, Windows `backgroundMaterial`) would give real blur once window = shell; it is a window-flag change near stealth. *Recommend: not now; revisit after V9 with a content-protection check.*
4. **Which build and slider value made the screenshot?** One spot is 1.6:1; code predicts ≤ 1.24:1. *Recommend: send the slider value and the running commit before V6.*
5. **Settings deep link** (`toggleSettingsWindow({ section: 'audio' })`, additive IPC). *Recommend: approve, so Fix audio lands on the fix.*
6. **Silence and Stop.** From code, silence does not stop chunks: the suppressor sends keepalive frames every 100ms (`native-module/src/silence_suppression.rs:10,54`, `lib.rs:189`) and each stamps `lastSystemAudioChunkAt` (`main.ts:645`). Unverified: whether the OS capture delivers frames while nothing plays. Stop while streaming needs main-process cancel (U8). *Recommend: watch the chip through 30s of a silent but routed call during V3's hand check; keep "Answering…" without Stop until cancel exists.*
