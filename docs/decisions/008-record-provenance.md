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

### First run adopts the `actorId` already in use; it never mints a fresh one (#39)

`actorId` is a command input — the engine rejects `MISSING_RECORDING_CONTEXT`
rather than inventing one. But a coach profile is created at first run, and
until it exists there is a window in which events can be written with an
`actorId` that no profile explains.

**If first run mints a new `actorId` for the new profile, every event written
before that point is orphaned** — attributed to an id belonging to no profile,
unresolvable, permanently. That is the same backfill loss this ADR exists to
prevent, reached by another road, and it cannot be repaired afterwards.

So, binding on whoever builds first run:

- the install generates a stable `actorId` and `deviceId` on first launch,
  **before any event can be written**, and the profile created later attaches
  its display name to that existing id; **or**
- no event may be written until a profile exists, so no window opens.

The first fits a flow where a screen exists before any profile UI does, which
is the likelier shape here. Either is acceptable; minting a second id is not.

**Nothing is broken today** — no event log exists yet, so no event has ever
been written. The window opens with the first persisted event, which is also
when the schema freezes (#35). Both deadlines fall on the same merge.

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
