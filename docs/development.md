# Development: commands and checks

pnpm is the only package manager (`.npmrc`: `node-linker=hoisted`). CI uses Node 22 and pnpm 11. The native audio module needs Rust.

## Run and build

- `pnpm install`: also runs `postinstall` (rebuilds `better-sqlite3` and `sqlite-vec` for Electron, downloads ML models). Owner-run.
- `pnpm run app:dev`: Vite on port 5180 plus Electron in development mode.
- `pnpm run build:web:raw`: `tsc` then `vite build`.
- `pnpm run build:electron:raw`: `tsc -p electron/tsconfig.json`.
- `pnpm run build:native:raw`: builds the Rust module.
- `pnpm run app:build` / `dist`, `app:notarize`, `release`: packaging, signing and release. Owner-run; see `RULES.md`.

The scripts without `:raw` run `verify` (lint plus test) first.

## Node version

Use Node 22 (`.node-version`, `engines` in `package.json`, and CI). Under Node 26 `pnpm install` cannot finish: `better-sqlite3@12.6.2` has no prebuilt binary for it, so it is compiled with node-gyp and the C++ build fails (`make failed with exit code: 2`). With fnm: `fnm install 22 && fnm use 22` (or `eval "$(fnm env --use-on-cd)"` in the shell profile so the version file is read). `.npmrc` does not set `engine-strict`: it would also apply to every dependency's `engines` field, which has not been checked on Node 22.

## pnpm caveat

pnpm 11 checks that `node_modules` matches the lockfile before running any `pnpm run` or `pnpm exec` script, and if it does not (here `node_modules/.modules.yaml` is missing) it runs a full `pnpm install` first, including every dependency's install scripts. That is why `pnpm run dev` printed only "Lockfile is up to date, resolution step is skipped" and then compiled `better-sqlite3` instead of starting Vite. An agent must not trigger that unasked: it rewrites `node_modules` and rebuilds native modules (it happened on 2026-10-26 while diagnosing, see `PROGRESS.md`). Run the tools through the local binaries instead:

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p electron/tsconfig.json --noEmit
node node_modules/tap/dist/esm/run.mjs --node-arg=--import=tsx "test/**/*.test.ts"
```

`eslint` is not declared in `package.json`; the lockfile resolves it only as a peer of `@typescript-eslint/*`, and it is not installed in that checkout. So `pnpm run lint` could not run there, and `verify` (and every script that runs it first: `build`, `electron:dev`, `app:build`) depends on a peer that may be missing (issue #35).

`pnpm run dev` starts Vite only (the renderer in a browser, without `window.electronAPI`). The app is `pnpm start` (`app:dev`).

## Checks

| Check | Command | Notes |
| --- | --- | --- |
| Typecheck, renderer | `tsc --noEmit` | exit 0 on 2026-10-26 |
| Typecheck, Electron | `tsc -p electron/tsconfig.json --noEmit` | exit 0 on 2026-10-26 |
| Unit and integration tests | tap over `test/**/*.test.ts` | 346 of 346 passed on 2026-10-26 |
| Lint | `pnpm run lint` (`eslint src electron test --no-inline-config`) | `rules` is empty, so this only checks that files parse; issue #35 |
| Build smoke | `pnpm run build:web:raw` and `build:electron:raw` | what CI runs |

CI (`.github/workflows/build-smoke.yml`) runs only the two `:raw` builds on pull requests. It does not run lint or tests (issue #35). Treat the table above as the local gate until that issue lands.

## UI changes

- There is no UI or end-to-end test suite, and none is required for a UI change. Logic that can be tested without a window (scroll-follow rule, message model, translation modules) gets a unit test in `test/unit/`.
- Visual acceptance is the owner's, in the running app: overlay at 380px and 600px width, light and dark theme, a streaming answer, a live transcript. The report lists what the owner must look at.
- Do not start Electron or a dev server on port 5180 if the owner already runs one.

## Finishing a change

1. Re-read your diff: no unrelated edits, debug output, screenshots or scratch files.
2. Run the checks above and read each exit code. Report which ran and which did not.
3. Update `TASKS.md` (the step leaves the queue, the next is named) and `PROGRESS.md`. Do not touch `CHANGELOG.md`.
4. Commit on a branch (`type(scope): summary`; no issue number in the title; `Fixes #N` in the body). End the message with the attribution lines the session requires.
5. Push and open a PR only when the owner asks. The PR template needs a type and a manual-test line naming the OS.
6. Report: what changed, what was verified and how, what was not run, what the owner must check by hand.

## Releases

release-please opens and updates a release PR from the conventional commits on `main` (`.github/workflows/release-please.yml`, config in `.release-please-config.json`). `feat`, `fix`, `perf`, `build`, `deps`, `refactor` and `revert` appear in release notes; `docs`, `style`, `chore`, `test` and `ci` are hidden. Pick the type with that in mind. Packaging, notarization and publishing are owner-run (`scripts/release.js`, `scripts/notarize-only.js`).
