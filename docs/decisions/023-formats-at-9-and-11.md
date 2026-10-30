# ADR-023: Formats at 9 and 11

**Status:** Accepted (Rob, 30 Oct: "approve 023, U9 fix")
**Date:** 2026-10-30
**Decision maker:** Architect, for the Product Owner's ruling (#249)

**Rulings.** Rob, 30 Oct, `approve 1a 2a 3a 4a 5a 6a 7, 2.2.0`
([#249](https://github.com/vanstoner/coaching-app/issues/249#issuecomment-6531641344)),
on Ada's read ([#249](https://github.com/vanstoner/coaching-app/issues/249#issuecomment-6530425455)).
This ADR records those rulings. Rob approves it once before any code.

**Relationship:** extends [ADR-012](./012-match-owns-its-format.md) (a match
owns its format) with new shapes. Stays inside
[ADR-021](./021-the-record-of-truth.md) D1 (additive only). Keeps
[ADR-015](./015-fairness-is-total-pitch-time.md) §6a and invariant 3 unchanged.

## Context

Rob wants 9- and 11-a-side as formats a coach can pick, each with its own
setups (#249, 29 Oct). Verified on `main` at `746a722`:

- **Most of the app already works for any team size.** The engine, lineup,
  plans, fair share and season figures read `onFieldCount` or
  `structure.onField`. ADR-015 §6a's dominating side is a number.
- **Shapes are a code table.** `ShapeCode` and `SHAPES` (`src/app/shapes.ts:36,65`)
  hold four shapes, all 5- or 7-a-side.
- **A shape is recognised by its unit counts.** `shapeOfFormat`
  (`shapes.ts:183`) matches on team size plus GK/DEF/MID/ATT counts.
- **The record stores the shape as a free string** and `onField` and
  `mainSide` as numbers. `MAIN_SIDES = [5, 7]` (`ledger.ts:1157`) limits what
  a season accepts.
- **Older builds replace an unknown shape.** `formatFromRecord`
  (`recordRestore.ts:30`) turns a shape it does not know into the phone's
  default format or `2-3-1`.
- **The pitch fits at most three in a row.** `rowX` (`pitchLayout.ts:42`)
  spaces rows of 1 to 3. A pill is 28% of the width, so a back four overlaps
  on a 360dp phone.

## Decision

**D1. Shapes stay a code catalogue.** Four are added to `SHAPES`, slots back
to front:

| Code | Side | Slots (label / unit) |
|---|---|---|
| `3-3-2` (9-a-side default) | 9 | GK · LB CB RB (DEF) · LM CM RM (MID) · LF RF (ATT) |
| `3-2-3` | 9 | GK · LB CB RB (DEF) · LM RM (MID) · LW ST RW (ATT) |
| `4-4-2` (11-a-side default) | 11 | GK · LB CB CB RB (DEF) · LM CM CM RM (MID) · LF RF (ATT) |
| `4-3-3` | 11 | GK · LB CB CB RB (DEF) · CM CM CM (MID) · LW ST RW (ATT) |

The 4-3-3 wingers are measured as ATT (Rob, ruling 1a). A shape code is
written into the record, so **codes are permanent, unique across all team
sizes, and never renamed or reused.** `TEAM_FORMATS` and `MAIN_SIDES` are
worked out from `SHAPES`, so there is one list.

**D2. One team size, distinct unit counts.** No two shapes for the same team
size may have the same GK/DEF/MID/ATT counts, because `shapeOfFormat` depends
on it. That keeps 4-2-3-1 out beside 4-5-1 until a shape has another identity.
A test enforces the rule over `SHAPES`.

**D3. No change to the record.** No new record type, no new field, and
`ledgerVersion` stays where it is. A 9- or 11-a-side file holds new values
only (`shape` strings, `onField` and `mainSide` numbers), as ADR-021 D1
allows.

**D4. An unknown shape is refused, never swapped.** From 2.2.0,
`formatFromRecord` refuses a shape it does not know with a stated reason. It
never replaces it with a format of a different team size.

**The older-build gap is accepted** (Rob, ruling 6a). Builds before 2.2.0 are
frozen. Restoring or importing a minutes file with a 9- or 11-a-side fixture
or default into one of them turns it into a 7-a-side one, with no message.
If that build then saves, it writes `2-3-1` back (inferred, not tested).
**Played matches are not affected**: minutes fold from intervals, which carry
their own `positionUnit`.

**D5. Pitch depth is display only.** If a later shape needs two lines in one
unit (a holding and an attacking midfielder), the depth is read from
`roleCode` to place the pill, and is never measured (invariant 3). None of
D1's shapes needs it.

**D6. Not now:** formats as data in the record, formations a coach makes
(Rob, ruling 2a), and a `sport` field. Each needs a record change and its own
ADR.

**Setups that follow (Rob, rulings 3a to 5a).** These are values, not
structure, and Bea's criteria own their detail:

- Match lengths add **70 and 80** minutes to `TOTAL_MINUTES_CHOICES`. Bea
  checks the FA lengths before writing criteria.
- A new team picking 9 is offered **60 min in halves**; picking 11 is offered
  **70 min in halves**. The coach can change both.
- The age nudge (`formatForAge`) becomes **U9–U10 → 7, U11–U12 → 9, U13 and up → 11** (U9 was 5-a-side; FA guidance is 7v7 from U9, Rob 30 Oct: "U9 fix").

## Consequences

**Easier:** adding a formation later is one entry in `SHAPES` plus tests.
Season figures, fairness and the record need no change for 9 or 11.

**Harder:**
- The pitch and the plan image must fit four in a row. That is Dee's
  prototype first, then a `fitGuard` case at 360dp.
- The made-up test team needs about 14 names; it has 10.
- Settings and the fixture form list eight shapes, so they need grouping by
  team size.

**Accepted:** the older-build restore gap in D4.

**Cost to reverse:**
- **D1 codes: permanent** once released. A code can be retired from the
  picker, never removed from what the app reads.
- **D3, D4, D5, D6: low.** D4's refusal is one function.

## Alternatives considered

- **Add 3-5-2 and 4-2-3-1 now.** Rejected (ruling 1a). A five-wide row does
  not fit a phone, and 4-2-3-1 breaks D2.
- **Formats as data, or coach-made formations.** Rejected for now (D6). They
  need a new record type and an ADR-021 format change nobody has asked for.
- **Make 2.2.0 a minimum version for minutes files.** Rejected (ruling 6a). It
  needs a version lock in ADR-021 that nothing else needs, and it is
  expensive to reverse.
- **Keep falling back to the default shape on an unknown code.** Rejected. It
  silently changes a fixture's team size, which is the gap D4 closes.
