# ADR-024: Who's coming and the team sheet

**Status:** Proposed. Rob approved Ada's D1–D7 with #277's criteria (5 Nov:
"approve 277 278 276, coming (assume all available), 2 own"); this ADR
records them and is accepted when the 2.3.0 PR merges.
**Date:** 2026-11-05
**Decision maker:** Architect, for the Product Owner's ruling (#277)

**Rulings.** [#277](https://github.com/vanstoner/coaching-app/issues/277):
the keeper ruling (1 Nov), P1–P5 (5 Nov) and the approval of criteria A–E
with A3 ruled as "a new fixture starts with everyone Coming".

**Relationship:** stays inside [ADR-015](./015-fairness-is-total-pitch-time.md)
(fairness is total pitch time; positions are a record, never a target) and
[ADR-021](./021-the-record-of-truth.md) (the record is additive). The plan
stays intent, never a record ([#72](https://github.com/vanstoner/coaching-app/issues/72)).

## Context

Rob plans a match in a set order: who is coming, who keeps, the mid-quarter
subs, everyone else, then a tweak with every quarter in view (#277). The app
had each piece (the per-match availability, the plan, the suggestion, the
season's owed time) but met them quarter by quarter and aware of this match
only.

## Decision

**D1. Who's coming is the match's own availability.** Coming is `available`
and Can't is `unavailable`. Not heard is one new status, `unconfirmed`. A new
fixture starts with every child Coming, as before. The weekly changes live
in the session only. At kick-off the snapshot records `unconfirmed` as
`absent` (unticked on Here today), so **the record never receives it**, and
no reader of the record, the minutes file or a frozen release's data changes.
A fixture stored before 2.3.0 reads every child as Coming.

**D2. Keeper rotation is a suggestion input.** A Main keeper who is coming
keeps every period; with none coming, a Back-up does (Rob, 6 Nov). Otherwise
Automatic (the Keepers choice; I'll choose sets one per period by hand) takes the eligible child with the least time in goal this season, folded from the
record each time. It is never stored, never compared with a target and never
shown as over or under. The step shows how many matches each keeper kept.

**D3. The fill is season-aware.** Planned minutes in this match come first;
ties go by owed time (Going into Saturday's figure), worked out each time and
never stored. A child with no owed figure counts as 0.

**D4. The best spread, in pure TypeScript.** `src/app/teamSheetBuilder.ts`
hands out time in half-periods (whole periods with no subs). A seeded search
over tie orders keeps the smallest spread, with a fixed seed, so the answer is
the same every time. It fills only the empty places: the keepers and places the
coach filled by hand (`PlannedPeriod.pinned`) stay (Rob, 6 Nov). Subs are a
number of pairs a period; `fairestSubs` gives the fewest with the fairest
split, where the coach's stepper starts. ⟳ Rearrange moves children within
one period only, so it never changes anyone's minutes. **By position** then seats each
child in their preferred area where a free place allows; it never changes who
plays how long (invariant 3). Shuffle was dropped (Rob, 6 Nov). A test checks, by exhaustive search, that no plan with a
smaller spread exists for 5–8 children at 5-a-side and 7–10 at 7-a-side.

**D5. The view (Pitch, All or Table; mock v2, Rob 6 Nov) is a view setting** under its own key
(`coaching-app/sheet-view/v1`, per team, like the table sort). Forget everything removes it, and it is never
in the record or a backup.

**D6. The sheet is the existing plan** (`matches[].plan`): a lineup and planned
subs per period. **Reset** clears it to the keepers, with Undo; Fill the rest fills only the empty places. The one addition is `PlannedPeriod.pinned`, the places filled by hand (D4), intent like the rest. No new plan model.

**D7. Planning and match day may split later (#258).** Who's coming and the
sheet are per-fixture session data, the seam a shared plan would sync
across. Nothing here ties planning to the match-day phone.

## Alternatives considered

- **A separate "intention" record for Who's coming**, confirmed by Here today.
  Rejected: two lists of the same thing could disagree, and the per-match
  availability already is that list before kick-off.
- **Storing Not heard as Coming or Can't.** Rejected: that would fabricate an
  answer nobody gave. `unconfirmed` models the gap and stays out of the record.
- **A keeper fairness figure** ("share of goal"). Rejected by invariant 3 and
  Rob's 1 Nov ruling: keeping is shared by rotation, as a suggestion input only.
- **A random fill.** Rejected (P3, then Rob 6 Nov): the fill gives the same
  answer every time, and Shuffle was dropped for Fairly and By position.
- **A new plan model for the sheet.** Rejected (D6): any number of subs a period
  fits today's plan, so every screen that reads a plan keeps working.

## Consequences

- One new availability status, which never reaches the record.
- The team sheet adds no stored figure: every minute, range and keeper count
  is worked out from the plan and the record each time it draws (invariant 1).
- The Lineup suggestion still looks at goal time in this match. The team
  sheet looks at the season. Both are suggestions, so they may differ.
