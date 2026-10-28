# Design: remove the process disguise and the dock/tray hiding; rename "Undetectable" to "Hide from screen share"

Status: proposal for owner approval, 2026-10-28 (design by Opus; the owner chose A+B and not C on 2026-10-28). Base: `main` at b18ea25. Nothing was run; everything below comes from reading the code. Track X in `TASKS.md`.

Owner decision: (A) remove the process disguise completely; (B) keep window content protection, drop the "Undetectable" framing and the dock/tray hiding, and rename the feature "Hide from screen share" (the stored key `isUndetectable` stays). Content protection itself is not removed (not option C). The full-feature version lives in the private repository `royisme/meetingCopa`.

## 1. Inventory (file:line)

**A. Process disguise (all of it is deleted)**

| Where | What |
| --- | --- |
| `electron/helpers/stealth.ts:158-317,336-338` | `setDisguise`, `applyInitialDisguise`, `_applyDisguise`, `getDisguise`: set `process.title` (re-asserted after 200/1000/5000 ms), `app.setName`, `process.env.CFBundleName`, the Win32 AUMID `com.pika.assistant.<mode>`, the dock or window icon and window titles, and send `disguise-changed`. |
| `stealth.ts:35-42` | `setUndetectable` clears `_disguiseTimers`. |
| `electron/main.ts:100-104,148,169,198,205,1420-1439` | Imports, `disguiseMode`, `_disguiseTimers`, constructor load, log line, wrapper methods. |
| `electron/lib/lifecycle.ts:60-61` | `appState.applyInitialDisguise()` |
| `electron/helpers/WindowHelper.ts:146-177` | The launcher `icon` picks a fake icon by mode. |
| `electron/ipc/core.ts:526-529,550-552` | `set-disguise`, `get-disguise` |
| `electron/preload.ts:533-540`, `electron/preload/settings.ts:34-41`, `src/types/electron.d.ts:81-83` | `setDisguise`, `getDisguise`, `onDisguiseChanged` |
| `electron/services/SettingsManager.ts:9` | `disguiseMode?` |
| `src/components/SettingsOverlay.tsx:262-269,1272-1323` | The disguise query and the "Process Disguise" card. |
| `assets/fakeicon/{mac,win}/{terminal,settings,activity}.png` | 6 files, packaged through `package.json` `extraResources` `assets/`. |
| `scripts/ad-hoc-sign.js` (whole file), `package.json:50` `afterPack` | A build-time disguise the brief did not list: it rewrites the helper `CFBundleName`/`CFBundleDisplayName` to "CoreServices Helper (...)" so Activity Monitor shows other names. |
| `test/unit/provider-setup-settings.test.ts:99` | Asserts the "Process Disguise" label is present. |
| `README.md:63`, `demo/src/PikaDemo.tsx:588-690`, `demo/out/pika-demo.mp4` (and probably `pika-preview.gif`, not checked) | Public copy and committed media that show the disguise. |

**B. "Undetectable"**

