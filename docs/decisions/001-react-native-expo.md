# ADR-001: React Native + Expo for cross-platform delivery

**Status:** Accepted
**Date:** 2026-09-17
**Decision maker:** Product Owner

## Context

The app must run on Android now, with a stated aspiration to run on iPhone
later. The Product Owner is technical (DevOps/platform specialism) but not a
full-time developer, and this is spare-time work. Time-to-running-on-device
matters for motivation and feedback.

## Decision

Build with React Native and Expo, in TypeScript with strict mode.

## Consequences

**Easier:**
- One codebase serves Android now and iOS later without a rewrite.
- Expo Go gives on-device testing without a native build toolchain.
- Large ecosystem; most problems are already solved.
- TypeScript makes the domain model self-documenting and refactor-safe.

**Harder:**
- Background timer behaviour needs care — addressed by ADR-002.
- Some native capabilities need Expo config plugins or a development build.
- A performance ceiling exists, though nothing in this app approaches it.

**Accepted:**
- The iOS aspiration is not committed. We avoid gratuitously Android-only
  choices but will not pay significant complexity cost for portability that may
  never be exercised. Trade-offs are flagged when they arise.

## Alternatives considered

**Kotlin + Jetpack Compose.** Best-in-class reliability for background timers
and foreground services. Rejected because iOS would mean a full rewrite in
Swift, contradicting the stated aspiration.

**Flutter.** Comparable cross-platform story and excellent performance. Rejected
on Dart being a less common language for the Product Owner to read and modify.

**Kotlin Multiplatform.** Strongest long-term architecture — shared logic,
native UI. Rejected as too much setup cost for an MVP built in spare time.
