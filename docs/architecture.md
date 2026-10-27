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

Settings > Provider setup (`providers`, `src/components/settings/ProviderSetupSettings.tsx`) owns the existing Connections editor. Models & Agent (`ai-providers`) keeps Quick answers, Summaries, Agent, the workspace and Proactive help. `SettingsOverlay.tsx` owns tab navigation in local state and passes callbacks for the links between these pages; existing tab ids and `initialTab` callers are unchanged. Search index stays under Knowledge.

- **Connections:** OpenAI-compatible, Anthropic and Gemini protocols (`electron/services/aiConnections.ts`), with a host and optional local-host key. Built-ins are Gemini, OpenAI, Claude and Groq; local servers such as Ollama and LM Studio are ordinary OpenAI-compatible connections. `CredentialsManager` drops stored connections of unsupported types when read.
- **Model uses:** Quick answers (`chat`), summaries and the agent each select a connection and exact model id through `electron/ipc/connections.ts`. Empty summary/agent connections inherit Quick answers; an unchosen Quick answers row returns a setup error, never a guessed provider or default model. Settings and the top-bar selector read the same rows. Interactive generation, suggestions, screenshot analysis and RAG answers use the chat row through `LLMHelper`'s connection stream; summaries/titles use the summary row, and `electron/agent/models.ts` resolves the agent row. Meeting chat retains role-separated history and cancellation. RAG keeps its existing prompts through optional verbatim streaming inputs. Settings tests Quick answers and Summaries drafts through the same connection stream (`model-test`); an empty Summaries connection tests the saved Quick answers row without writing settings. Results report first-text/total time and classified provider errors from an invented question.
- **One model-call path:** `LLMHelper` creates SDK clients from the resolved connection for each request, never from ambient or cached built-in keys. Translation accepts only a ready connection id and an exact model; obsolete ids are not configured. Legacy method/channel names such as `chatWithGemini` and `gemini-chat` remain for their callers, but no longer select Gemini or fall back to another provider.
- **STT:** Google Cloud Speech (default), Deepgram, ElevenLabs, Soniox, OpenAI (WebSocket with REST fallback), Groq, Azure, IBM Watson, under `electron/audio/`. Falls back to Google on failure.
- **RAG:** search embeddings use a saved connection and exact model id (OpenAI-compatible or Gemini), with the bundled local model as the only fallback. With no choice, the existing OpenAI, Gemini, Ollama, local chain remains. `electron/rag/embeddingConfig.ts` builds the same configuration at startup, after Ollama readiness and on Settings Save. Settings > Knowledge owns the Sources, Index and Interview profile local pages (`src/components/settings/KnowledgeSettings.tsx`); the Index page's Search index section reports the active model/dimensions and queues incompatible and never-embedded completed meetings through the existing rebuild IPC. Embeddings remain in SQLite with `sqlite-vec` (`electron/rag/`, `electron/db/`).

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

The follow-up email modal keeps transcript-based recipient lookup and manual entry; it has no external attendee lookup.

## Tests

`test/unit/` and `test/integration/`, run by tap with tsx (`docs/development.md`). There are no UI or end-to-end tests.
