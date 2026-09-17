# Delivery slices — the route to something that runs

**Status:** Accepted
**Date:** 2026-09-17
**Decision maker:** Product Owner, this session

## Why this document exists

The Product Owner opened the 2026-09-17 session with a challenge:

> "I want to ensure we're not deviating from a thin slice goal, we've spent a lot
> of time on 'the spine' but not necessarily much moving towards production."

Measured from the working tree at `9311af9`, that challenge was correct:

| | |
|---|---|
| Documentation (specs, ADRs, process) | 4 245 lines |
| Production code (engine + types) | 599 lines |
| App code | **0 lines** |
| CI workflows | **0** |
| Runnable artifact | **none** |

`package.json` declared no runtime dependencies. There was no `App.tsx`, no
`app.json`, no React Native and no Expo. TECH-01 (#11), the project scaffold, had
been open since the issues were first created and never started.

This document records the route out, so that sequencing is a decision with a home
rather than a preference re-argued each session.

## The six stages to a phone

Nothing useful happens until the app runs on the Product Owner's hardware. Six
stages separate source from that, and each needs the one before it:

| # | Stage | State at 2026-09-17 |
|---|---|---|
| 1 | Pure match engine | **Complete** — 438 lines, 66 passing tests |
| 2 | Expo scaffold | Not started (TECH-01, #11) |
| 3 | Boots in an emulator | Blocked on 2 |
| 4 | CI builds an APK | Blocked on 2 |
| 5 | Installed on a real phone | Blocked on 4 |
| 6 | Used at a real match | Blocked on 5 |

## The slices

### Slice 0 — Walking skeleton

Deliberately almost featureless. Its job is to prove every stage from source to
the coach's hand, not to be useful.

- Expo + TypeScript scaffold (TECH-01, #11)
- **One screen**: squad name, a running match clock, start / end quarter
- That clock wired to the **real engine**, so the engine is proven on a device
- GitHub Actions → debug APK published as a workflow artifact
- Android auto-backup disabled (ADR-011 clause 2, which names TECH-01 as its home)

**Output: an APK that installs.**

### Slice 1 — The useful bit

What the Product Owner actually described wanting.

- Enter a squad, first names only (REQ-09, #9 — minimal)
- Pick who is on the pitch and who is on the bench
- **Sub-due alerting (REQ-04, #4)** — the point of the app
- Quarter-end prompt, margin and notification (spec 02, already ruled)
- Survives backgrounding and a forgotten clock

**Output: usable at a real match.**

### Slice 2 — Fairness over time

Why the spine was built.

- Minutes per player per match (REQ-03, #3)
- Season fairness ledger (REQ-07, #7)
- Positions and affinity (REQ-02 #2, REQ-10 #10)
- Whatever REQ-08 turns out to be (#8, pending the ruling on #36)

**Output: the season story.**

## Sequencing ruling (2026-09-17)

**The ADR-007 engine reshape (#35) goes first, before Slice 0.**

This was the Product Owner's explicit ruling, and it follows
[ADR-007](../decisions/007-append-only-match-event-log.md) literally: the reshape
lands *before* REQ-02–05 build on the current engine shape.

The alternative put to the PO — Slice 0 first, on the grounds that the scaffold
and CI touch no engine code and therefore cost the reshape nothing — was
**considered and rejected**. Recorded here so it is not re-argued:

- **Accepted cost:** a runnable APK is two units of work away rather than one.
- **Accepted benefit:** no UI is ever written against an engine shape ADR-007 has
  already ruled against, so the reshape never has to be done twice.

Order of work from here:

1. **CI test gate** (this document's own change) — see below
2. **#35** — engine reshape to the append-only event log
3. **Slice 0** — scaffold, APK pipeline, clock on screen
4. **Slice 1**, then **Slice 2**

## Build path ruling (2026-09-17)

**GitHub Actions + Gradle**, not EAS Build.

`expo prebuild` followed by `gradle assembleDebug` in GitHub Actions, with the
APK uploaded as a workflow artifact to download and sideload.

- **Why:** no external account, no build-minute limits, fully self-contained. It
  is a real CI/CD pipeline rather than a hosted build service.
- **Rejected:** EAS Build (easier and official, but adds an Expo account
  dependency and free-tier queues); Expo Go only (fastest feedback, but it is
  neither an APK nor a pipeline).

This lands in Slice 0. The test gate below is **not** it.

## The CI test gate (landed ahead of the reshape)

Before this change nothing ran the tests except Claude pasting terminal output
into a pull request. The operating model's rule that **"PRs carry evidence"** was
therefore enforced by hand, on trust.

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

1. `npm ci` — exact install from the committed lockfile
2. `npx vitest run`
3. `npx tsc --noEmit`
4. `python3 docs/process/validate-docs.py`

The PO ruled this in alongside the reshape. It is landed **before** the reshape
pull request rather than inside it, because a gate that arrives in the same PR
cannot guard that PR's own review — and the reshape is the largest engine rewrite
the project has attempted, rewriting all 66 tests.

Pasted evidence in PR bodies stays the convention; it is now corroborated by a
run rather than trusted.

## What this document does not change

- The five invariants in `CLAUDE.md`. Slicing is about order of delivery, not
  about weakening guarantees.
- The proportionality ruling (ADR-009): seconds-level accuracy is sufficient, and
  surviving a forgotten clock matters more than refining precision.
- Approval gates. Each slice still lands through pull requests the PO approves.

## Changelog

| Date | Change | Source |
|---|---|---|
| 2026-09-17 | Created. Six stages, three slices, sequencing ruling (#35 before Slice 0), build path ruling (Actions + Gradle), CI test gate landed ahead of the reshape. | PO rulings, 2026-09-17 session |
