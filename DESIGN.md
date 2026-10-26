# DESIGN

The visual rules of the overlay, the surface this app is judged on. The acceptance checks Q1 to Q14 and their reasons are in `docs/design-overlay-v2.md`; the rules for contributors are in `docs/conventions.md` ("Overlay UI"). Token values live in `src/index.css`; this file names them and says what they are for. It does not copy numbers that can drift, except the floors that were chosen on purpose.

## What the surface is

A small, always-on-top panel read for one to three seconds in the middle of a call. The newest line the other party said, in the reader's language, is the first thing to read; an answer, when there is one, comes next; everything else stays quiet. It is a tool, not a showcase: no decoration, no motion for its own sake, nothing that moves under the reader's eyes.

## Structure

One panel that is the window (no transparent margin around it), from top to bottom: a 36px top bar, the transcript area, a 1px splitter, the answer area, and the composer (two rows: actions at 28px, input at 36px, about 86px with padding). Chrome (everything except the transcript and the answers) stays under 140px at a 420px window, and each of the two content areas keeps at least 112px (`src/lib/splitClamp.ts` holds the pixel floors; the window's minimum height is 360px).

## Surfaces and tokens (use these, never raw palette classes or new hex values)

| Role | Token or class |
| --- | --- |
| Panel | `overlay-shell-surface`; its alpha comes from `getOverlayAppearance` |
| Chips and controls | `overlay-chip-*`, `overlay-control-*`, `overlay-icon-*`, `overlay-input-*` |
| Text | `overlay-text-primary`, `overlay-text-secondary`, `overlay-text-muted` (placeholder equals muted); `overlay-text-strong` for emphasis |
| Dividers | `overlay-hairline` (it sets `--overlay-border-soft`); `border-border-subtle/NN` generates no CSS and must not be used |
| The one filled control | `--overlay-action` (`#0071E3`, white text on it): the primary action, Send, Fix audio. At most one is filled on screen |
| State | `state-success`, `state-warning`, `state-danger` for a dot, icon or border; the words stay in `overlay-text-primary` |

**Legibility floor.** The user's opacity slider (stored 0.35 to 1) maps onto a shell alpha of 0.95 to 0.985 in the dark theme and 0.94 to 0.985 in the light theme. Nothing below the floor is possible, because text behind the panel must stay behind it. `backdrop-filter` is not used: a transparent window cannot blur what is behind it.

## Type

Four sizes, one family (the sans of `src/index.css`; mono only for code).

| Size | Use |
| --- | --- |
| 11px | status chip, speaker label, meta, key badges, small labels |
| 12px | source lines, chips and button labels, help and empty-state text |
| 14px | translations, answers, the input, a title in an empty state |
| 16px | the lead sentence of a "what to say" answer (`splitLead`; other answer layouts keep 14px) |

Nothing the reader must read is under 11px. Do not add another `text-[Npx]`.

## States

The audio status is shown once (`src/lib/audioStatus.ts`): the top-bar chip carries the words when the transcript has rows; when it is empty, the transcript area carries them with one action and the chip shows only its dot. Empty areas are one line of 12px muted text, top-left, with no box or icon; warn and blocking states add a ▲ or ✕ because meaning is never carried by colour alone. When there is nothing for the user to do, no control is filled.

## Controls

- 28px high in the bar and the composer; icon-only buttons are 28px square, with an accessible name.
- From 480px up Translate and Original are buttons in the bar and secondary actions show their words; below 480px they move into the menu or become icon-only, so nothing is ever cut off.
- Hide and Stop sit at the right of the bar; Stop needs a second press within three seconds.
- Interactive elements inside a `draggable-area` carry `no-drag`.

## Motion and accessibility

No spinners and no bounce; a state that is working says so in words on the control it belongs to. `prefers-reduced-motion` is honoured (the CSS rule covers CSS animation; framer-motion needs its own handling). Focus is visible everywhere (global `:focus-visible`).
