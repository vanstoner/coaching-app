# ADR-017: Data categories and audiences

**Status:** Accepted
**Date:** 2026-10-05
**Decision maker:** Architect, on the Product Owner's rulings of 2026-10-05 (#136 `approve 20a 20b 20c 20d`; #138 `approve 24, 25, 26`)

**Relationship:** refines [ADR-016](./016-charts-drawn-from-views.md) §3 (the
numbers module reads the gate's view). ADR-011, 013, 014 and 015 stand; the
ledger format does not change.

## Context

> *"The choice to use it should be deliberate by the coach and protection
> should be enshrined so it can be a walled off feature in future versions,
> i.e. if we create a parent distribution of the app that part of the ledger
> should not be accessible."* — Product Owner, 2026-10-05 (#136)

The ledger already holds individual performance, unwalled: each `goal`, `save`
and `conceded` event carries the `playerId` it is credited to (`LedgerEvent`,
`src/app/ledger.ts`). Verified on `main` at b31ff57, the raw `Ledger`, whose
`entries` are the whole chain, reaches four screens (`MinutesSection`,
`MatchSummaryScreen`, `MatchAnalysisScreen`, `SquadScreen`) and four lens
modules (`analysis`, `childSeason`, `attendance`, `outfieldTarget`) plus
`ledger.seasonRows`; `attendance.firstSeen` walks `entries`. The bundle cannot
tell Coaching Beta from Coaching App: `APP_VARIANT` reaches only
`app.config.js`, and `expo-constants` is not a direct dependency.

## Decision

1. **Every ledger field has exactly one category.** A record's tag and keys
   take its category. An event's `period` and `atMs` are individual
   performance: with the goalkeeper intervals they name who saved or conceded.

   | Category | Fields, by record type in `ledger.ts` `FIELDS` |
   |---|---|
   | Identity | `player`: all (`id`, `firstName`, `displaySuffix`, `active`) |
   | Participation | `interval`: all (minutes, positions); `attendance`: all |
   | Team | `squad`: all; `match`: all (opponent, competition, status…); `event`: `id`, `matchId`, `kind`, `refersTo`, `note` |
   | Individual performance | `event`: `playerId`, `period`, `atMs` |

   Team results (score, goals for and against, saves, clean sheets) fold from
   team fields alone, so the switch never touches them (ruling 26). The
   chain's own fields (`seq`, `prev`, `hash`…) are structure, not data.

2. **One gate: `src/app/ledgerGate.ts`** (pure TypeScript). Screens and lenses
   get a `LedgerView`, never a `Ledger`. A view is folded on every read from a
   ledger verified whole, and never stored (20a). It copies only categorised
   fields the audience may have, so a withheld field, a newer version's
   uncategorised field and `entries` are never handed over, not merely not
   drawn. It carries the one chain fact a lens needs, the first-seen order of
   players and matches, and is branded, since structural typing would accept
   a raw `Ledger`. Scope is *one match* or *across matches* (more than one,
   including a list of each match's scorers). The live match and its report
   read that one match from the working document: the coach, one match. Only
   the gate reads the ceiling (5) and the switch (6).

3. **Audiences.**

   | Audience | Identity | Participation | Team | Individual performance |
   |---|---|---|---|---|
   | Coach, one match | yes | yes | yes | yes: a moment, not a running total (20c) |
   | Coach, across matches | yes | yes | yes | only if the ceiling allows **and** the switch is on |
   | Share/export | yes | yes | yes | no, provisionally (question 1) |
   | Parent (future) | with #113 | with #113 | with #113 | never (20a) |

4. **The coach's own backup is not a share.** The minutes file stays the whole
   chain (only that verifies and extends on import, ADR-014 §8–9): the gate's
   `backupFile` makes it and `ledgerFile.ts` writes it. A share (a team sheet,
   a season summary) is a projection, never a ledger file, never importable.

5. **The ceiling (20b, 26): `src/app/performanceCeiling.ts`**, one line per
   distribution: whether the Performance section (team results, the switch)
   exists. `beta` yes, `app` no; a PR Rob approves changes a line. CI writes
   `src/app/generated-distribution.ts` from `APP_VARIANT` before bundling, as
   for the build label (#52), and asserts it. It is checked in as `app`, so a
   missed write only removes the feature. Team figures are no secret from the
   coach (the match report shows the score), so this is a release gate, not a
   wall. Parent's "never" is the gate's rule, not this file's.

6. **The per-child switch** (Settings, #138's design) is off by default,
   shown where the ceiling allows, and on only after an explanation and a
   confirm. Each on and off is appended with its date and time to a history in
   the working document's settings (optional, like #140's `buzzWhenSubDue`).
   The switch is the latest entry; no history reads as off. Not in the ledger.

7. **Guard tests**, in the gate's PR:
   - *Coverage:* any field in `FIELDS` without exactly one category fails.
   - *No raw reads:* a scan fails on a non-test import from `ledger.ts` (types
     too) outside `ledgerAnchor`, `ledgerStore`, `ledgerFile`, the writers
     `matchClosing` and `testSeason`, the gate and `App.tsx`. It pins
     `talliesOf` and `timeStream`, which name a child per event, to
     `analysis.matchReport` and `ClockScreen`.
   - *Never handed over:* no audience, distribution or switch state yields a
     withheld or uncategorised field, or `entries`, in a view.
   - *Ceiling:* Coaching App with a stored "on" gets no cross-match individual
     performance; parent gets none, whatever the file says.

## Consequences

**Invariants touched, none broken.** *1:* views and the switch state are folded
on read, never stored. *4:* identity is a category, so who sees first names is
decided; nothing personal is added. *3:* fairness lenses accept a view type
without individual performance, so it can never be a fairness input.

**Easier:** the parent wall exists before a parent app; no field ships without
a decision on who sees it; a Beta lens is promoted by one line. **Harder:**
four screens and five readers move to the view; Platform adds one generated
module; every new field brings its category.

**Not protected, honestly.** Once the coach shares the backup file, who reads
it is the coach's choice (ADR-011 §4), so its export screen should call it a
full copy for the coach's own phones. Categories wall fields, not arithmetic:
when one child keeps goal all match, the team's goals against are theirs.

**Forward path, v4 (#113).** The store and a parents' app read through the
gate. Parents get a projection made where the whole ledger is verified, never
the chain; the store gets IDs and stats with identity withheld, as #113
proposes. Parents' event streams are new record types, so they get categories
first. Leaving the phone still needs the hosting ADR and DPIA (ADR-011 §3).

**Not decided here.** Modes (dropped, 20d); which lenses exist (#138); what
parents see beyond "never individual performance" (#113); whether free-text
notes leave the coach (until ruled, no share or parent projection has them).
Two questions for Rob:

1. **What a share/export carries.** Recommend no individual performance, as
   for parents: a shared file usually reaches them, and the backup moves
   everything between the coach's phones. Reverse: one table line.
2. **The match report's keeper line** (each keeper's saves and goals conceded,
   #104). The ruling on designer question 4 names only scorers. Recommend it
   stays: 20c's "a moment from one match" covers it. Reverse: low.

## Alternatives considered

- **A screen flag that hides performance.** 20a: hidden is not withheld.
- **A separate performance ledger.** 20a keeps the ledger unchanged, and the
  score folds from the same events.
- **Categorising whole records.** Team results would then need the switch.
- **`expo-constants` or an `EXPO_PUBLIC_` variable.** The first is not a direct
  dependency; #52 found the second did nothing on the Gradle path that ships.
