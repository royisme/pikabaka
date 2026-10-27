# Knowledge (replaces "Your Background")

Status: option A approved by the owner on 2026-10-27; built step by step (see `TASKS.md`). Nothing is built. Evidence is a source-only investigation (GPT, commit `fdd71df`); every claim below was cited there by file and line, and none was run.

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

## Steps (each one a branch and one PR)

1. Knowledge tab: extract the current profile branch into `KnowledgeSettings.tsx`, keep the id `profile`, add Sources, Index and Interview profile as local pages, move the Search index controls from AI functions, correct the "only transcripts" text, drop the fake upload percentage and spinner. No stored data or IPC change; works without a resume.
2. Repair live search identity: index under the real meeting id, remove the stale `source` insert, record the provider on live writes, flush the last under three segments.
3. Refresh summary-derived search after the summary is final, including recovery and edits.
4. Notes without interview framing: a neutral material lookup, an agent `search_materials` tool over the existing notes, source labels.
5. Material index status and generic import (document type, provenance columns, IPC). Owner approval gate before this step.

## Decisions

Option A: chosen by the owner on 2026-10-27. Materials are never searched by default: decided (the switch above). Still open: the `material` type and the provenance columns (step 5 waits for this); how deletes should behave (the proposal: removing a meeting also removes its index, with a clear confirmation); folders later or never.
