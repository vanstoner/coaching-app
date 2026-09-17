# ADR-007: Engine records an append-only event log; intervals are a checked projection

**Status:** Proposed
**Date:** 2026-09-17
**Decision maker:** Architect, awaiting Product Owner approval

**Relationship:** Refines [ADR-003](./003-intervals-as-source-of-truth.md). If
accepted, ADR-003 is superseded by a restated version that keeps its guarantees
and names events as the persisted record.

## Context

The REQ-01 engine mutates state in place: `startQuarter` and `endQuarter` edit
`Quarter` fields and set `endElapsedMs` on open Appearances. `Quarter` also
persists `accumulatedMs`, a running value.

In-place mutation has three problems for the spine:

- **Audit.** An Appearance's `endElapsedMs` is written after creation. The
  record shows the current value, not how it got there. "Append-only" in
  ADR-003 is only true at row level, not at field level.
- **Sharing.** Two devices that each edit a row cannot be merged without
  guessing. Two devices that each append facts can be.
- **Defects.** DEF-001 (#13) was a wrong value written into a record. With
  intervals derived from events, the fix corrects every historical figure on
  replay. With stored end times, historical rows stay wrong unless migrated.

ADR-003 rejected "event log without closed intervals" because raw events have no
checkable invariants. That reasoning still holds and is kept.

## Decision

1. **The persisted record is an append-only log of match events**, e.g.
   `MatchCreated`, `QuarterStarted`, `ClockPaused`, `ClockResumed`,
   `QuarterEnded`, `PlayerSubstituted`, `PositionChanged`, `IntervalCorrected`.
   Events are never updated or deleted.
2. **Appearances, BenchStints and quarter elapsed time are projections** — pure
   folds over the event log. They keep every invariant ADR-003 established
   (quarter sums, one-place-per-player), asserted on every fold.
3. **Engine commands are pure functions:** `(state, command, clock) → events[]`
   or a rejection. The engine does not mutate its input. Applying events to
   state is a separate pure reducer.
4. **Corrections are events** that reference the event they correct and carry a
   mandatory note (invariant 5). The original event remains.
5. **Derived values are never persisted.** `Quarter.accumulatedMs` and
   `elapsedMs` become computed from `QuarterStarted` / `ClockPaused` /
   `ClockResumed` / `QuarterEnded` timestamps. ADR-002 (wall-clock anchors) is
   unchanged in substance — the anchors simply live in events.

## Consequences

**Easier:**
- Invariant 1 strengthens: every minute traces to timestamped facts, not just
  to intervals.
- Invariant 5 becomes structural rather than conventional.
- Defect fixes in derivation logic repair history on replay.
- Sync later means exchanging events, which merge by union.
- Tests become "given these events, expect this projection" — very direct.

**Harder:**
- REQ-01 engine needs reshaping before REQ-02 builds on it.
- Event schemas need versioning discipline (an event written in season one must
  still replay in season three).
- Read performance relies on folding. At a few thousand events per season this
  is negligible; snapshots can be added if ever needed.

**Accepted:**
- Two representations (events and projections) to understand instead of one.

## Alternatives considered

**Keep mutable intervals (status quo).** Simplest. Rejected: weakest audit
story, no clean merge path, and defects persist in stored data.

**Full event sourcing framework / library.** Rejected: adds dependency and
concepts beyond need. A typed union of events and a reducer is sufficient.

**Raw event log with no interval projection.** Rejected for the reason ADR-003
gave: loses checkable invariants.
