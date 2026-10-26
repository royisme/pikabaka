# Product Brief: Pika

## 1. Product
Pika is a desktop overlay that transcribes a call, translates the other party, and suggests what to say. It runs on the user's machine with the user's own API keys. The application combines an Electron desktop shell, a React user interface, and a native Rust audio capture module.

## 2. Who uses it and when
**Live phone and video calls**: A participant on a phone or video call who needs to follow what the other party is saying in another language [docs/design-live-translation-ui.md]. The overlay acts as a quiet subtitle strip delivering translations of the other speaker in under two seconds [docs/design-live-translation-ui.md].

**Interview practice and prep**: A job candidate rehearsing technical or conversational interview questions before a real interview [README.md]. The documentation designates practice and rehearsal as the legitimate use case, respecting external assistance policies [README.md].

**Sales and customer success calls**: A representative in live customer discussions who needs real-time objection handling, pricing references, and product facts [README.md]. Stealth mode keeps private notes hidden during screen shares [README.md].

**Customer support**: A support specialist looking up relevant context from past tickets via on-device vector search during active customer conversations [README.md].

**Lectures and research**: A student or researcher listening to spoken presentations, transcribing content live, generating summaries, and asking follow-up questions on live material [README.md].

**Accessibility**: A hearing-impaired individual who needs live speech-to-text captions across meetings [README.md].

## 3. How it is used
The overlay is designed for quick glance reading lasting one to three seconds mid-call [DESIGN.md, docs/conventions.md]. It presents as a small, translucent, always-on-top window positioned over call software [DESIGN.md, RULES.md]. Window width defaults to 600px with a 380px minimum; height defaults to 420px with a 360px minimum [docs/conventions.md, DESIGN.md, docs/design-overlay-v2.md, PROGRESS.md]. Global keyboard shortcuts operate primary actions, translation toggles, and scrolling without stealing focus from the call [docs/conventions.md, docs/design-live-translation-ui.md, PROGRESS.md]. Operating system window capture exclusion ensures stealth by hiding the window from screen-sharing software during meetings [README.md, RULES.md].

## 4. Principles
- **Glance-first**: Mid-call reading lasts one to three seconds, requiring minimal chrome and quiet secondary controls [DESIGN.md, docs/conventions.md].
- **Answer or newest translation leads**: When an answer is streaming or pinned, the answer is the most prominent element [docs/conventions.md]. When translation is active and no answer exists, the newest translated line from the other party is most prominent [DESIGN.md, docs/conventions.md, docs/design-live-translation-ui.md].
- **Nothing moves under the reader's eyes**: Layout positions stay stable, reserved slots absorb incoming text, and controls never shift active content [DESIGN.md, docs/conventions.md, docs/design-live-translation-ui.md].
- **Privacy and bring-your-own-key**: Credentials remain in the OS keychain and audio goes only to the providers the user configures [README.md, RULES.md, docs/conventions.md, docs/architecture.md]. The README also says "no telemetry runs by default"; see section 5, where the code does not support that sentence.
- **Never invent data**: The application never outputs fake statistics, scores, synthetic provenance, or fallback AI answers [RULES.md, docs/conventions.md].

