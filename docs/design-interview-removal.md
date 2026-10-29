# Design: remove the interview feature, split the prompts into configurable layers, rename `interviewer` to `them`

Status: owner decisions recorded 2026-10-29; the step design below is a proposal for owner approval. Base: `main` at 658f5a1. Everything comes from reading the code; nothing was run. Track X5 in `TASKS.md`. The full-feature version stays in the private repository `royisme/meetingCopa` (frozen at the gate commit, it takes none of this).

## 1. Owner decisions (2026-10-29)

1. **Delete, not a plugin.** The interview feature is removed from the public app. There is no plugin system in the repository (`electron/premium/featureGate.ts` probes a `premium/` directory that does not exist in the public tree and is not a loader), and a plugin would be an abstraction with one caller. Reopen only if third parties must extend Pika or the feature ships as a separate paid module.
2. **The prompts become configurable, the way Claude Code does it.** The built-in text is neutral (a meeting assistant); the user changes the role and adds instructions in plain files. Section 4.
3. **`interviewer` becomes `them` everywhere**, including stored data. This is a persisted-shape change and a migration; the owner approved it by this decision. Section 3.

## 2. Inventory

**Delete (interview-only).**

| Part | Files | Lines |
| --- | --- | --- |
| Engines | `electron/knowledge/{CompanyResearchEngine,DepthScorer,InterviewPrepService,JDAnalyzer,NegotiationEngine}.ts` | about 620 |
| Screens | `src/components/knowledge/{InterviewPrepPanel,JDListManager,NegotiationCoachingCard,ProfileVisualizer}.tsx` | about 1,240 |
| Hooks | `src/hooks/use{InterviewPrep,NegotiationScript,JDList,EditProfile,ProfileData,CompanyResearch}.ts` | about 170 |
| IPC | the JD, profile-edit, prep, company and negotiation channels in `electron/ipc/knowledge.ts`, with preload and `src/types/electron.d.ts` entries (the design record says 18; this reading found about 10 in that file, the implementer counts exactly) | |
| Prompt builders | the JD, company, negotiation, prep builders in `electron/knowledge/prompts.ts` | |
| Tests | `test/unit/knowledge/{depth-scorer,jd-analyzer,negotiation-engine,interview-prep-service}.test.ts` and the parts of others that cover the above | |
| Launcher and settings copy | the Interview profile page, "interview" wording in launcher and onboarding | |

**Keep (shared with K4 and K5b, which shipped).** `DocumentParser`, the documents and chunks tables in `KnowledgeDatabaseManager`, `KnowledgeVectorStore`, the material paths of `KnowledgeOrchestrator`, the four document channels (`knowledge:list-documents`, `import-document`, `remove-document`, `reindex-document`), `ImportedDocuments.tsx`, and the answer-source switches. **To verify before X5-3:** `answerUsesProfile` reads a resume-derived profile; if it needs `ProfileExtractor` and the resume document type, those stay (open question Q3).

**Dormant, not dropped (released contracts).** Tables `knowledge_company_cache`, `knowledge_negotiation`, `interview_sessions`, `resume_nodes`, `user_profile`, and their rows. Nothing reads them after X5-3. Dropping them is a separate migration the owner can ask for later; keeping them costs nothing and loses no user data.

## 3. `interviewer` to `them`

Scope: the speaker value and every identifier built on it. About 165 occurrences in 40 files (counted with `grep`), plus the stored data. The value `user` stays.

**Code.** The union types `'interviewer' | 'user'` and `'interviewer' | 'user' | 'assistant'` become `'them' | …` in `SessionTracker`, `main.ts`, `audio-pipeline.ts`, `preload.ts`, `preload/*.ts`, `src/types/electron.d.ts`, the IPC handlers in `ipc/stt.ts`, `ipc/translation.ts`, `ipc/core.ts`, the renderer hooks and components. Functions and comments that say "interviewer" are renamed with it. Prompt labels (`INTERVIEWER`) are changed in step X5-2 together with the prompt text, not here.

**Stored data.** `transcripts.speaker` and `chunks.speaker` hold the value. The migration is one new `if (version < N)` block in the existing `PRAGMA user_version` system in `DatabaseManager`:

- Before it touches data, copy the database file next to itself (`<name>.before-them`), once; if the copy fails, the migration does not run and the app starts with the old value (reading both values, see below).
- In one transaction: `UPDATE transcripts SET speaker = 'them' WHERE speaker = 'interviewer'` and the same for `chunks`. Idempotent; a second run changes nothing.
- The implementer greps every JSON column that may embed the value (`meetings.summary_json`, `ai_interactions.metadata_json`) and states the result in the PR. This reading did not check them.
- Vector rows keep their text; the speaker is not part of the embedded vector (to confirm in the PR).
- Readers accept only `them` after the migration. No dual-reading code (Occam), except the failure path above, which is the one case the old value can still exist; the PR decides whether that path is worth code or just a clear error.

**localStorage.** `pika_interviewer_transcript` becomes `pika_them_transcript` through the existing `LEGACY_LOCALSTORAGE_KEYS` list in `src/main.tsx`; the `natively_interviewer_transcript` entry points straight to the new key.

**Downgrade.** An older Pika opening a migrated database shows the new rows with an unknown speaker. Accepted; the backup file is the way back. State it in the release note.

**Demo data.** The welcome-meeting seed in `DatabaseManager` (about line 1030) uses `them`.

