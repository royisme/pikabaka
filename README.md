<div align="center">

# Pika

**The open-source AI interview copilot & meeting assistant.**
Real-time transcription, AI-suggested answers, and screenshot reasoning — running on your machine.

[![Latest Release](https://img.shields.io/github/v/release/royisme/pikabaka?display_name=tag&color=4f46e5)](https://github.com/royisme/pikabaka/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)](#system-requirements)
[![GitHub Stars](https://img.shields.io/github/stars/royisme/pikabaka?style=social)](https://github.com/royisme/pikabaka/stargazers)

[Download](https://github.com/royisme/pikabaka/releases/latest) · [Demo](#demo) · [Features](#features) · [Why Pika](#why-pika) · [FAQ](#faq)

</div>

---

Pika listens to your meetings, transcribes both sides of the conversation in under 500 ms, and quietly suggests answers powered by the LLM you choose — OpenAI, Claude, Gemini, Groq, or fully offline with Ollama. Bring your own API key, keep your audio on your machine, and customize every shortcut.

If you've been looking for an **open-source alternative to Cluely, Granola, or Otter** that respects your privacy and your wallet, Pika is built for you.

## Demo

![Pika preview](demo/out/pika-preview.gif)

Full demo video: [`demo/out/pika-demo.mp4`](demo/out/pika-demo.mp4) · Built with [Remotion](https://www.remotion.dev/).

## Why Pika

|                                       | **Pika** | Cluely | Granola | Otter |
| ------------------------------------- | :------: | :----: | :-----: | :---: |
| Open source                           |    ✓ AGPL-3.0    |   —    |    —    |   —   |
| Bring your own API key                |    ✓     |   —    |    —    |   —   |
| 100% offline option (Ollama)          |    ✓     |   —    |    —    |   —   |
| Real-time AI answer suggestions       |    ✓     |   ✓    |    —    |   —   |
| Stealth overlay (hidden in screen-share) |  ✓     |   ✓    |    —    |   —   |
| Local RAG memory across past meetings |    ✓     |   —    |    —    |   —   |
| Custom global keyboard shortcuts      |    ✓     |   ✓    | partial |   —   |
| Audio never leaves your device        |    ✓\*   |   —    |    —    |   —   |

\* When using Ollama for LLM and a local STT engine. With cloud providers, audio is sent only to the provider you configured.

## Built for

- **Interview practice & prep** — rehearse with realistic AI-suggested answers, not generic flashcards.
- **Sales & customer success calls** — surface objection handlers, pricing, and product facts in real time.
- **Customer support** — instant context from your past tickets via on-device vector search.
- **Lectures & research** — live transcribe, summarize, and ask follow-up questions on what you just heard.
- **Accessibility** — live captions for hearing-impaired users with provider-agnostic STT.

## Features

- **Sub-500 ms transcription** powered by a Rust native audio module (cpal + WebRTC VAD + rubato resampling).
- **Dual-channel capture** — system audio (the meeting) and your microphone are streamed independently for clean attribution.
- **Any LLM, any STT** — switch providers at runtime: OpenAI, Anthropic Claude, Google Gemini, Groq, Ollama, or any OpenAI-compatible endpoint.
- **Local RAG memory** — past meetings indexed with `sqlite-vec`; search and recall without sending data anywhere.
- **Screenshot reasoning** — capture full screen or a region, pipe it to a vision model, get an answer in seconds.
- **Stealth overlay** — disguise the process name and hide the window from screen-sharing.
- **Configurable everything** — every shortcut, every provider, every key in your OS keychain.
- **Cross-platform** — macOS (Apple Silicon + Intel) and Windows 10/11.

## Install

### Download a release (recommended)

Grab the latest signed build from [GitHub Releases](https://github.com/royisme/pikabaka/releases/latest).

> **macOS unsigned warning**: If macOS reports the app as unverified, clear quarantine:
> ```bash
> xattr -cr "/Applications/Pika.app"
> ```

### Build from source

```bash
git clone https://github.com/royisme/pikabaka.git
cd pikabaka
pnpm install            # also rebuilds native modules for Electron ABI
pnpm run build:native   # compile Rust audio module
pnpm run app:dev        # Vite + Electron in dev mode
pnpm run dist           # production build via electron-builder
```

**Prerequisites**: Node.js 20+, pnpm, Rust toolchain (for the native audio module), Git.

## Configure AI Providers

You only need **one** LLM provider and **one** STT provider to get started. All keys are stored in your OS keychain.

### LLM Providers

| Provider     | Best for                       | Notes                                |
| ------------ | ------------------------------ | ------------------------------------ |
| Google Gemini | Cost + huge context window    | Recommended default for most users   |
| OpenAI       | General quality, GPT-4o, o3    | Strong at chained reasoning          |
| Anthropic Claude | Coding interviews          | Best Claude tier for technical depth |
| Groq         | Sub-second inference, vision   | Cheapest fast tier                   |
| Ollama       | Fully offline, no key required | Run Llama/Qwen/etc. on your machine  |
| Custom       | Any OpenAI-compatible endpoint | Self-hosted vLLM, LM Studio, etc.    |

### STT Providers

Google Cloud Speech (default), Deepgram Nova-3, Soniox, OpenAI Whisper, Groq Whisper, ElevenLabs Scribe, Azure Speech, IBM Watson. Auto-fallback to Google on failure.

## Architecture

Three-process Electron app:

1. **Main process** (`electron/`) — window orchestration, IPC, credential storage, provider routing.
2. **Renderer** (`src/`) — React 18 + TypeScript + Tailwind CSS + React Query.
3. **Native module** (`native-module/`) — Rust (NAPI-RS) for low-latency audio capture; CoreAudio/ScreenCaptureKit on macOS, WASAPI on Windows.

```
            ┌─────────────────────────────────────┐
            │ Electron Main (Node + native deps)  │
            │  IPC · keychain · provider routing  │
            └────────────┬────────────────────────┘
              IPC bridge │
            ┌────────────┴───────────┐    ┌──────────────────┐
            │ Renderer (React/Vite)  │    │ Rust (NAPI-RS)   │
            │ Overlay · Settings · UI│    │ Audio capture    │
            └────────────────────────┘    └──────────────────┘
```

Local data lives in `~/Library/Application Support/Pika` (macOS) or `%APPDATA%\Pika` (Windows). API keys live in the OS keychain. No telemetry runs by default.

## System Requirements

- macOS 13+ (Apple Silicon or Intel) **or** Windows 10/11.
- 4 GB RAM minimum, 8 GB recommended.
- 16 GB+ if running Ollama locally.

## Roadmap

- [ ] Linux build (Wayland audio capture)
- [ ] Plugin / extension API
- [ ] iOS companion for cross-device handoff
- [ ] More languages in the bundled embedding model
- [ ] Hosted cloud sync (opt-in, end-to-end encrypted)

Track progress in [GitHub Issues](https://github.com/royisme/pikabaka/issues).

## FAQ

**Is Pika free?**
Yes — AGPL-3.0. Free for personal use, study, and open-source projects. Commercial / proprietary integrations should review the AGPL terms or reach out about a commercial license.

**Does my audio leave my machine?**
Only if you choose a cloud STT/LLM provider. Pair Ollama with a local STT engine (or system-only transcription) for a fully offline pipeline.

**Where are my API keys stored?**
In your OS keychain — Keychain Access on macOS, Credential Manager on Windows. Never in plaintext config files.

**How is Pika different from Cluely?**
Open source under AGPL-3.0, no subscription, you bring your own API key, and you can run completely offline with Ollama. Every shortcut and provider is configurable.

**Why "stealth mode"?**
The overlay can be hidden from screen-sharing tools so private notes during a sales demo don't show on the customer's screen. It's a privacy feature, not a permission to break rules — please use Pika ethically and respect any policies that apply to your conversations.

**Can I use Pika during a coding interview?**
Use it for **prep and rehearsal** before the interview — that's the legitimate use case. Real interviews almost always have explicit rules about external assistance; respect them.

**Does it work on Linux?**
Not yet. Tracking on the [roadmap](#roadmap).

## Contributing

Pull requests welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). For security issues, see [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE) — see file for details.

---

<div align="center">

If Pika is useful to you, [give it a star](https://github.com/royisme/pikabaka) — it helps others discover the project.

**Keywords**: AI interview copilot, AI meeting assistant, real-time transcription, open source Cluely alternative, local AI assistant, Electron AI app, BYO API key meeting tool, privacy-first AI copilot, screenshot AI assistant, RAG meeting memory.

</div>
