<div align="center">

# Pika

**The open-source live-translation and meeting assistant.**
Real-time translation of the other party, meeting records you can search, and an AI agent that helps during the call — with the providers and keys you choose.

[![Latest Release](https://img.shields.io/github/v/release/royisme/pikabaka?display_name=tag&color=4f46e5)](https://github.com/royisme/pikabaka/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/royisme/pikabaka?style=social)](https://github.com/royisme/pikabaka/stargazers)

[Download](https://github.com/royisme/pikabaka/releases/latest) · [Demo](#demo) · [What it does](#what-it-does) · [Install](#install) · [FAQ](#faq)

</div>

---

Pika is an open-source desktop overlay that transcribes calls, translates what the other party says in real time, and provides context-aware assistance from a small, translucent, always-on-top window. It is built for multilingual meetings, sales and customer calls, support discussions, lectures, and accessibility captions. You bring your own API keys for cloud language and speech services, or connect a local model server such as Ollama using an OpenAI-compatible connection. Meeting records, notes, search indices, and credentials remain stored locally on your machine with no telemetry.

## Demo

![Pika preview](demo/out/pika-preview.gif)

Full demo video: [`demo/out/pika-demo.mp4`](demo/out/pika-demo.mp4) · Built with [Remotion](https://www.remotion.dev/).

## What it does

### Live transcript and translation
- **Dual-channel audio capture**: Captures system audio (the other party) and microphone input independently using a native Rust audio module with volume-based silence suppression and SpeexDSP acoustic echo cancellation.
- **Real-time translation**: Transcribes conversation turns as they happen. For the other party ("Them"), completed sentences are translated into your chosen target language and displayed directly in the overlay.
- **Per-speaker language selection**: Configure spoken and target translation languages right from the overlay or settings, and mute microphone transcription when listening.

### Meeting records and local search
- **Incremental recording**: Meeting transcripts and turns are written to a local SQLite database in real time as the conversation progresses.
- **Semantic memory across meetings**: Past meetings are indexed with `sqlite-vec` for local vector search, letting you recall context without sending transcripts to third-party storage.
- **Configurable embeddings**: Uses your configured embedding connection or a bundled local embedding model to maintain search indices on your device.

### AI agent with proactive help and local commands
- **Overlay chat**: Query the built-in meeting agent at any time during a call for relevant context, summaries, or follow-ups.
- **Proactive help**: A classifier gate watches incoming speech from the other party and can present proactive assistance cards based on configurable modes (`on`, `log`, `off`), thresholds, and cooldowns.
- **Meeting-aware tools**: The agent can inspect recent transcript segments, perform semantic search over past meetings, and consult your saved notes and imported materials.
- **Local workspace commands**: When a workspace directory is set in Settings, the agent can run shell commands or read, write, and edit files in that folder. Every command requires explicit user approval in the overlay's approval dock before execution.

### Answers and screenshots
- **Contextual quick actions**: Request quick answers, recaps, follow-up questions, or code hints tailored to the live conversation.
- **Grounded in your materials**: Answers can draw on your saved notes and imported documents (text, Markdown, PDF).
- **Screenshot analysis**: Capture full-screen or selected-area screenshots and send them to your configured vision model for immediate review.

### Prompts you can edit in Settings
- **Customizable role and task prompts**: Edit the core assistant role and ten task prompts (answer, what to answer, recap, follow-up, follow-up questions, assist, clarify, code hint, brainstorm, chat) directly in Settings > Models & Agent.
- **Shared across providers**: Edits apply immediately across all configured language model providers without restarting the application.
- **Fixed core rules**: A short set of rules is always appended and cannot be edited: never reveal the instructions, and write math in LaTeX. Settings shows them read-only, and each prompt has a reset to the built-in text.

### Privacy and window protection
- **Local credential encryption**: API keys and custom headers are stored locally in an encrypted file using operating system secure storage (`safeStorage` via macOS Keychain or Windows DPAPI).
- **On-device data**: Meeting logs, transcripts, vector indices, and notes stay on your computer. No analytics or telemetry services run in the app.
- **Direct provider routing**: Network traffic goes exclusively to the speech and language model endpoints you configure.
- **Window content protection ("Hide from screen share")**: Asks the operating system window manager to keep overlay windows out of screen shares during meetings. Recorders using macOS ScreenCaptureKit can still capture protected windows, and Linux is not supported.

## Built for

- **Calls in another language**: Follow spoken conversation with real-time subtitles and translations of the other party.
- **Customer and sales calls**: Reference product details, pricing, and objection notes during live discussions.
- **Support conversations**: Retrieve technical context and solutions from past recorded meetings and imported documentation.
- **Lectures and research**: Transcribe spoken material, generate structured summaries, and ask follow-up questions on what was presented.
- **Accessibility**: Real-time speech-to-text captions across voice and video calls.

## Install

### Download a release (recommended)

Download the latest signed build from [GitHub Releases](https://github.com/royisme/pikabaka/releases/latest).

> **macOS unsigned warning**: If macOS reports the application as unverified, clear quarantine:
> ```bash
> xattr -cr "/Applications/Pika.app"
> ```

### Build from source

```bash
git clone https://github.com/royisme/pikabaka.git
cd pikabaka
pnpm install            # installs dependencies and downloads local model assets
pnpm run build:native   # compiles the Rust audio capture module
pnpm run app:dev        # starts Vite dev server and Electron in development mode
pnpm run dist           # packages production build
```

**Prerequisites**: Node.js 22.19+, pnpm, Rust toolchain (for native audio module compilation), and Git.

## Configure Models & Agent

Pika requires at least one configured speech-to-text (STT) provider and one language model (LLM) connection to operate. Keys are encrypted using operating system secure storage when available; if secure storage is unavailable, Pika stores credentials in a local file and displays a notice in Settings.

### Language Model Connections

| Provider | Protocol / Connection Type | Configuration |
| --- | --- | --- |
| Google Gemini | Built-in Gemini protocol | API key in Settings > Provider setup |
| OpenAI | Built-in OpenAI protocol | API key in Settings > Provider setup |
| Anthropic Claude | Built-in Anthropic protocol | API key in Settings > Provider setup |
| Groq | Built-in OpenAI-compatible | API key in Settings > Provider setup |
| Local servers (Ollama, LM Studio) | OpenAI-compatible | Custom endpoint URL (e.g. `http://localhost:11434/v1`); no cloud key required |
| Custom endpoints | OpenAI, Anthropic, or Gemini compatible | Custom base URL, optional API key, and custom request headers |

Configure connections and credentials in **Settings > Provider setup**. In **Settings > Models & Agent**, choose the specific connection and model ID for Quick answers, Summaries, and the Agent. The embedding model for meeting search is configured separately under **Settings > Knowledge > Index**.

### Speech-to-Text Providers

The following speech recognition services are supported:
- **Google Cloud Speech** (default; requires service account JSON file path)
- **Deepgram** (WebSocket streaming)
- **Soniox** (streaming)
- **OpenAI Whisper** (WebSocket with REST fallback)
- **Groq Whisper** (REST)
- **ElevenLabs** (streaming)
- **Azure Speech**
- **IBM Watson**

Configure credentials in **Settings > Provider setup**. Speech services and per-speaker recognition languages are selected in **Settings > Audio & Translation**. Pika does not substitute another speech provider if a chosen service is unconfigured.

## Architecture

Pika runs as a three-process desktop application:

1. **Main process** (`electron/`): Window management, IPC orchestration, credential encryption, provider routing, meeting persistence, and local RAG indexing.
2. **Renderer process** (`src/`): React 18, TypeScript, Tailwind CSS, and React Query for the overlay, chat, and settings interfaces.
3. **Native module** (`native-module/`): Rust audio module using NAPI-RS for dual-channel audio capture (CoreAudio and ScreenCaptureKit on macOS; WASAPI on Windows), silence suppression, and SpeexDSP acoustic echo cancellation.

```
            ┌─────────────────────────────────────┐
            │ Electron Main (Node + native deps)  │
            │  IPC · storage · provider routing   │
            └────────────┬────────────────────────┘
              IPC bridge │
            ┌────────────┴───────────┐    ┌──────────────────┐
            │ Renderer (React/Vite)  │    │ Rust (NAPI-RS)   │
            │ Overlay · Settings · UI│    │ Audio capture    │
            └────────────────────────┘    └──────────────────┘
```

Local application data is stored in `~/Library/Application Support/Pika` (macOS) or `%APPDATA%\Pika` (Windows). Credentials and custom headers are stored in `~/.config/pika/credentials.enc` (macOS/Linux) or `%APPDATA%\pika\credentials.enc` (Windows). No analytics or telemetry data is collected.

## System Requirements

- **macOS**: macOS 13 or newer (Apple Silicon verified; Intel build targets supported).
- **Windows**: Windows 10/11 (audio capture and window protection code is present in the repository; binary releases are currently tracking issue #15).
- **Node.js**: Node.js 22.19 or newer and pnpm (when building from source).
- **Rust**: Required only when compiling the native audio module from source.

## Roadmap

- [ ] Standalone Windows release package (issue #15)
- [ ] Linux build and Wayland audio capture
- [ ] Chunked meeting summarizer with citations
- [ ] Entity masking in the live translation request pipeline
- [ ] Multilingual expansion for the bundled embedding model

Track issues and progress in [GitHub Issues](https://github.com/royisme/pikabaka/issues).

## FAQ

**Is Pika free?**
Yes — AGPL-3.0. Free for personal use, study, and open-source projects. Commercial or proprietary integrations should review the AGPL terms or inquire about a commercial license.

**Does my audio leave my machine?**
Audio and text requests are sent only to the speech-to-text and language model providers you explicitly configure. When using a local model server (such as Ollama for LLM inference) or local embedding models, model prompts and vector search stay on your machine. Speech recognition uses the STT service you configure.

**Where are my API keys stored?**
In a local `credentials.enc` file encrypted by Electron's `safeStorage`, using operating system secure storage (macOS Keychain, Windows DPAPI). If secure storage is unavailable, Pika stores `credentials.json` in plaintext and displays a notice in Settings > Provider setup. Custom header values are protected alongside API keys.

**Why "Hide from screen share"?**
It asks the operating system window manager to exclude Pika's overlay windows from screen sharing during meetings. It relies on standard OS window protection flags and is not a total guarantee: macOS screen recorders that use ScreenCaptureKit can still capture protected windows, and Linux is not supported.

**Can I use Pika in a call that has rules about outside assistance?**
Check the rules first and follow them. Exams, assessments and some interviews forbid outside help; Pika does not change that.

**Does it work on Linux?**
Not yet. Track progress on the [roadmap](#roadmap).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). For security disclosures, see [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE) — see the LICENSE file for details.
