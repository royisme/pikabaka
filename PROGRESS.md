# PROGRESS

What is done, what is broken, what is unverified. `TASKS.md` is what to do next; GitHub issues hold the evidence. Add to the top when a step lands or something breaks.

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
