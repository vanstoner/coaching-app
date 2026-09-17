# Spec 01 — Domain Model

Status: Draft for Product Owner review
Owner: Rob (Product Owner)
Last updated: 2026-09-17

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
   timestamped interval. Disputes are settled by replaying intervals, never by
   trusting a running total.
4. **Append-only where it matters.** Minutes are derived from intervals.
   Intervals are never silently mutated; corrections are explicit and recorded.

## Entities

### Squad

A named group of players, typically a team for a season.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `name` | string | e.g. "U9 Reds" |
| `formatId` | UUID | FK → Format (the current default, e.g. 7-a-side) |
| `createdAt` | ISO timestamp | |

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
| `name` | string | e.g. "7-a-side" |
| `onFieldCount` | int | e.g. 7 (includes the goalkeeper) |
| `positions` | Position[] | Ordered; length must equal `onFieldCount` |

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
| `formatId` | UUID | FK → Format — snapshotted at creation |
| `opponent` | string \| null | Free text, optional |
| `kickoffAt` | ISO timestamp \| null | Planned start |
| `totalMinutes` | int | 40, 50 or 60 (validated: must divide evenly by `quarterCount`) |
| `quarterCount` | int | Default 4 |
| `status` | enum | `planned` \| `in_progress` \| `completed` \| `abandoned` |
| `createdAt` | ISO timestamp | |

**Derived:** `quarterMinutes = totalMinutes / quarterCount`. Validation rejects a
combination that does not divide evenly, since the brief requires equal quarters.

### Quarter

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `matchId` | UUID | FK → Match |
| `index` | int | 1-based |
| `status` | enum | `pending` \| `running` \| `ended` |
| `startedAt` | ISO timestamp \| null | Wall-clock |
| `endedAt` | ISO timestamp \| null | Wall-clock |
| `elapsedMs` | int | Authoritative accumulated play time for this quarter |

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

## Future-proofing for match events

Spec 06 (later iteration) adds a `MatchEvent` entity: goal, save, tackle, foul,
with `elapsedMs`, `playerId`, and `positionId` captured at the moment of the
event. The model above already carries the elapsed-time spine that makes this a
pure addition — no migration of existing entities required. This is why the
clock is modelled as accumulated `elapsedMs` rather than wall-clock only.

## Open questions for Product Owner

1. Should a player be able to appear for more than one squad in a season?
2. Do you want to record match results (score), or is that out of scope for MVP?
3. For dispute arbitration — does the exported record need to be human-readable
   (PDF/CSV per player) or is on-screen review sufficient?
