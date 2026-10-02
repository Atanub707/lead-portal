# Style Lock — Lead Portal

Direction: **Attio blend** (Attio structure & density + Pipedrive Insights KPIs + Lightfield/Twenty detail layout), chosen from Mobbin references. Palette grounded via pixel extraction — see `.tastemaker/references/`.

Surface classes: **app shell, data views, transactional forms** (no marketing macrostructure; app-shell motion track).

## Color contract (light mode)

| Role | Value | Notes |
| ---- | ----- | ----- |
| bg | `#F7F7F8` | page background |
| surface | `#FFFFFF` | cards/tables |
| subtle | `#FAFAFA` | hover, table header, sidebar |
| border | `#E4E4E7` | hairline; depth comes from borders, not shadows |
| text | `#18181B` | 17.72:1 on surface |
| muted | `#71717A` | 4.83:1 on white — passes as text; the floor for secondary text |
| primary | `#18181B` | dark buttons; 17.72:1 with on-primary |
| on-primary | `#FFFFFF` | |
| accent | `#2563EB` | links/active only; 5.17:1 on white |

**Banned:** `#A1A1AA` (zinc-400) for text — 2.56:1, fails. Icons/decorative only, never the carrier of meaning. Color is never the only state indicator — status dots always ship with a text label.

**Status dot colors** (paired with `STATUS_LABEL` text): new `zinc-300` · contacted `blue-500` · demo/scoping `violet-500` · proposal `amber-500` · won `emerald-500` · lost `rose-400`.

**Pill pairings (text-safe):** green `#ECFDF3/#067647` · amber `#FFFAFB→#FFFAEB/#B54708` · red `#FEF3F2/#B42318` · blue `#EFF8FF/#175CD3` · violet `#F4F3FF/#5925DC` · neutral `#F4F4F5/#3F3F46`.

## Type

Inter (next/font/google). 13px UI base · 12px secondary · 11px micro/labels · 20px page title · 22px KPI numeral. Weights 400/500/600. `tabular-nums` on numeric columns.

## Spacing, shape, motion

- 4px grid · page padding 32px · card padding 20px · card gap 24px
- radius: cards `8px` · inputs/buttons `6px` · pills `4px`
- shadow: hairline only `0 1px 2px rgba(0,0,0,.04)`
- motion (app shell): `transition-colors 120ms ease-out` on interactive elements; entrance fade + 4px rise, 180ms, 40ms stagger on dashboard/detail cards only — table rows none; all disabled under `prefers-reduced-motion`.

## Anti-slop commitments

No gradients · no emoji · no `transition-all` · zinc-scale neutrals only · status = dot + label · no invented metrics · empty states designed.

## Decision log

- 2026-10-02 — build: Attio blend across shell/table/detail; Pipedrive-style stage bars on dashboard. Status: **KEPT** (user approved, 2026-10-02).
