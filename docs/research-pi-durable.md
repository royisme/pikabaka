# Research: pi-durable as Pika's agent runtime

Status: research for the owner's decision, 2026-10-26. Nothing here is installed in the repo.

## Question

Pika is to become a meeting partner built on live translation, a complete meeting record and an agent: one the user talks to in the chat panel during the meeting (questions, look-ups, local commands with approval, like Claude Code or pi), and one that decides from the meeting content when to offer help, using TypeSafe's Jev decision model. Can `@earendil-works/pi-durable` be that agent runtime inside Pika's Electron main process?

## What pi-durable is

`@earendil-works/pi-durable` 1.4.0 (MIT, ESM only, Node 22.19 or newer) is "a durable agent harness": conversations, model turns, tool calls and app state are committed to storage before anything is shown, and a restarted process resumes unfinished work. It is built on `@earendil-works/pi-ai` (models) and `@earendil-works/chord` (document state). The pieces that matter here:

- Conversations of immutable entries; app entries of our own kind (`meeting.segment`) that the model sees.
- `submit()` with `whenBusy: "steer" | "follow-up" | "reject"`, idempotent by `requestId`.
- Tools (`defineTool`), built-in `read`, `write`, `edit`, `bash` over an `ExecutionEnv` (`NodeExecutionEnv` with a `cwd`).
- Hooks: `beforeTool` may return a Promise, so a call can wait for the user's approval; a throw blocks.
- `viewState()`, `watch()`, `watchEvents()` for a UI; partial answers committed every 100 ms.
- Automatic and manual compaction; older entries stay in storage.
- Subagents and child tasks, sleeping tasks that survive restarts.
- Storage: memory, JSONL, SQLite through Node's built-in `node:sqlite` (one owner process per file).

Jev is reachable through pi-ai's `models.classify()` (`type: "classifier"` models; `choice`, `score` and `bool` questions with calibrated probabilities): `typesafe/jev-latest` with `TYPESAFE_API_KEY`, or through OpenRouter, Cloudflare Workers AI, Vercel AI Gateway, OpenCode. The owner's magpie gateway serves decision models at `POST /v1/systemone`, and the owner reports that Jev is configured there through OpenRouter. Pika has not sent a classification request yet.

pi-ai takes an injected `CredentialStore`, so keys can come from Pika's `CredentialsManager` instead of environment variables. It has no built-in Ollama provider (custom OpenAI-compatible providers are documented, not tried).

## Experiments

All in `/tmp`, nothing installed in the repo.

1. `npm install --ignore-scripts @earendil-works/pi-durable@1.4.0 @earendil-works/pi-ai@1.4.0 @earendil-works/chord@1.4.0 typebox@1.3.27`: 91 packages, 112 MB of `node_modules`.
2. A CommonJS script run with Electron 44.9.3 as Node (`ELECTRON_RUN_AS_NODE=1`, Node 24.22.0):
   - `node:sqlite` is available.
   - `require('@earendil-works/pi-durable')` works (require of ESM).
   - `require('@earendil-works/pi-ai/models')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`: pi-ai's subpaths export only the `import` condition. `import()` works.
   - On SQLite storage, with pi-ai's faux provider: a `meeting.segment` entry with model content was written, an input ran one tool call (`run_command`) and answered (`settled: done`, tool ran once); after close and reopen the entries were `meeting.segment, pi.user, pi.system, pi.assistant, pi.tool-result, pi.assistant`; resubmitting the same `requestId` returned the same submission.
3. `tsc` on a file with `await import('@earendil-works/pi-ai/models')`: with `module: CommonJS` (Pika's `electron/tsconfig.json` today) the output is `require(...)`, which fails as in 2; with `module: node16` it stays `import(...)`.
4. `tsc -p electron/tsconfig.json --noEmit --module node16 --moduleResolution node16`: 3 errors, all type imports from ESM packages (`electron/core/LLMHelper.ts:1`, `electron/llm/types.ts:4`, `electron/rag/providers/LocalEmbeddingProvider.ts:51`). With `--module nodenext --moduleResolution nodenext` instead: 0 errors and no source edits (re-run on 2026-10-26 on the merged `main`). The design uses `nodenext`.
5. A fresh install, searched for files read at runtime: no `.md`, `.ts` or `.map` file is read outside pi-durable's `testing/` folder, so electron-builder's `!**/node_modules/**/*.{md,ts,map}` exclusion should not break the packages.

## What the README settles, not yet run

- `beforeRequest` (a `GenerationTask` hook) replaces the messages of one request. The design uses it to add the recent transcript without storing it; whether those messages stay out of storage is an A3 check.
- A tool runs again after a crash only when it is declared `replay: "safe"`; otherwise the model gets an `interrupted` result. Pika's local tools stay not replay-safe, so an interrupted command is never re-run.
- Nested calls through `api.executeTool()` run the `ToolTask` hooks too. The design still enforces approval inside Pika's own tools.
- `abandonOnRestart` and `abortTask()` exist for tasks that must not resume; whether they cover every live task of an ended meeting's store is an A3 check.
- Sections (system prompt parts) are stored as positional system entries when they change, so a per-request transcript must not go through a section.

## Risks

- Maturity: first release 2026-09-19, 17 releases by 2026-10-21, breaking changes in most minor versions (1.2.0 and 1.4.0 among them). The README says the API changes without notice. Pin an exact version and keep every `pi-*` import inside one module.
- Not verified: loading the ESM packages from inside a packaged `app.asar`; a real model through pi-ai with Pika's keys; a real Jev call; Ollama through a custom provider.
- Security: the other party's speech is untrusted input. An agent with `bash` that runs on their words is a prompt-injection path. Proactive runs must not get `bash`, `write` or `edit`, and those tools need the user's approval on every call.
- A packaged macOS app started from Finder has a minimal `PATH`; `git`, `pnpm` and Homebrew tools will not resolve in `NodeExecutionEnv` without resolving the login shell's `PATH`.

## Alternatives considered

- A tool loop on top of `IntelligenceEngine`: no durability, and the inbox (steer, follow-up), compaction, approval hooks and UI state would all be ours to write.
- `pi` (the coding agent) as a child process in RPC mode: mature, but a separate install or bundle, a session format built for coding, and less control over meeting entries.

## Reproduce

The probe script was a throwaway in `/tmp` and is not kept. Steps 1 to 4 above are enough to redo it: install the four packages in an empty directory, then run a CommonJS file that loads them with `import()` under `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, using `fauxProvider()` from `@earendil-works/pi-ai` and `openNodeSqliteStorage()` from `@earendil-works/pi-durable/storage/sqlite/node`.
