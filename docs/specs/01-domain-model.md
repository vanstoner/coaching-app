# Spec 01 — Domain Model

Status: **Approved** by the Product Owner, 2026-09-18.

> Approved 2026-09-18 — 12 of its 13 entities exist in `src/types/index.ts` and match. Only `Vacancy` is unbuilt. Open questions below are carried as issues, not blockers.
Owner: Rob (Product Owner)
Last updated: 2026-09-20

## Purpose

Defines the core entities and their relationships. This is the foundation all
other specs build on. Nothing in the UI may invent state that is not expressible
here.

## Design principles

1. **GDPR-minimal.** First names only. No surnames, no DOB, no contact details,
   no photographs. The data model must make it awkward to add PII, not merely
   discourage it.
2. **Season-scoped, not match-scoped.** Fairness is measured across a season,
   so the durable record is the season ledger. A match is an input to it.
3. **Auditable.** Every minute attributed to a player must be traceable to a
   timestamped interval, and every interval to the events behind it. Disputes
   are settled by replaying events, never by trusting a running total.
4. **Append-only.** The persisted record is an append-only event log
   ([ADR-007](../decisions/007-append-only-match-event-log.md)). Intervals are a
   projection of it and are never mutated; corrections are new events that
   reference what they correct and carry a note.
5. **Proportionate.** This is a substitution reminder and a fairness tracker,
   not an audit-grade timing system (PO ruling, 2026-09-17,
   [ADR-009](../decisions/009-single-clock-owner-per-match.md)). Seconds-level
   accuracy is sufficient. The structural guarantees above are worth paying for;
   precision beyond that is not. Robustness when the coach forgets the clock
   matters more than either.

## Entities

### Squad

A named group of players, typically a team for a season.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `name` | string | e.g. "U9 Reds" |
| `formatId` | UUID | FK → Format — **default** for a new fixture ([ADR-012](../decisions/012-match-owns-its-format.md)) |
| `marginMs` | int | Quarter-end margin setting. Default 60 000. Range 30 000–300 000 inclusive. Copied onto each match at start — see Spec 02 § Margin |
| `createdAt` | ISO timestamp | |

