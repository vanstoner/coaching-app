# ADR-009: One device owns a match's clock

**Status:** Accepted
**Date:** 2026-09-17
**Decision maker:** Architect; approved by the Product Owner 2026-09-17 (#19)

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
3. **Anchors are absolute; everything derived from them is elapsed.** A
   clock-anchoring event carries `clockAnchorAt` (ADR-008) — an absolute
   wall-clock reading from the owning device. Anchors are the only absolute
   values that feed minutes. Every fact derived from them — appearance
   durations, quarter elapsed, total minutes — is stored as **elapsed
   milliseconds**, never as wall-clock. `recordedAt` (ADR-008) is audit only
   and never feeds a minute.
4. In the MVP this is trivially true and costs nothing. The rule exists so that
   a future sharing feature has to hand over ownership explicitly rather than
   let two devices write concurrently.

Post-match corrections are not time-anchored and may come from any device.

### Proportionality (Product Owner, 2026-09-17, #19)

This ADR is accepted as a **cheap structural constraint, not an accuracy
programme**. The PO's steer, recorded because it governs how the rules above
are implemented and how far they may be taken:

> "we're not building a share trading app here, approx. times aren't going to
> cause major harm and I am not trying to audit a match, I just want something
> that reminds me to put a substitute on, alerts me if a match is running
> really weirdly and that doesn't die in a heap if I forget to stop the clock"

Consequences for implementation:

- **Seconds-level accuracy is sufficient.** No sub-second correctness work, no
  clock-drift compensation, no monotonic-clock plumbing. Do not spend
  complexity buying precision past this bar.
- **Robustness beats precision.** A forgotten clock must degrade gracefully —
  this is a higher priority than any accuracy refinement.
- **The value of one device owning the clock is that it is free**, not that it
  is precise. It costs nothing in the MVP and stops a future sharing feature
  silently corrupting the ledger. That, and only that, is why it is accepted.

This does not weaken invariants 1–5 in `CLAUDE.md`. Those are about the figure
and the audit trail being *incapable of disagreeing*, which is a structural
property, not a precision target. A ledger can be internally consistent to the
millisecond and still be anchored to a clock the coach started ten seconds
late — and that is fine.

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
