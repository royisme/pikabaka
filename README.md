# Pika

AI-powered interview copilot & meeting assistant. Real-time transcription, AI answer suggestions, and screenshot analysis — running locally on your machine.

## Features

- **Real-time transcription** — sub-500ms latency via Rust native audio capture
- **AI answer suggestions** — context-aware responses powered by your choice of LLM
- **Screenshot analysis** — capture and analyze slides, code problems, or any on-screen content
- **Dual-channel audio** — separate system audio (meeting) and microphone (your voice)
- **Local RAG memory** — search across past meetings with on-device vector search (SQLite + sqlite-vec)
- **Stealth mode** — hide from dock, disguise process name during screen sharing
- **Any LLM, any STT** — bring your own keys for OpenAI, Claude, Gemini, Groq, or run fully offline with Ollama

## Quick Start

### Prerequisites

- Node.js v20+
- Rust (for native audio module)
- Git

### Setup

```bash
git clone <your-repo-url>
cd pika
npm install
npm run build:native    # build Rust audio module
npm run app:dev         # start dev server + Electron
```

### Production Build

```bash
npm run dist
```

## Installation Notes

**macOS: Unsigned app warning** — If macOS reports the app as unsigned or unverified after installation, you can remove the quarantine attribute with:

```bash
xattr -cr "/Applications/Pika.app"
```

## AI Providers

| Provider | Notes |
| :--- | :--- |
| Google Gemini | Large context window, low cost |
| OpenAI | GPT-4o, o3 series |
| Anthropic Claude | Strong at coding tasks |
| Groq | Near-instant inference + vision |
| Ollama | 100% offline, no API keys needed |
| Custom endpoint | Any OpenAI-compatible API |

You only need **one** LLM provider and **one** STT provider to get started.

### STT Providers

Google Cloud Speech, Deepgram, Soniox, OpenAI Whisper, Groq, ElevenLabs, Azure Speech, IBM Watson.

## Architecture

Three-process Electron app:

1. **Main process** (`electron/`) — window management, IPC, backend services
2. **Renderer** (`src/`) — React + TypeScript + Tailwind CSS
3. **Native module** (`native-module/`) — Rust (NAPI-RS) for low-latency audio capture

All data stored locally. API keys managed via the built-in credentials manager.

## System Requirements

- macOS 12+ (Apple Silicon & Intel) or Windows 10/11
- 4GB RAM minimum, 8GB+ recommended
- 16GB+ for local AI (Ollama)

## License

AGPL-3.0
