# ADR-015: Fairness is total time on the pitch; averages are per match attended

**Status:** Accepted
**Date:** 2026-10-04
**Decision maker:** Architect, on the Product Owner's rulings of 2026-10-04 (#98 rulings 3, 4 and 5, `approve 1 2 3 4 5 6 7 8 9`; criteria in #101, #102, #103)

**Relationship:** **supersedes [ADR-004](./004-fairness-is-position-independent.md)**.
Its core stays: position is never a fairness input and no flag is ever raised
on position distribution. Goalkeeper time is no longer excluded.

## Context

> *"Broadly over a season we want to try and offer equal opportunity for
> playing time. Right now we have a dedicated keeper who still wants in general
> outfield play e.g 25%."* — Product Owner, 2026-10-04 (#98)

ADR-004 measured fairness on outfield minutes alone, so a full-match keeper
looked as if they had not played. With a dedicated keeper that is false, and
it would push the coach to give them outfield time they have already had in
goal. Absences (#102) and cup matches (#103) also need a per-match figure that
stays fair to a child who was not there.

## Decision

1. **The fairness figure is total pitch time**: goal plus outfield, summed
   over every position. This applies everywhere a fairness figure appears:
   plan projection, lineup, clock, summary, season and analysis (#101 AC1).
   Bench time is not pitch time.
2. **Never per position** (kept from ADR-004). Position and unit are recorded
   and reportable. They never enter fairness arithmetic and never raise a
   flag.
3. **Outfield-share target.** This is optional, per player, and a whole
   percentage, for example 25 for the dedicated keeper. It is a coach setting
   on the player in the working document, `outfieldTargetPct: number | null`,
   and is not in the ledger, because it is not player time. The figure shown
   against it is outfield ÷ pitch time over the season's counted matches. It
   reads "on track" when it is at or above the target, "below" when it is
   under, and nothing when there is no pitch time yet. It is never a fairness
   input (#101 AC2).
4. **Attended means available at kick-off.** A player whose attendance status
   for that match (ADR-014 §4, latest revision) is `available` attended it,
   even if benched for the whole match. `absent`, `injured` and `unavailable`
   all count as games missed. A child benched for a whole match is exactly the
   unfairness this measure exists to show, so that match must count against
   their average. Treating it as not attended would hide it.
5. **Matches recorded before attendance existed.** These are v1 matches,
   which have no attendance records. For them, attended is inferred as
   "played any interval". It is computed on read, never stored, and the
   season view says how many matches were inferred. v1's stored availability
   is not used, because it is all-available by default rather than measured.
6. **Counted matches** are those with status `completed`. A planned,
   in-progress or abandoned match does not count towards the averages. An
   abandoned match's minutes still count in the season totals.
7. **Season average** = pitch time over counted matches attended ÷ the number
   of counted matches attended. It is null when the player has attended none;
   that is not zero (#102 AC3). Games missed is counted the same way, from
   matches missed.
8. **Competition split** (#103). The same average is computed separately for
   each `Competition`: `league`, `cup`, `friendly` and `tournament`. A null
   competition counts as `league` (#103 AC3). A bucket with no attended
   matches is null. Cups count in the season figure (AC1). Whether friendly
   and tournament share a column on screen is #103's display decision; the
   pure module returns all four buckets.
9. **The shadow** in the analysis (#105) is the season average for counted
   matches attended, excluding the match being viewed. That keeps a live
   match from being compared with itself.
10. **New invariant 3 wording for `CLAUDE.md`**, verbatim:

    > 3. **Fairness is total time on the pitch, in goal plus outfield, never
    >    per position.** Positions are assigned by affinity; per-position
    >    measurement would flag the coach's own decisions as anomalies. A
    >    player's outfield-share target is shown beside their figures, never
    >    used as a fairness input (ADR-015).

## Consequences

**Text this supersedes.** It is to be updated by the work that implements
#101, not by this ADR:

- the [fairness spec](../specs/03-fairness-ledger.md): the outfield-only
  measure, its `expectedMs` and GK-exclusion rules, and its flags;
- the [domain model spec](../specs/01-domain-model.md): the line that makes
  `outfieldMs` "the fairness figure";
- the [match engine spec](../specs/02-match-engine.md), "Attribution of
  minutes";
- the invariant 3 line in `docs/HANDOVER-PROMPT.md`;
- the comments in `src/app/playerMinutes.ts`.

**Easier:** one figure that a parent can be shown. The keeper's time is
counted honestly, and the 25% wish has a place that does not distort
fairness.

**Harder:** every existing fairness call site changes from `outfieldMs` to
pitch time, and all of them must change together, or two screens will
disagree.

**Accepted:** a full-match keeper now reads as well played. That is the
ruling.

## Alternatives considered

**Keep outfield-only fairness and add the GK time as a footnote.** This
contradicts ruling 3.

**Attended = played at least one interval, everywhere.** It needs no
attendance data. It was rejected because it hides a child benched for a whole
match, which is the case fairness exists for. It is kept only for v1 matches,
where nothing better exists.

**Target as a fairness weight** (outfield time counted at 4× for the keeper).
This was ruled out, because the target is never a fairness input, and it adds
a tuning parameter with no principled value, which ADR-004 already rejected.
