# Architecture

Stack, folders and the pipelines that matter for the conversation UI and live translation. Moved here from the old `CLAUDE.md` and corrected: the project does have unit tests (`test/`, tap).

## Three processes

1. **Electron main** (`electron/main.ts`): window management, IPC orchestration, native module loading and every backend service. `AppState.getInstance()` is the singleton, with helpers in `electron/helpers/` (`WindowHelper`, `SettingsWindowHelper`, `CropperWindowHelper`, `ScreenshotHelper`, `ProcessingHelper`).
2. **React renderer** (`src/`): Vite, React, TypeScript, Tailwind. React Query and local `useState`; no Redux or Zustand. Entry `src/main.tsx`; `src/App.tsx` switches on window mode (main, settings, cropper).
3. **Rust native module** (`native-module/`, crate `natively-audio`): low-latency audio capture with cpal, WebRTC VAD, rubato resampling and silence suppression. Speaker capture is CoreAudio/ScreenCaptureKit on macOS and WASAPI on Windows. Built by `scripts/build-native.js`.

## Native echo cancellation

`native-module/src/echo_cancellation.rs` owns a process-wide, bounded speaker reference and a per-microphone SpeexDSP echo state. The system DSP thread copies ungated mono PCM into the reference without waiting for the microphone; its existing output signal, frame size and buffering are unchanged. The microphone DSP thread aligns the reference, converts it to the microphone's hardware rate, cancels echo in 20ms frames with a 250ms filter, then runs the existing silence/VAD gate. Hardware-rate PCM and `get_sample_rate()` remain the STT contract; `resampler.rs` is not in this capture path.

Alignment uses sample-count clocks anchored to DSP arrival times, a fixed 40ms reference lead and 60ms microphone-only lookahead while reference frames are fresh. Missing, incomplete, stopped or 100ms-old reference data bypasses cancellation; a capture restart clears the reference and resets the adaptive filter. A zero reference bypasses too, after allowing the previous echo's 250ms tail to drain. No setting, IPC or NAPI surface is added. The text-level `electron/lib/echo-filter.ts` remains unchanged.

