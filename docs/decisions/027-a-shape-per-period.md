# ADR-027: A shape per period

**Status:** Accepted. Rob approved #298's recommendations and criteria on 20 Nov
("approve 298 recommendations", "Approve 298 criteria"), and the build in
PR #299 ("approve 299").
**Date:** 2026-11-20
**Decision maker:** Architect, for the Product Owner's ruling (#298)

**Ruling.** [#298](https://github.com/vanstoner/coaching-app/issues/298),
Rob, 20 Nov: *"I want to try changing formation mid match so we will have a
choice between switching to preset configurations. Just do it for 7 aside for
now, I need it when I plan a match but also the switch should be available
between quarters. Out will need to show up when I share the plan. We need a
new formation for 7 aside to be added: 4 mid field flat with sweeper
defence."* Recommendations approved: the sixth outfield place is a striker
(1-4-1); on a switch each child stays in their area; the sweeper is "SW".

**Relationship:** keeps invariants 1–5. Amends
[ADR-012](./012-match-owns-its-format.md) (one format per match) and extends
[ADR-023](./023-formats-at-9-and-11.md) D1 (one new catalogue code). Keeps
[ADR-015](./015-fairness-is-total-pitch-time.md): fairness is total pitch time.

## Context

Verified on `main`:

- A match holds one `Format`, snapshotted on the fixture (ADR-012). Its
  positions have fresh ids (`makeFormat`), so a second shape's positions are
  unknown to the match's format.
- The engine already takes the format on every `startQuarter`, and every
  `Appearance` snapshots `positionKind` and `positionUnit` when it opens. The
  ledger's interval records carry `kind`, `unit` and `role`. Minutes, fair
  share and every season figure fold from those, not from the shape.
- `structure.onField` (the side) is 7 for every 7-a-side shape, so the
  season's main format is unaffected.

## Decision

**D1. `1-4-1` joins the catalogue (7-a-side).** Slots: GK; SW (DEF, role
`SW`); RM, CM, CM, LM (MID); ST (ATT). Permanent once written (ADR-023 D1).
The labels are cues the coach may rename (#166).

**D2. One shape for the match; a period may override it** (Rob, 20 Nov: *"The default will be same formatting through out with options to over ride per quarter when needed."*) The match's format is the default for every period.
Each `Quarter` gains an optional `format`, a snapshot of the shape that
period is played in, set at its Start. Readers that need a period's positions use one helper,
`formatOfPeriod(match, quarter) = quarter.format ?? match.format`. An old
save has no `quarter.format`, so every period reads as the match's format,
exactly as today. Never mid-period: a period's shape is fixed at its Start.

**D3. 7-a-side only, for now.** A shape can change only between shapes of
the same side (`sideOfShape`): the number on the pitch never changes, so the
engine identity (elapsed × onFieldCount) holds. The control is offered only
for a 7-a-side match.

**D4. The plan holds a shape per period.** `PlannedPeriod` gains an
optional `shape`. Its slots are keyed by that shape's positions, whose ids are
derived from the match format's id and the shape (`matchFormatInShape`), so
they are the same on every read without being stored. Every shape of a
match shares the keeper's position, so keeper tools read one id. No shape means the
match's.

**D5. A switch keeps each child in their area.** When the shape changes at a
break or on the plan, each child on the pitch goes to a place of the same
unit in the new shape (DEF, MID, ATT; the keeper stays in goal), in their
old order. Anyone left over goes to the nearest unit with room (MID before
DEF or ATT). Nobody comes on or goes off. The coach adjusts by hand. Planned
subs and who comes off are kept (they name children, not positions).

**D6. No record changes.** The ledger gains nothing. Intervals already say
what each child played, by unit and role, so minutes, fairness and the
timeline need nothing new (invariant 1). The shape per period lives with the
plan and the session, as intent and display.

**D7. The shared plan shows each period's shape**, on its pitch and in its
heading ("Q3 · 1-4-1").

## Consequences

**Easier:** no figure, record or older reader changes. An older build
reading a new save ignores `quarter.format` and `shape`, and draws
every period in the match's shape: wrong positions on screen for a switched
period, never wrong minutes.

**Harder:** every screen that draws a period (Lineup, clock, plan, Team
sheet, share image, report) must ask `formatOfPeriod`. The 22 call sites
that read `format.positions` are reviewed, and a guard test keeps them on
the helper.

**Accepted:** position renames (#166) are per shape. A rename in 2-3-1 does
not carry to 1-4-1.

**Cost to reverse:** the shape code `1-4-1` is permanent once written. D2
and D4 are additive, optional fields: low.

## Alternatives considered

- **One format holding every shape's positions.** It mixes slots on the
  pitch and breaks `onFieldCount`. Rejected.
- **A shape-change record in the ledger.** It would state what the
  intervals already say, and could disagree with them (invariant 1).
  Rejected.
- **Mid-period switching.** Rob asked for between quarters. Rejected for now.
