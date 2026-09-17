# ADR-011: Player data stays on device until a hosting ADR is approved

**Status:** Accepted
**Date:** 2026-09-17
**Decision maker:** Architect; approved by the Product Owner 2026-09-17 (#19)

## Context

The app holds children's data. It is minimised (first names only) but still
personal data under UK GDPR, and minutes played linked to a named child is not
trivial — it touches selection, which parents care about.

On-device only, the coach is effectively the sole holder and the app developer
processes nothing. Hosting changes that fundamentally: the operator becomes a
controller or processor, with duties around lawful basis, security, retention,
breach notification and data subject rights. Parental consent questions arise.
Cloud backups (e.g. Android auto-backup to the user's Google account) are a
quieter version of the same move.

These are product, legal and cost questions as much as technical ones, and they
should not be answered implicitly by a technical convenience such as enabling a
sync library or leaving OS backup on.

## Decision

1. **All player data remains on the device** in the MVP.
2. **Android auto-backup is disabled for app data** unless and until this ADR
   is superseded. (Confirm during TECH-01 scaffold.)
3. **Any feature that moves player data off the device** — sync, hosted
   database, cloud backup, analytics that include player fields, crash reports
   with state dumps — requires a new ADR approved by the Product Owner, and that
   ADR must include a data protection impact assessment.
4. **Export** is permitted as an explicit, user-initiated action (coach chooses
   to share a file), since the coach then controls the destination.
5. Real squad data is never committed to the repository (existing rule,
   restated because it applies to test fixtures and crash logs too).

## Consequences

**Easier:**
- No controller obligations for the developer in the MVP.
- ADR-006's sync-ready spine can be built without accidentally going live.

**Harder:**
- Losing the phone loses the data. Mitigated by explicit export. Accepted for
  MVP; worth stating to the coach in-app.

**Accepted:**
- Multi-coach sharing is blocked on a future ADR plus DPIA. Deliberately.

## Alternatives considered

**Allow OS cloud backup by default.** Convenient. Rejected: silently moves
children's data to a third party with no decision recorded.

**Decide hosting approach now.** Rejected: premature; the scenario (ADR-010
open question) and appetite for controller duties are not yet known.
