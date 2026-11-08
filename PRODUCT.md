# Product Brief: Pika

## 1. Product
Pika is an open-source meeting assistant that the user sets up for the situation they are in. A desktop overlay shows a live transcript with translation of the other party, answers questions about the meeting through an agent, and puts up a short suggestion card when a small decision model judges that the user needs help. It runs on the user's machine with the user's own models and API keys. The application combines an Electron desktop shell, a React user interface, and a native Rust audio capture module.

## 2. Who uses it and when
**Classes and lectures**: A student who follows a spoken class, possibly in another language, and wants terms explained and questions answered as they come up, for example a university computer science course.

**Cross-border work conversations**: A person in a call in a second language, for example a product design consultation with a client abroad, who needs to follow what is said and be reminded of questions put to them and action items.

**Everyday meetings and calls**: Other meetings where a configured assistant helps the user keep up.

**Accessibility**: A hearing-impaired person who needs live captions across meetings.

## 3. How it is used
The user writes a **scenario** once: a short brief (up to 600 characters) and an answer language. Cards, answers and the decision on when to step in follow it. The overlay is read in one to three seconds mid-call [DESIGN.md, docs/conventions.md]. It is a small, translucent, always-on-top window over the call software [DESIGN.md, RULES.md]. Global keyboard shortcuts operate the primary actions without stealing focus from the call [docs/conventions.md]. Hide from screen share asks the operating system to keep the window out of screen sharing [RULES.md].

After each segment from the other party, the proactive gate asks a decision model whether help is wanted now; a card (question for the user, term, claim worth checking, action item) is shown only above the configured threshold and outside the cooldown [docs/architecture.md]. The user can take a card, or any transcript line, to the agent through the chat input (Ask more, Not right, the line button), and can have a model fix misheard words in the transcript (off by default).

**Interpreting** (optional, off by default): when the user's own language is not the other party's, the user presses Talk, speaks, and presses Talk again; Pika translates what was said, voices it with Fish Audio or ElevenLabs (a voice the user picks by its ID, or the user's own cloned voice) and plays it into a virtual microphone that the user, not Pika, has installed (BlackHole on macOS; VB-CABLE on Windows, where no release exists yet) and selected as the microphone in the meeting app. Only translations go to the virtual microphone, never the user's own voice. The transcript row keeps the user's source text, with the spoken translation under it; the translation is not saved in the meeting record. The user is asked to tell the other party they hear machine translation. Pika never changes the system default input [docs/architecture.md, README.md].

## 4. Principles
- **Glance-first**: Mid-call reading lasts one to three seconds, requiring minimal chrome and quiet secondary controls [DESIGN.md, docs/conventions.md].
- **Quiet by default**: Pika steps in only when the decision model says so; a card never covers the chat, moves the page or makes a sound.
- **Set up for the situation**: The scenario is the one place the user tells Pika what the meeting is; everything that talks to a model follows it.
- **Answer or newest translation leads**: When an answer is streaming or pinned it is the most prominent element; otherwise the newest translated line [docs/conventions.md, DESIGN.md].
- **Nothing moves under the reader's eyes**: Layout positions stay stable and controls never shift active content [DESIGN.md, docs/conventions.md].
- **Privacy and bring-your-own-key**: Credentials stay in the OS secure storage, audio and text go only to the providers the user configures, and the application has no telemetry [RULES.md, docs/architecture.md].
- **Never invent data**: The application never outputs fake statistics, scores or fallback AI answers; a failure shows the real error [RULES.md, docs/conventions.md].

## 5. Claims this project must not make
- **Windows support**: no Windows build has been released and window behaviour is verified only on macOS (issue #15).
- **Latency or speed numbers** (transcription, translation, provider speed): no measurements exist in the repository.
- **Working offline**: no local speech-to-text engine is among the providers. A local language model (for example Ollama) keeps prompts local, but a call cannot be transcribed offline.
- **Comparisons with other products**: the repository holds no evidence about competitors.
- **Hardware requirement numbers**: no profiling exists.
- **The decision model, the misheard-word fix or the agent being correct**: they are models. The repository tests the plumbing with mocked providers, not the quality of real model output.

Evidenced in the repository: AGPL-3.0 licence [LICENSE]; bring-your-own-key through `CredentialsManager` and client-side provider routing [docs/architecture.md]; dual-channel capture by the Rust module [docs/architecture.md]; local search with sqlite-vec [docs/architecture.md]; Hide from screen share through `setContentProtection` in the window helpers, with real-device behaviour the owner's check; custom global shortcuts through `KeybindManager`; the scenario, proactive gate and misheard-word fix [docs/architecture.md].

## 6. Not in scope / not yet built
- **Windows distribution package** (issue #15) and **Linux support with Wayland capture**.
- **Phone calls as an audio source**: an idea, not started.
- **A live agent that takes part in a conversation**: an idea, not started.
- **One answer component for every window**: the live overlay's answers have the Re line, the 16px lead and per-block Copy; the chat overlays and the post-meeting view still render answers themselves.
- **Entity masking in live translation**: the module exists and is tested but is not in the request path.
- **Native OS vibrancy blur**: deferred pending a content-protection review.
- **Real-provider verification**: recent features (streaming translation, the proactive gate, the scenario, the misheard-word fix) have not been exercised against real providers by automated checks; the owner verifies them in real meetings.
- **The interview feature, the resume and the profile**: removed in 3.0.

## 7. Questions for the owner
1. Name and one-line tagline for the new positioning.
2. Whether the Roadmap in the README keeps the phone-call and live-agent ideas.
