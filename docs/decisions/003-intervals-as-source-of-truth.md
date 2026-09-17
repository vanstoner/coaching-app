# ADR-003: Appearances are the source of truth for minutes

**Status:** Accepted
**Date:** 2026-09-17
**Decision maker:** Architect, approved by Product Owner

## Context

The Product Owner requires that playing-time data support *"fairness and dispute
arbitration"* — meaning a parent may challenge how much their child played, and
the record must withstand that.

A running total per player is the obvious implementation. It is also
indefensible: if a total and the events behind it ever disagree, there is no way
to tell which is right.

## Decision

The **Appearance** — one player, one position, one continuous interval, with
start and end elapsed times — is the atomic unit of record. It is append-only.

**All** minute figures are derived by folding Appearances. No running total is
ever stored as authoritative.

Bench time is recorded explicitly as BenchStints rather than inferred by
subtraction, so that a gap surfaces as a broken invariant rather than being
silently absorbed.

Corrections are explicit: they set a flag, require a note, and preserve the
original values.

## Consequences

**Easier:**
- The displayed figure and the audit trail cannot disagree, by construction.
- Any total can be explained by listing the intervals behind it.
- Invariants become checkable: quarter durations must sum exactly; every player
  must be in exactly one of an Appearance or a BenchStint at all times.
- The later match-events feature attaches to the same elapsed-time spine with no
  migration.

**Harder:**
- Slightly more storage. Irrelevant at this scale — a season is a few thousand rows.
- Totals must be computed rather than read. Cheap, and cacheable if ever needed.
- More entities to reason about than a simple counter.

**Accepted:**
- Deriving on every read is the cost of a defensible audit trail. Worth it.

## Alternatives considered

**Running totals per player.** Simpler and faster. Rejected: unauditable, and
cannot survive a challenge — which is the requirement.

**Event log without closed intervals.** More flexible, but every query becomes a
fold over raw events with no invariants to check against. Closed intervals give
us checkable guarantees.
