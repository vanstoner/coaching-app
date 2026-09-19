# Spec 03 — Fairness Ledger (Season-Scoped)

Status: **Approved** by the Product Owner, 2026-09-18.

> Approved 2026-09-18 — its defining rule (fairness is total outfield time, goalkeeper excluded, position never part of the arithmetic) is implemented in `src/app/playerMinutes.ts` and `src/app/lineup.ts`. The season-scoped ledger it describes is still ahead of what is built; that is REQ-07 (#7).
Owner: Rob (Product Owner)
Last updated: 2026-09-17

## Purpose

Defines how equal playing time is measured, carried across matches, and defended
under challenge.

## Product Owner decisions

> *"Let's set up fair time — each outfield player gets equal allocation of time
> over a multi-match period or season. This will allow us to fix anomalies. Data
> will need to be recorded and observed for fairness and dispute arbitration."*

> *"Fairness wasn't supposed to be per position, just total playing time. We are
> likely to lock players into certain positions or a couple of positions so their
> distribution will be higher into those affinities."*

**This is the defining constraint of the feature.** Players have position
affinities that the coach assigns deliberately. A defender who never plays up
front is not an anomaly — it is the plan. Measuring fairness per position would
therefore generate false alarms against the coach's own selection policy.

**Fairness is measured on one number: total outfield minutes on the pitch.**

> *"Keep GK out of fairness entirely."*

Goalkeeper minutes are excluded from the fairness measure. Rationale: the keeper
is a specialist role, and counting it as equivalent to outfield time would let
outfield allocation be offset by time in goal.

## What is and is not measured

| Quantity | Tracked? | Drives fairness? | Raises flags? |
|---|---|---|---|
| Total outfield minutes | Yes | **Yes — this is the measure** | Yes |
| Goalkeeper minutes | Yes, separately | No | No |
| Minutes per position | Yes | **No** | **No** |
| Bench minutes | Yes | No (derived view) | No |

Position-level time is recorded and reportable — it is interesting to the coach
and the later events feature depends on the same intervals — but **no fairness
arithmetic and no anomaly detection is ever performed on it.** A player with
100% of their minutes at left-back is a normal, expected record.

## Core measure: the fairness balance

For each player, per season:

```
expectedMs  = sum over available matches of (matchOutfieldPlayerMs / eligibleOutfieldPlayers)
actualMs    = sum of that player's outfield Appearance durations   // position ignored
balanceMs   = actualMs - expectedMs
```

Note `actualMs` sums **across all positions**. The position held during an
interval is recorded on the Appearance but plays no part in this sum.

- `balanceMs > 0` → player is **ahead** (has had more than their share).
- `balanceMs < 0` → player is **owed** time.
- Displayed to the coach in minutes, as a single signed figure per player.

### Why "per match available"

A player absent for three matches is not owed those minutes. `expectedMs` accrues
only for matches where their Availability is `available`. This prevents the
perverse result where the most absent player appears most owed.

### Goalkeeper handling in the arithmetic

- A player keeping for a whole match accrues **no** outfield minutes and, for
  that match, **no** `expectedMs` either — they were not in the outfield pool.
- A player keeping for one quarter and playing outfield for three accrues
  `expectedMs` scaled to the portion of the match they were outfield-eligible.

This keeps the balance honest: a part-time keeper is neither penalised nor
credited for the time they spent in goal.

> **Open question for PO:** if the same player keeps every week by preference,
> should the app say anything? Currently: silent. A flag can be added later.

## Planning the next match

The ledger is only useful if it changes what happens next. When building a team
sheet, the app:

1. Sorts the available squad by `balanceMs` ascending (most-owed first).
2. Suggests a sub schedule that drives balances toward zero.
3. Shows projected end-of-match balances **before** the coach confirms.

**Position affinity is respected by the planner.** Each player may be assigned
one or more preferred positions. Suggestions place a player in a preferred
position wherever possible and never propose moving someone out of their
affinity purely to satisfy a minutes target — the target is met by adjusting
*how long* they play, not *where*.

Suggestions are always advisory. The coach can override for any reason, and the
override is recorded with an optional reason so the ledger explains itself later.

### Position affinity

| Field | Type | Notes |
|---|---|---|
| `playerId` | UUID | |
| `positionId` | UUID | |
| `preference` | enum | `primary` \| `secondary` |

A player with no recorded affinity is treated as available for any outfield
position. Affinities constrain suggestions only; the coach can always assign
freely.

## Dispute arbitration view

For any player, the coach can open a record showing:

- Season totals: outfield minutes (**the fairness figure**), GK minutes, bench
  minutes, matches available, matches played.
- Running fairness balance over time, match by match.
- Every individual Appearance: match, quarter, position, start, end, duration.
- Any corrections applied, with notes.
- Any coach overrides of suggested plans, with reasons.

Position appears in the record as **descriptive detail**, not as a measure. The
arbitration conversation is about the total, and the per-interval list is the
evidence for it.

**Export:** per-player CSV and a printable summary.

> **Open question for PO:** is export needed for MVP, or is on-screen review
> sufficient initially?

## Anomaly detection

Flags relate **only** to total outfield time. There is deliberately no
position-distribution flag.

| Anomaly | Trigger | Surfaced as |
|---|---|---|
| Persistent deficit | Balance < −(1 quarter) for 2+ consecutive matches | Amber flag on player, shown at team-sheet build |
| Persistent surplus | Balance > +(1 quarter) for 2+ consecutive matches | Amber flag |
| Correction cluster | 3+ corrections in one match | Data-quality flag on the match |
| Short-handed match | Fewer available than `onFieldCount` | Match annotated; expected-time maths adjusts |

**Removed in this revision:** the "never-keeper" flag and any position-coverage
flag. Both would fight the coach's stated selection policy.

Flags are advisory. Nothing is auto-corrected — the coach decides, the app
informs.

## Carry-over rules

- Balances carry across matches within a season.
- Balances do not carry across seasons; a new season starts at zero.
- A player joining mid-season starts at zero and accrues `expectedMs` only from
  their first available match.
- A player leaving mid-season retains their record for audit but drops out of
  planning suggestions.

## Worked example

Squad of 10, 7-a-side (1 GK + 6 outfield), 4×10-minute quarters = 40 minutes.
One player keeps for the whole match.

- Outfield player-minutes available: `6 × 40 = 240`.
- Outfield-eligible available players: 9.
- `expectedMs` per available outfield player: `240 / 9 = 26.67` minutes.

If Sam plays 20 minutes — **regardless of which positions those minutes were
spent in** — his balance is `20 − 26.67 = −6.67` minutes. Next match he is top
of the most-owed list and the suggested schedule gives him roughly 33 minutes,
placed in his preferred positions.

The keeper accrues 40 GK minutes, 0 outfield minutes, and no `expectedMs` for
this match. Their fairness balance is unchanged.

The test suite encodes this example, plus: a part-time keeper, an odd squad size,
a mid-match absence, and an abandoned match.

## Open questions for Product Owner

1. Should the app flag a player keeping goal every week, or stay silent?
2. Is CSV / printable export needed for MVP?
3. Should there be a minimum minutes-per-match floor (e.g. "no player gets less
   than one quarter"), independent of the season balance?