> **Squad is the ownership boundary** ([ADR-010](../decisions/010-tenancy-boundary.md),
> accepted 2026-09-17). Every entity in this spec is reachable from exactly one
> `squadId`. Access, export, deletion and any future sharing operate per squad.
> There is no `Club` entity; if clubs ever arrive they *group* squads rather than
> own their data, which keeps a squad exportable and erasable as one unit.
>
> The Product Owner ruled (#19) that the sharing scenario is **the coaches of
> one squad** — a head coach and an assistant — not a club seeing all its
> squads. No club-level read model is designed.

### Player

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `squadId` | UUID | FK → Squad |
| `firstName` | string | **First name only.** Enforced at input layer. |
| `displaySuffix` | string \| null | Optional disambiguator for two players sharing a first name, e.g. "B" for a second Jack. Not a surname; max 2 chars. |
| `squadNumber` | int \| null | Optional |
| `active` | boolean | Inactive players stay in the ledger but are not selectable |
| `createdAt` | ISO timestamp | |

> **Disambiguation rule.** Two players in one squad may share a first name. The
> UI renders `firstName` + `displaySuffix` where a collision exists. The
> `displaySuffix` field is deliberately capped at 2 characters so it cannot
> become a surname field by convention.

### Format

A customisable match shape. 7-a-side is the current default, but the number of
players on the pitch and the position set are configurable.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `squadId` | UUID | FK → Squad. **Formats are squad-owned** — see the note below |
| `name` | string | e.g. "7-a-side" |
| `onFieldCount` | int | e.g. 7 (includes the goalkeeper) |
| `positions` | Position[] | Ordered; length must equal `onFieldCount` |

> **Formats are copied, not shared** ([ADR-010](../decisions/010-tenancy-boundary.md) §2,
> accepted 2026-09-17). Built-in formats (5-a-side, 7-a-side, 9-a-side, 11-a-side)
> are **templates**. Using one copies it into the squad. No mutable reference is
> ever shared across squads, so editing a template cannot retrospectively change
> a match that has already been played — which is the correct behaviour for a
> record that has to be explainable months later.

### Position

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `formatId` | UUID | FK → Format |
| `label` | string | e.g. "GK", "LB", "CM", "ST" |
| `kind` | enum | `goalkeeper` \| `outfield` |
| `sortOrder` | int | Drives pitch layout ordering |

> Exactly one position per format should have `kind: goalkeeper`. The engine
> tolerates zero (some formats have no keeper) but rejects more than one.

### Match

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `squadId` | UUID | FK → Squad |
| `formatId` | UUID | FK → Format. The format itself is **copied onto the stored match** ([ADR-012](../decisions/012-match-owns-its-format.md)). The squad format is only the default for a new fixture. |
| `opponent` | string \| null | Free text, optional |
| `kickoffAt` | ISO timestamp \| null | Planned start |
| `totalMinutes` | int | Whole minutes, 20–120 — see [Match length](#match-length) |
| `quarterCount` | int | **2** (halves) or **4** (quarters). Default 4 — see [Match length](#match-length) |
| `marginMs` | int \| null | The quarter-end margin for this match, **copied from `Squad.marginMs` when the match starts**. Null while `planned`; fixed for the whole match once set. See Spec 02 § Margin |
| `status` | enum | `planned` \| `in_progress` \| `completed` \| `abandoned` |
| `createdAt` | ISO timestamp | |

**Derived:** `quarterMinutes = totalMinutes / quarterCount`.

### Match length

> **Amended 2026-09-17 (#19).** This section replaces the previous rule
> *"40, 50 or 60 (validated: must divide evenly by `quarterCount`)"* and the
> derived note *"validation rejects a combination that does not divide evenly,
> since the brief requires equal quarters"*. That wording contradicted the
> fractional-quarter rule ruled into Spec 02 (#16, #31): it would have rejected
> the single most common configuration in this squad's own age group.

**Validity rule.** A match configuration is valid when all of these hold:

1. `totalMinutes` is a **whole number** of minutes.
2. `totalMinutes` is between **20 and 120** inclusive.
3. `quarterCount` is **exactly 2 or 4**.
4. `totalMinutes × 60 000 / quarterCount` is a **whole number of milliseconds**.

Rule 4 is the fractional-quarter rule from Spec 02. Quarters are still equal —
they are simply allowed to be a fractional number of *minutes*, provided each is
a whole number of milliseconds. A 50-minute match in quarters gives 12.5-minute
quarters (750 000 ms each): valid, and it is what this squad plays now.

**Rules 2 and 3 close the gap QA raised on PR #17** and recorded as an open item
on PR #15: `createMatch` accepted arbitrary input, so 40 minutes over 2.5
quarters built two quarters totalling 1 920 000 ms, and 50 minutes over 0.5
quarters built a match with zero quarters. Neither is reachable from the UI
today, but both had to be ruled before storage or a UI calls `createMatch`.

**Why a range and not a table of age groups.** Grassroots match lengths are set
by the league, vary by age group and by competition, and change between seasons.
Encoding an FA table into the engine would buy nothing and go stale. The range
is a **sanity check against nonsense input**, not a rulebook. For orientation
only, the shape of the real data:

| Age group | Format | Typical match length | Periods |
|---|---|---|---|
| U7–U8 | 5v5 | ~40 min | Quarters or halves |
| U9–U10 | 7v7 | 40–50 min | Quarters or halves |
| U11–U12 | 9v9 | 50–60 min | Halves |
| U13+ | 11v11 | 70–90 min | Halves |

> **Provenance of the table above.** Indicative figures from secondary sources
> (county FA and league pages) gathered 2026-09-17. `thefa.com` and the league
> mirrors were unreachable from this environment, so **these figures are not
> verified against the FA Standard Code of Rules** and are not relied on by any
> validation rule. They justify the 20–120 range and nothing more. The FA's own
> constraint is a cap on total playing time per day (40 min at U8/U9 rising to
> 100 min at U13+), which is a squad-management concern, not a match-length one.

**Halves are supported.** The Product Owner confirmed (2026-09-17) that matches
are played in either quarters or halves, so `quarterCount: 2` is valid. The
field name `quarterCount` is now inaccurate for the halves case — a rename to
`periodCount` is proposed with the ADR-007 reshape rather than made here, since
it ripples through the engine, Spec 02 and the test suite. Tracked as an open
question below.

### Quarter

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `matchId` | UUID | FK → Match |
| `index` | int | 1-based |
| `status` | enum | `pending` \| `running` \| `ended` |
| `startedAt` | ISO timestamp \| null | Wall-clock **anchor** (`clockAnchorAt`, ADR-008) |
| `endedAt` | ISO timestamp \| null | Wall-clock **anchor** at the effective end |
| `effectiveEndElapsedMs` | int \| null | Quarter-elapsed time the quarter is recorded as having ended — the coach's chosen end time. Spec 02 § End-time choices |
| `endChoiceRecordedAt` | ISO timestamp \| null | Wall-clock time the coach made that choice. Audit only; never feeds a minute |
| `endChoice` | enum \| null | `planned` \| `just_now` \| `last_event` — which option the coach picked |

> **`elapsedMs` is no longer a stored field.** It was
> *"authoritative accumulated play time for this quarter"*; under
> [ADR-007](../decisions/007-append-only-match-event-log.md) it is **derived** by
> folding the quarter's clock events and is never persisted. This also closes
> trial-review finding 4 on PR #15 (*"stored `Quarter.elapsedMs` is never
> updated"*) — a stored derived value that can drift is exactly what invariant 1
> forbids.
>
> `startedAt` and `endedAt` are **anchors**, and anchors are the only absolute
> wall-clock values that feed minutes ([ADR-009](../decisions/009-single-clock-owner-per-match.md) §3).
> `endChoiceRecordedAt` is provenance, not an anchor: a coach who taps "Ended at
> planned time" two minutes late has an `effectiveEndElapsedMs` at the planned
> length and an `endChoiceRecordedAt` two minutes after it.

### Appearance (the audit unit)

**This is the most important entity in the model.** An Appearance is a single
continuous interval during which one player occupied one position. It is the
atomic, auditable record from which all minutes are derived.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `matchId` | UUID | FK → Match |
| `quarterId` | UUID | FK → Quarter |
| `playerId` | UUID | FK → Player |
| `positionId` | UUID | FK → Position |
| `positionKind` | enum | Denormalised `goalkeeper` \| `outfield` — snapshotted so later format edits cannot rewrite history |
| `startElapsedMs` | int | Match-elapsed time at interval start |
| `endElapsedMs` | int \| null | Null while the interval is open |
| `endReason` | enum \| null | `substitution` \| `position_change` \| `quarter_end` \| `match_end` \| `correction` |
| `corrected` | boolean | True if this interval was edited after the fact |
| `correctionNote` | string \| null | Required when `corrected` is true |

**Rules:**

- A player has at most one open Appearance at any time.
- A position has at most one open Appearance at any time.
- Changing a player's position ends the current Appearance (`position_change`)
  and opens a new one. This is what makes position-time trackable separately
  from total time.
- Substituting a player off ends their Appearance (`substitution`) and opens one
  for the incoming player in the same position.
- `durationMs = endElapsedMs - startElapsedMs`, and is only defined for closed
  intervals. Open intervals are evaluated against the live clock.

### BenchStint

Mirrors Appearance for time spent off the pitch. Needed so that "time on bench"
is auditable rather than inferred by subtraction, which would hide errors.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `matchId` / `quarterId` / `playerId` | UUID | |
| `startElapsedMs` / `endElapsedMs` | int / int \| null | |

**Invariant:** at any elapsed time, every available player is in exactly one of
an open Appearance or an open BenchStint. The test suite asserts this
continuously; a violation means the engine has lost a player.

### Vacancy

> **Added 2026-09-17 (#19).** Spec 02 asserts its quarter identity with a
> `sum(vacancy durations)` term that was held at zero *"until Spec 01 defines
> vacancy records"* (PO ruling, open question 9, PR #20). This section defines
> them, so the term becomes real.

An unfilled position. When a player is injured or leaves the pitch with no
replacement, the team plays short: a position is occupied by nobody for a
stretch of the quarter. That time belongs to the position, not to any player.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `matchId` / `quarterId` / `positionId` | UUID | |
| `startElapsedMs` / `endElapsedMs` | int / int \| null | Mirrors Appearance |
| `reason` | enum | `injury` \| `no_replacement` \| `other` |
| `note` | string \| null | |

**Why this is a record and not a subtraction.** Without it, a short-handed
quarter breaks the identity in Spec 02 and the engine cannot tell "the team
played with six" from "the engine lost a player". Recording the vacancy makes
the first case explicit and leaves the second detectable — the same reasoning
that made BenchStints explicit rather than inferred.

**A vacancy is not bench time.** The injured player moves to a BenchStint if
they remain available, or out of the available set entirely if they do not.
Their time never goes into the vacancy, and the vacancy never counts toward any
player's minutes. It is therefore invisible to fairness arithmetic, which is
correct: nobody played it.

With vacancies defined, Spec 02's identity for a closed quarter is asserted in
full: `sum(Appearance durations) + sum(vacancy durations) === actualQuarterElapsedMs × onFieldCount`.

### Season & the Fairness Ledger

Per the Product Owner: *fair time is measured across a multi-match period or a
season, so anomalies can be corrected over time, and the data must support
dispute arbitration.*

#### Season

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `squadId` | UUID | FK → Squad |
| `name` | string | e.g. "2026/27" |
| `startDate` / `endDate` | ISO date | |

#### PlayerSeasonTotals (derived, never authored)

Recomputed by folding every Appearance in the season. Never written by hand —
this guarantees the displayed figure and the audit trail can never disagree.

| Field | Type | Notes |
|---|---|---|
| `playerId` | UUID | |
| `seasonId` | UUID | |
| `outfieldMs` | int | Sum of `outfield` Appearances, **all positions combined — this is the fairness figure** |
| `goalkeeperMs` | int | Sum of `goalkeeper` Appearances — reported separately, excluded from fairness |
| `totalMs` | int | `outfieldMs + goalkeeperMs` — display only, not the fairness measure |
| `matchesAvailable` | int | Matches where player was in the selected squad |
| `matchesPlayed` | int | Matches with ≥1 Appearance |
| `benchMs` | int | Sum of BenchStints |

**Per-position totals are reportable but are not a fairness measure.** Position
is recorded on every Appearance, so time-per-position can always be derived for
display. No fairness arithmetic or anomaly detection is performed on it — see
Spec 03, which explains why (deliberate position affinities would otherwise
generate false anomalies).

**Availability matters.** A player who missed four matches through absence is
not owed those minutes. Fairness is therefore measured per match *available*,
not per calendar match. See Spec 03 for the algorithm.

### PlayerPositionAffinity

Per the Product Owner: *"We are likely to lock players into certain positions or
a couple of positions so their distribution will be higher into those
affinities."*

| Field | Type | Notes |
|---|---|---|
| `playerId` | UUID | FK → Player |
| `positionId` | UUID | FK → Position |
| `preference` | enum | `primary` \| `secondary` |

A player with no recorded affinity is treated as eligible for any outfield
position. Affinities **constrain team-sheet suggestions only** — the coach may
always assign any player to any position manually. They never affect fairness
arithmetic.

`goalkeeper`-kind affinity marks a player as keeper-eligible.

### Availability

| Field | Type | Notes |
|---|---|---|
| `matchId` / `playerId` | UUID | |
| `status` | enum | `available` \| `absent` \| `injured` \| `unavailable` |
| `note` | string \| null | |

## The event log

> **Added 2026-09-17 (#19)**, recording
> [ADR-007](../decisions/007-append-only-match-event-log.md) and
> [ADR-008](../decisions/008-record-provenance.md), both accepted.

**The persisted record for a match is an append-only log of events.** Events are
never updated and never deleted. Appearances, BenchStints, Vacancies and quarter
elapsed times are **projections** — pure folds over that log.

This does not change what the entities above mean or what they guarantee. It
changes where they come from: they are computed, not stored. Every invariant
ADR-003 established still holds and is asserted on every fold.

### Event envelope

Every event carries the same envelope ([ADR-008](../decisions/008-record-provenance.md)):

| Field | Type | Notes |
|---|---|---|
| `eventId` | UUID | Client-generated. No autoincrement or sequence keys anywhere in the model |
| `squadId` | UUID | The ownership boundary (ADR-010) |
| `actorId` | UUID | The coach who recorded it |
| `deviceId` | UUID | Stable per-install |
| `recordedAt` | ISO timestamp | When the row was written. **Audit only — never feeds a minute** |
| `clockAnchorAt` | ISO timestamp \| null | Wall-clock anchor from the clock-owning device. Present **only** on clock-anchoring events; null everywhere else |
| `schemaVersion` | int | For replay across app versions |

**`recordedAt` and `clockAnchorAt` are different fields with different jobs.**
`clockAnchorAt` is the anchor ADR-002 derives elapsed time from, and anchors are
the only absolute wall-clock values that feed minutes. `recordedAt` is
provenance. A correction entered on Tuesday for Saturday's match has a Tuesday
`recordedAt` and no `clockAnchorAt` at all.

### Coach identity

`actorId` refers to a **local coach profile holding a display name only**. No
email, no phone, no account in the MVP. A coach profile is personal data but it
is not child data, and the first-names-only rule in design principle 1 governs
players, not the coach using the app on their own device.

### Event types

`MatchCreated`, `QuarterStarted`, `ClockPaused`, `ClockResumed`, `QuarterEnded`,
`PlayerSubstituted`, `PositionChanged`, `PositionVacated`, `PositionFilled`,
`IntervalCorrected`. The list grows with each requirement; the envelope does not.

### Corrections

A correction is an **event** that references the event it corrects and carries a
mandatory note. The original event remains in the log. This makes invariant 5
(*corrections are explicit, noted, and never destructive*) structural rather
than a convention the code is trusted to follow.

## Future-proofing for match events

Spec 06 (later iteration) adds match events: goal, save, tackle, foul, with
`elapsedMs`, `playerId`, and `positionId` captured at the moment of the event.

Under ADR-007 these are **not a new entity** — they are simply more event types
in the log defined above, carrying the same envelope. This is a smaller addition
than it was when this spec was first written: no new storage shape, no
migration, and provenance comes for free.

## Open questions for Product Owner

1. ~~Should a player be able to appear for more than one squad in a season?~~
   **Ruled 2026-09-17 ([ADR-010](../decisions/010-tenancy-boundary.md) §4):** no.
   A player belongs to one squad. If the same child plays for two squads that is
   two player records, never a shared one, and their history stays with the
   squad it was earned in.
2. Do you want to record match results (score), or is that out of scope for MVP?
3. For dispute arbitration — does the exported record need to be human-readable
   (PDF/CSV per player) or is on-screen review sufficient?
4. **Rename `quarterCount` → `periodCount`?** Matches are played in quarters or
   halves, so the field name is now wrong half the time. The rename is proposed
   with the ADR-007 reshape rather than done here, because it ripples through the
   engine, Spec 02 and the test suite and should land in one change. Raised
   2026-09-17 (#19).
5. **Is dispute arbitration still a requirement at its original weight?** The
   Product Owner said on 2026-09-17: *"I am not trying to audit a match, I just
   want something that reminds me to put a substitute on."* That sits oddly
   beside REQ-08 (#8, *Dispute arbitration record and audit trail*) and design
   principle 3, both of which this spec is built around. Nothing has been
   downgraded on the strength of a remark — the structural guarantees are cheap
   and stay. But REQ-08's scope, and how much UI it earns, should be ruled before
   it is built. Raised 2026-09-17 (#19).

## Changelog

| Date | Change | Source |
|---|---|---|
| 2026-09-17 | Match length rules replaced: whole minutes 20–120, `quarterCount` ∈ {2, 4}, each period a whole number of ms. Removes the "divide evenly" contradiction with Spec 02 and closes the arbitrary-input gap from PR #15/#17. Halves recorded as supported. | PO rulings, #19 |
| 2026-09-17 | `Squad.marginMs` setting and `Match.marginMs` (copied at start) added; the field Spec 02 § Margin was waiting on. | PO ruling #21, via #19 |
| 2026-09-17 | Vacancy entity defined, making Spec 02's `sum(vacancy durations)` term real rather than held at zero. | PO ruling #20 Q9, via #19 |
| 2026-09-17 | Event log and provenance envelope added; `Quarter.elapsedMs` becomes derived, not stored. Design principles 3–4 restated, principle 5 (proportionality) added. | ADR-007, ADR-008, ADR-009 accepted, #19 |
| 2026-09-17 | Squad recorded as the ownership boundary; formats become squad-owned copies of templates. Open question 1 ruled. | ADR-010 accepted, #19 |
| 2026-09-17 | Quarter gains `effectiveEndElapsedMs`, `endChoiceRecordedAt`, `endChoice`. | Spec 02 § End-time choices, via #19 |
| 2026-09-20 | A match copies length, period count and format at creation. Squad format is the default. Shapes: 2-3-1+GK and 2-2-2+GK. | ADR-012, #70 |
