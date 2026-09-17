# ADR-004: Fairness is measured on total playing time, not per position

**Status:** Accepted
**Date:** 2026-09-17
**Decision maker:** Product Owner

## Context

An initial draft of the fairness ledger measured equity partly per position, and
included anomaly flags for uneven position distribution (for example, a player
who had never kept goal).

The Product Owner corrected this:

> *"Fairness wasn't supposed to be per position, just total playing time. We are
> likely to lock players into certain positions or a couple of positions so
> their distribution will be higher into those affinities."*

This is decisive. Position assignment is **deliberate coach policy**, driven by
player affinity. A defender who never plays up front is not an anomaly — it is
the plan. Per-position fairness measurement would generate flags against the
coach's own selection decisions, training the coach to ignore the app's alerts.

A separate decision: goalkeeper minutes are excluded from the fairness measure
entirely, as the keeper is a specialist role and counting it as equivalent would
let outfield allocation be offset by time in goal.

## Decision

Fairness is measured on a single figure: **total outfield minutes, summed across
all positions.**

- Position is recorded on every Appearance and is reportable.
- Position is **never** an input to fairness arithmetic.
- **No** anomaly flag is ever raised on position distribution.
- Goalkeeper minutes are tracked separately and excluded from fairness.
- A player keeping for part of a match accrues expected time scaled to the
  portion they were outfield-eligible; a full-match keeper accrues none.

Position affinity exists as a first-class concept, constraining team-sheet
*suggestions* only: the planner meets a minutes target by adjusting **duration**,
never by moving a player out of their preferred position.

## Consequences

**Easier:**
- The fairness calculation is one number — simple to compute, explain and defend.
- No false alarms against deliberate selection policy.
- Arbitration conversations are about one figure, not a matrix.

**Harder:**
- The app cannot tell you whether position experience is being shared. Accepted
  deliberately: that is a coaching judgement, not an app judgement.

**Accepted:**
- Excluding GK from expected-minutes accrual means a full-match keeper's
  fairness balance is unchanged by that match. Without this, keepers would
  permanently appear owed large debts purely for keeping.

## Alternatives considered

**Per-position fairness.** Rejected by the Product Owner for the reasons above.

**GK counted as equivalent playing time.** Rejected: would allow a fairness debt
to be discharged by putting a player in goal.

**GK weighted partially (e.g. 50%).** Considered and not adopted. Adds a tuning
parameter with no principled value and complicates the explanation, which
matters when the figure must be defended to a parent.
