# Coaching App

A junior football coaching app for Android (iOS later): squad management, match
clock, position tracking, substitutions with alerts, and season-long fair play
time with an audit trail.

**Start here → [`docs/README.md`](./docs/README.md)**

## Status

Specs are approved before feature implementation begins. Slice 0a — the walking
skeleton — is the first application code: an Expo scaffold, one static screen,
and a CI pipeline that produces a sideloadable debug APK. See
[`docs/process/delivery-slices.md`](./docs/process/delivery-slices.md).

| Area | Status |
|---|---|
| Domain model | Spec drafted, awaiting approval |
| Match engine | Spec drafted, awaiting approval; pure-TypeScript engine in `src/engine/` |
| Fairness ledger | Spec drafted, awaiting approval |
| Squad roles & process | Defined |
| App scaffold (Slice 0a) | Static screen, APK pipeline |
| Clock wired to the engine (Slice 0b) | Not started |

## The five things that must stay true

1. Minutes are derived from intervals, never stored as running totals.
2. Elapsed time comes from wall-clock anchors, never tick counting.
3. Fairness is total playing time, never per position.
4. First names only. No PII.
5. Corrections are explicit, noted, and never destructive.

Each is recorded as an ADR in [`docs/decisions/`](./docs/decisions/).

## Build and run

Requires Node 22, a JDK (17) and the Android SDK. From a fresh clone:

```bash
npm ci && npm run apk
```

That runs `expo prebuild` and Gradle `assembleDebug`, leaving a sideloadable
debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`. The same two
steps run in the `Android APK` GitHub Actions workflow, which publishes the APK
as a downloadable artifact; that workflow can also be started by hand from the
Actions tab.

**`android/` and `ios/` are generated, never committed.** `expo prebuild`
recreates them, and `.gitignore` blocks them. This is not tidiness: it keeps
`app.json` the single source of truth for the Android manifest, so
[ADR-011](./docs/decisions/011-player-data-stays-on-device.md)'s
`allowBackup=false` cannot be contradicted by a stale committed manifest.

`npm start` runs the Expo dev server for day-to-day work.

## Data protection

This app handles children's participation data. First names only; no surnames,
dates of birth, contact details or photographs. **Real squad data must never be
committed to this repository** — `.gitignore` guards common patterns, but the
rule is the important part.

App data is device-local and is **not** backed up: Android auto-backup is
disabled in `app.json`, and the CI build asserts `allowBackup=false` against the
built APK. See
[ADR-011](./docs/decisions/011-player-data-stays-on-device.md).

## Validate the docs

```bash
python3 docs/process/validate-docs.py
```

Checks that internal links resolve, ADRs are well-formed, and no spec has been
sitting in Draft too long. Exits non-zero on failure, so it can gate CI.
