# ADR-009: One device owns a match's clock

**Status:** Proposed
**Date:** 2026-09-17
**Decision maker:** Architect, awaiting Product Owner approval

**Relationship:** Extends [ADR-002](./002-wall-clock-time-derivation.md), which
accepted device clock changes as rare on a single device. That acceptance does
not hold across devices.

## Context

ADR-002 derives elapsed time from wall-clock anchors on one device. If two
devices ever record events for the same live match, their clocks will disagree
— often by seconds, sometimes by minutes. Elapsed time computed from anchors
written by different devices would then be wrong in ways no invariant catches,
and the fairness ledger would absorb the error silently.

This is the most likely place for a future multi-coach feature to corrupt data.

## Decision

1. **A live match has exactly one clock-owning device.** Only that device may
   record time-anchored events (`QuarterStarted`, `ClockPaused`,
   `ClockResumed`, `QuarterEnded`, substitutions, position changes) during play.
2. **All elapsed-time arithmetic uses anchors from a single device.** Anchors
   from different devices are never subtracted from each other.
3. **Match-time facts are stored as elapsed milliseconds** (relative to the
   owner's anchors), not as absolute wall-clock times, wherever they feed
   minutes. Absolute `recordedAt` (ADR-008) is for audit only.
4. In the MVP this is trivially true and costs nothing. The rule exists so that
   a future sharing feature has to hand over ownership explicitly rather than
   let two devices write concurrently.

Post-match corrections are not time-anchored and may come from any device.

## Consequences

**Easier:**
- Clock skew between devices cannot distort minutes, by construction.
- A future "assistant coach view" is read-only during play — simple to build.

**Harder:**
- A future feature where two coaches both record live subs needs an ownership
  handover design. Deliberately so.

**Accepted:**
- Live co-recording by two devices is ruled out until a superseding ADR.

## Alternatives considered

**Server time as authority.** Rejected: requires connectivity on a touchline,
contradicting offline-first.

**Clock-offset estimation between devices.** Rejected: complex, imprecise, and
failure is silent — the worst property for this data.