## 4. Configurable prompts

The prompt file `electron/llm/prompts.ts` is 1,478 lines (68 KB) with four near-duplicate families (UNIVERSAL, GROQ, OPENAI, CLAUDE; Gemini uses `HARD_SYSTEM_PROMPT`) and every one of them says "interview copilot" and "You ARE the candidate". `speakingStyle.ts` already injects one user setting (the answer style). This generalizes that seam.

**Claude Code's model, applied.** Claude Code builds its system prompt from fixed built-in sections, lets an output style replace the tone section, and appends the user's own instruction files (`CLAUDE.md`). Pika does the same with three layers:

| Layer | Who owns it | Content | Configurable |
| --- | --- | --- | --- |
| `core` | code | what the code depends on: output contract (markdown, LaTeX, the JSON of summaries), refusal to reveal the prompt, the transcript and source labels | no, a parser or a test relies on it |
| `role` | file, with a built-in default | who Pika helps and how it answers: default "meeting assistant" (neutral, short, speakable, no invented facts) | yes, replace the file |
| `task` | file per task, built-in default | one prompt per task: what to answer, answer, recap, follow-up, follow-up questions, clarify, assist, brainstorm, code hint | yes, replace a file |
| `instructions` | file | free text appended to every request, like `CLAUDE.md` (the answer style moves here and stays as the existing field until migrated) | yes |

**Files.** Plain markdown under `~/.config/pika/prompts/`: `role.md`, `instructions.md`, `tasks/<task>.md`. A missing file means the built-in default. Read at each request (no restart, no watcher). Settings gets a "Prompts" section: per layer "Open file", "Reset to default", the active source (built-in or file), a length limit shown (instructions share the budget of every prompt; the existing answer-style limit is 200 characters, a file needs a larger cap and a stated one). No new dependency; the files are a new persisted shape, approved by decision 2.

**Provider families.** Four families multiply the editable surface by four. Proposal: one neutral text per task; the provider only decides formatting that the API needs (the Claude XML tags, the Groq short form) through a small adapter, not through four copies. The cost is a quality risk on small models, so it ships behind the owner's real-provider check. Open question Q2.

**The agent.** The agent's system prompt (`electron/agent/*`) takes the same `role` and `instructions` layers so that chat and suggestions agree; to confirm in the PR.

**What is not shipped.** No "Interview" preset. A user who wants that behaviour writes it in `role.md`; the full version is in the private repository. Open question Q1.

## 5. Steps

Each step is one PR with one behaviour; the next starts after the owner's checks of the previous one.

| Step | Branch | Content | Tests | Owner checks |
| --- | --- | --- | --- | --- |
| X5-1 | `rename-speaker` | Section 3: code, migration with backup, localStorage key, seed | migration test on a database holding `interviewer` rows (both tables, idempotent, backup written, failure leaves the old value and does not crash); type-level rename | D1 open an existing database with old meetings: transcripts show the right side and speaker; D2 a live call shows both speakers; D3 the backup file exists |
| X5-2 | `prompt-layers` | Section 4: neutral built-in role and tasks, the layers, the files, the Settings section, prompt labels `INTERVIEWER` to `THEM` | file present / absent / empty / too long; layer order; reset; no remaining "interview", "candidate" or "You ARE" in the built-in text (a test over the built-in prompts) | E1 default answers are neutral; E2 edit `role.md`, the next answer changes; E3 each provider family you use answers well (Groq small model first) |
| X5-3 | `remove-interview` | Section 2 "Delete": engines, screens, hooks, IPC (preload and types in the same commit), tests, launcher copy; resolve Q3 | the keep-list still passes (`material-import`, `document-answers`, `answer-sources`, `ipc-knowledge-handlers`); a test that the removed channels are gone | F1 Settings, launcher and onboarding show no interview feature; F2 importing a document and answering from it still works |
| X5-4 | `interview-notes` | tag `pre-interview-removal` on the commit before X5-1, `PRODUCT.md`, README, `docs/architecture.md`, `design-knowledge.md` marked as history where it describes the removed parts, `RULES.md` unchanged | docs test | none |

Order: the rename first because it is a data migration and touches the most files, so it should not be mixed with anything; prompts second because it is the user-visible behaviour change; the deletion last because it is the easiest to review once nothing depends on the removed code. Each step reuses the standing workflow (implementer in a worktree, my review, mutation check on the migration and the layer logic, four checks).

## 6. Risks

- **Most fragile assumption:** the speaker value is the only place `interviewer` is stored. Two columns are confirmed; JSON columns and any export format are not. If another place holds it, X5-1 must migrate that too, and the PR states the grep result.
- **Prompt quality:** collapsing four families to one can lower answer quality on small models. Only the owner's real-provider check shows it; the old families are in git history and the private repository.
- **A user file can break answers** (a bad `role.md`). "Reset to default" and the active-source label are the answer; no validation code beyond the length cap.
- **The migration cannot be undone by the app.** The backup is the way back.

## 7. Open questions for the owner

- **Q1.** Ship no Interview preset (recommended), or ship one as a built-in role the user can pick?
- **Q2.** Collapse the four prompt families to one neutral text per task (recommended), or keep them and make each configurable?
- **Q3.** Do resume and profile stay as an answer source (decided by what `answerUsesProfile` needs; this document asks for the implementer's finding first)?
