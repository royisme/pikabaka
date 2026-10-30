# Development: commands and checks

pnpm is the only package manager (`.npmrc`: `node-linker=hoisted`). CI uses Node 22 and pnpm 11. The native audio module needs Rust.

## Run and build

- `pnpm install`: also runs `postinstall` (rebuilds `sharp`, downloads the ML models, checks `sqlite-vec`). Owner-run.
- `pnpm run app:dev`: Vite on port 5180 plus Electron in development mode.
- `pnpm run build:web:raw`: `tsc` then `vite build`.
- `pnpm run build:electron:raw`: `tsc -p electron/tsconfig.json`.
- `pnpm run build:native:raw`: builds the Rust module.
- `pnpm run app:build` / `dist`, `app:notarize`, `release`: packaging, signing and release. Owner-run; see `RULES.md`.

The scripts without `:raw` run `verify` (lint plus test) first.

## Node version

Node 22.19 or newer; Electron is 45.1.0; CI runs the oldest (22) and the newest (26), and `.node-version` is 26. `pnpm install` was verified on Node 26.10 and 22.22 (macOS arm64 only).

The system Node is not the app's Node: the app runs on the Node inside Electron (Electron 45.1.0 embeds Node 24.22.1, ABI 150, N-API 10). The system Node runs the toolchain (pnpm, vite, tsc, tap). Electron 42 and newer download their binary the first time `electron` runs, not at install: the first `pnpm start` fetches about 300M.

What made Node 26 work, and what to keep in mind:
- `better-sqlite3` is pinned to 13.0.3. Its N-API 10 binary ships in the package and loads in Electron 45 without a rebuild, so `postinstall` has no `electron-rebuild` step. Version 12.11.1 does not compile against Electron 45 (V8 API change); 13 needs Electron 40 or newer.
- `pnpm-workspace.yaml` carries `nodeLinker: hoisted` and the overrides; pnpm 11 ignores `.npmrc`'s `node-linker` and the `pnpm` field of `package.json`. With the default isolated linker the packaged app lacked sharp's platform package and `onnxruntime-node`.
- `keytar`, `sqlite3`, `tesseract.js`, `@electron/rebuild`, `electron-is-dev` and `@types/electron` were removed: nothing imports them, and `sqlite3` was the package that pulled in `node-gyp@8.4.1`, which needs Python's `distutils` (gone in Python 3.12 and newer).
- Not verified: Windows, Linux, a signed and notarized build.

## pnpm caveat

pnpm 11 checks that `node_modules` matches the lockfile before running any `pnpm run` or `pnpm exec` script, and if it does not (here `node_modules/.modules.yaml` is missing) it runs a full `pnpm install` first, including every dependency's install scripts. That is why `pnpm run dev` printed only "Lockfile is up to date, resolution step is skipped" and then compiled `better-sqlite3` instead of starting Vite. An agent must not trigger that unasked: it rewrites `node_modules` and rebuilds native modules (it happened on 2026-10-26 while diagnosing, see `PROGRESS.md`). Run the tools through the local binaries instead:

```sh
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit
node node_modules/tap/dist/esm/run.mjs --node-arg=--import=tsx "test/**/*.test.ts"
```

`pnpm run dev` starts Vite only (the renderer in a browser, without `window.electronAPI`). The app is `pnpm start` (`app:dev`).

## Credential storage and downgrades

Pika migrates `credentials.json` to OS-encrypted `credentials.enc` only after a verified round trip. An older Pika cannot read `credentials.enc`: downgrading after migration makes saved credentials and the settings in that file unavailable to the old version. Keep the encrypted file and use the newer version to regain access; do not delete it to fix a locked-store notice. When OS secure storage is unavailable, plaintext remains and Provider setup shows a notice. Tests substitute `safeStorage` and synthetic temporary stores; never exercise the real keychain in tests.
The donation record is a separate file (`electron-store`). The installed store 12 / `conf` 16 reads and writes what store 8.2 / `conf` 10.2 wrote, so no migration exists; the reverse is not true — a file written by the new version is encrypted with a derivation the old `conf` cannot read, and an older Pika shows the record as missing. Downgrading therefore loses that one record, not credentials or settings.

## Checks

