# Architecture

Stack, folders and the pipelines that matter for the conversation UI and live translation. Moved here from the old `CLAUDE.md` and corrected: the project does have unit tests (`test/`, tap).

## Three processes

1. **Electron main** (`electron/main.ts`): window management, IPC orchestration, native module loading and every backend service. `AppState.getInstance()` is the singleton, with helpers in `electron/helpers/` (`WindowHelper`, `SettingsWindowHelper`, `CropperWindowHelper`, `ScreenshotHelper`, `ProcessingHelper`).
2. **React renderer** (`src/`): Vite, React, TypeScript, Tailwind. React Query and local `useState`; no Redux or Zustand. Entry `src/main.tsx`; `src/App.tsx` switches on window mode (main, settings, cropper).
3. **Rust native module** (`native-module/`, crate `natively-audio`): low-latency audio capture with cpal, WebRTC VAD, rubato resampling and silence suppression. Speaker capture is CoreAudio/ScreenCaptureKit on macOS and WASAPI on Windows. Built by `scripts/build-native.js`.

## IPC boundary

A channel exists in four places and they move together:

- handler: `electron/ipc/*.ts` (`index.ts` registers them; `safeHandle.ts` wraps handlers)
- preload: `electron/preload.ts` and `electron/preload/*.ts` (`contextBridge`)
- types: `electron/preload/types.ts` and `src/types/electron.d.ts`
- renderer caller or listener (`src/hooks/*`, components)

Channel groups: window control, LLM switching and keys, audio and STT control, screenshots and intelligence, translation (`electron/ipc/translation.ts`).

## AI providers

- **Connections:** OpenAI-compatible, Anthropic and Gemini protocols (`electron/services/aiConnections.ts`), with a host and optional local-host key. Built-ins are Gemini, OpenAI, Claude and Groq; local servers such as Ollama and LM Studio are ordinary OpenAI-compatible connections. `CredentialsManager` drops stored connections of unsupported types when read.
- **Model uses:** Quick answers (`chat`), summaries and the agent each select a connection and exact model id through `electron/ipc/connections.ts`. Empty summary/agent connections inherit Quick answers; an unchosen Quick answers row returns a setup error, never a guessed provider or default model. Settings and the top-bar selector read the same rows. `LLMHelper.streamChat` routes through the chat row; summaries/titles use the summary row, and `electron/agent/models.ts` resolves the agent row. Other legacy LLM paths still use provider keys directly.
- **Legacy LLM paths:** screenshot analysis, suggestions, RAG chat, `chatWithGemini` and the legacy translation-provider list retain direct provider-key routing. The `chat:stream-meeting` RAG handler reads the chosen chat model instead of the removed default setting, but its prefix-based provider routing is unchanged.
- **STT:** Google Cloud Speech (default), Deepgram, ElevenLabs, Soniox, OpenAI (WebSocket with REST fallback), Groq, Azure, IBM Watson, under `electron/audio/`. Falls back to Google on failure.
- **RAG:** cascading embeddings (OpenAI, Gemini, Ollama, then a bundled local model) stored in SQLite with `sqlite-vec` (`electron/rag/`, `electron/db/`).

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
