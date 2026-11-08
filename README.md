<div align="center">

# Pika

**A meeting assistant you set up for the situation you are in.**
Tell Pika what the meeting is. It listens, translates, and steps in with a short card only when you need one.

[![Latest Release](https://img.shields.io/github/v/release/royisme/pikabaka?display_name=tag&color=4f46e5)](https://github.com/royisme/pikabaka/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

[Download](https://github.com/royisme/pikabaka/releases/latest) · [What it does](#what-it-does) · [Install](#install) · [Set up](#set-up) · [FAQ](#faq)

</div>

---

Pika is an open-source desktop overlay: a small, translucent, always-on-top window you glance at for one to three seconds in the middle of a call. It shows a live transcript with translation, answers questions about the meeting through an agent, and watches the other party's speech so that it can put up a quiet suggestion card without being asked.

It is for classes and lectures, work meetings and everyday calls, in your language or another one. You bring your own models and keys. Meeting records, notes and credentials stay on your machine, and the app has no telemetry.

## What it does

### A scenario you write once
Describe the situation in a few lines (up to 600 characters) and pick the language for answers: a lecture in French, a weekly team call, a call with a landlord. Cards, answers and the decision on when to step in all follow that brief. You can change it at any time in Settings.

### It steps in on its own, and stays quiet otherwise
After each segment the other party finishes, a small, fast decision model judges whether you need help right now. If so, one card appears: a question put to you, a term explained, a claim worth checking, or an action item. You set the model, the threshold and the cooldown. A card never covers the chat or moves the page, and it stays until you dismiss it or a newer one replaces it. Two small actions take the card to the agent: **Ask more**, and **Not right**, which carries the card and the line that triggered it into the chat box for you to correct.

### Live transcript and translation
- Captures system audio (the other party) and the microphone separately with a native Rust module, with acoustic echo cancellation.
- Shows what the other party said with its translation under it. Your own speech is shown as a quiet source line.
- Optional **Fix misheard words**: a model of your choice repairs clearly misheard words using the scenario and the earlier lines. Corrected lines carry a small mark; hover to see the original. Off by default.
- Hover any other-party line to put it into the chat box, then edit and send.

### An agent that knows the meeting
Ask during the call. The agent can read the recent transcript, search it, search your past meetings (local vector search with `sqlite-vec`) and your saved notes, and look at a screenshot. If you set a workspace folder, it can also run commands and edit files there; every command waits for your approval in the overlay. The role and task prompts are editable in Settings.

### Records you can search
Transcripts are written to a local SQLite database as the meeting goes on, so you can search and summarise them later.

### Privacy
- API keys and custom headers are encrypted with the operating system's secure storage (macOS Keychain, Windows DPAPI).
- Network traffic goes only to the speech and model endpoints you configure.
- "Hide from screen share" asks the operating system to keep the overlay out of screen sharing. It is not a guarantee; the FAQ lists its limits.

## Install

### Download a release (recommended)

Download the latest signed and notarized build from [GitHub Releases](https://github.com/royisme/pikabaka/releases/latest). Releases are for macOS (13 or newer).

### Build from source

```bash
git clone https://github.com/royisme/pikabaka.git
cd pikabaka
pnpm install            # installs dependencies and downloads local model assets
pnpm run build:native   # compiles the Rust audio capture module
pnpm run app:dev        # starts Vite dev server and Electron in development mode
pnpm run dist           # packages a production build
```

Prerequisites: Node.js 22.19+, pnpm, a Rust toolchain (for the native audio module) and Git. Windows capture and window-protection code is in the repository; there is no Windows release yet (issue #15).

## Set up

Pika needs one speech-to-text service and one language model.

1. **Settings > Provider setup**: add the keys. Language models are connections of three interface types: OpenAI-, Anthropic- or Gemini-compatible, each with its own base URL and headers. A local server such as Ollama or LM Studio is an OpenAI-compatible connection with no cloud key.
2. **Settings > Models & Agent**: choose the model for quick answers, summaries and the agent, and set up **Proactive help** (mode, decision model, threshold, cooldown). The embedding model for search is under **Settings > Knowledge**.
3. **Settings > Audio & Translation**: choose the speech service, the spoken and target languages, and the optional misheard-word fix.
4. Write your **Scenario** in Settings.

Speech services: Google Cloud Speech (default), Deepgram, Soniox, OpenAI Whisper, Groq Whisper, ElevenLabs, Gemini Live, Azure Speech and IBM Watson. Pika does not substitute another service if the one you chose is not configured.

## How it works

```
            ┌─────────────────────────────────────┐
            │ Electron Main (Node + native deps)  │
            │  IPC · storage · providers · agent  │
            └────────────┬────────────────────────┘
              IPC bridge │
            ┌────────────┴───────────┐    ┌──────────────────┐
            │ Renderer (React/Vite)  │    │ Rust (NAPI-RS)   │
            │ Overlay · Settings · UI│    │ Audio capture    │
            └────────────────────────┘    └──────────────────┘
```

Application data is in `~/Library/Application Support/Pika` (macOS) or `%APPDATA%\Pika` (Windows). Credentials are kept separately in `credentials.enc` under `~/.config/pika` (macOS/Linux) or `%APPDATA%\pika` (Windows). Details: [`docs/architecture.md`](docs/architecture.md).

## Roadmap

- [ ] Windows release package (issue #15)
- [ ] Linux build and Wayland audio capture
- [ ] Phone calls as an audio source
- [ ] A live agent that can take part in a conversation (idea, not started)
- [ ] Chunked meeting summarizer with citations

Progress is tracked in [GitHub Issues](https://github.com/royisme/pikabaka/issues).

## FAQ

**Is Pika free?**
Yes. It is AGPL-3.0: free for personal use, study and open-source projects. Commercial or proprietary use should review the AGPL terms or ask about a commercial license.

**Does my audio leave my machine?**
Audio and text go only to the speech and language services you configure. Speech recognition always uses a service you configure, so it is not available offline; a local model server and the bundled embedding model keep prompts and search on your machine.

**Where are my API keys stored?**
In a local `credentials.enc` file encrypted by Electron's `safeStorage`. If secure storage is unavailable, Pika writes `credentials.json` in plain text and shows a notice in Settings > Provider setup.

**Why "Hide from screen share"?**
It asks the operating system window manager to exclude Pika's overlay windows from screen sharing during meetings. It relies on standard OS window protection flags and is not a total guarantee: macOS screen recorders that use ScreenCaptureKit can still capture protected windows, and Linux is not supported.

**Can I use Pika in a call that has rules about outside assistance?**
Check the rules first and follow them. Exams, assessments and some interviews forbid outside help; Pika does not change that.

**Does it work on Linux?**
Not yet; see the [roadmap](#roadmap).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). For security reports, see [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE)
