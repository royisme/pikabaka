# Design note: translating before the turn flushes (R5, issue #33)

Status: the owner chose option B on 2026-10-26 and it is built (`electron/transcript/speculativeTranslation.ts`, wired in `transcript-assembler.ts`); the expected gain is smaller than this note first suggested, see "What B saves" at the end. Evidence is from a read-only audit of the STT providers and the assembler (2026-10-26); items marked "unconfirmed" were not shown by the code.

## The question

Today a translation starts only after the assembler flushes a turn (700 to 5000 ms after the last words, by profile), then runs as one streamed request. OmniVoice avoids that wait by translating the stable prefix of a still-growing hypothesis. Does Pika need that, and can it coexist with second-pass correction (#17, a flushed turn can be reopened and merged, its `revision` bumped)?

## What the audit found

- The assembler never sees interim text. `audio-pipeline.ts` sends interim results only to the UI as the live partial; finals go to `bufferFinalTranscriptChunk`.
- Provider shapes:

| Provider | Interim | Stability information | Boundary signal |
| --- | --- | --- | --- |
| Deepgram | full replacement of the current hypothesis | `is_final` per chunk; word data not read | `speech_final`, `UtteranceEnd` |
| Google | full replacement | `stability` per result exists but is not read | none |
| Soniox | only the unfinalised tail, per message | `is_final` per token, already used | `<end>` |
| ElevenLabs | `partial_transcript`; cumulative or not is unconfirmed | none used | none |
| OpenAI (WebSocket) | a delta fragment only (append-only; the app does not accumulate it) | none | `done` |
| Groq, Azure, IBM, OpenAI REST | none (finals only) | none | none |

- A stable-prefix tracker (two consecutive hypotheses agree on a prefix) fits Deepgram and Google directly. Soniox already hands over a committed prefix. OpenAI deltas would have to be accumulated first. The REST providers have nothing to track.
- Where a translation already shown can become wrong (audit, with `transcript-assembler.ts` lines at the time): a reopened turn (revision bump) and the merge that grows its text. One gap was found and fixed in this branch stack: the reopen did not supersede the old revision until the next flush. Two remain: manual retranslate sends no revision, and the context cache `recentTranslatedTurns` is overwritten for a reopened segment.

## The three questions on #33

1. **How does early translation work with #17?** Translation is keyed by `segmentId + revision`, and since the guard fix a reopen supersedes the old revision at once, so an early translation of revision N is dropped when the turn is reopened to N+1. The renderer already keeps the old translation as "updating" until the new one arrives (T4). Nothing more is needed for correctness if early translations are whole-turn requests that can be discarded. A prefix-by-prefix commit (OmniVoice's model) would need an append-only rule that #17 breaks: a merge can change text inside an already translated prefix. Do not combine them.
2. **Which providers send what?** The table above.
3. **Does early translation change what the user sees?** Unknown until measured. R1 now logs the flush gap and the request times; no real call has been logged yet.

## Options

- **A. Stable-prefix tracker** (OmniVoice). New plumbing: interim text into the assembler, a tracker per provider shape, partial translations that must be reconciled with the final one. Helps Deepgram and Google only. High cost, and it conflicts with #17 as in question 1.
- **B. Translate at the provider's own boundary, speculatively.** When a provider says the utterance ended (Deepgram `speech_final`, Soniox `<end>`, OpenAI `done`), start the whole-turn translation at once instead of waiting for the flush delay. If the turn is then merged or reopened, the revision guard drops it and the later revision is translated as today. Reuses the streaming request, the revision keys and the "updating" state; no new text model. Helps the three providers that send a boundary, which are the streaming ones the app recommends. Costs extra requests when a turn is reopened (the audit gives a 4 to 9.5 s reopen window).
- **C. Nothing more.** Streaming already shows the first words as soon as the model produces them; the flush delay (0.7 to 5 s) stays.

## Recommendation

Do C now and let R1 collect numbers over a few real calls. If the log shows the flush gap is a large share of the wait (say more than a second, most of the time), do B. Do not do A: it costs the most, helps two providers, and fights second-pass correction.

## Decisions for the owner

1. Agree with "C now, B if the logs justify it, not A"? (Recommended: yes.)
2. If B is built, may it send extra requests for turns that are later reopened? Cost: one short request each. (Recommended: yes, capped to one speculative request per turn.)
3. Should the two remaining gaps be fixed with B (manual retranslate sends the revision; the context cache keeps one entry per segment and revision)? (Recommended: yes, small.)

## What B saves (added after building it)

Reading `handleSpeakerSpeechEnded` closely, a provider boundary already shortens the flush: `speechEndedSentenceFlushMs` (120 to 400 ms by profile) when the turn ends a sentence of enough words, otherwise `speechEndedFragmentFlushMs` (500 to 1100 ms). So for the providers that send a boundary (Deepgram, Soniox, OpenAI) B can save at most that remaining wait, and only when no more words arrive; for providers with no boundary (Google, ElevenLabs, the REST ones) it saves nothing, because nothing signals the end early. The 700 to 5000 ms delays in section "The question" apply to those providers, not to the ones B helps. The `[Translation] timing` log now prints `speculative=true` and a flush gap measured from the speculative start, so a few real calls will show whether it is worth keeping.

The decisions: (1) B built, not A. (2) Extra requests for turns that are later changed: allowed, capped at one speculative request per turn (segment and revision), turns of fewer than three words are skipped. (3) The manual-retranslate gap is fixed (it now sends the turn's revision). The context cache is not changed: overwriting the entry of a reopened segment is what later translations should see, so it is not a bug.