## 5. Claims this project must not make and claims in the README that this brief does not endorse
- **Windows platform support badge and claim** (`Windows 10/11` and `platform-macOS | Windows` badge): `contradicted by the repo`. Issue #15 records that a Windows build was never released, and window behavior is verified only on macOS [TASKS.md, PROGRESS.md].
- **Transcription latency under 500 ms** ("under 500 ms" and "Sub-500 ms transcription"): `not evidenced in the repo`. No transcription or translation latency measurements exist in the repository [PROGRESS.md, docs/architecture.md].
- **"Audio never leaves your device" (table cell with an asterisk)**: `qualified by the README's own footnote and FAQ` ("only if you choose a cloud STT/LLM provider"); the repo lists only cloud STT providers (`src/config/stt.constants.ts`: google, groq, openai, deepgram, elevenlabs, azure, ibmwatson; `electron/audio/` adds Soniox), so the offline route the footnote describes is `not evidenced in the repo` [README.md, docs/architecture.md].
- **"100% offline option (Ollama)" and "run completely offline with Ollama"**: `not evidenced in the repo`. Ollama covers the language model; no local speech-to-text engine is among the providers, so a call cannot be transcribed offline today [docs/architecture.md]. The FAQ mentions "a local STT engine (or system-only transcription)"; neither was found.
- **"No telemetry runs by default" (README line 126)**: `contradicted by the repo`, pending the owner's check. `initAnalytics()` runs at startup (`src/App.tsx:52`) and injects the Google Tag Manager script (`src/lib/analytics/analytics.service.ts:121-123`) even though `GA4_MEASUREMENT_ID` is an empty string (`:49`); there is no guard for the empty id. No network traffic was observed, so what is actually sent is unconfirmed.
- **Feature comparison table cells regarding Cluely, Granola, and Otter**: `not evidenced in the repo`. The repository contains no empirical tests, benchmarks, or documentation concerning competitor features or limitations [RULES.md].
- **Hardware requirement numbers** ("4 GB RAM minimum, 8 GB recommended", "16 GB+ for Ollama"): `not evidenced in the repo`. No memory profiling or benchmark evidence exists in the codebase [PROGRESS.md].
- **Provider speed and suitability assertions** (e.g. Groq "sub-second inference", Claude "best for coding interviews", Gemini "recommended default"): `not evidenced in the repo`. No comparative evaluation data or latency benchmarks exist in the repository [PROGRESS.md, docs/architecture.md].
- **Open-source AGPL-3.0 licensing**: `evidenced`. Verified by the project license file [LICENSE].
- **Bring-your-own-key architecture**: `evidenced`. Supported by `CredentialsManager` and client-side provider routing [docs/architecture.md, docs/conventions.md].
- **Stealth overlay hidden from screen sharing**: `evidenced`. Verified by window capture exclusion configuration in window helpers [RULES.md, docs/architecture.md].
- **Custom global keyboard shortcuts**: `evidenced`. Verified by `KeybindManager` and settings store [docs/architecture.md, PROGRESS.md].
- **Local RAG memory with sqlite-vec**: `evidenced`. Verified by `electron/rag/` and `electron/db/` [docs/architecture.md].
- **Dual-channel audio capture (system audio and mic)**: `evidenced`. Verified by native Rust audio capture module implementation [docs/architecture.md].

## 6. Not in scope / not yet built
- **Windows distribution package**: no Windows build has been released (issue #15) [TASKS.md, PROGRESS.md].
- **One answer component for every window**: the live overlay's answers have the Re line, the 16px lead and per-block Copy; the chat overlays and the post-meeting view still render answers themselves [TASKS.md, PROGRESS.md].
- **Entity masking in live translation**: the module exists and is tested but is not in the request path [TASKS.md, PROGRESS.md].
- **Translating before a turn flushes**: a design note recommends measuring first, then translating at the provider's own boundary; the stable-prefix design is not recommended [docs/design-early-translation.md].
- **Translating own speech ("Me")**: excluded; own lines stay untranslated source text [docs/design-live-translation-ui.md].
- **Linux support and Wayland capture**: open roadmap item [README.md].
- **Native OS vibrancy blur**: deferred pending a stealth and content-protection review [docs/design-overlay-v2.md].
- **Real-provider verification**: nothing built in the last weeks (streaming translation, Stop and Retry, the audio status, the top bar) has been exercised against a real STT or LLM provider or on Windows [PROGRESS.md].

## 7. Questions for the owner
1. Who is the primary target user and what is the primary workflow (live call translation, meeting copilot, or interview rehearsal)?
2. Should interview prep and assistance remain a headline use case in README.md, given strict interview assistance policies and recent focus on live call translation?
3. How should the privacy claims in README.md be amended: "audio never leaves your device", "100% offline", and "no telemetry runs by default" (the analytics script is injected at startup)? Should the analytics call be removed or guarded?
4. Should the Windows platform badge and Windows 10/11 support claims be marked experimental or removed until issue #15 is resolved and a Windows installer is released?
5. Should the "100% offline option" claim be removed or qualified until a local STT engine is integrated alongside Ollama?
6. Which speaker vocabulary should be standardized across live overlay and post-meeting views ("Them" vs. "Interviewer", "Me" vs. "User")?