| Where | What | Fate |
| --- | --- | --- |
| `stealth.ts:17-33,44-45` | guard, sets `isUndetectable`, `setContentProtection` on the 4 helpers, persists, broadcasts `undetectable-changed` | keep |
| `stealth.ts:47-118` | macOS-only, 150 ms debounce: `app.dock.hide/show`, `hideTray/showTray`, focus restore, `setIgnoreBlur` juggling | delete |
| `main.ts:152,197,217-220,1389-1395`; `main.ts:170` `_dockDebounceTimer` | state, startup protection, wrappers; the timer field | keep; delete the field |
| `lifecycle.ts:33-43` | pre-emptive `app.dock.hide()` at startup | delete |
| `lifecycle.ts:80-87` | tray shown only when not undetectable (all platforms) | make unconditional |
| `lifecycle.ts:108-116` | `activate` calls `dock.show()` unless undetectable or in a meeting | delete the dock lines; keep window restore |
| `SettingsWindowHelper.ts:39,43-45,208`; `ModelSelectorWindowHelper.ts:23,27-29,184` | `ignoreBlur`; only `stealth.ts` calls it | delete (dead once the dock code goes) |
| `tray-menu.ts:122-129` `hideTray`; `main.ts:1377-1379` | only `stealth.ts:94` calls it | delete |
| `WindowHelper.ts:34-54,190,232,505-521,544-558`; `SettingsWindowHelper.ts:106-119,184-185,236-244`; `ModelSelectorWindowHelper.ts:18,80-93,165,218-223`; `CropperWindowHelper.ts:95,249-253,349-378` | content protection, including the Windows opacity-0 show that avoids a captured frame | keep, unchanged |
| `WindowHelper.ts:257-262,313-318` | native right-click menu suppressed while protected | keep (it protects screen shares, not the dock) |
| `ipc/core.ts:521-524,531-533`; `preload.ts:524-525,925-930`; `preload/window.ts:39-40,58-63`; `preload/types.ts:166`; `electron.d.ts:75-76,254` | IPC and preload | keep |
| `SettingsOverlay.tsx:1026,1028-1030`; `Launcher.tsx:224-225`; `SettingsPopup.tsx:102` | UI strings "Undetectable mode: on/off", "Detectable/Undetectable", aria-labels | rename |
| `electron/db/DatabaseManager.ts:1034` | demo seed: "enable undetectable mode" | reword |
| comments only (`Cropper.tsx:11`, `preload.ts:316,1146`, `index.css:381`, `main.ts:254-286`, `WindowHelper.ts:441`) | | leave, to keep merges cheap |

**Coupling with behaviour that stays**
- All five `new BrowserWindow` calls are content-protected: launcher, overlay, settings, model selector, cropper.
- The `skipTaskbar: true` values are unconditional, not tied to protection. Keep them.
- Nothing calls `setActivationPolicy`, and `package.json` has no `LSUIElement` or `extendInfo`. The dock is hidden only by the two runtime `app.dock.hide()` calls.
- The overlay's always-on-top, all-Spaces, click-through and Cmd+B behaviour does not touch any deleted line.
- The app menu (`KeybindManager.ts:261,349`) uses roles only. No `Notification` exists in `electron/`. `auto-updater.ts` does not touch the name, dock or AUMID.

## 2. Decisions

