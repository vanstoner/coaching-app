# ADR-008: Every event records who, where and when it was recorded

**Status:** Proposed
**Date:** 2026-09-17
**Decision maker:** Architect, awaiting Product Owner approval

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
| `recordedAt` | Wall-clock time the event was written |
| `schemaVersion` | Event schema version, for replay across app versions |

`recordedAt` is distinct from match-time fields inside the event (e.g. the
elapsed time a substitution took effect). A correction recorded on Tuesday for a
Saturday match has both.

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

**Accepted:**
- On a single-device install `deviceId` and `actorId` are constant. That is the
  point: they cost nothing now.

## Alternatives considered

**Add provenance when multi-coach arrives.** Rejected: existing records would be
permanently unattributed — the exact records most likely to be disputed.

**Track only `recordedAt`.** Cheaper, but does not distinguish two coaches or
two devices, which is the case that matters.
