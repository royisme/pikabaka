# TASKS

The work queue in small steps, one at a time. GitHub issues hold the evidence and the owner decisions (labels `ui`, `translation`, `needs-owner`, `tracking`); this file is what to do **next**, in order, with what makes each step done. Update it when a step starts, lands or is replaced; finished steps move to `PROGRESS.md`.

**A step is done when:** its acceptance line holds, both `tsc` checks and the `test/` tap run exit 0 (read the exit codes; `docs/development.md`), lint also exits 0 once #35 lands, the diff has been read, and the owner-manual checks it lists are written down for the owner. Visual acceptance, real devices, real keys and Windows are the owner's and are listed under "Owner" until done.

Each step is one branch (`RULES.md`: at most three hyphenated words) and one PR that says `Fixes #N` for its issue.

## Order

S (rules and tooling) first. U0 (owner runtime check) can happen in parallel at any time. After that, U and R run as two independent tracks; inside a track, go in order.

## S. Rules, tooling, context

| # | Step | Acceptance | Issue | State |
| --- | --- | --- | --- | --- |
| S1 | Land the rule set: `AGENTS.md`, `CLAUDE.md` import, `RULES.md`, `docs/conventions.md`, `docs/development.md`, `docs/architecture.md`, `TASKS.md`, `PROGRESS.md` | links resolve; the owner has read and accepted or changed the rules and the three decisions under "Owner" | none | committed on branch `project-rules` (owner approved 2026-10-26). `AGENTS.md` and `CLAUDE.md` stay git-ignored by the owner's choice (`.gitignore` lines 199-200), so they exist in this checkout only and are not in the commit; the other documents link to `AGENTS.md` regardless |
| S2 | Make lint and CI real: a `typecheck` script for `src` and `electron`; an ESLint rule set that passes on the current tree; CI runs typecheck, lint and `test/` on pull requests | a PR with a deliberate type error and one with a deliberate lint error each fail CI; `pnpm run verify` exits 0 on `main` | #35 | not started; **needs the owner's approval first**: it adds `eslint` as a devDependency and needs an install, and `RULES.md` forbids both without asking |
| S3 | Write `PRODUCT.md` (impeccable init) and `DESIGN.md` (impeccable document from the existing tokens in `src/index.css`) | `PRODUCT.md` states audience, the glance-first use, stealth and what Pika never claims; `DESIGN.md` lists the real tokens; `AGENTS.md` table no longer says "not written yet" | #28 | not started; blocks U5 |
| S4 | Retire stale docs: mark `docs/UI_DESIGN_AUDIT.md` superseded (it says there is no `focus-visible`, no reduced-motion rule and no semantic state colours; all three exist); add `docs/HANDOFF.md` to `.gitignore` for live session state; fix `CONTRIBUTING.md` (2 `npm` references) and `README.md` (4) that still say `npm install` / `npm start` while the project is pnpm-only | the audit file starts with a pointer to #28 and `docs/conventions.md`; `git check-ignore docs/HANDOFF.md` prints the path; no `npm ` command is left in `CONTRIBUTING.md` or `README.md` | none | done on branch `docs-hygiene` |

## U. Conversation area (epic #28)

Direction: answer first, one primary action, transcript as supporting evidence (`docs/conventions.md`, "Overlay UI"). Platform before polish: structure and behaviour first, type scale and wording last.

