# Design: Pika as a meeting partner on an agent base

Status: direction approved by the owner on 2026-10-26; revised the same day after a review by GPT-6 Astra (see "Review log" at the end). The owner approved the revision, the mockup and both amendments (marked **Amendment**) on 2026-10-26. Research and evidence: `docs/research-pi-durable.md`. The work is split into tasks in `TASKS.md` (track A).

## Product

A personal meeting partner, not a commercial product. It translates what the other party says as they say it, keeps a complete record of the meeting, writes a summary you can trust afterwards, and keeps one agent at hand for the whole meeting: you talk to it in the chat panel (questions about the call, past meetings, the screen, and local commands you approve), and it decides from the meeting content when to offer help on its own, using a fast decision model (TypeSafe's Jev, or any compatible classifier).

Four capabilities, in the order they depend on each other:

1. **Record**: every assembled transcript line is committed to `pika.db` as it is assembled. A crash loses at most the line still being assembled.
2. **Live translation**: the existing pipeline (`electron/transcript/`, `electron/lib/transcript-assembler.ts`), unchanged in this track.
3. **Agent**: one durable chat per meeting that reads the record, answers the user, calls tools, and runs commands only with approval.
4. **Proactive help**: a decision model judges each finished line of the other party. It starts in log-only mode; cards appear only after the owner sets the threshold from a real call.

## Owner decisions (2026-10-26)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Interview features (resume tables, interview intents, "What to say" and the other interview LLMs) | Kept, not extended. No new work builds on them; removal is a later, separate decision. |
| D2 | The overlay's glance-first rule (the answer is the most prominent thing, one primary action) | Changed. The overlay becomes translation plus agent chat. The new rule is written from the mockup the owner approves (A1). |
| D3 | Where commands run | One fixed workspace root in Settings, a folder per day, and inside it a folder per meeting with its time and title, so a meeting's files are easy to find. **Amendment** (approved 2026-10-26): the title only exists after the meeting stops (`MeetingPersistence.ts:115` generates it then) and two meetings can share a minute. So the folder is created on the first file or command use, not at meeting start (silent meetings leave no empty folders), as `<root>/<YYYY-MM-DD>/<HHmm> <short id>/`, and renamed once to `<HHmm> <title>` when the title is set after stop (the short id stays only if the name is taken). Renaming the meeting later does not move the folder. |
| D4 | How to reach Jev | Configurable only: provider, model id, base URL and key. pi-ai's TypeSafe adapter posts to `<baseUrl>/systemone`, so base URL `http://localhost:3425/v1` points it at the owner's magpie, which the owner reports serves Jev through OpenRouter. Pika has not sent a classification request yet; that is A4's first check. Unset means proactive help is off. |
| D5 | pi-durable as the runtime | Adopted with conditions: exact version `1.4.0`; every `pi-*` import inside `electron/agent/` behind one loader; the record stays in `pika.db`; one agent store file per meeting; no code mode, subagents or child tasks in this track. |

Rules this design crosses, approved by the owner on 2026-10-26: new dependencies (`@earendil-works/pi-durable`, `@earendil-works/pi-ai`, `@earendil-works/chord`, `typebox`), a new provider (TypeSafe, or a compatible classifier), new persisted shapes (`userData/agent/`, new IPC channels, new settings keys, the summary shape in A6, and a second recognition language key for your microphone, approved separately the same day), a new data flow (recent transcript lines sent to the decision model), the overlay rule (D2), and `electron/tsconfig.json` moving to `module` and `moduleResolution` `nodenext`.

**Amendment** (approved 2026-10-26): A2 also changes a persisted shape that was not on that list: `transcripts` gains `segment_id` and `revision` columns. The owner waived migrations for existing data, so old rows keep `NULL` in both.

## Not building

- A general coding agent. Commands serve the meeting (look something up, run a script the user asked for), in the meeting's folder.
- A sandbox for commands. An approved command runs as the user, with the user's file access; the approval card says so.
- A durable agent chat in the launcher across meetings. The launcher keeps its current chat. A second long-lived store would need its own retention and deletion rules, and the per-meeting agent with `search_meetings` already answers questions about past meetings.
- pi-durable's code mode, subagents and child tasks.
- Speaker diarization (who among several remote people spoke). The record knows two speakers: the other party and you.
- Cloud sync, sharing, accounts, teams.
- A replacement for the translation pipeline or the STT providers.
- Removing stealth or the interview features (D1).
- Migrating the existing `LLMHelper` features to pi-ai. The agent and the A6 summary use pi-ai; the rest keeps `LLMHelper`.

## Architecture

```
 Rust audio -> STT provider -> transcript-assembler -> segment flush (segmentId, revision)
                                                              |
                     +------------------------+---------------+--------------------+
                     v                        v                                    v
          translation pipeline        MeetingRecord, pika.db              proactive gate
          (existing, LLMHelper)       the only record: one row per        (other-party flushes only;
                     |                segment, newest revision wins        one request in flight)
                     |                   ^                 ^                        |
                     |                   | read            | read            log entry, and in
                     v                   |                 |                 "on" mode an input
           overlay: translated lines   agent chat       assist runs                 |
                                       (per-meeting     (transcript tools  <--------+
                                        agent store)     only)
                                            |
                                  events and approvals over IPC <-> chat panel
```

Data flows one way. The record is written only by the segment flush and by meeting start, stop and recovery. The agent reads it through tools and a per-request snapshot and never writes it. The agent store holds the chat, the assist runs and the gate log, and nothing that the record already has.

## The record (A2)

A2 is the base of everything else and ships first, with no new dependency.

- **One persistence event**: the assembler's flush of a segment (`segmentId`, `revision`, speaker, text, start time). Today the saved list is built from raw STT finals (`audio-pipeline.ts:131` sends them to `SessionTracker` before the assembler merges them); after A2 the record comes from the flush only. `SessionTracker` keeps its in-memory list for the live LLM context as today.
- **Shape**: `transcripts` gains `segment_id` and `revision`, unique on `(meeting_id, segment_id)`. A flush upserts: a newer revision replaces the text, an older or equal one is ignored. A reopened segment (second-pass correction) therefore updates its row instead of adding one.
- **Start**: `startMeeting()` creates the meeting id and the real start time (today the id is made at stop, `MeetingPersistence.ts:53`, and the start time at construction, `SessionTracker.ts:58`) and inserts the meeting row with `is_processed = 0`. The same id names the agent store and the workspace folder.
- **Stop**: flush both speakers' pending buffers first (today `main.ts:902` resets them before saving), then update the meeting row (duration, title, summary). Stop never uses `INSERT OR REPLACE` and never re-inserts transcripts. A meeting under one second (`MeetingPersistence.ts:32`) is deleted with its agent store.
- **Writers split**: `saveMeeting` becomes `createMeeting`, `upsertSegment`, `addInteraction` (written when the interaction happens) and `completeMeeting`. Startup recovery (`MeetingPersistence.ts:234`) reads the committed row and its transcripts and only completes the metadata; it keeps the stored start time and calendar fields and never rewrites transcripts.
- **Saved** means committed to `pika.db`: one synchronous better-sqlite3 write per flush, a few per minute.
- **Logging**: the touched paths stop logging content (`SessionTracker.ts:237` logs answer text, `:470` transcript text; AGENTS.md forbids both).

## Modules

New code lives in `electron/agent/` (main process) and `src/components/agent/` (renderer). Nothing outside these imports `@earendil-works/*`.

| File | Responsibility |
| --- | --- |
| `electron/agent/loader.ts` | The one place that loads `pi-*` with `import()`; returns typed handles. |
| `electron/agent/models.ts` | A pi-ai `Models` with a `CredentialStore` that answers only from `CredentialsManager`. An explicit table maps Pika's providers to pi-ai provider and model pairs, with whether each supports tools and images; anything else shows "The agent does not support this model" instead of running. The model is fixed per run. The decision model comes from the D4 settings. |
| `electron/agent/MeetingAgent.ts` | The registry and owner of the per-meeting stores (`userData/agent/<meetingId>.sqlite`): open, the stop sequence, reopen for meeting details, delete. At most one open handle per file. |
| `electron/agent/context.ts` | The `beforeRequest` hook that adds the recent transcript (the last three minutes, newest revisions, from `pika.db`) to each request. |
| `electron/agent/workspace.ts` | The meeting folder (D3), title sanitizing, the one rename after stop, the login shell's `PATH` resolved once for packaged builds. |
| `electron/agent/tools/*.ts` | Meeting tools: `search_transcript` and `recent_transcript` (this meeting, `pika.db`), `search_meetings` (existing RAG), `screenshot` (existing capture). Local tools (A5): Pika's own `read`, `write`, `edit`, `bash` built on `NodeExecutionEnv`; pi-durable's `CodingTools` are never registered directly. |
| `electron/agent/approval.ts` | The approval broker that the local tools call inside `execute()`, before any side effect. |
| `electron/agent/gate.ts` | The proactive gate (below). |
| `electron/ipc/agent.ts`, preload, `src/types/electron.d.ts` | IPC: submit, abort, approve or deny, event stream, gate status. Channel names are a released contract once shipped. |
| `src/components/agent/*` | Chat thread, approval dock, proactive card, tool-call line (from the mockup). |

## How the agent knows the meeting

The transcript is not copied into the agent store. Each chat request gets the last three minutes of the transcript (newest revisions) through a `beforeRequest` hook, which replaces the messages of that one request (pi-durable README, "Hooks"); anything older is reached with `search_transcript`. A correction is therefore seen by the next request without any bookkeeping. An answer already given from an older revision stays as it was said; the transcript row shows the correction.

**A3 check**: that messages added in `beforeRequest` are not stored as entries. If they are, the fallback is `recent_transcript` and `search_transcript` as tools only, with no snapshot.

## Conversations and tools

- **chat**: the user's messages and the agent's turns. A message sent while a run is going is a follow-up by default, or a steer when the user chooses "now".
- **assist**: proactive runs only. One input per gate decision that passes, carrying the segment ids it is about and the gate's kind. At most three tool steps and one answer. Its answer is shown as a proactive card. "Ask more" sends a chat message that quotes the card as Pika's suggestion, labelled as such, not as the user's own words.

| Step | chat tools | assist tools |
| --- | --- | --- |
| A3 | `search_transcript`, `recent_transcript`, `search_meetings`, `screenshot` | none (no assist yet) |
| A4 | as A3 | `search_transcript`, `recent_transcript` (this meeting only: no screenshot, no other meetings, no files) |
| A5 | as A3, plus `read`, `write`, `edit`, `bash` with approval on every call | as A4 |

## Proactive gate (A4)

- **Trigger**: the flush of an other-party segment (A2's event, with id and revision). Not the utterance-end signal: it comes from two sources (`audio-pipeline.ts:149` provider boundaries, `:193` native silence) and can arrive before or after the final text.
- **Input** (`state`): the last few segments, the user's language, what Pika said recently, seconds since the last card.
- **Questions**: `help` (bool: would the user benefit from help right now), `kind` (choice: answer a question put to the user, explain a term, check a fact or number, note an action item, nothing).
- **Concurrency**: one request in flight. While it runs, only the newest pending segment waits; older ones are logged as `superseded`. One overall deadline of 2 seconds and no retries, both set explicitly in the call.
- **On a result**: discard it if the meeting has stopped, the segment has a newer revision, or it is older than 20 seconds; only then check threshold and cooldown.
- **Modes**: `log` (default: decide and log, never show a card), `on`, `off`. The owner switches to `on` after setting threshold and cooldown from a real call's log.
- **Log**: every decision is a `meeting.gate` entry in the agent store with no speech text: segment id and revision, model id, the threshold and cooldown in force, probabilities, kind, latency, and the outcome (`shown`, `below_threshold`, `cooldown`, `stale`, `superseded`, `error:<class>`).
- **Failure**: one error skips that segment silently. A lasting failure (an auth error, or three in a row) shows "Proactive help unavailable" with the reason in Settings and on the status chip. Transcription and translation never wait for the gate.

## Security

The other party's speech is untrusted input that reaches a model with tools.

- **Approval is enforced in Pika's tools**, not in a hook: `bash`, `write` and `edit` call the approval broker inside `execute()` and do nothing until the user allows that one call. A `beforeTool` hook that blocks local tools outside the chat conversation is a second line only. Nested calls through `executeTool` also run the `ToolTask` hooks (README, "Calling tools from tools"), and code mode is off.
- **One approval, one execution**: an approval is bound to the tool task id and a hash of the exact arguments and the resolved folder. Pending approvals live in memory only and are denied when the meeting stops, the run is aborted or the app quits.
- **No re-run after a crash**: Pika's local tools are not declared `replay: "safe"`, so pi-durable gives the model an `interrupted` result instead of running them again (README, "Tools"). A command cut off mid-way may have partly run; the chat line says "interrupted, not re-run".
- **The approval card shows** the exact command, or the path with the full new contents or the diff, and the folder. For `bash` it says the command runs as you with your file access.
- **File tools are confined**: the path is resolved with `realpath` (symlinks, `..`) and must be inside the meeting folder. Any other path asks with the full path shown; Pika's own data folder (`pika.db`, credentials) is refused outright.
- **`bash` gets a minimal environment**: the login shell's `PATH`, `HOME`, `LANG`; no Pika keys and no provider variables.
- **Assist runs** read only this meeting's transcript (table above).
- **Credentials**: the `CredentialStore` answers only from `CredentialsManager`. pi-ai falls back to ambient credentials when none is stored (`auth/resolve.js`), so A3 tests that a key in the environment is not used when Pika has none.
- **Logs**: errors at the agent boundary are logged as an error class and status code only (pi-ai's classifier errors keep the response headers and body). IPC events carry no keys. Tests pass a made-up secret marker through a provider error and a tool output and check that it reaches no log.
- Stealth (content protection, window flags) is unchanged.

## Lifecycle

- **One owner**: `MeetingAgent` in the main process opens and closes every store.
- **Start**: the store opens after the meeting row exists.
- **Stop**: reject new submissions, deny pending approvals, abort running runs, wait for them to settle (at most 3 seconds), detach watchers, close. The A6 summary reads `pika.db` and uses pi-ai directly, so it does not need the store.
- **Quit**: the same sequence, bounded to 2 seconds, in `before-quit` before credentials are scrubbed (`lifecycle.ts:161`).
- **Reopening an ended meeting's store** (meeting details): unfinished runs are aborted, not resumed. **A3 check**: that 1.4.0 can abort the live tasks on open without running them (`abortTask`, `abandonOnRestart`).
- **Delete one meeting, or clear all data**: one main-process operation closes the store through `MeetingAgent`, deletes `<id>.sqlite` with its `-wal` and `-shm`, then the rows. `delete-meeting` and `flush-database` call it (`electron/ipc/meeting.ts` calls the database directly today). The meeting's workspace folder holds the user's files and is kept; the delete confirmation says where it is.

## Cost and latency

- A chat request carries about three minutes of transcript (a few hundred words) plus the chat history. Nothing is ingested per segment.
- The gate makes one classify request per other-party segment, with at most one in flight and a 2-second deadline.
- Assist runs: none in `log` mode; at most one per cooldown in `on` mode.

## Overlay UI (D2)

The overlay becomes two areas: live translation of the other party (top) and the agent (bottom). The mockup the owner reviews is an interactive HTML page with Chinese notes, kept outside the repository; once approved, A1 commits an English version as `docs/mockups/agent-overlay.html`. Its draft rules (revised after the owner's first look on 2026-10-26), which replace "the answer is the most prominent thing, one primary action" once the owner approves them:

1. The two areas are two different things and look it. The translation area is the other party's speech and sits on a deeper ground (`overlay-transcript-surface`); the Pika area is your conversation with the agent on the panel ground, laid out as a chat. The top bar stays the one header for both (owner decision V9, chrome budget Q3), so there are no per-area header rows and no per-line times: a hairline plus the change of ground separates them. (Revised 2026-10-27: the draft asked for header rows and times; they cost chrome the overlay cannot spare.)
2. Languages change during the call from the translation header ("Them"). "Their language" sets recognition of their audio and the translation source; "You speak" sets recognition of your microphone only (in the ⋯ menu below 480px), and your own lines are not translated. Changing either restarts that one recognition stream (about a second) and applies from the next sentence. "Translate into" re-translates the lines on screen, and new lines follow. When their language and the target are the same, lines show in the original only. The backend already restarts streams live (`set-recognition-language`) and holds translation source and target (`set-transcript-translation-settings`); today both are only in Settings, and one recognition language serves both streams (`main.ts:1100`). The owner approved splitting it per speaker on 2026-10-26 (A1.4).
3. In a transcript row the source text comes first and is larger, its translation under it, smaller (owner, 2026-10-26, confirmed 2026-10-27). The newest finished line keeps the accent bar; older lines use the secondary colour.
4. The newest item in the agent area is read second. A proactive card is marked by its kind label, not by size.
5. Nothing moves what you are reading: an area you have scrolled up stops following and shows a count of new items; clicking it returns to the bottom.
6. An approval request docks above the input, outside the thread, so it cannot scroll away. The thread shrinks from the top; the translation area keeps its size.
7. At most one filled control on screen: Send, or Allow while a request waits.
8. Proactive help is quiet: at most one card per cooldown, no sound, a 150ms fade, dismissed with ×.
9. Working states are words ("Searching the transcript…"), never a spinner.
10. The size floors stay: nothing under 11px; translations and answers at 14px.

`docs/conventions.md` ("Overlay UI") and `DESIGN.md` change with A3.

## Steps

Each step ships on its own branch and leaves the app usable. Tasks, files and checks are in `TASKS.md` (track A). "Windowless tests" run under `test/` with temporary stores and pi-ai's faux provider; real providers, real calls and visual checks are the owner's.

| Step | Delivers | Windowless tests | Owner's acceptance |
| --- | --- | --- | --- |
| A1 | This design, the research note, the mockup; `PRODUCT.md`, `docs/architecture.md`, the product paragraph of `AGENTS.md` and `TASKS.md` updated for the direction | none | The owner approves the mockup and the two amendments |
| A2 | The record as it happens (section above). No new dependency | newer revision replaces, older ignored; pending buffers flushed at stop; repeated stop and repeated recovery change nothing; recovery keeps start time and calendar fields; a meeting under one second is removed | Force-quit mid-call, relaunch: the transcript is there up to the kill; in a long call the first sentence is still there; every line appears once |
| A3 | The agent in the meeting: dependencies, `nodenext`, loader, models, `MeetingAgent`, context hook, chat with the A3 tools, the chat panel and the overlay rules | store create and reopen; the snapshot is not stored; opening an ended meeting aborts live tasks; delete removes the store files; an environment key is not used; a secret marker reaches no log; an unsupported model shows its state | Packaged build: the loader runs, a store is created and reopened, a faux-model tool run completes, and the existing RAG chat still answers. Then a real call: "what price did they just say" is answered from the transcript |
| A4 | Proactive help: gate in `log` mode, its settings (D4 fields, mode, threshold, cooldown), assist conversation, proactive cards in `on` mode, the failure state | results out of order, superseded, stale and in cooldown; one request in flight; each error class logged; assist is offered only transcript tools | One real call in `log` mode: the log shows each decision with latency; the owner sets threshold and cooldown, then one call in `on` mode |
| A5 | Local commands: workspace root setting (picker, validation; a missing root disables commands and never stops recording), D3 folders, approval dock, the local tools, `PATH` resolution | denied `bash` leaves no side effect; changed arguments ask again; `..`, symlink and data-folder paths are refused; an interrupted call is not re-run; the `bash` environment has no keys | Ask for `git status` in the meeting folder: the card appears first; denying runs nothing; the folder is under `<root>/<date>/` and carries the title after stop |
| A6 | The summary: every chunk of the whole transcript from `pika.db` is read, citations checked against segment ids and revisions, owners and dates only when spoken; a draft kept apart from the approved summary; replaces the current summary worker and its recovery path together, with readers, editors, export, IPC and types | facts at the start, middle and end of a long made-up transcript all reach the draft; a corrected line is cited at its newest revision; a bad citation is dropped; confirming twice is one save; recovery never overwrites an approved summary | A decision spoken in the first, middle and last five minutes of a 45-minute call each appears in the summary |

## Risks and unknowns

- pi-durable is young (17 releases in five weeks, breaking changes in most minors). Mitigation: the exact pin, the single loader, per-meeting files; upgrading is its own step.
- A3 checks, from the README and not yet run: `beforeRequest` messages are not stored; live tasks can be aborted on open without running.
- Loading the ESM packages from a packaged `app.asar` is not verified. The packages read no `.md`, `.ts` or `.map` file at runtime outside their `testing/` folder (searched in a fresh install), so the build's exclusions should not break them; A3's packaged check decides.
- `nodenext` turns the eight dynamic imports in `electron/ipc/rag.ts` into real ESM imports. The typecheck passes with 0 errors; A3 checks them at runtime.
- pi-ai has no built-in Ollama provider; until a custom provider is tried, the agent shows its unsupported-model state for Ollama.
- No real model, decision model or packaged build has been exercised with this design.

## Rollback

Each step is its own branch. Removing the agent means removing `electron/agent/`, `src/components/agent/`, the four dependencies, the agent settings keys and `userData/agent/`; `pika.db` and the record are untouched. Rolling back A2 leaves the two new `transcripts` columns, which the old code ignores.

## Review log

Review by GPT-6 Astra through pi, 2026-10-26 (read-only; 24 findings). Its claims about Pika's code were checked before acting, and all of them held. Of its claims about the installed pi-ai, the fallback to ambient credentials (#19) and the error object that keeps headers and body (#21) were confirmed in the package source; the default of two classifier retries (#14) was not confirmed (the shared retry helper defaults to none), and the design sets no retries explicitly either way.

| # | Finding | Outcome |
| --- | --- | --- |
| 1 | `beforeTool` is an unproven security boundary | Accepted. Approval moved into Pika's own tools; the hook is a second line; code mode, subagents and child tasks are off |
| 2 | Approval has no binding or replay contract | Accepted. Bound to task id and argument hash, memory only, denied on stop and quit; tools are not replay-safe, so an interrupted call is not re-run; the card shows full contents or the diff |
| 3 | Read-only proactive tools can still disclose data | Accepted. Assist reads only this meeting's transcript; "Ask more" quotes the card as Pika's |
| 4 | A working directory is not confinement | Accepted for file tools (`realpath` check, data folder refused). For `bash`, amended: no sandbox; the card says it runs with your access, and its environment carries no keys |
| 5 | A2 assumed the wrong transcript path | Accepted. The record comes from the assembler flush; pending buffers flush before the reset at stop |
| 6 | No stable segment identity or correction rule | Accepted. `segment_id` and `revision` columns (Amendment); the agent store no longer copies the transcript |
| 7 | Recovery and every save caller must change | Accepted. `saveMeeting` split; recovery completes metadata only |
| 8 | No explicit start operation | Accepted. `startMeeting()` creates id, start time and row |
| 9 | Two stores need reconciliation | Resolved by not mirroring: `pika.db` is the only record |
| 10 | Closing at meeting end conflicts with runs and post-meeting work | Accepted. One owner and a stop sequence; the summary no longer needs the store; bounded quit |
| 11 | Deletion misses retained copies | Accepted. One delete operation for both IPC paths; launcher agent chat dropped; workspace files kept and named in the confirmation |
| 12 | Appending every segment is costly | Accepted. Per-request snapshot plus search tools |
| 13 | Utterance end is not one turn event | Accepted. The gate triggers on the other party's segment flush |
| 14 | Gate concurrency and retries unbounded | Accepted. One in flight, newest pending only, 2-second deadline, no retries, result rechecked on arrival |
| 15 | No behaviour before calibration | Accepted. `log` mode by default; richer log fields; lasting failure is shown |
| 16 | A6 acceptance does not prove coverage | Accepted. Every chunk read, citations checked, start, middle and end tests |
| 17 | Summary confirmation conflicts with automatic processing | Accepted. Draft apart from approved; the old worker and recovery replaced together |
| 18 | Import and packaging check too weak | Accepted. The packaged check runs the loader, a store and a faux tool run. The research note's `node16` line was stale: `nodenext` was re-run on 2026-10-26 with 0 errors |
| 19 | "Follow the current model" has no contract | Accepted. Explicit mapping table, per-run snapshot, no ambient credentials |
| 20 | Workspace naming and Settings missing | Accepted; the naming fix changes D3 (Amendment); the root setting is in A5 |
| 21 | Credential injection does not make logging safe | Accepted. Class and status only, no keys in events or `bash`, a secret-marker test, content logs removed in A2 |
| 22 | No tests for the critical guarantees | Accepted. Windowless tests per step |
| 23 | Task track missing, step boundaries conflict | Accepted. Tools per step; `TASKS.md` track A written |
| 24 | D4 overstates the gateway evidence | Accepted. D4 now says what is reported and what is unverified |
