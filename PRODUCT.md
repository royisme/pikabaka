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
- **Privacy and bring-your-own-key**: Credentials remain in the OS keychain, no telemetry runs by default, and audio is transmitted only to user-configured cloud providers [README.md, RULES.md, docs/conventions.md, docs/architecture.md].
- **Never invent data**: The application never outputs fake statistics, scores, synthetic provenance, or fallback AI answers [RULES.md, docs/conventions.md].

## 5. Claims this project must not make and claims in the README that this brief does not endorse
- **Windows platform support badge and claim** (`Windows 10/11` and `platform-macOS | Windows` badge): `contradicted by the repo`. Issue #15 records that a Windows build was never released, and window behavior is verified only on macOS [TASKS.md, PROGRESS.md].
- **Transcription latency under 500 ms** ("under 500 ms" and "Sub-500 ms transcription"): `not evidenced in the repo`. No transcription or translation latency measurements exist in the repository [PROGRESS.md, docs/architecture.md].
- **"Audio never leaves your device" claim**: `contradicted by the repo`. All supported speech-to-text providers in the architecture require network transmission to external cloud services [docs/architecture.md].
- **"100% offline option (Ollama)" claim**: `contradicted by the repo`. While Ollama runs local LLM inference, transcription depends on cloud speech-to-text providers because no local STT engine exists in the codebase [docs/architecture.md].
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
- **Windows distribution package**: A packaged and verified Windows build has not been released [TASKS.md, PROGRESS.md].
- **16px lead sentence on answers**: Planned under task U5, not yet implemented [PROGRESS.md, TASKS.md].
- **Unified AnswerCard component**: Shared answer rendering across overlay and post-meeting views remains open under task U5 [TASKS.md, PROGRESS.md].
- **Streaming answer cancellation and retry**: Main-process cancellation and answer retries are not yet built [TASKS.md, PROGRESS.md].
- **Entity masking in live translation**: Ported as a module, but deferred and not wired into the translation request path [TASKS.md, PROGRESS.md].
- **Early translation with committed/preview rendering**: Deferred under tasks R3, R5, and T10 pending stable-prefix tracking [TASKS.md, PROGRESS.md].
- **Translating own speech ("Me")**: Explicitly excluded; own speech lines remain untranslated source text [docs/design-live-translation-ui.md, TASKS.md].
- **ESLint ruleset and CI enforcement**: Open under task S2 and awaits owner approval [TASKS.md].
- **Linux platform support and Wayland capture**: Open roadmap item; not implemented [README.md, TASKS.md].
- **Native OS vibrancy blur**: Deferred pending stealth and content-protection review [docs/design-overlay-v2.md, TASKS.md].

## 7. Questions for the owner
1. Who is the primary target user and what is the primary workflow (live call translation, meeting copilot, or interview rehearsal)?
2. Should interview prep and assistance remain a headline use case in README.md, given strict interview assistance policies and recent focus on live call translation?
3. How should the privacy and "audio never leaves your device" claims in README.md be amended, given that transcription currently requires cloud STT providers?
4. Should the Windows platform badge and Windows 10/11 support claims be marked experimental or removed until issue #15 is resolved and a Windows installer is released?
5. Should the "100% offline option" claim be removed or qualified until a local STT engine is integrated alongside Ollama?
6. Which speaker vocabulary should be standardized across live overlay and post-meeting views ("Them" vs. "Interviewer", "Me" vs. "User")?