- **App identity after the disguise goes.** Replace `lifecycle.ts:61` with two inline lines: `app.setName("Pika")` and, on Win32, `app.setAppUserModelId("com.pika.assistant.none")`. Both are exactly what default users get today; keeping the AUMID keeps existing Windows taskbar pins grouped. (That AUMID does not match the installer's `appId` `com.royisme.pika`; a separate issue.) In step 1 `setName` keeps today's `!isUndetectable` guard, because `setName` after `dock.hide` re-shows the dock; step 3 drops the guard. `process.title`, the `CFBundleName` env and `dock.setIcon` are dropped, so the packaged dock shows the bundle icon `assets/pika.icns` instead of `assets/icon.png` (whether they match is unverified; owner check A2).
- **A user with `disguiseMode` stored.** The key stays in `settings.json`, unread. `SettingsManager.ts:42-50,67` keeps and rewrites the whole parsed object, so the private build on the same profile still finds it. On the next start nothing sets another name, so app, menu, dock, Cmd-Tab and window titles show "Pika".
- **Data location for users who had a disguise on.** `SettingsManager`, `DatabaseManager:44`, `ScreenshotHelper:357`, `KeybindManager:80` and `ThemeManager:18` resolve `userData` in the `AppState` constructor (`lifecycle.ts:52`), before the rename at `:61`, so meetings, keys and settings do not move. These read it later, after the rename: `WindowHelper:453`, `ipc/core.ts:132,271`, `ipc/gate.ts:74`, `agent/instance.ts:26-31,90`, `ScreenshotHelper:525`. Electron fixes `userData` at startup, so these should not follow `setName` either: unverified, owner check A3.
- **A user with `isUndetectable: true`.** Protection stays on. Dock and tray come back on the first start of the new build, every time: no code hides them any more, `dock.hide()` is runtime state that does not survive a restart, and step 3 makes the tray unconditional (the Windows tray also returns; the old startup check hid it on every platform).
- **Label and copy.** Name: "Hide from screen share". The Settings heading is static, the switch shows the state; the launcher pill and the overlay popup use the same words; aria-label "Hide from screen share" with `aria-pressed`. Description, in Settings only: "Asks macOS and Windows to keep Pika's windows out of screen sharing and recording. Not guaranteed: macOS apps that record with ScreenCaptureKit can still capture them. Not supported on Linux." Sources: `PROGRESS.md` (Electron docs: ScreenCaptureKit recorders can still capture a protected window) and the current `SettingsOverlay.tsx:1029`. Do not claim behaviour on older Windows 10 unless cited from Electron's `setContentProtection` docs (not checked). Icons unchanged (smallest diff).
- **Settings page.** The General tab shows the renamed card and loses the "Process Disguise" card.

## 3. Changes that need owner approval (released contracts)

| # | Change | Recommendation |
| --- | --- | --- |
| 1 | Settings key `disguiseMode`: stop reading and writing it, remove it from `AppSettings`, leave stored values in place | approve |
| 2 | IPC `set-disguise`, `get-disguise` (invoke), `disguise-changed` (event) and preload `setDisguise`, `getDisguise`, `onDisguiseChanged` with their types: delete (only caller: `SettingsOverlay`) | approve |
| 3 | `isUndetectable`, `set-undetectable`, `get-undetectable`, `undetectable-changed`, preload names, react-query key `['undetectable']`, localStorage `pika_undetectable` | keep all (renaming needs a migration, touches 5 preload/type files, breaks private merges) |
| 4 | Remove `afterPack` / `ad-hoc-sign.js` (release pipeline) | approve; the owner builds and notarizes |
| 5 | Win32 AUMID stays `com.pika.assistant.none` | keep; open an issue for the `appId` mismatch |
| 6 | `test/unit/provider-setup-settings.test.ts:99`: replace `match 'Process Disguise'` with `notMatch` | approve explicitly |
| 7 | Release-please type for the user-visible removals: `refactor` is listed, `chore`/`docs` hidden; `refactor(stealth)!:` with `BREAKING CHANGE:` would bump 2.x to 3.0.0 | owner decision; a plain `refactor:` lists it with no major bump (release-please's exact bump unverified) |

## 4. Steps

Each step is one branch whose PR contains only that step, updates `TASKS.md` and `PROGRESS.md`, and runs the checks. Effort in focused days, estimates.

**Step 0 `stealth-rule` (docs, 0.25 d).** Rule text from section 6 into `AGENTS.md` and `RULES.md`. `docs/conventions.md` does not repeat the rule (grepped), so it does not change.

**Step 1 `remove-disguise` (0.5-1 d).**
- Delete everything in table A except `ad-hoc-sign.js`; delete `assets/fakeicon/`.
- Reduce the launcher icon to the old `'none'` branch; add the inline identity lines at `lifecycle.ts:61`; delete the "Process Disguise" card (section 3 rows 1, 2, 6).
- Delete the demo's disguise cycling (`PikaDemo.tsx:590-690`) and retitle the scene. Re-rendering `demo/out/*` needs an install in `demo/` (owner approval); until then drop the README links to the media or accept stale media (owner choice).
- `README.md:63` is replaced in step 4; until then cut it to "hide the window from screen-sharing".
- Tests (synthetic, `@tapjs/mock` with a stub `electron`, as in `live-meeting-id.test.ts`): `stealth.ts` no longer exports `setDisguise`, `_applyDisguise`, `applyInitialDisguise`, `getDisguise`; with settings `{disguiseMode:'terminal'}` the lifecycle start calls `app.setName('Pika')` once, never another name, never sets `process.title`; with `process.platform` stubbed to `win32` the AUMID is `com.pika.assistant.none`; the General tab render contains none of "Process Disguise", "Activity Monitor", "System Settings".
- Owner checks (macOS): **A1** on the old build pick "Terminal", update: dock, menu bar, Cmd-Tab, Activity Monitor and window titles say Pika. **A2** the dock icon looks right. **A3** meetings, settings, keys, overlay size and agent files are all present after the update. **A4** the General tab works. Windows if available: name, icon, pin grouping.

**Step 2 `remove-helper-rename` (0.25 d plus a release build).** Delete `scripts/ad-hoc-sign.js` and `package.json:50`. No unit test (no logic left). Owner checks: a signed and notarized build passes `codesign --verify --deep --strict` and `spctl -a -vv`; Activity Monitor shows "Pika Helper (Renderer/GPU/Plugin)"; the app launches and audio capture works.

**Step 3 `stop-dock-hiding` (0.5 d).** Delete `stealth.ts:35-42` (if step 1 did not) and `:47-118`, `lifecycle.ts:33-43` and the dock lines in `:110-116`; make the tray unconditional; drop the `setName` guard; delete `setIgnoreBlur`/`ignoreBlur`, `hideTray` and `_dockDebounceTimer`. No timers remain, so no fake clock. Tests with a mocked `electron` (`app.dock.hide/show` spies), `tray-menu` spies, four helper fakes and a SettingsManager fake: `setUndetectable(true)` calls `setContentProtection(true)` on all four helpers, persists `isUndetectable: true`, sends `undetectable-changed` once per distinct window, never calls `dock.hide` or `hideTray`; a repeat call with the same state does nothing; lifecycle with stored `isUndetectable: true`: no `dock.hide`, `showTray` once. Owner checks: **B1** with "Undetectable" on in the old build (dock and tray gone), update by auto-update and by a fresh install: dock icon and tray are back on the first start. **B2** toggling never hides the dock or tray. **B3** with protection on, overlay, cropper, settings and model selector are absent from a Zoom/Meet share and from the macOS screenshot tool. **B4** toggling from inside Settings does not close the Settings window. **B5** always-on-top, click-through, Cmd+B and full-screen Spaces are unchanged.

**Step 4 `screen-share-label` (0.5 d).** UI strings from section 2; reword the seed at `DatabaseManager.ts:1034` (new installs only, unverified); docs from section 6. Leave `docs/design-settings-cleanup.md` and the HANDOFF/SPEC files (frozen records). Tests: render Settings General, Launcher and SettingsPopup; each contains "Hide from screen share" and none contains "Undetectable"; the Settings description contains "ScreenCaptureKit" and "Linux". Owner check **C1**: the label fits the 200 px overlay popup and the launcher pill without wrapping, in light and dark; text at least 11 px.

## 5. Living with `royisme/meetingCopa`

Pika lands PRs as merge commits. **A plain merge of public `main` into the private repository raises no conflict and silently deletes the disguise there.** For each removal PR the private repo does not want, merge up to the commit before it, record it as merged without taking it, then continue:

```
git merge M^1
git merge -s ours M
git merge main
```

(Or merge normally and then `git revert -m 1 M`.) This only works if each removal PR contains nothing else, which is why steps 0-4 are separate. Shape the removal as whole functions and blocks, keep the `stealth.ts` file and the names `setUndetectable`/`getUndetectable`, keep `isUndetectable` and its IPC, do not reword comments or move code. Steps 0 and 4 (rule and copy) are the private repo's choice to take or "ours". Conflicts to expect afterwards: later public changes near `SettingsOverlay.tsx` General (about lines 1000-1325), `lifecycle.ts:30-120`, the top half of `stealth.ts`, the `WindowHelper.ts:146-177` icon block, the `SettingsWindowHelper`/`ModelSelectorWindowHelper` blur code, `preload.ts:520-540`, `provider-setup-settings.test.ts:99` and the README.

## 6. Rule and doc text

- **`AGENTS.md`, replacing the stealth line:** "Pika never presents itself as another app: no fake app, process or helper name, icon, window title or AUMID, and no hiding of the dock icon or tray (owner decision 2026-10-28). "Hide from screen share" (window content protection on macOS and Windows) stays: never weaken it or the always-on-top / click-through overlay, or add telemetry on meeting content, without the owner."
- **`RULES.md`, heading "Screen-share privacy":** never weaken "Hide from screen share" (content protection on all five windows, including the Windows hidden-first show) or the always-on-top / click-through window behaviour without the owner; never make Pika pretend to be another app (name, process title, helper name, icon, window title, AUMID) or hide its dock icon or tray; never call content protection undetectable or guaranteed, and copy states its limits (ScreenCaptureKit recorders on macOS, no Linux support); never add telemetry on meeting content without the owner.
- **README:** row `| Hide from screen share (macOS, Windows) | ✓ | ✓ | — | — |`; the feature line becomes "**Hide from screen share** — asks macOS and Windows to keep Pika's windows out of screen sharing; macOS recorders that use ScreenCaptureKit can still capture them."; the FAQ becomes "**Why "Hide from screen share"?** So private notes don't appear on a screen you share. It is not a guarantee (ScreenCaptureKit recorders on macOS; no Linux support). Use Pika ethically and respect the rules of your conversations."
- **`PRODUCT.md`:** "Hide from screen share keeps private notes off a shared screen on macOS and Windows."; the evidence line "**Hide from screen share**: `evidenced` in code (`setContentProtection` in the window helpers); real-device behaviour is the owner's check."; "pending a content-protection review".
- `DESIGN.md`: nothing. `docs/design-overlay-v2.md` "near stealth" may stay (a design record).

## 7. Order with the broader interview removal

Do A+B first: about 2-2.5 days, one behaviour per PR, and it removes the strongest public signal now. Its owner checks (window, dock, identity) do not mix with the broader removal's (prompts, providers). The overlap is small (different regions of `SettingsOverlay.tsx`, README/PRODUCT), and the `-s ours` recipe is tried first on five small PRs before the roughly 4,000-line one. Doing the broader removal first would make A+B rebase onto a churned `SettingsOverlay` and launcher. First step of the broader removal: an owner decision record on the released contracts (the knowledge tables, the profile settings keys, the 18 IPC channels: keep dormant or migrate); the first code PR then replaces the "You ARE the candidate" core prompts with neutral meeting prompts (real-provider checks by the owner).

## 8. Risks

- **Most fragile assumption:** `userData` and the dock state do not depend on the disguise once it is removed. The code supports it (early consumers resolve before the rename; no activation policy or `LSUIElement`); Electron's internals are unverified. A3 showing files under a "Terminal "-named folder means step 1 needs a one-time move of those files (a migration needing owner approval). B1 showing a hidden dock means a stray hide remains to be found.
- **Windows** (AUMID, tray, protection) cannot be checked unless the owner has a Windows machine; never claim it was exercised.
- **Dock icon:** removing `dock.setIcon` may change the dock icon look (A2); one line restores it.
- **The 200 px popup label** may wrap (C1); a shorter popup-only label needs the owner.
- **The committed demo media** keeps showing the disguise until it is re-rendered or unlinked.
- **Merge recipe:** a plain merge into the private repo deletes its disguise with no conflict (section 5).

Effort (estimates): step 0 0.25 d, step 1 0.5-1 d, step 2 0.25 d plus a release build, step 3 0.5 d, step 4 0.5 d; about 2-2.5 focused days plus the owner's device checks.