| # | Step | Acceptance | Issue | State |
| --- | --- | --- | --- | --- |
| U0 | **Owner:** open the running overlay at 600px width; write down the real first-show height, whether the splitter drags or moves the window, and whether the chips row clips at 380px | the numbers and a screenshot are on #22 and #26 | #22, #26 | owner |
| U1 | Scroll-follow rule: a new answer scrolls its start into view once; follow tokens only within 32px of the bottom; no smooth scroll per token. The rule is a small pure function with a unit test | test covers near-bottom, far-from-bottom and a new message; owner checks a streaming answer by hand | #20 | done on branch `fix-scroll-follow` (checks pass, 359 tests); owner checks a streaming answer by hand, then it moves to `PROGRESS.md` |
| U2 | Quick actions stop inserting a synthetic user bubble. With a screenshot attached, only a screenshot bubble is shown (no prompt text). The "Re: <latest other-party sentence>" line moves to U5 (the answer card) because it needs the transcript model from the live-translation design | `submitPrompt` takes `echoPrompt`; what-to-say, code hint and brainstorm pass false; a typed prompt still shows the user's text; unit test on `userEchoMessage` | #21 | done on branch `drop-synthetic-bubble` (stacked on `fix-scroll-follow`; 367 tests); owner looks at a quick action with and without a screenshot |
| U3 | One primary action; Enter sends typed text; dead Stop/Listening branches and unused `isManualRecording` plumbing removed | `Guide me` and `Answer` are one control; the hint matches behaviour; `tsc` finds no leftover reference | #23 | done on branch `one-primary-action` (stacked); owner checks the primary button at 380px |
| U4 | **Owner decision, then brief:** confirm the answer-first layout and the transcript position (it was placed above the answer on purpose in the 2026-05-06 handoff). Write the shaped brief (impeccable shape) | the owner's choice is recorded on #28; the brief lists the pinned answer card, transcript rows, actions, default height | #28 | blocked on S3 and the owner |
| U5 | One `AnswerCard` for live and post-meeting views: "Re:" header, intent chip, lead sentence, details, per-code-block copy; the code branch no longer pre-empts the intent | `ChatPanel`, `MeetingChatOverlay`, `GlobalChatOverlay` and `MeetingDetails` use it or are deleted; speaker names match across live and post-meeting | #25 | partly done on branch `answer-render` (precedence, language default, line numbers); the shared AnswerCard, "Re:" line and speaker vocabulary remain |
| U6 | Transcript as flat rows: last 2-3 lines, live line at full contrast, one scroll container, status as a dot, real speaker label for the partial line | no nested `overflow-y-auto`; no `text-[9px]` or `text-[10px]` left in the transcript for readable text; owner checks it at 380 and 600px | #24 | superseded for the rows by T1 to T3 (the spec's layout); what is left here is the zone's size and position, which waits on U4 |
| U7 | Default overlay height of at least 420px, persisted; message area `min-h`; chips and footer collapse when short; splitter gets `no-drag`, `role="separator"`, arrow keys and double-click reset | owner confirms on U0's numbers; unit test on the persisted-size clamp | #22, #26 | done on branch `overlay-size` (stacked) except the short-window collapse; owner checks height and splitter on macOS and Windows |
| U8 | The remaining gaps: visible copy and retry, stop a stream, IME guard, chips at 380px, Stop confirm, accessible names, error styling with retry, delete `SuggestionOverlay` and `KeyBadge` or use them | each checkbox on #27 is ticked or struck with a reason | #27 | done on branch `conversation-gaps` (stacked) except stop-stream and Retry (need main-process support); owner checks at 380px |
| U9 | Collapse the 9 pixel font sizes in the conversation components to a small scale; readable text at least 11px | `grep -c "text-\[[0-9.]*px\]"` over the conversation components drops from 90 and the remaining sizes are on the scale in `DESIGN.md` | #24, #28 | blocked on U6 |
| U10 | Re-run the critique on the overlay and record the score | score above the 14/40 baseline; new issues filed for anything found | #28 | after U9 |

## R. Real-time translation (epic #34)

Direction: port the ideas from the OmniVoice project (`../OmniVoice`, macOS-only Swift) to TypeScript. No Swift rewrite: OmniVoice needs macOS 26+, Pika also targets Windows. Local models and a macOS helper process are deferred until the latency numbers exist.

