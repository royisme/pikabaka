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

Node 22.12 or newer; CI runs the oldest (22) and the newest (26), and `.node-version` is 26. `pnpm install` was verified on Node 26.10 and 22.22 (macOS arm64 only).

The system Node is not the app's Node: the app runs on the Node inside Electron (Electron 33 embeds Node 20.18). The system Node runs the toolchain (pnpm, vite, tsc, tap, electron-rebuild).

What made Node 26 work, and what to keep in mind:
- `better-sqlite3` is pinned to 12.11.1. 13.x is faster to install (N-API binaries ship in the package), but its binary needs N-API 10 and crashes Electron 33 on load (found by loading it with `ELECTRON_RUN_AS_NODE`). Move to 13.x together with the Electron upgrade (Electron 40 or newer). `postinstall` rebuilds better-sqlite3 for Electron.
- `pnpm-workspace.yaml` carries `nodeLinker: hoisted` and the overrides; pnpm 11 ignores `.npmrc`'s `node-linker` and the `pnpm` field of `package.json`. With the default isolated linker the packaged app lacked sharp's platform package and `onnxruntime-node`.
- `yauzl` is overridden to `^3.2.0`: Electron 33's install script unzips with a yauzl that never finishes on Node 26 and leaves a 256K `dist` with no Electron binary and no error. After an install, `cat node_modules/electron/path.txt` and `du -sh node_modules/electron/dist` (about 240M) show whether it worked. Drop the override with Electron 40 or newer.
- `keytar`, `sqlite3`, `tesseract.js` and the old `electron-rebuild` were removed: nothing imports them, and `sqlite3` was the package that pulled in `node-gyp@8.4.1`, which needs Python's `distutils` (gone in Python 3.12 and newer).
- Not verified: Windows, Linux, a signed and notarized build.

## pnpm caveat

pnpm 11 checks that `node_modules` matches the lockfile before running any `pnpm run` or `pnpm exec` script, and if it does not (here `node_modules/.modules.yaml` is missing) it runs a full `pnpm install` first, including every dependency's install scripts. That is why `pnpm run dev` printed only "Lockfile is up to date, resolution step is skipped" and then compiled `better-sqlite3` instead of starting Vite. An agent must not trigger that unasked: it rewrites `node_modules` and rebuilds native modules (it happened on 2026-10-26 while diagnosing, see `PROGRESS.md`). Run the tools through the local binaries instead:

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p electron/tsconfig.json --noEmit
node node_modules/tap/dist/esm/run.mjs --node-arg=--import=tsx "test/**/*.test.ts"
```

`pnpm run dev` starts Vite only (the renderer in a browser, without `window.electronAPI`). The app is `pnpm start` (`app:dev`).

## Checks

| Check | Command | Notes |
| --- | --- | --- |
| Typecheck | `pnpm run typecheck` (renderer, then Electron) | both exit 0 |
| Lint | `pnpm run lint` | ESLint 9 with the plugin's recommended TypeScript set; 1265 existing findings are warnings and the script caps them with `--max-warnings 1265`, so the number may go down and never up. Lower the cap in `package.json` when you fix some. Every other recommended rule is an error |
| Unit and integration tests | `pnpm run test` (tap over `test/**/*.test.ts`) | 755 passed on 2026-10-26 |
| Everything | `pnpm run verify` | typecheck, lint, test; the build scripts without `:raw` run it first |
| Build smoke | `pnpm run build:web:raw` and `build:electron:raw` | what `build-smoke.yml` runs |

CI runs two workflows on pull requests: `verify.yml` (typecheck, lint, tests) and `build-smoke.yml` (the two builds). Neither was exercised on GitHub from this checkout: the files are checked in, and a first run will show whether the macOS runner can run the tests.

Under an agent's shell, run the tools without pnpm when `node_modules` may be out of step (see "pnpm caveat"): `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js src electron test --no-inline-config --max-warnings 1265`, `node node_modules/tap/dist/esm/run.mjs --node-arg=--import=tsx "test/**/*.test.ts"`.

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
