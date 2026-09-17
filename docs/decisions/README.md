# Architecture Decision Records

Short, dated, immutable records of technical decisions.

**Immutable means immutable.** A decided ADR is never edited. If the decision
changes, write a new ADR that supersedes it and update the old one's status line
only. The historical record is the entire value — editing destroys it.

## When to write one

Write an ADR when the decision is:

- Hard or expensive to reverse, **or**
- Affects multiple components, **or**
- Someone will ask "why did we do it that way?" in six months

Routine choices don't need one. A library version bump doesn't; the choice of
state management does.

## Status values

| Status | Meaning |
|---|---|
| Proposed | Drafted, awaiting Product Owner approval |
| Accepted | Approved and in force |
| Superseded by ADR-NNN | Replaced; retained for the record |
| Rejected | Considered and declined, with reasoning |

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [001](./001-react-native-expo.md) | React Native + Expo for cross-platform | Accepted | 2026-09-17 |
| [002](./002-wall-clock-time-derivation.md) | Derive elapsed time from wall-clock anchors | Accepted | 2026-09-17 |
| [003](./003-intervals-as-source-of-truth.md) | Appearances as the source of truth for minutes | Superseded by [ADR-007](./007-append-only-match-event-log.md) | 2026-09-17 |
| [004](./004-fairness-is-position-independent.md) | Fairness measured on total time, not per position | Accepted | 2026-09-17 |
| [005](./005-deterministic-docs-build.md) | Documentation site built deterministically | Accepted | 2026-09-17 |
| [006](./006-sync-ready-not-hosted.md) | Build the spine sync-ready; do not build hosting yet | Accepted | 2026-09-17 |
| [007](./007-append-only-match-event-log.md) | Append-only event log; intervals are a checked projection | Accepted | 2026-09-17 |
| [008](./008-record-provenance.md) | Every event records who, where and when | Accepted | 2026-09-17 |
| [009](./009-single-clock-owner-per-match.md) | One device owns a match's clock | Accepted | 2026-09-17 |
| [010](./010-tenancy-boundary.md) | Squad is the data-ownership boundary | Accepted | 2026-09-17 |
| [011](./011-player-data-stays-on-device.md) | Player data stays on device until a hosting ADR is approved | Accepted | 2026-09-17 |

## Template

```markdown
# ADR-NNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-NNN | Rejected
**Date:** YYYY-MM-DD
**Decision maker:** Role, approved by Product Owner

## Context
What situation forces a decision? What constraints apply?

## Decision
What we will do, stated plainly.

## Consequences
What becomes easier. What becomes harder. What we accept.

## Alternatives considered
What else was on the table, and why it lost.
```