| # | Step | Acceptance | Issue | State |
| --- | --- | --- | --- | --- |
| R1 | Timing logs per segment: source final, request, first token, complete, provider, model. Ids and times only | numbers for two providers are posted on #29 | #29 | logs landed on branch `translation-streaming`; the numbers for two providers need a real call (owner) |
| R2 | Streaming translation request and token events; `translationState: 'streaming'`; a reopened turn cancels its request | unit test: a superseded `segmentId + revision` writes nothing; providers that cannot stream deliver one chunk | #30 | done on branch `translation-streaming` (stacked); owner runs a real call per provider |
| R3 | `committed` plus `preview` event model; the row shows muted preview that disappears when the commit covers it | unit test on the reducer: committed only appends, preview is replaced; committed text never moves | #31 | not needed for streamed LLM text (it is append-only); relevant only for early translation, see R5 |
| R4 | `EntityMasker` in TypeScript with tests (read the OmniVoice source in full first) | mask and restore tests for URL, path, flag, snake_case, filename, backticks and a model that drops placeholders | #32 | module ported and tested on branch `entity-masker-port`; not wired (speech transcripts rarely contain such entities) |
| R5 | **Owner decision:** design note for stable-prefix and early translation against second-pass correction; audit which STT providers send full-replace hypotheses | the note answers the three questions on #33 and the owner has agreed | #33 | blocked on R3 |

## T. Live translation UI for calls (epic #38)

Design: `docs/design-live-translation-ui.md`. The owner wants to use Pika on a phone or video call and read a clear live translation of the other party. Translation first (14px), original beneath (12px); one scroll container; a reserved line per translation. Steps T1 to T6 work with today's non-streaming pipeline; T9 and T10 wait for R2 and R3. T1 to T4 do not need the zone-position decision (U4); they change row internals and scrolling only. They replace U6 for the transcript rows.

| # | Step | Acceptance | Issue | State |
| --- | --- | --- | --- | --- |
| T1 | Flat rows, translation first, honour `displayMode` (`RollingTranscript.tsx`) | `translated` hides the source until expanded; `both` puts translation above source; a unit test covers the per-mode choice; no `text-[9px]` or `text-[10px]` left in the file | #36 | done on branch `transcript-rows` (stacked; 385 tests); owner checks at 380 and 600px |
| T2 | One scroll container and the transcript follow rule (`nextTranscriptScroll` next to `answerScroll.ts`, jump pill with a count) | no nested `overflow-y-auto`; unit test covers pin, hold, resume | #38 | done on branch `transcript-follow` (stacked; 393 tests); owner checks on a live call |
| T3 | Reserved slot and line states: pending with elapsed time, error with Retry, same language, not configured | a late one-line translation moves nothing above it (reducer test plus a hand check) | #38 | done on branch `translation-slot` (stacked; 423 tests); owner hand-checks that a late translation moves nothing above it |
| T4 | Revision-safe translations (`translatedRevision`) | reopened turn marks the old translation updating, never current | #37 | done on branch `revision-safe-translation` (stacked; 443 tests) |
| T5 | Zone header controls and status dot (on/off, target language, original toggle) | settings persist through the existing `set-transcript-translation-settings` channel; "Set up translation" opens Settings | #38 | done on branch `transcript-header` (stacked); owner checks at 380px |
| T6 | Announcer and keyboard (`aria-live` off on the list, one announcement per complete translation, End resumes follow) | VoiceOver reads each complete translation once and no partials | #38 | done on branch `transcript-a11y` (stacked); owner checks with VoiceOver |
| T7 | Global toggle shortcuts | `Cmd+Alt+O` and `Cmd+Alt+T` work while the overlay is unfocused; Windows defaults chosen on a real keyboard | #38 | done on branch `translation-shortcuts` (stacked); owner checks the shortcuts on macOS and a real Windows keyboard |
| T8 | Error reason on the translation event | the slot shows "timeout" or "auth"; logs carry no text | #38 | done on branch `translation-error-reason` (stacked); owner checks with a wrong key and with the network off |
| T9 | Streaming tokens in the slot | first token appears within the time measured on #29; a superseded revision writes nothing | #38 | done on branch `translation-streaming` with R2 |
| T10 | Committed and preview rendering | reducer test: committed only appends, preview is replaced; owner checks committed text never moves | #38 | blocked on R5: only early translation produces a preview |

