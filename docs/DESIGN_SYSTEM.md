# EconQuest design system

One set of rules for every page and desk. New UI uses the shared classes in `src/index.css`
(`ui-*`). Existing desks were moved onto the same tokens by a codemod (2026-11-04), so they
look the same even where they still use plain Tailwind classes.

## Type

| Use | Class | Size |
|---|---|---|
| Page title | `ui-title` | 20px, semibold |
| Section / panel title | `ui-section-title` | 14px, semibold |
| Body text | `ui-body` | 14px |
| Labels, captions, table meta | `ui-label` (or `text-xs`) | 12px |

- One UI font: **Public Sans**. Headings use Plus Jakarta Sans.
- Numbers use tabular figures (`tabular-nums` / `ui-num`), in the same font. No monospace for UI.
- Monospace (`font-code`) is only for code, formulas and IDs.
- Smallest text is 12px. No 8–11px text.
- Two weights: regular and **semibold** (`font-medium` is allowed for buttons and tabs). No bold.
- Sentence case. No `uppercase` and no letter-spacing tricks. Acronyms stay upper case (GDP, CDS, IMF).

## Colour

Neutral is **slate**. Every other colour has one meaning:

| Role | Tailwind hue | Used for |
|---|---|---|
| Accent | `blue` | Primary actions, links, selected tab, focus |
| Positive | `emerald` | Live data, gains, safe readings |
| Warning | `amber` | Elevated risk, sample data, caution |
| Negative | `rose` | Critical risk, losses, destructive actions |

Indigo, violet, purple, cyan, sky, teal, orange, yellow, red and green are not used. Charts use
the same hexes: `#3b82f6` / `#2563eb` accent, `#10b981` positive, `#f59e0b` / `#d97706` warning,
`#f43f5e` / `#e11d48` negative, `#64748b` / `#94a3b8` neutral.

## Shape

- Square corners on panels, buttons, inputs and badges. `rounded-full` only for status dots.
- 1px borders (`slate-200`, dark `slate-800`). No 2px borders except the selected-tab underline.
- No drop shadows on page content. Menus and dialogs may use `shadow-lg` / `shadow-2xl`.

## Components

| Thing | Class |
|---|---|
| Panel / card | `ui-panel`, header `ui-panel-header` |
| Secondary button | `ui-btn` |
| Primary button (one per area) | `ui-btn ui-btn-primary` |
| Destructive button | `ui-btn ui-btn-danger` |
| Quiet button | `ui-btn ui-btn-ghost` |
| Badge | `ui-badge` + `ui-badge-accent` / `-positive` / `-warning` / `-negative` |
| Page tabs (underline) | `ui-tab` with `aria-current="page"` or `aria-selected="true"` |
| Sub-tabs / filter chips | `ui-pill` with `aria-selected` or `aria-pressed` |

Spacing: panels `p-4`, gaps `gap-3` between panels, `gap-1.5` between buttons.

## Still to do

- Many desk buttons are built from dynamic class strings and keep their own padding. They
  already use the standard colours and type; move them to `ui-btn` / `ui-pill` as desks are touched.
- Some labels in data and strings (not JSX text) are still in capitals or Title Case.
