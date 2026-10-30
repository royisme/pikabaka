# Design: fewer code smells, by rules that fail the build

Status: plan for the owner to approve. Written 2026-10-30 after the "last meeting is still on screen" bug. No code changes in this step.

## What the bug taught

The overlay window is hidden between meetings, so React state lived on with nobody owning its lifetime. The fix was one `key` (reset by remount). The same shape of problem was copied into the main process: nine `run*` paths in `IntelligenceEngine` each hand-wrote the same "claim a generation id, re-check it after every await" pattern, and several missed a place. Both are one smell: **a lifetime rule written by hand at every site instead of once**.

## Measured on `main` (business code only)

| Smell | Count / place |
| --- | --- |
| `: any`, `as any` | 348 in `electron` and `src` |
| `(appState as any)` | about 30, in `helpers/stealth.ts`, `lib/audio-pipeline.ts`, `lib/transcript-assembler.ts` |
| `@ts-ignore` / `@ts-expect-error` | 7 |
| Files over 800 lines | `main.ts` 1420, `SettingsOverlay.tsx` 1324, `preload.ts` 1146, `DatabaseManager.ts` 1101, `useMeetingChat.ts` 992 |
| `useState` + `useEffect` calls in one file | `SettingsOverlay` 18, `useMeetingTranscript` 10, `PikaInterface` 9 |
| Effects whose only job is `setX(...)` | 0 found (good; keep it at 0) |
| Empty `catch` | 1 |

## Decisions

1. **No zustand, no new dependency.** The meeting state belongs to one component tree that is reset by remounting. A global store outlives a remount, so it would bring the bug back unless every slice also had a reset hook. Nothing today is shared between two distant components. Revisit only when a second real consumer exists (AGENTS.md, Occam).
2. **`useReducer` where state has transitions, `useState` for scalars.** A blanket ban on `useState` would turn a boolean toggle into a reducer. The rule: two or more `useState` that change together, or a setter called from more than one event, becomes one reducer with named actions. Candidates: `useMeetingTranscript`, the flag cluster in `useMeetingChat`.
3. **Effects by purpose** (the five patterns): derive instead of sync; data through `useQuery`; actions in handlers; one-time external sync in `useMountEffect`; reset with `key`. Written into `docs/conventions.md`.
4. **Rules must fail the build or they do not exist.** Every rule below is either an oxlint rule at `error`, or a ratchet script whose ledger can only go down.
5. **Boy-scout, not bulk.** No repository-wide refactor (the owner has not authorised one). A file is cleaned when a step already touches it.

## Steps (one branch and PR each; deepseek implements, the agent reviews; business code first, tests small)

| Step | Branch | What | Done when |
| --- | --- | --- | --- |
| H1 | `smell-ratchet` | `scripts/smell-ratchet.js` counts `any`, `as any`, `@ts-ignore`, files over 800 lines, and compares with a committed ledger; `pnpm run lint` and CI run it; the numbers can only go down. oxlint: turn the react-hooks rules and `no-floating-promises` to `error` for new files via overrides. | CI fails when any number rises. |
| H2 | `generation-guard` | One helper in `IntelligenceEngine` (`beginRun(mode)` returning `isCurrent()`), replacing the nine hand-written copies. Behaviour unchanged; the race tests from the meeting fix are the proof. | Each `run*` has no `++currentGenerationId` of its own. |
| H3 | `app-state-type` | A small interface for the `AppState` members that `stealth`, `audio-pipeline` and `transcript-assembler` use; remove their `as any`. | `as any` count in those three files is 0. |
| H4 | `transcript-reducer` | `useMeetingTranscript` and the `useMeetingChat` flag cluster move to `useReducer`; pure reducer, unit-tested with invented actions. | No setter is called from two places without going through `dispatch`. |
| H5 | `settings-split` | `SettingsOverlay.tsx` split by tab into files under `src/components/settings/`, no behaviour change. | No file over 800 lines in `src`. |
| H6 | `conventions-effects` | The five effect patterns and the `key` rule in `docs/conventions.md`; one line in `AGENTS.md` pointing to it. | Doc merged. |

Order: H1 first (it makes every later step measurable), then H2 and H3 (small, mechanical), then H4, H5, H6.

## Risks

- **Most fragile assumption:** the ratchet counts text patterns, so it can be gamed (`as unknown as X` instead of `as any`). It is a guard against drift, not a proof of quality; reviews still read the diff.
- **H4 changes the hot path** of the overlay. It ships alone, with the meeting-reset test kept green, and the owner checks one real call (both speakers, translation, end and restart).
- **H5 is large and mechanical.** Skip it if no other step touches `SettingsOverlay`.

## Not doing

zustand or any store; a ban on `useState`; renaming files for taste; a bulk `any` clean-up.
