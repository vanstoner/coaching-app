# ADR-002: Derive elapsed time from wall-clock anchors

**Status:** Accepted
**Date:** 2026-09-17
**Decision maker:** Architect, approved by Product Owner

## Context

The match clock is the foundation of every figure the app produces. The Product
Owner has specified that the clock runs continuously within a quarter, stopping
only at quarter end, because stopping it reliably at in-play stoppages is not
realistic on the touchline.

Android aggressively throttles or suspends JavaScript timers when an app is
backgrounded or the screen locks. Both will happen during a match — a coach puts
the phone in a pocket, or the screen times out.

If elapsed time were counted by incrementing on timer callbacks, suspended
callbacks would silently lose time. The loss would be invisible, unrecoverable,
and would corrupt the fairness ledger the app exists to provide.

## Decision

Elapsed time is **always derived** from stored wall-clock timestamps:

```
elapsedMs = accumulatedMs + (running ? now() - runningSinceWallClock : 0)
```

Timer callbacks drive **display refresh only**. No callback ever increments an
authoritative value. Tick counting is forbidden anywhere in the codebase.

## Consequences

**Easier:**
- Time survives backgrounding, screen lock and process death with zero loss.
- Crash recovery is trivial: re-read the anchor and recompute.
- The engine becomes testable without a device — pass in a clock function.

**Harder:**
- Every read computes rather than looking up a counter. Negligible at this scale.
- Device clock changes mid-match would distort elapsed time. Accepted: it is
  rare, and detectable as an implausible jump if we later choose to guard it.

**Accepted:**
- Display may lag the true value by up to one refresh interval. Cosmetic only —
  the authoritative value is correct at every read.

## Alternatives considered

**Tick counting with a background task.** Rejected: fragile across Android
versions and OEM battery optimisations, and fails silently — the worst property
for a value underpinning dispute arbitration.

**Foreground service to keep timers alive.** Viable on Android, no equivalent on
iOS, and unnecessary once time is derived rather than counted.
