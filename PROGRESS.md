# PROGRESS

What is done, what is broken, what is unverified. `TASKS.md` is what to do next; GitHub issues hold the evidence. Add to the top when a step lands or something breaks.

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
