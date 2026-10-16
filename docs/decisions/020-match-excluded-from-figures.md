# ADR-020: A match can be left out of the figures, by a noted record in the ledger

**Status:** Accepted
**Date:** 2026-10-16
**Decision maker:** Architect, on the Product Owner's rulings of 2026-10-16 (#187: "Approve 1 but ensure it can be applied retrospectively")

**Relationship:** extends [ADR-014](./014-ledger-hash-chain.md) §3 (one more record type) and refines [ADR-015](./015-fairness-is-total-pitch-time.md) §6 (which matches count). Neither is changed; the ledger format version does not move.

## Context

> *"i want a way for matches e.g adhoc ones to have playing mins excluded from averages and totals"* — Product Owner, 2026-10-16 (#187)

> *"Approve 1 but ensure it can be applied retrospectively"* — Product Owner, 2026-10-16 (#187)

Today a match counts towards averages when it is `completed` (ADR-015 §6), and every other match's minutes still count in the season totals. A coach has no way to say "this one was a kick-about, leave it out", least of all after it has been played and recorded.

`recordMatches` writes each match's header from the working document on every save, so a flag stored on the `match` record would be overwritten by the next save of a match that has never heard of it.

## Decision

1. **A new record type, `exclusion`:** `{ matchId, excluded, note }`, keyed by `matchId` and latest wins, like attendance (ADR-014 §4). No record means the match counts, so every existing ledger reads exactly as before.
2. **Before the match,** a fixture carries `Match.excludeFromStats`. `recordMatches` writes the first `exclusion` record when the match first kicks off (note null) and never rewrites it from the working document afterwards.
3. **After kick-off, and for any match already in the ledger,** a change is `setMatchExcluded`: a new `exclusion` record with a mandatory note (invariant 5). The earlier record stays in the chain, so nothing is destroyed and un-marking is just another record. This is what makes it retrospective: it works on completed and abandoned matches alike.
4. **The effect is in the views, not in the record.** `isCounted` is `completed` and not excluded. `seasonStats` and `seasonRows` leave an excluded match out of averages, totals and games missed. `foldLedger` and the exported file's `summary` stay all-matches: they are the audit figure that is checked against the intervals on import, and no interval is ever removed (invariant 1).
5. **The squad views keep an excluded completed match in the grid and match-by-match** as `counted: false`, shown greyed. Averages, the squad average, trend, owed time and positions use only counted matches.
6. **No version bump.** An unknown record type is carried and hashed (#99 AC2). A build that predates this one would ignore the marking and count the match; one recording phone per match makes that acceptable.

## Consequences

- Season totals in the app can be lower than the `summary` in an exported file. That is intended and the file's summary says nothing about which matches a coach chose to count.
- A marking is a coach's choice, not a measurement, so it carries a note once the match has been played.
- Every consumer of "which matches count" goes through `isCounted`; a new one that filters on `status` alone would count an excluded match.
- This covers figures not yet written, in-play event totals across games included (PO, #187). `leftOutGuard.test.ts` fails the build if a source file compares a match's status to `'completed'` without `isExcluded`/`isCounted` on the line, unless the file is listed there as single-match with its reason.

## Alternatives considered

- **A field on the `match` record.** Overwritten by the next `recordMatches` unless that function is taught to read it back; a second source of truth.
- **A fifth competition type for ad hoc matches.** Overrides the PO's ruling that four values cover everything (#62), only covers that one case, and an older build would read it as "other" and count it. Not chosen.
- **Excluding a whole competition.** Too coarse: a league match is sometimes the odd one out. Not chosen.
- **Editing or removing the match's intervals.** Destructive; breaks invariants 1 and 5.
