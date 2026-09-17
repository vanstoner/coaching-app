# ADR-006: Build the spine sync-ready; do not build hosting yet

**Status:** Proposed
**Date:** 2026-09-17
**Decision maker:** Architect, awaiting Product Owner approval

## Context

The Product Owner has signalled a possible future in which data is hosted
online and several coaches share one dataset. Nothing is committed, but the PO
has said explicitly that a later move must not mean "refactoring hell".

This is in tension with the Architect charter, which names "gold-plating for
hypothetical scale" as an anti-pattern and describes the product as "a coaching
app for one squad, not a platform". It is also in tension with the current data
protection stance: "player data belongs on the device".

The match engine is at REQ-01. Nothing is persisted yet. The spine — how state
is recorded, identified and timed — is the part that is cheapest to shape now
and most expensive to change once a season of real data exists.

A move from single-device to shared data typically forces rework in four places:
identity (autoincrement keys collide), mutation (in-place updates cannot be
merged), provenance (no record of who or which device wrote what) and time
(each device's clock disagrees). Hosting infrastructure itself — servers, auth,
APIs — is comparatively easy to add later.

## Decision

1. **The app remains offline-first and single-device** for the MVP. No server,
   no account system, no network dependency.
2. **The domain spine is built so that sharing is additive, not a rewrite.**
   Specifically, the no-regret choices in ADR-007 (append-only events), ADR-008
   (provenance), ADR-009 (clock ownership) and ADR-010 (tenancy boundary) are
   adopted now.
3. **Anything that moves player data off the device is gated by ADR-011** and
   requires its own approved ADR before any build.
4. The Architect charter's "one squad, not a platform" line is to be read as
   "one squad *at a time* per device, designed not to preclude sharing". The
   charter is amended to say so if this ADR is accepted.

The test for each choice: *does it cost meaningful complexity today?* If yes, it
is deferred. If it is roughly free now and costly later, it is done now.

## Consequences

**Easier:**
- A later sync or hosted backend replays existing records rather than migrating
  a mutable schema.
- Multi-coach becomes a product decision rather than a technical rescue.

**Harder:**
- The engine's shape changes slightly before REQ-02 (see ADR-007). REQ-01 code
  will need a small rework; better now than after REQ-02–05 build on it.
- Every entity carries a few extra fields.

**Accepted:**
- Some fields (device, author) will be constant on a single-device install.
  That is the cost of not needing a migration later.

## Alternatives considered

**Do nothing until hosting is committed.** Cheapest now. Rejected: the rework
lands on the entities with a season of real, audit-critical data in them, which
is the worst moment to migrate.

**Build a hosted backend now.** Rejected: pays real cost (auth, GDPR controller
duties, availability, money) for a future that is not committed.

**Adopt a sync framework now (e.g. a CRDT or replicated database).** Rejected
for now: large dependency, and its conflict model may not respect the audit
invariants. Revisit when sharing is committed.
