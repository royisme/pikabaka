# Conventions

The long form of the hard rules in `AGENTS.md`. The never-do list and working agreements are in `RULES.md`.

## Language of text

Documentation, code comments, commit messages, issues and PR text are in English. Comments explain why, not what. Product UI strings that already exist keep their current wording; there is no i18n framework in the renderer, so do not introduce one inside an unrelated change.

## Data and secrets

- Keys live in `CredentialsManager` and the user's `.env`; never in code, tests, fixtures or logs.
- Never invent data: no sample stats, fake scores or fallback AI answers. Empty means empty; failures show the real error, with a way to retry.
- Logs carry timings, ids, provider and model names. They never carry transcript text, answers, prompts or keys.

## Overlay UI

The overlay is read for one to three seconds mid-call. These rules come from the 2026-10-26 critique (issues #20 to #28).

**Hierarchy**
- The answer is the most prominent thing on the surface. The transcript supports it; chrome (buttons, chips, footer) is quieter than both. Exception (owner, 2026-10-26): when translation is on and no answer is streaming or pinned, the newest translated line is the most prominent text, because on a call the translation is what must be read (`docs/design-live-translation-ui.md`).
- One primary action, labelled for what it does, with its shortcut shown. Secondary actions are visibly secondary and collapse at narrow widths.
- The live line (the current partial transcript) is never dimmer than finished lines.
- Do not show text the user did not write as if they had. System prompts and quick-action text are not chat bubbles.

**Scrolling and streaming**
- A new answer scrolls its start into view once. Follow new tokens only while the user is within 32px of the bottom. No smooth scroll per token.
- Each scroll container has one owner. Do not nest scroll containers.
- Copy, stop and retry are visible controls on the answer, not hover-only.

**Layout**
- Controls never move the page. Loading, streaming and errors show on the control itself or in a reserved slot, not as a row that appears and disappears.
- Check a layout at the 380px minimum and the 600px default overlay width, with long text. Wrap or truncate with `min-w-0`; do not rely on fixed widths.
- At 380px nothing in the bar or the composer is cut off or needs horizontal scrolling; below 480px labels give way to icons and menus.
- Interactive elements inside a `draggable-area` need `no-drag`.

**Type and colour**
- Type is four sizes: 11px (meta, status, key badges), 12px (source lines, chip and button labels, help text), 14px (translations, answers, input) and 16px (an answer's lead sentence). Nothing to be read is under 11px; do not add another `text-[Npx]`.
- In the overlay use its own tokens: the `overlay-*` classes and `var(--overlay-*)` (for example `hover:text-[var(--overlay-text-primary)]`), `state-*` for a dot or border and `text-state-*-strong` for small coloured words. `text-text-primary` and the other `text-text-*` are not redefined for the light theme and turn near-white on the light panel. Three things generate no CSS and must not be used: an opacity suffix on a token colour defined as a bare `var()` (`border-border-subtle/50`, `bg-accent-primary/60`), a Tailwind variant on a custom `overlay-*` class (`hover:overlay-text-primary`), and `bg-white/8`-style values that are not on Tailwind's opacity scale. Raw palette classes (`text-slate-*`, `bg-red-500`, `text-emerald-400`) are not used in new code. Old code is not rewritten only for this.
- No gradients as decoration. Intent colours must carry meaning, not variety.
- Meaning is never carried by colour alone.

**Chrome budget, status, legibility** (`DESIGN.md`, `docs/design-overlay-v2.md` Q3, Q6, Q7)
- At a 420px window, everything except the transcript and the answers is at most 140px, and each of those two areas keeps at least 112px. A new row of chrome must come out of this budget; the pixel floors are in `src/lib/splitClamp.ts`.
- The audio status is spelled out in one place (`audioStatus()`): the top-bar chip when the transcript has rows, the transcript area when it has none. Do not add a second banner for the same condition.
- Panel opacity never goes below the legibility floor (`getOverlayAppearance`: 0.95 dark, 0.94 light); do not add `backdrop-filter` to the overlay, and do not put a transparent band around the panel.
- A divider uses `overlay-hairline`. `border-border-subtle/NN` generates no CSS; with `border-b` it falls back to the browser's light grey.
- At most one control is filled with `--overlay-action`; when the one thing to do is elsewhere (fix the audio), the primary action is quiet.
- An empty area is one line of muted 12px text, without a box.

**Accessibility**
- Every icon-only button has an accessible name.
- Keyboard focus is visible (`:focus-visible` is global in `src/index.css`); do not remove it with `outline-none` unless you add a replacement.
- `aria-live` regions must not re-announce on every token; announce completed answers.
- Text input honours IME composition: Enter does not submit while composing.
- Respect `prefers-reduced-motion`. The CSS rule covers CSS animation; motion run by framer-motion needs its own handling.

## IPC and persisted shapes

- A channel is added, renamed or removed in handler, preload, types and renderer in one commit (`docs/architecture.md`).
- Register handlers through `safeHandle`. Handlers validate the payload at the boundary and return the real error.
- A persisted key (SQLite column, credential key, localStorage key such as `pika_splitter_position`) is a released contract. A change that needs a migration is an owner decision.

## Git names and releases

- **Branches:** at most three words joined by hyphens; no slash and no type prefix. Examples: `answer-card`, `fix-scroll-follow`, `translation-timing`. Existing branches keep their names until merged or deleted.
- **Commits and PR titles:** `type(scope): summary`. Types: `feat`, `fix`, `perf`, `build`, `deps`, `refactor`, `revert`, `docs`, `style`, `chore`, `test`, `ci`. Scope is optional: `overlay`, `transcript`, `translation`, `stt`, `llm`, `ipc`, `settings`, `native`, `docs`. Example: `fix(overlay): keep the answer start in view while streaming`.
- **Issues:** `Fixes #N` in the PR body. No issue number in the PR title.
- **Changelog:** generated by release-please from the titles. Do not edit `CHANGELOG.md`. A user-noticeable change needs a title that shows up in the release notes (`feat`, `fix`, `perf`).

## Smallest design (first principles, Occam)

Start from what the task needs and build the least that does it.

- No defensive code for cases that cannot happen. Trust types and internal callers; validate at real boundaries (user input, IPC payloads, STT and LLM output, storage reads).
- No abstraction until a second real caller exists. Duplicating a few lines once is cheaper than a wrong interface. The existing rule applies in both directions: do not split a file for tidiness, and do not add to a very large file when a new module is the natural home.
- No speculative options, flags or config. Add one when a real need arrives.
- If two designs solve the task, pick the one with fewer moving parts.
- Before adding complexity for a rare race or security edge case, tell the owner the concrete failure, its likelihood and the cost, and get agreement.

## Code style

Applies to TypeScript in `src`, `electron` and `test`. Where existing code differs, match it and leave it alone.

- Validate an unknown value once, at the boundary that owns it. Pass typed values inward.
- Do not extract a single-use helper in advance. Inline it unless it is reused, hides a genuinely complex boundary, or has a clear independent name.
- Avoid `any` and avoid `try`/`catch` where an error can propagate to the boundary that reports it.
- Rely on type inference; annotate exports and unclear spots.
- Prefer `const`, early returns and `map`/`filter`/`flatMap` over reassignment, `else` and manual loops.
- New files stay under about 500 lines. This is a guideline, not enforced; `SettingsOverlay.tsx`, `LLMHelper.ts` and a few others already exceed it and are not split as a side effect of another change.
- Name a file for what it holds; avoid `utils`, `helpers`, `common`, `misc`.

## Tests

- Pure logic gets a unit test in `test/unit/` (tap). Examples: the scroll-follow rule, a message reducer, `EntityMasker`, the translation event model, the assembler.
- Test the real implementation; do not copy its logic into the test. Use invented text, not real transcripts.
- Prefer no mocks. STT and LLM providers are mocked by rule; say so in the report and never claim the real provider was exercised.
- An implementer does not weaken or delete an existing assertion. New tests come from the step's acceptance line.
