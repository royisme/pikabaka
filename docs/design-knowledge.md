# Knowledge

Status: option A approved by the owner on 2026-10-27; built step by step (the queue and the status of each step are in `TASKS.md`; K1 is built). It was reviewed independently by gpt-6-astra the same day; the corrections below come from that review. Evidence is a source-only investigation (GPT, commit `fdd71df`); every claim below was cited there by file and line, and none was run.

## Why it is not a rename

Pika is live translation, a meeting record and an agent base, so it has to search everyday meetings and the user's materials, not only a resume. Today:

- There are two separate corpora with two retrieval paths: meeting passages and summaries (`chunks`, `chunk_summaries`) and resume, job description and notes (`knowledge_chunks`). They share one embedding setting but nothing queries both.
- The user can bring in only a resume, job descriptions and one notes text. Every uploaded file is forced through the resume or job-description extractor. There is no general document, no folder, no slides, and no list, delete or re-index for materials.
- Retrieval paths do not agree: the agent's `search_meetings` searches meeting passages only (no summaries, no materials, no date or type filter); global chat searches all meetings with no scope control; the saved-meeting chat is not vector search at all (title, summary and the last 80 rows); the launcher search pill is a substring match on titles and summaries. Materials reach an answer only through the "background" interceptor, which frames every answer as the candidate's, and only on a fallback path.
- "Use your background" is in-memory state that needs a resume; notes alone can personalize answers while the screen says it is off.
- Live meeting indexing has source-established gaps (the live index writes under a provisional id, the stale `source` column insert fails and is caught, the provider is never recorded so retrieval filters those rows out; the summary index can hold a placeholder). Rebuild covers only meetings, never materials. Deleting a meeting or a role leaves vector rows behind. The Search index setting says "only transcripts" although summaries and materials are embedded too.
- The Settings tab is a resume page: resume uploader, roles, interview prep, a 607-line profile editor, a fake upload percentage. For someone who never job hunts it offers nothing, and it has no list of meetings or materials and no index status.

## Proposed structure (option A, recommended)

Settings tab "Knowledge" (the tab id `profile` stays so every caller keeps working), with three local pages:

- **Sources**: one list of everything searchable. Filter All, Meetings, Materials. A filled Add source menu: Write a note, Import a document. Meetings appear by themselves (a count row plus each meeting with an Open action that goes to the meeting details); materials show kind, name, date, passages, a state in words and a mark (Indexed, Indexing, Needs rebuild, Failed with the real reason), and quiet Open, Edit or Re-index and Remove. The profile is a quiet link, never an empty resume hero. Empty state: "Meetings appear here as you record them. Add a note or document for Pika to search."
- **Index**: the Search index model setting moves here from AI functions (Automatic or a provider, one model for both meetings and materials), what is indexed per kind (indexed of total, last indexed, model), a Needs attention list with the real error and Retry, Re-index all. "Queued" is never shown as "done"; sources indexed before this view existed show Unknown.
- **Interview profile (optional)**: the current resume, target roles, interview prep and profile editor, unchanged, behind one disclosure page that says it is only for interview practice. Interview features are kept, not extended (`docs/design-agent-platform.md`, D1).

Using sources when answering: each kind of source on the Sources page has a **Use when answering** switch. Past meetings are on; materials and the interview profile are off until the user turns them on (owner decision, 2026-10-27: nothing the user adds is ever searched by default). It is a global setting, not a per-question choice: a per-question "Sources" chip in the composer was considered and left for later (it adds a control to the overlay, which is read for one to three seconds and has a tight chrome budget, and it needs per-request scope fields on several IPC channels; if it is ever added, the launcher's global chat is the place, not the overlay). The switches are one new persisted settings key per kind in `settings.json` (a missing key means the default above), approved by the owner.

Rejected, option B: a launcher "Library" with a source browser and a cited-results screen, Settings only configuring the index. Larger (navigation, a source reader, citation events). Choose it later if browsing sources becomes a daily activity.

## Marking what is new

The preview tags every piece that needs new code. Pure UI moves (the tab, the Search index controls, disclosing the resume) need no new behaviour and no stored change. New behaviour with no new stored shape: neutral material lookup separate from the candidate prompt, an agent `search_materials` tool, a combined source-labelled retrieval, live-index and summary-index repairs, accurate delete and re-index. Needing the owner first (the switch keys are already approved): a `material` document type, indexing provenance columns on `knowledge_documents` (`embedding_provider`, `embedding_dimensions`, `indexed_at`, `index_error`), new IPC for source lists, and folders (not proposed now).

## Steps

The ordered queue is in `TASKS.md`. Corrections from the review that shape it:

- K2 (live indexing) is two steps. K2a first makes the live indexer safe: a forced stop drains one or two pending segments after any in-flight batch, a batch advances only to the boundary it captured, a stopped batch cannot touch the next session, and each write records the provider and dimensions of the provider it actually used. K2b then indexes under the real meeting id, removes the stale `source` insert (the meeting row is created by `MeetingPersistence`, so the insert is redundant) and, after the meeting ends, replaces that meeting's live chunks with the full-transcript chunks instead of appending a second copy. Skip live indexing when the record could not be created. Order matters: switching to the real id before the stop and drain races are fixed would corrupt indexing.
- K3 (summary-derived search) is two steps and its reason is different from what was first written. An ordinary stop does not embed the placeholder (an empty summary is skipped); the real gaps are that the summary index is never refreshed after the final summary, after recovery or after an edit, and that a refresh needs care: replacing the summary text changes its vector identity, an older in-flight embed must not attach to newer text, the queue's NULL-keyed job does not deduplicate, and old native vectors must be removed. K3a is that safe refresh; K3b calls it after a successful final commit, a successful recovery commit and a successful edit. "Final" means committed metadata, not "the model returned".
- Material provenance comes before expanded material retrieval. Material vectors are checked by dimension only, so a same-dimension model switch can return unrelated evidence; K5a (provenance and index status for the existing notes) therefore precedes K4.
- K4 is three steps: the Use when answering settings and their enforcement in every retrieval path (the agent's past-meeting search, global chat, quick answers and their fallback, the profile interceptor), then the neutral notes lookup and the agent's `search_materials`, then the labels. "Materials" means notes and imported documents; the interview profile (resume and roles) is its own switch. Current-meeting context never depends on the Past meetings switch. Turning a kind off must hold on every path, including fallbacks.
- Combined retrieval, per-source retry, accurate deletion (a meeting or a role leaves vector rows behind) and Re-index all are real gaps not yet assigned to a step; they are listed in `TASKS.md` as K6 so nothing is promised that no step delivers.

## Decisions

Option A: chosen by the owner on 2026-10-27. Materials are never searched by default: decided (the switch above). Still open: the `material` type and the provenance columns (step 5 waits for this); how deletes should behave (the proposal: removing a meeting also removes its index, with a clear confirmation); folders later or never.