## V. Overlay v2, the minimum bar (`docs/design-overlay-v2.md`)

Owner approved on 2026-10-26: the top bar instead of the pill and both zone headers (V9); the panel opacity ranges 0.95-0.985 dark and 0.94-0.985 light (V6); a Settings deep link for "Fix audio" (V3); and V1 to V10. Acceptance is the spec's Q1 to Q14. V1 finishes U7, V4 amends U3, V8 amends U8, V9 is U4's layout and supersedes the rest of U6, V10 replaces U9, V11 is S3 (the DESIGN half), V12 is U10.

| # | Step | Acceptance | State |
| --- | --- | --- | --- |
| V1 | Answer zone never clips: pixel floors for both zones, overlay `minHeight` 400 | unit test: both zones above their floors at 350px, 250px and 1000px; owner checks at 420px with translation on | done on branch `overlay-split-clamp` |
| V2 | Hairlines use a real border class (`border-border-subtle/NN` generates no CSS) | no `border-border-subtle/` left in the overlay files; Q12 | done on branch `overlay-hairlines` (written by a Gemini 3.8 worker through pi, merged by the lead) |
| V3 | One audio status: `audioStatus()`, chip, zone line, Settings deep link; the amber box is gone | unit test covers every row of spec section 6; Q6, Q14 | done on branch `audio-status`; owner checks the chip over a quiet call and the Fix audio deep link on macOS and Windows |
| V4 | The primary action follows the state ("Fix audio" when there is no audio) | Q4, Q5 in all six states | done on branch `primary-follows-state`; owner checks the six states |
| V5 | One-line empty states | Q11 | done on branch `empty-states` |
| V6 | Legibility floor: alpha ranges, no `backdrop-filter`, light muted 0.82, placeholder = muted, `--overlay-action` | unit test: shell alpha at the lowest slider value is at least 0.95 dark and 0.94 light; Q7, Q9 | done on branch `overlay-legibility`; owner checks the lowest slider value over a busy page in both themes |
| V7 | Header controls as specified: short language label, overflow menu below 480px | Q2 at 380 and 600 | done with V9 on branch `overlay-top-bar` |
| V8 | Two-row composer | composer at most 86px; every action reachable at 380 without scrolling | done on branch `overlay-composer` (written by a GPT-6.1 worker through pi, merged by the lead) |
| V9 | Top bar replaces the pill and both zone headers | Q3 (chrome at most 140px at 420px), Q8 | done on branch `overlay-top-bar` (with V7); owner checks the bar and menu at 380, 600 and 1000px |
| V10 | Four-size type scale (11, 12, 14, 16) | Q10 grep finds nothing | done on branch `overlay-type-scale` |
| V11 | Overlay rules and `DESIGN.md` tokens | rules quote Q3, Q6, Q7 | not started |
| V12 | Critique re-run on Q1 to Q14 | every check ticked or filed | after V10 |

## Owner

- Decided 2026-10-26: new branches use the relire naming (no slash, at most three words; existing branches keep their names); docs, issues and PR text are in English; `AGENTS.md` and `CLAUDE.md` stay git-ignored. Persisted shapes are released contracts because 2.2.0 has shipped.
- U0: the runtime numbers.
- U4: the transcript position decision.
- Visual acceptance after each U step: overlay at 380 and 600px, light and dark, a streaming answer, a live transcript.
- Windows: issue #15 says no Windows build has been released. Any step that touches window behaviour is checked on macOS only until that changes, and says so.
- Real STT and LLM provider checks for R2 and R3 (the agent mocks providers).
- Live translation spec (T): approved 2026-10-26 with all six recommendations as written (transcript above the answer and 55% when translating; own speech not translated; ship 14px and check on a real call; `Cmd+Alt+O` and `Cmd+Alt+T` on macOS, `Ctrl+Shift+F9/F10` on Windows to be confirmed on a real keyboard; requests keep running in `original` mode; optional error reason on the event). The Overlay UI rule in `docs/conventions.md` is amended accordingly.
