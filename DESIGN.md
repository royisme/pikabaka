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
| The one filled control | `--overlay-action` (the brand action blue `#2563EB`, white text on it, 5.17:1): the primary action, Send, Allow, Fix audio. At most one is filled on screen |
| The two areas | `--overlay-zone-them` (the other party's words: cool and deep) and `--overlay-zone-pika` (Pika's conversation: cream `#fff8e7` in light, a lifted navy in dark), each under its own header, split by `--overlay-zone-line` |
| Menu and popover surface | `--overlay-menu-bg` (opaque; white on light). Never `bg-bg-elevated` inside the overlay |
| State | `state-success`, `state-warning`, `state-danger` for a dot, icon or border; the words stay in `overlay-text-primary` |

### Brand colours

The identity board gives four colours, and `src/index.css` holds them as `--brand-*` (plus `--brand-action` and `--brand-ink`). Components never use them directly; the semantic tokens refer to them, and each pairing below was checked for contrast.

| Brand colour | Role |
| --- | --- |
| Blue `#3b82f6` | Identity: icon, logo, focus ring, large graphics. It is 3.68:1 with white text, so it never carries small text or a white label. |
| Action blue `#2563eb` | The same hue one step deeper: the filled control and the light theme's `primary` (5.17:1 with white). |
| Sky `#7dd3fc` | Dark theme's `primary`, links and the "listening" and "translating" movement. |
| Cream `#fff8e7` | Pika's body: the ground where Pika speaks (light theme). |
| Slate `#94a3b8` | Dark theme's tertiary text. On white it is 2.56:1, so in the light theme it is for icons and lines only. |
| Spark `#f5b301` (`--accent-spark`) | The "done" star: a graphic, never text or a button. |

Success, warning and danger keep their own greens, ambers and reds; the brand has none of them. The mascot illustrations belong to the launcher, empty states and meeting details; the overlay is a tool surface and carries none.

### Two token families, one rule

The overlay uses `overlay-*`. The launcher, the settings pages, the meeting details and the chat views use the base family: `bg-bg-*`, `text-text-*`, `border-border-*`, `accent-*`, `primary`, `secondary`, and `on-primary` for text on a solid `primary` fill. Both families are defined for both themes in `src/index.css` (`:root` is dark, `[data-theme='light']` is light), and `test/theme-tokens.test.ts` fails when the dark block has a colour the light block lacks. Pick the family by the surface you are on and never mix them: an `overlay-*` text colour on a `bg-bg-*` surface, or the reverse, is how dark text lands on a dark panel.

| | Dark | Light |
| --- | --- | --- |
| Canvas, sidebar, card and menu | `#0b1120`, `#0f172a`, `#162033` (the hue of the logo's dark card) | `#f3f6fc`, `#fafbfe`, `#ffffff` (cards and menus are lifted by shadow, not by fill) |
| Accent (`primary`) and text on it | `#7dd3fc` (brand sky), `#0b1120` | `#2563eb` (brand action blue), `#ffffff` |
| Text, secondary, tertiary | near white, then slate 300, then brand slate `#94a3b8` (6.4:1 on the cards) | slate 900, slate 800, slate 600, all 4.5:1 or more on the canvas |
| `state-*` words (`text-state-*-strong`) | bright green, amber, red | deep green, amber, red (`#166534`, `#92400e`, `#991b1b`), 4.5:1 or more on white |

Fills that carry text get a pair: pale fill with dark text in dark, deep fill with white text in light, both through `primary` and `on-primary`. `text-white` on a `primary` fill is a bug (1.7:1 in dark).

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
