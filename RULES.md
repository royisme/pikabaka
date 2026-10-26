# RULES

What an agent (or a person) must never do in this repository, and the working agreements that keep a change reviewable. The **hard rules** are in `AGENTS.md` (loaded every session); their long form is `docs/conventions.md`. This file adds the prohibitions and the process, so nothing here repeats those.

## Never

**Secrets and private content**
- Never commit an API key, a `.env` file or anything under `.claude/`. Never read `.env` into a message or print a key.
- Never put real meeting, interview, transcript, screenshot or personal content into an issue, PR, commit message, test fixture or log. The repository is public. Use invented text.
- Never log transcript text, answers or credentials. Timings and ids are fine.

**Invented or overstated facts**
- Never invent data: no fake stats, scores, AI answers, translations or provenance. A failure shows the real error.
- Never report a check as passing without reading its exit code. Passing tests say nothing about typecheck or lint.
- Never claim a real STT service, LLM provider, microphone, audio device, Windows machine or the packaged app was exercised when it was not.
- Never state a UI or latency claim as measured when it was derived from code. Say "from code" and say how to verify it.

**Stealth**
- Never weaken content protection, capture exclusion or the always-on-top / click-through window behaviour, and never add telemetry on meeting content, without the owner.

**Scope and shape**
- Never add an abstraction before a second caller, a flag, an option or a dependency nobody asked for. Ask first for product scope, a new dependency, a new provider, or a persisted-shape change.
- Never rename or remove an IPC channel or a persisted key in only one place: preload, handlers, types and renderer move together.
- Never edit a generated or release-managed file by hand: `CHANGELOG.md`, `.release-please-manifest.json`, the `version` in `package.json`, `pnpm-lock.yaml` (except through pnpm), `dist/`, `dist-electron/`, `release/`.
- Never edit `native-module/` for a UI or translation task.
- Never reformat or rewrite code you are not changing.

**Tests**
- Never weaken, delete or loosen an existing assertion to make a change pass. If an assertion is wrong, say so and get it changed on its own.
- Never write a test by copying the implementation's logic. Derive it from the step's acceptance line.

**Git and environment**
- Never commit to `main`. Never push, open a PR, merge or force-push unless the owner asks. Never bypass a hook (`--no-verify`).
- Never `git add .` or `git add` a bare directory. Add explicit paths and read `git status` and `git diff --stat` first.
- Never run `pnpm install`, or a `pnpm run <script>` in a checkout where it triggers an install, without the owner's approval: `postinstall` rebuilds native modules and downloads models (`docs/development.md`, "pnpm caveat").
- Never run the release, notarize, `dist` or `app:build` scripts, and never touch signing or `.env` credentials: they are the owner's.
- Never start a second dev server or Electron instance on port 5180 while the owner has one running.
- Never name a branch with a slash or a type prefix, or with more than three hyphenated words; never write a commit or PR title that is not `type(scope): summary` (types: feat, fix, perf, build, deps, refactor, revert, docs, style, chore, test, ci). Do not put an issue number in a PR title; close issues with `Fixes #N` in the body.

**Delegation**
- Never trust a subagent's report: re-run every check, read the diff and the exit codes before relying on it.
- Never let a subagent mark a decision as made: owner decisions are recorded by the owner (label `needs-owner`).

## Working agreements

- **One small step at a time** (`TASKS.md`). A step has an acceptance line and an issue; it is done when the checks pass, the owner-manual checks are listed, and the diff has been read.
- **Read before you change**: the files you will touch, the issue, and the document for the area (`AGENTS.md` map).
- **Evidence first**: a bug issue names file and line. If a claim has not been seen in the running app, the issue says so and the first step is a check by the owner.
- **Verification report**: say what ran, what did not, and what the owner must check by hand (visual acceptance, real devices, real keys, Windows).
- **Platform before polish**: pipeline and structure before copy and visual refinement. Do not spend review rounds on wording while a structural step is open.
- **Docs move with the code**: module responsibilities move `docs/architecture.md`; a rule changes `RULES.md` or `docs/conventions.md`; a landed or broken step updates `PROGRESS.md`; the next step updates `TASKS.md`. The changelog is not on this list: release-please writes it.
- **One owner per fact**: if two files disagree, fix the one that is not the owner of that fact (`AGENTS.md`, document set) and say which in the PR.
