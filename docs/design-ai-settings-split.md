# AI settings split

Status: proposed on 2026-10-27, waiting for the owner to approve a page design from a preview. Nothing is built. Evidence is a source-only investigation (GPT, commit `a69d308`); the findings below were rechecked by content where they decide something.

## The problem

Settings > "Models & Agent" (id `ai-providers`) holds connections, three job rows, the search index and proactive help: provider setup, model choice, behaviour and diagnostics on one page. Speech keys and translation sit in the audio tab, answer language and style in General. A user who wants live translation with a cloud model crosses two pages and about 14 controls; proactive help plus live speech crosses two pages and about 17.

## What the product really has

About 30 call sites reduce to seven model settings. The user should see these, not thirty features:

| Model setting | Jobs it serves |
| --- | --- |
| Quick answers | What to say, Clarify, Follow-up, rephrase, Recap, code hint, Brainstorm, screenshot analysis, answers from past meetings (RAG), resume and role analysis, interview prep, live-context compaction |
| Summaries | Meeting notes and the meeting title (live Recap is not here) |
| Agent | The typed agent with tools, and the proactive cards it drafts |
| Proactive decision | Its own System One service (URL, key, model); not a connection |
| Translation | Per-sentence and paragraph translation |
| Search index | Embeddings for meetings, summaries and materials |
| Speech | Seven services with their own keys |

Transcript second-pass correction needs no model (it merges reopened turns); the intent classifier is a bundled local model; neither needs a picker.

## Proposed structure (option A, "federated")

Tab ids stay, labels change: General, Audio & Translation, **AI functions** (`ai-providers`), **Provider setup** (new id), Shortcuts, Your Background, About.

- **Provider setup**: the services Pika connects to. The model is the one in quotio's provider list (`../../ops/quotio`, `Views/Components/CustomProviderSheet.swift` and its Custom Providers list): one row per provider the user has added, never a fixed list of companies (owner feedback, 2026-10-27; `electron/services/aiConnections.ts` already says Pika is not tied to any provider and that a connection is a type, a host and a key). Every provider speaks one of three interfaces, so the user picks the **interface**, not a company.
  - Language model providers: one row per configured provider: the name the user typed, the interface ("OpenAI compatible", "Anthropic compatible", "Gemini compatible"), the host, a state in words and a mark (Key saved, No key, Test failed), and a delete button (two presses: the row asks "Delete <name>?" first). Clicking the row opens the editor. Add provider opens the same editor: Interface (three choices, which fills the default Base URL), Name, Base URL, API key, **Custom headers (optional)** with Add header and an empty state, Test, Save, Cancel. OpenAI, Groq, OpenRouter, DeepSeek, a gateway of your own, Ollama and LM Studio are all "OpenAI compatible" and need no row of their own and no preset chip. There is no sample or default name in the product: the list starts with what the user has configured.
  - Speech-to-text providers: the same list pattern (Add provider starts with the service, the fields change with it: a key; a key and a region; a service-account file). Audio & Translation then offers only the ones listed here, so a call never falls back to another service silently.
  - Decision service (proactive help): base URL, key, Remove key, Save. A separate kind of service, not a language model provider.
  - The four built-in records (`gemini`, `openai`, `claude`, `groq`) stay in storage because jobs may already name them. The list shows only the built-ins that have a key or a host override, plus every custom one. Add always creates a custom provider.
  - **Custom headers are new.** They need one new optional field on a custom connection record (a persisted-shape change the owner asked for) and support at every place a connection is used: the three SDK clients in `LLMHelper` (`defaultHeaders` for OpenAI and Anthropic, `httpOptions.headers` for GenAI), the model-list request in `connectionModels.ts`, and the Agent's pi-ai model in `electron/agent/models.ts` (not yet checked). Built-in records get no headers; a user who needs them adds a custom provider. Header values are secrets: stored with the key, never logged, never sent back to the renderer (only the header names and a "set" mark).
  No thresholds, languages, prompts, folders or model choices here.
- **AI functions**: one row per model setting that is not about audio: Quick answers (connection, model, Fetch, Save, collapsed Test, a line naming every job it serves, answer language, collapsed answer style), Summaries, Agent (image checkbox, workspace folder), Proactive help (mode, decision model, a read-only line saying cards use the Agent model, collapsed threshold, cooldown and decision log), Search index (Automatic or own, status always visible, collapsed rebuild).
- **Audio & Translation**: devices, speech (service and model, languages), translation (enabled, target, connection and model, Test; source, display, prompt and segmentation under Advanced). Keys and accounts are links to Provider setup.
- **Your Background** is being rethought, not kept as it is: Pika also has to search everyday meetings and the user's materials, not only a resume. See `docs/design-knowledge.md`. The Search index setting moves there, so AI functions has four rows (Quick answers, Summaries, Agent, Proactive help).

Rejected, option B: one "AI functions" page with all seven rows, including speech and translation. It rebuilds the overloaded page and separates devices from recognition.

## What is a pure move and what is not

No persisted key, credential key or IPC channel changes in option A. Moving components, headings and links is safe. These change behaviour and are not part of the split (separate tasks, owner decisions noted in `TASKS.md`): automatic model alternatives for embeddings and speech, the Groq model reset when the language changes, the proactive decision Test deadline (5 s test, 2 s live), the Agent Test using saved settings when the draft is incomplete, deleting an Agent connection making it inherit Quick answers, template answers for interview prep and a made-up company rating (against "never invent data"), the missing Watson region input, and the Tavily key without an input.

## Steps (each one a branch and one PR, in order)

1. Provider setup page with the existing Connections component moved in, both pages link to each other (pure move).
2. Answer language and style move beside Quick answers (pure move).
3. Proactive help: URL, key, Remove and Save move to Provider setup; mode, model, threshold, cooldown and the log stay under AI functions.
4. Speech: key, file and region controls move to Provider setup; the service, model and languages stay in Audio & Translation.
5. Translation extracted as its own component; the AI functions page gets the "also used by" lines, collapsed diagnostics and deep links.

Design rules for every step: base-family tokens only (`DESIGN.md`), no spinners, state as words plus a dot or glyph, at most one filled control, 11/12/14 px, results and errors show the real text, both themes.

## Owner decision recorded

On 2026-10-27 the owner chose to see a page preview before picking A or B, wants API keys stored with system encryption (a separate task with its own design, because it changes the stored credential format and needs a migration decision), and wants the behaviour problems above fixed in a separate task after the split.
