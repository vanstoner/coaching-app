# ADR-008: Every event records who, where and when it was recorded

**Status:** Accepted
**Date:** 2026-09-17
**Decision maker:** Architect; approved by the Product Owner 2026-09-17 (#19)

## Context

The product's purpose includes dispute arbitration. Today no record says who
entered it, on which device, or when it was written as opposed to when the
thing happened on the pitch.

On one device with one coach this is implicit. The moment a second coach or a
second device exists — or a record is corrected — "who said so, and when?" is
the first question in any dispute, and it cannot be answered retrospectively.

Adding these fields later means a season of existing records has no provenance,
permanently.

## Decision

Every event (ADR-007) carries an envelope:

| Field | Meaning |
|---|---|
| `eventId` | UUID, generated on the device (already the convention) |
| `actorId` | The coach who recorded it. A local coach profile on single-device installs |
| `deviceId` | Stable per-install UUID |
| `recordedAt` | Wall-clock time the event was written. Audit only — never feeds minutes |
| `clockAnchorAt` | Wall-clock reading of the clock-owning device, present **only** on clock-anchoring events (`QuarterStarted`, `ClockPaused`, `ClockResumed`, `QuarterEnded`). Null everywhere else |
| `schemaVersion` | Event schema version, for replay across app versions |

### `recordedAt` vs `clockAnchorAt` (resolves the ADR-007/008/009 overlap)

These were conflated in the first draft, which left it unclear which timestamp
elapsed time is derived from. They are separate fields with separate jobs:

- **`clockAnchorAt`** is the anchor ADR-002 derives elapsed time from. It is an
  absolute wall-clock reading, and anchors are **the only absolute values that
  feed minutes**. Under ADR-009 every anchor in one match comes from the same
  device, so anchors are only ever subtracted from other anchors on the same
  clock.
- **`recordedAt`** is when the row was written. It never feeds a minute. A
  correction recorded on Tuesday for a Saturday match has a Tuesday
  `recordedAt` and no `clockAnchorAt` at all.

Everything downstream of an anchor — appearance durations, quarter elapsed,
total minutes — is **elapsed milliseconds**, not wall-clock. See ADR-009 §3.

**Coach identity is not child data** but is still personal data. `actorId`
refers to a coach profile holding a display name only. No coach email, phone or
account in the MVP.

IDs remain client-generated UUIDs. No autoincrement or sequence keys anywhere.

## Consequences

**Easier:**
- Corrections show who changed what, and when, alongside the original.
- A later multi-coach model needs no backfill.
- Replay across app versions is explicit rather than guessed.

**Harder:**
- A lightweight coach profile is needed at first run (a name). Small UX cost.
- Two timestamp fields instead of one. The alternative was ambiguity about which
  one minutes come from, which is worse.

**Accepted:**
- On a single-device install `deviceId` and `actorId` are constant. That is the
  point: they cost nothing now.

## Alternatives considered

**Add provenance when multi-coach arrives.** Rejected: existing records would be
permanently unattributed — the exact records most likely to be disputed.

**Track only `recordedAt`.** Cheaper, but does not distinguish two coaches or
two devices, which is the case that matters.
