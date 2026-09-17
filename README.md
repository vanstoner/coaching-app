# Coaching App

A junior football coaching app for Android (iOS later): squad management, match
clock, position tracking, substitutions with alerts, and season-long fair play
time with an audit trail.

**Start here → [`docs/README.md`](./docs/README.md)**

## Status

Specification phase. No application code yet — deliberately. Specs are approved
before implementation begins.

| Area | Status |
|---|---|
| Domain model | Spec drafted, awaiting approval |
| Match engine | Spec drafted, awaiting approval |
| Fairness ledger | Spec drafted, awaiting approval |
| Squad roles & process | Defined |
| Implementation | Not started |

## The five things that must stay true

1. Minutes are derived from intervals, never stored as running totals.
2. Elapsed time comes from wall-clock anchors, never tick counting.
3. Fairness is total playing time, never per position.
4. First names only. No PII.
5. Corrections are explicit, noted, and never destructive.

Each is recorded as an ADR in [`docs/decisions/`](./docs/decisions/).

## Data protection

This app handles children's participation data. First names only; no surnames,
dates of birth, contact details or photographs. **Real squad data must never be
committed to this repository** — `.gitignore` guards common patterns, but the
rule is the important part.

## Validate the docs

```bash
python3 docs/process/validate-docs.py
```

Checks that internal links resolve, ADRs are well-formed, and no spec has been
sitting in Draft too long. Exits non-zero on failure, so it can gate CI.