| Check | Command | Notes |
| --- | --- | --- |
| Typecheck | `pnpm run typecheck` (renderer, then Electron) | both exit 0 |
| Lint | `pnpm run lint` | oxlint (`.oxlintrc.json`) with the TypeScript, unicorn, oxc and React plugins. It needs no TypeScript compiler API, so TypeScript 7 is supported. The 814 existing findings are warnings and the script caps them with `--max-warnings 814`, so the number may go down and never up; lower the cap in `package.json` when you fix some |
| Unit and integration tests | `pnpm run test` (tap over `test/**/*.test.ts`) | tap needs `--node-arg=--import=tsx` and `--node-arg=--disable-warning=DEP0205` on the current toolchain (`.taprc` disables the `@tapjs/typescript` plugin so TypeScript 7 works); 5252 assertions passed in 92 files on 2026-10-30 |
| Everything | `pnpm run verify` | typecheck, lint, test; the build scripts without `:raw` run it first |
| Build smoke | `pnpm run build:web:raw` and `build:electron:raw` | what `build-smoke.yml` runs |

CI runs two workflows on pull requests: `verify.yml` (typecheck, lint, tests) and `build-smoke.yml` (the two builds). Neither was exercised on GitHub from this checkout: the files are checked in, and a first run will show whether the macOS runner can run the tests.

Under an agent's shell, run the tools without pnpm when `node_modules` may be out of step (see "pnpm caveat"): `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/oxlint src electron test --max-warnings 814`, `node node_modules/tap/dist/esm/run.mjs --node-arg=--import=tsx "test/**/*.test.ts"`.

### Mutation check

Mutation testing is optional, reserved for a specific unresolved risk in important business logic. It is not a default development step or a delivery requirement (owner decision, 2026-10-30). Prefer a small regression test for the actual bug and checks at real integration boundaries.

- Tool: [unclebob/mutator](https://github.com/unclebob/mutator) (BSD-0, Python, tree-sitter only). It lives outside the repository and is not a dependency in `package.json`. Run it from a scratch worktree (`git worktree add --detach ../pika-wt/<name> main`, `node_modules` symlinked), never from the main checkout: it writes `.metrics/` and `target/`.
- Command: `mutator --no-coverage --max-workers 4 --test-command "node node_modules/tap/dist/esm/run.mjs --node-arg=--import=tsx --node-arg=--disable-warning=DEP0205 --disable-coverage test/unit/<the test>.test.ts" electron/<changed file>.ts`. `--no-coverage` is needed because tap with tsx writes no usable line coverage. A file of about 130 sites takes about two minutes.
- Read only the functions the change touches. Functions that the single test file does not exercise report 0% and mean nothing.
- A surviving mutant does not automatically require another assertion. Add a test only when the behaviour matters to the product and existing coverage does not protect it; stop once the identified risk is resolved.

## UI changes

- There is no UI or end-to-end test suite, and none is required for a UI change. Logic that can be tested without a window (scroll-follow rule, message model, translation modules) gets a unit test in `test/unit/`.
- Visual acceptance is the owner's, in the running app: overlay at 380px and 600px width, light and dark theme, a streaming answer, a live transcript. The report lists what the owner must look at.
- Do not start Electron or a dev server on port 5180 if the owner already runs one.

## Finishing a change

1. Re-read your diff: no unrelated edits, debug output, screenshots or scratch files.
2. Run the checks above and read each exit code. Report which ran and which did not.
3. Keep verification proportional to the business risk. Do not expand tests or add defensive code solely for coverage or mutation scores.
4. Update `TASKS.md` (the step leaves the queue, the next is named) and `PROGRESS.md`. Do not touch `CHANGELOG.md`.
5. Commit on a branch (`type(scope): summary`; no issue number in the title; `Fixes #N` in the body). End the message with the attribution lines the session requires.
6. Push and open a PR only when the owner asks. The PR template needs a type and a manual-test line naming the OS.
7. Report: what changed, what was verified and how, what was not run, what the owner must check by hand.

## Releases

release-please opens and updates a release PR from the conventional commits on `main` (`.github/workflows/release-please.yml`, config in `.release-please-config.json`). `feat`, `fix`, `perf`, `build`, `deps`, `refactor` and `revert` appear in release notes; `docs`, `style`, `chore`, `test` and `ci` are hidden. Pick the type with that in mind. Packaging, notarization and publishing are owner-run (`scripts/release.js`, `scripts/notarize-only.js`). The release script uploads `latest-mac.yml` with the installers. Installed apps read it to update themselves (see `docs/design-auto-update.md`).

tap runs without its TypeScript plugin (`.taprc`: `plugin: ["!@tapjs/typescript"]`) because that plugin needs the TypeScript compiler API, which TypeScript 7 does not have; tests are loaded through `tsx`. `.taprc` only takes effect after `tap build` regenerates the plugin set (a git-ignored build in `node_modules` and `.tap`), so the `test` script runs `tap build` first. When you call tap by hand in a fresh checkout or worktree, run `node node_modules/tap/dist/esm/run.mjs build` once.
