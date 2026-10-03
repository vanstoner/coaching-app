# ADR-013: Player time lives in its own ledger, with a frozen format

**Status:** Accepted
**Date:** 2026-10-03
**Decision maker:** Architect; approved by the Product Owner 2026-10-03 (#75: `1A 2A 3A`)

## Context

> *"Whatever happens there, player time is what I want to keep hold of."*
> — Product Owner, 2026-10-03 (#74, note 4)

Player time lived only inside the working document (`coaching-app/session/v1`),
which also holds the squad, settings, fixtures and plans, is migrated on every
upgrade, and is the thing that will keep changing as the data model is
experimented with. Android backup is off (ADR-011). One lost or reset document
lost the season.

## Decision

1. **A separate minutes ledger** under its own storage key,
   `coaching-app/ledger/v1`, written alongside every save of the working
   document. Resetting, migrating or corrupting the working document cannot
   reach it.
2. **Intervals, never totals (1A).** It holds closed playing intervals: player,
   match, period, goalkeeper or outfield, start and end. Totals are folded on
   read (invariant 1). A file's `summary` is for people and is recomputed and
   compared on import, never trusted.
3. **It only accumulates.** Recording adds and updates by id and never removes,
   so a defect in the working document cannot take player time with it.
4. **A frozen, additive format.** `ledgerVersion` 1 is a contract: later
   versions may add optional fields only, and readers ignore what they do not
   know. A committed fixture (`src/app/fixtures/ledger-v1.json`, synthetic
   names) must load on every build.
5. **Export and import as a file (2A).** Export is explicit, through the
   Android share sheet, which ADR-011 §4 already permits. Import merges by id:
   new is added, identical is skipped, different is kept as it was and
   reported. Nothing is overwritten or deleted (invariant 5).
6. **First names travel in the file (3A).** The export screen says so.
7. **Forget everything clears it too.** That action is how a phone is handed
   on; children's data must not stay behind. The confirm text says to export
   first.

## Consequences

**Easier:** the data model can be reshaped freely; season fairness (#7) has a
base that survives it; a new phone gets the season back from one file.

**Harder:** two writes per save. Records are duplicated between the working
document and the ledger; the ledger is a copy of closed intervals, never the
source of a displayed match figure, so the two cannot disagree about a match
being played.

**Accepted:** `expo-file-system` and `expo-sharing` become dependencies. The
storage permissions they declare are already stripped by `blockedPermissions`
and the APK gate (#44) proves it.

## Alternatives considered

**Per-player totals per match (1B).** Smaller. Rejected: a stored total is the
derived-as-authoritative record ADR-007 forbids, and cannot be corrected.

**Text share and paste (2B).** No dependencies. Rejected: pasting 150 KB on a
phone is where this stops being used.
