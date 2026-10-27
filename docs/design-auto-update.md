# Auto-update

Status: decided by the owner on 2026-10-27; built on branch `auto-update`. This file holds the decision and the release contract. `TASKS.md` has the step, `PROGRESS.md` what landed.

## Problem (checked on 2026-10-27)

Pika ships `electron-updater` and an update modal, but a packaged build cannot update itself:

- `build.publish` in `package.json` is `null`. electron-builder then writes no `app-update.yml` into the app (it is the file that says where to look), and the build produces no `latest-mac.yml` (the feed `electron-updater` reads from a GitHub release).
- `scripts/release.js` uploads only the `.dmg`, the `.zip` and their blockmaps. `latest-mac.yml` is never uploaded.
- The GitHub releases v2.2.0 to v2.4.0 carry no installer assets, so nothing can be fetched from them.
- `ReleaseNotesManager` asks the GitHub API for `royisme/pika`, which answers 404 (the repository is `royisme/pikabaka`), so the modal never shows release notes.
- `quitAndInstallUpdate` still has a branch for unsigned apps (open Finder, ask the user to install by hand) and the modal has a matching "Manual Update Required" view with `xattr` commands. The app is signed and notarized now, so neither is needed.

## Decision

Keep `electron-updater` with the GitHub provider. The repository is public, so the app needs no token.

Rejected:

- **Velopack**: needs the .NET `vpk` tool and a new packaging and signing chain, produces a `.pkg` instead of the `.dmg`, adds a native module (about 13.6 MB), has one core maintainer, and its npm `engines` field excludes Node 26. Its open issue #975 says it does not verify the code signature of a downloaded bundle before swapping it into place. Its one real gain, binary deltas, does not repay that. `electron-updater` also supports blockmap differential downloads.
- **update.electronjs.org**: replaces the code with Electron's built-in `autoUpdater` plus an outside service, for no gain over fixing the config.

Existing 2.2 to 2.4 installs have no `app-update.yml`, so they cannot update. Those users install the first version built with this change by hand once; after that it updates itself. This holds for any updater we could choose.

## Behaviour

- Updates download as a block-level difference. `electron-updater` on macOS compares the new `-mac.zip.blockmap` with the `update.zip` it kept from the last update and fetches only the changed blocks (`MacUpdater.js`, `disableDifferentialDownload` stays off). The first update after a fresh install has no earlier `update.zip`, so that one is a full download; later ones are differences. The real size depends on how much of the `.app` changes between two builds; measure it on the first real update before promising a number.
- The app checks 10 seconds after start and then every 4 hours, only when `app.isPackaged`.
- An update downloads in the background (`autoDownload = true`). There is no modal while it downloads and no OS notification (`checkForUpdates`, not `checkForUpdatesAndNotify`).
- When the download finishes, the modal opens with "Restart & Install" and "Not Now". Nothing restarts the app on its own. If the user quits normally, the update installs on quit (`autoInstallOnAppQuit = true`).
- While a meeting is active, the finished-download notice waits. It is shown when the meeting ends. A restart in the middle of a call would lose the live transcript.
- Background errors are written to the log only. The modal has no error view. Settings keeps its own "Check for updates" button, which already shows checking, up to date and error states.

## Release contract

`package.json` `build.publish` is `{ provider: "github", owner: "royisme", repo: "pikabaka" }`. The build step never publishes (`--publish never` stays); the setting makes the build write `app-update.yml` into the app and `latest-mac.yml` next to the artifacts.

`scripts/release.js` uploads these files to the GitHub release, in this set and no other: `.dmg`, `.dmg.blockmap`, `-mac.zip`, `-mac.zip.blockmap`, `latest-mac.yml`. The script stops if any is missing. `latest-mac.yml` holds the sha512 of the `.zip` built in the same run, so all of them come from one build.

Order of a release: release-please merges its PR (tag and an empty GitHub release exist) then the owner runs `pnpm run release`. Between the tag and the upload, an update check fails with a missing `latest-mac.yml`. That is only logged, nothing shows to the user. Run the release script right after the merge to keep the gap short.

## Files

`package.json` (publish), `scripts/release.js` (upload list and its final message), `electron/lib/auto-updater.ts`, `electron/main.ts` (flush the waiting notice when a meeting ends), `electron/update/ReleaseNotesManager.ts` (repository name), `src/components/UpdateBanner.tsx`, `src/components/UpdateModal.tsx`, `docs/development.md` (Releases). No persisted shape, no IPC channel name and no dependency changes. The IPC channels `download-update` and `check-for-updates` stay.

## Not in scope

Windows and Linux updates (no such release is shipped), update channels or betas, a CI job that builds and uploads the installers, redesigning the modal, and tuning the block size of the differences.

## What the owner must check by hand

Automated checks cannot do these, and the agent did not:

1. Build the release for a version N+1 with the owner's signing setup, upload with `pnpm run release`, and confirm `latest-mac.yml` is on the release.
2. Install a packaged build of version N (one built with this change). Launch it and wait, or press "Check for updates" in Settings. Confirm it downloads silently and the modal then offers "Restart & Install", and that after restart `app.getVersion()` is N+1 and the app still opens (Gatekeeper accepts it).
3. On the second update after an install, read the log line from `MacUpdater` and the download size: it should say differential download and fetch far less than the full `.zip`. Report the size.
4. During an active meeting, confirm the modal does not appear, and that it appears after the meeting ends.
