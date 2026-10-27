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
- Background errors are written to the log only. The modal has no error view. The About tab has an Updates card (below) that shows checking, downloading, ready and error states.

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

## Updates card (About tab)

The one-button "Version" row in Settings > General is replaced by an Updates card in Settings > About. It copies the structure of the Updates card in quotio (`../../ops/quotio`, `Quotio/Views/Screens/SettingsScreen.swift`, `UpdateSettingsSection`, and its `screenshots/about.png`): a titled card, a switch for automatic checks, a status line with one action on the right, and a "Last checked" line. Pika keeps its own tokens, type and spacing (`DESIGN.md`); only the layout and behaviour are copied. quotio's "Receive beta updates" switch is not copied: Pika has no beta channel.

```
Updates
Current version                          v2.4.0   (mono)
Automatically check for updates            [switch]
-------------------------------------------------
<status text>                        [action button]
Last checked                          26 sec ago
```

The card follows `DESIGN.md`: no decorative icon, no spinner (a working state says so in words on its button), state shown by a dot or a glyph plus words, only tokens of the base family, and at most one filled control. The one filled control is `Restart & Install`; `Check Now` is not filled.

Status line (one fixed-height row, so the card never changes height between states):

| State | Mark and text | Action on the right |
| --- | --- | --- |
| nothing checked yet | no mark, "Not checked yet" in secondary text | `Check Now` |
| checking | no mark, "Checking for updates" | `Checking…`, disabled |
| up to date | `state-success` dot, "Up to date" | `Check Now` |
| downloading | no mark, "Downloading version X" and the percent | `Downloading…`, disabled |
| ready | `accent-primary` dot, "Version X is ready to install" | `Restart & Install` (the filled control) |
| error | `✕` in `state-danger`, a readable sentence, and under it the first line of the real error | `Check Now` |

Errors are readable (`src/lib/updateError.ts`, `describeUpdateError`): the main process reports one long string (a Chromium code, an HTTP status, a stack), so the card shows a sentence that says what to do (no connection, the release has no update files yet, GitHub is limiting requests or having problems, the download failed verification, not enough disk space, or a generic line) and keeps the first line of the real message below it, with the whole text as the tooltip. The cause is never hidden.

"Last checked" shows a relative time ("26 sec ago", "3 hr ago") or "Never", and refreshes every 30 s while the card is open. It is the time of the last check that finished, kept in memory by the main process, not saved to disk; the 10-second check after launch fills it in.

Behaviour:

- The switch saves the setting `autoCheckUpdates` in `settings.json` (`SettingsManager`), default on. When off, the check 10 seconds after launch and the 4-hourly check are skipped; `Check Now` still works. This adds one persisted key (owner approved on 2026-10-27); a missing key means on, so no migration.
- The card asks the main process for its state when it opens (`get-update-state`), because the update may have been found or downloaded before Settings was opened, or the user may have chosen "Not Now" in the modal. It then follows the existing events (`update-checking`, `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, `update-error`).
- `Restart & Install` uses the existing `quit-and-install-update`. The card never calls `download-update` (the download starts on its own), which closes the gap noted for the Settings button.
- A finished download that waits for a meeting to end (see Behaviour above) still counts as "ready" in the card, since the user opened Settings on purpose.

Files: new `src/components/UpdatesCard.tsx`, rendered in `src/components/AboutSection.tsx`; remove the Version row, `updateStatus`, `handleCheckForUpdates` and the update subscriptions from `src/components/SettingsOverlay.tsx`; `electron/lib/auto-updater.ts` (read the setting, keep the last-check time and the downloading/downloaded state, `getUpdateState`), `electron/ipc/core.ts`, `electron/preload.ts`, `electron/preload/settings.ts` or the matching preload file, `electron/preload/types.ts`, `src/types/electron.d.ts` (new IPC channels `get-update-state` and `set-auto-check-updates`), `electron/services/SettingsManager.ts` (the key).

Owner checks by hand: the card in the light and the dark theme at the normal Settings width; each state in the table (use a packaged build for the real ones); the switch off, then relaunch and confirm no check runs until `Check Now`.