`native-module/vendor/aec-rs-sys` is an echo-only adaptation of aec-rs-sys 1.0.0: unchanged BSD-licensed SpeexDSP/KISS FFT C sources, a portable `cc` build and fixed echo bindings instead of CMake/bindgen. Only a C compiler is needed by the new dependency. Alignment and real-device latency still require owner checks (issue #39).

## IPC boundary

A channel exists in four places and they move together:

- handler: `electron/ipc/*.ts` (`index.ts` registers them; `safeHandle.ts` wraps handlers)
- preload: `electron/preload.ts` and `electron/preload/*.ts` (`contextBridge`)
- types: `electron/preload/types.ts` and `src/types/electron.d.ts`
- renderer caller or listener (`src/hooks/*`, components)

Channel groups: window control, LLM switching and keys, audio and STT control, screenshots and intelligence, translation (`electron/ipc/translation.ts`).

## AI providers

Settings > Provider setup (`providers`, `src/components/settings/ProviderSetupSettings.tsx`) owns the language-model Connections editor, the speech credential list/editor (`SpeechProvidersSettings.tsx`) and the separate decision-service URL/key editor (`DecisionServiceSettings.tsx`). The speech editor uses the existing per-service key IPC and Google account chooser; Audio & Translation keeps the transcription service, model and language drafts, reuses the speech editor's service catalog and saved credential-status query to offer only configured services, and shows a setup link for a missing saved choice. Models & Agent (`ai-providers`) keeps Quick answers, Summaries, Agent, the workspace and Proactive help (mode, decision model, threshold, cooldown, decision log and model Test), with a link to Provider setup for the service address and key. Each gate editor sends only its own fields through the existing partial settings IPC; Provider setup's Test reuses the gate model test with its draft endpoint fields and the saved decision model. `SettingsOverlay.tsx` owns tab navigation in local state and shares provider-editor navigation through `ProviderNavigation` with all job pickers, including Search index and translation; existing tab ids and `initialTab` callers are unchanged. The floating Quick answers picker uses `providers:<id>` in the existing `open-settings-section` string to reach that editor without a new IPC field. Search index stays under Knowledge. The Quick answers row in `ModelUsesSettings.tsx` holds `AnswerLanguageSetting.tsx` (owns the response-language queries and save through the existing IPC) and `AnswerStyleSettings.tsx` (owns the collapsed style disclosure and its existing query/save). General no longer owns either answer control. `ModelUsesSettings.tsx` also reads all three saved job rows with their existing queries to name the other jobs that resolve to the row's connection and model (empty summary/agent connections inherit Quick answers), and keeps each row's Test and result under a collapsed, self-opening disclosure. Audio & Translation's translation block is `TranslationSettings.tsx`: it owns the seven-field draft, the unchanged Save payload and the segmentation IPC, puts source language, display mode, prompt and segmentation under a collapsed Advanced disclosure, and shows `TranslationTest.tsx` under its own collapsed Test disclosure. `SettingsOverlay.tsx` keeps no translation state.

- **Connections:** OpenAI-compatible, Anthropic and Gemini protocols (`electron/services/aiConnections.ts`), with a host and optional local-host key. Built-ins are Gemini, OpenAI, Claude and Groq; local servers such as Ollama and LM Studio are ordinary OpenAI-compatible connections. `CredentialsManager` drops stored connections of unsupported types when read. Setup lists configured built-ins (key or host override) and all customs; pickers also retain their current named provider even when unconfigured. Built-ins can reset their key/host, not be deleted. The connection delete IPC handler refuses customs referenced by Quick answers, Summaries, Agent, Search index or Translation without changing any job.
- **Model uses:** Quick answers (`chat`), summaries and the agent each select a connection and exact model id through `electron/ipc/connections.ts`. Empty summary/agent connections inherit Quick answers; an unchosen Quick answers row returns a setup error, never a guessed provider or default model. Settings and the top-bar selector read the same rows. Interactive generation, suggestions, screenshot analysis and RAG answers use the chat row through `LLMHelper`'s connection stream; summaries/titles use the summary row, and `electron/agent/models.ts` resolves the agent row. Meeting chat retains role-separated history and cancellation. RAG keeps its existing prompts through optional verbatim streaming inputs. Settings tests Quick answers and Summaries drafts through the same connection stream (`model-test`); an empty Summaries connection tests the saved Quick answers row without writing settings. Results report first-text/total time and classified provider errors from an invented question.
- **Custom headers:** `CredentialsManager` stores optional headers only on custom providers in the existing plaintext credential file. `connectionHeaders.ts` owns stored-map and explicit keep/set/remove validation; list/status payloads expose names and set marks only. The custom provider editor in `src/components/settings/ConnectionsSettings.tsx` owns the write-only header draft: saved rows show their name and a set mark, a blank value keeps the saved one, a typed value or a new row sends a set edit, Remove sends a remove edit, and the same edits go on Save and the discovery Test. Only the missing, duplicate and non-token name rules are checked in the renderer; reserved names, limits and control characters are the validator's and its message is shown unaltered. The connection Save handler force-rebuilds a selected embedding provider after transport credentials change. `connectionSecrets.ts` owns shared error redaction for SDK streams, tests and summary logs.
- **One model-call path:** `LLMHelper` creates SDK clients from the resolved connection for each request, never from ambient or cached built-in keys. Translation accepts only a ready connection id and an exact model; obsolete ids are not configured. Legacy method/channel names such as `chatWithGemini` and `gemini-chat` remain for their callers, but no longer select Gemini or fall back to another provider.
- **STT:** Google Cloud Speech (default), Deepgram, ElevenLabs, Soniox, OpenAI (WebSocket with REST fallback), Groq, Azure, IBM Watson, under `electron/audio/`. `audio-pipeline.ts` refuses a selected service without its saved credential (Google requires its service-account path), never substitutes another service, and propagates setup failures to the meeting-start boundary. That boundary retains the real message in audio status and broadcasts `meeting-audio-error`; the overlay polls status through `useMeetingAudio` and displays it through `audioStatus` and `TranscriptPanel`. Same-service model/transport alternatives remain.
- **RAG:** search embeddings use a saved connection and exact model id (OpenAI-compatible or Gemini), with the bundled local model as the only initialization fallback. With no choice, the existing OpenAI, Gemini, Ollama, local chain remains. `electron/rag/embeddingConfig.ts` builds the same configuration at startup, after Ollama readiness and on Settings Save. Settings > Knowledge owns the Sources, Index and Interview profile local pages (`src/components/settings/KnowledgeSettings.tsx`); the Index page's Search index section reports the active model/dimensions and queues incompatible and never-embedded completed meetings through the existing rebuild IPC. Embeddings remain in SQLite with `sqlite-vec` (`electron/rag/`, `electron/db/`). `LiveRAGIndexer` owns per-session batching and stop/drain; `EmbeddingPipeline` owns transactional vector/metadata writes and job retries; exhausted jobs retain their real error as `failed` without replacing the meeting's provider or vectors. A write whose provider differs from the meeting's recorded one stays unembedded until retry or rebuild. `VectorStore` owns native row replacement and discovers every provisioned chunk/summary vector dimension for scoped cleanup; native write failures propagate to the caller's transaction.

Knowledge documents use a separate store (`electron/knowledge/`). Main injects embeddings with the provider/dimensions captured before each request and exposes the active embedding status to `KnowledgeOrchestrator`. `KnowledgeVectorStore` owns atomic document-vector/provenance replacement and provider/dimension filtering; legacy NULL provenance retains dimension-only retrieval. The orchestrator records first-line indexing failures without overwriting provenance and derives notes status for the existing `profile:get-status` reply. Notes Save waits for the attempt; Sources reads that status, and notes/model saves invalidate its query cache. The orchestrator's `searchMaterials` is a neutral notes-only lookup (at most five trimmed passages, the same provider/dimension guard and score cut as the answer interceptor) that the agent's `search_materials` tool quotes as data, gated by the materials answer switch. The `answer-sources:get`/`answer-sources:set` pair reads and writes the three approved answer-source switches for the Sources page. No meeting retrieval responsibility moves.

## Services

`electron/services/`: `CredentialsManager` (key storage and settings, including the transcript translation settings), `KeybindManager`, `OllamaManager`.

## Overlay and conversation UI (renderer)

| Piece | File |
| --- | --- |
| Overlay shell, shortcuts wiring, scroll-to-end | `src/components/PikaInterface.tsx` |
| Top pill (hide, stop) | `src/components/ui/TopPill.tsx` |
| Transcript / answer split | `src/components/meeting/SplitterShell.tsx`, `src/components/ui/ResizableSplitter.tsx` |
| Transcript zone | `src/components/meeting/TranscriptColumn.tsx`, `TranscriptPanel.tsx`, `src/components/ui/RollingTranscript.tsx` |
| Answer zone (messages, quick actions, input, footer) | `src/components/meeting/ChatColumn.tsx`, `ChatPanel.tsx` |
| Chat state, intents, streaming | `src/hooks/useMeetingChat.ts` |
| Transcript and audio state | `src/hooks/useMeetingTranscript.ts`, `useMeetingAudio.ts` |
| Other chat surfaces | `MeetingChatOverlay.tsx`, `GlobalChatOverlay.tsx`, `MeetingDetails.tsx` (post-meeting) |
| Window size and position | `electron/helpers/WindowHelper.ts` |
| Overlay tokens and drag regions | `src/index.css` (`--overlay-*`, `draggable-area`, `no-drag`) |

`useMeetingChat` subscribes to the intelligence IPC channels (what-to-answer, recap, follow-up questions, clarify, assist, suggested and refined answers) and to the generic Gemini stream. A channel the main process sends that the hook does not listen to is silently lost; see `docs/HANDOFF_ANSWER_TRANSCRIPT_DISPLAY.md`.

## Transcript and translation pipeline

1. STT providers emit interim and final results (`electron/audio/*`), through `electron/lib/audio-pipeline.ts`.
2. `electron/lib/transcript-assembler.ts` merges them into turns and flushes a turn after a delay that depends on the profile (sentence flush 700-2500 ms, fragment flush 1450-5000 ms, shorter after the speech-ended signal). Flushed turns can be reopened and merged by second-pass correction (`docs/SPEC_TRANSCRIPT_SECOND_PASS.md`, `revision`).
3. After a flush, `emitTranscriptWithTranslation` (`transcript-assembler.ts`) emits the turn, then, if translation is enabled and the source language differs from the target, calls `LLMHelper.translateTranscriptText` once for the whole turn (non-streaming, with the two previous translated turns as context). The prompt is built in `electron/transcript/translationExecutor.ts`.
4. The renderer receives `translationState` of `pending`, `complete`, `skipped` or `error` through `emitNativeAudioTranscript`.

Consequence: a translated line appears after the flush delay plus one full LLM round trip, with no partial text. This is read from code; latency has not been measured (issue #29).

## Meeting record

Meetings start manually from the launcher. `MeetingPersistence` creates the row before capture, assembled transcript turns and usage are written incrementally, and stop or startup recovery completes the row without rewriting its children. Recovery preserves the stored start time and any provided title. New databases have no event-link or meeting-origin columns; existing unused nullable columns are left untouched and ignored by row mappings. No schema migration removes them.

Live indexing uses that same persisted id; a failed record creation starts no live index. The main process owns the stop fence: it awaits the live drain before persistence can delete a short record or another meeting can start, and removes a short meeting's derived chunks/vectors before the record's cascade removes their ids. `RAGManager` owns full-transcript replacement: it finishes queued writes, then replaces only that meeting's transcript chunks, chunk queue entries and vectors across all provisioned dimensions in one transaction. The record, transcripts, interactions and existing summary index survive; provider metadata is cleared for the replacement only when no summary vector survives.

`electron/rag/meetingSummaryIndex.ts` owns the key-point/action-item text composition shared by the main process's full-transcript indexing and summary-only refreshes. Persistence refreshes after a successful final save or recovery commit; the summary-edit IPC refreshes only after a successful write. Both read the committed record and start the existing queue runner without awaiting it; refresh/runner errors are logged without failing the save or reply. `IntelligenceManager` passes an injected RAG-manager getter to persistence, so unconfigured RAG is a no-op without a circular import. Placeholder and blank notes produce no summary index text.

The `delete-meeting` IPC handler deletes the `MeetingAgent` store, calls `RAGManager.deleteMeetingData` to remove both vector families, derived rows and queue jobs while their ids still exist, then calls `DatabaseManager.deleteMeeting` for the record cascade. The database layer stays independent of RAG; short-meeting cleanup already uses the same RAG deletion method before persistence deletes its record.

The follow-up email modal keeps transcript-based recipient lookup and manual entry; it has no external attendee lookup.

## Tests

`test/unit/` and `test/integration/`, run by tap with tsx (`docs/development.md`). There are no UI or end-to-end tests.
