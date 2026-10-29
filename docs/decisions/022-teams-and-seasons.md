# ADR-022: Teams are key prefixes, seasons live in each team's record, and ADR-007 is superseded

**Status:** Accepted (Rob, 26 Oct: "Accept and go with all recommendations")
**Built:** in 2.0.0 (#248), with five points where the build departs from or
adds to the text below, each ruled or flagged there:
- **D3 step 1 is replaced by #224 AC6** (Rob, 26 Oct, Dee's T4): a fresh
  install has no team until the coach names one. The demo and the store
  screenshots still get a first team, for their made-up season.
- **The first season has a fixed id, `first-season`** (D5): a match whose
  fixture names no season belongs to it, with or without a `season` record,
  so no default is written for the coach. The current season is the latest
  started after it.
- **#243 AC8 is its own record, `format-count`** (Rob's ruling 8A), never a
  new meaning for `exclusion`.
- **"Season by play"** (Rob, 27 Oct): starting a season moves every fixture
  still to be played into it, written in the same entry. Membership is still
  read from the fixture, never a date; a match counts in the season it is
  played in.
- **D4's backup is version 2**, `{ teams: [{ id, removed, session, ledger }] }`;
  1.x refuses it as newer. Beyond the text: a damaged index is rebuilt from
  the teams' own keys, and a key found at the root after the move is set
  aside, never copied over the team.
**Date:** 2026-10-25
**Decision maker:** Architect, for the Product Owner's ruling (#224, #243; #239 S1 and S4)

**Rulings.** Rob, 26 Oct, `Approve all 8`: **D1 approved**, and **Q1 and Q2
approved as recommended**. Quinn's check of D1 found
[#244](https://github.com/vanstoner/coaching-app/issues/244). Rob then
**accepted the ADR** the same day, with #244 tracked as a defect to fix as D1
says: a recorded match's summary reads the record.

**Relationship:** **Supersedes [ADR-007](./007-append-only-match-event-log.md)**
(D1). Implements [ADR-010](./010-tenancy-boundary.md) (a team is
the squad it already names as the ownership unit). Extends
[ADR-021](./021-the-record-of-truth.md) D2 with one record type and one
optional field, inside its D1 "additive only" rule. Answers
[ADR-018](./018-session-and-ledger-in-asyncstorage.md)'s revisit point: **no**
(D7). [ADR-011](./011-player-data-stays-on-device.md),
[ADR-015](./015-fairness-is-total-pitch-time.md) and
[ADR-017](./017-data-categories-and-audiences.md) stand. **The lens ADR**
(#241, amending ADR-015 and invariant 3) comes later and depends on D5's
season record; this ADR gives the lens fields a home and defines none of
their meaning.

## Context

Rob wants one coach to run several squads, switched like browser profiles
(#224), each with seasons that carry a main format, age group, competition
level and fairness lens (#243; #241, ruled `approve 241 Q1-Q7`). #239 asked
this ADR to decide S1 (ADR-007 and invariant 1) and adopt S4 (minimal
restructure). Proportionality: one coach, a handful of teams.

Verified on `main` at `d8788ea` (this branch differs from it in docs only):

- **Keys.** Six AsyncStorage keys plus set-aside prefixes, all under
  `coaching-app/`: `session/v1` (`persistence.ts:238`), `ledger/v2`,
  `ledger/head`, `ledger/v1` (`ledgerStore.ts:24,29,31`), `table-sort/v1`
  (`tableSort.ts:333`), `getting-started/v1` (`gettingStarted.ts:61`),
  `test-clock/v1` (`testKit.ts:114`); asides under `session/v1/unreadable/`
  (`sessionStore.ts:37`), `ledger/v2/unreadable/` (`ledgerStore.ts:73`) and
  `before-restore/` (`phoneBackup.ts:27`).
- **Who touches the store.** `persistence`, `sessionStore`, `ledgerStore`,
  `phoneBackup` and `forget` write keys; so do `App.tsx:451,1836-1847`
  (test clock, Getting started) and a screen, `src/screens/TableSort.tsx:59,74`.
  #224's "screens never touch storage" is not quite true. `ledger.ts:87`
  (`LEDGER_ID = 'coaching-app/minutes'`) is a file marker, not a key. Every
  one of them receives the store from the shell (`App.tsx:280`).
- **The queue.** `inTurn` serialises work per store object, through a
  `WeakMap` (`persistence.ts:755-761`).
- **Forget everything** lists the store and removes every `coaching-app/` key
  but the test clock (`forget.ts:40-60`).
- **The signing key** is in the secure store under `coaching-app.device-key.v1`,
  not AsyncStorage (`deviceKey.ts:20`). A chain publishes its own `device`
  record (`entrySigning.ts:75-77`), so each team's chain can publish the same key.
- **`squadId` is not stable.** It is made at launch (`App.tsx:324`) and
  replaced by a restore from the record (`App.tsx:675`). It cannot be a team id.
- **Backup.** `BACKUP_VERSION = 1`. A file with a higher version is refused
  with "made by a newer version" (`phoneBackup.ts:24,109-111`).
- **No downgrade.** `versionCode` is the Actions run number
  (`android-apk.yml:260`), and Android refuses a lower one over a newer
  install, so a phone cannot go back to 1.x and keep its data.
- **Size.** `release-1.2.0/store.json` holds a 196,046-byte session and a
  127,960-byte ledger for 11 matches. AsyncStorage 3.1.1's Android source sets
  no maximum database size.
- **Released data.** `releaseUpgrade.test.ts` loads each `release-*` store
  through the normal launch path and compares figures. The manifest covers
  1.0.0 to 1.2.0. **1.3.0, the build on Rob's phone, is not frozen yet.**
- **Seasons.** `Season` and `PlayerSeasonTotals` (`src/types/index.ts:348-366`)
  are unused. ADR-015 §6a picks the dominating side (`analysis.ts:394`).
- **S1 facts.** The engine changes state in place: `endQuarter` writes
  `accumulatedMs` and closes Appearances (`MatchEngine.ts:544-558`). The
  session saves Appearances (`persistence.ts:253`). Every save records the
  closed intervals into the hash-chained ledger, idempotently by Appearance id
  (`App.tsx:607-608`, `ledger.ts:98`, `recordMatches` at `ledger.ts:830`).
  Season figures fold from the ledger (`seasonStats`, `analysis.ts:580`). The
  match summary folds one match from the session (`MatchSummaryScreen.tsx:166`).

## Decision

**D1 (S1). Supersede ADR-007. Invariant 1 rests on the record of truth.**

ADR-007 was accepted on 17 September to reshape the engine before storage
depended on it. Storage then grew around the engine as it is: the hash-chained
ledger (ADR-013, 014) and the record of truth (ADR-021). These already give
invariant 1 what ADR-007 promised. Every minute shown for a season folds from
append-only, hash-chained interval records. A correction is a new, noted
record (invariant 5). Nothing derived is stored as truth (ADR-021 rejected
even a `pristine` flag). What ADR-007 adds beyond that is field-level
append-only *inside a match still being played*, plus a pure command engine.
That would mean reshaping `MatchEngine` and a 2,436-line shell for a guarantee
no coach can see. It is precision past the PO's bar.

- **Invariant 1 is restated in `CLAUDE.md`** as: *"Minutes fold from the record;
  nothing derived is stored as authoritative. The displayed figure and the
  audit trail must be incapable of disagreeing (ADR-022 D1; the record is
  ADR-013, 014, 021)."* That edit is part of approving this ADR.
- **The working copy is not the record.** The session's Appearances and
  `Quarter.accumulatedMs` are the in-match working copy. `accumulatedMs` is a
  frozen wall-clock anchor written on pause and end, never in a tick
  (invariant 2), and it is not a total.
- **Disagreement is a defect.** Wherever a recorded match's minutes are shown
  from the session rather than the ledger (the match summary today), a
  disagreement between the two breaks invariant 1. **Quinn's check (26 Oct):**
  minutes per child agree after every ledger-only correction. That was a run,
  not reasoning: `foldLedger` equals `matchReport` after `correctStructure`,
  `addUnknownTimeEvent`, `withdrawRecordEvent`, `correctMatchAttendance` and
  `setMatchExcluded`. **The summary's goals list and its structure caption do
  not agree:** they read the phone's copy ([#244](https://github.com/vanstoner/coaching-app/issues/244)).
  As this decision says, the fix is that a recorded match reads the record,
  not a reshape of the engine.
- **#35 closes as won't-do**, pointing here.

**D2. A team is a key prefix. A thin shell picks one (S4).**

- Each team's keys are today's keys with `teams/<teamId>/` inserted after
  `coaching-app/`. For example, `coaching-app/teams/<id>/session/v1`, and the
  same for the ledger, its head, asides, table sorts and Getting started.
- **`teamKey(teamId, key)` lives in one place:** `teamStore(root, teamId)`, a
  `KeyValueStore` that rewrites every key on the way in and out, and lists only
  its own team's keys. This is S4's helper, applied at the store boundary
  instead of at each of the ten-odd call sites. Every module above, and
  `TableSort.tsx`, keeps its key constants and works unchanged.
- **Two rules make the wrapper safe.** `inTurn` queues on the root store
  (the wrapper carries `root`), so a team's saves, a restore and Forget
  everything still never overtake each other. The test clock passes through
  to the root, since it is per install.
- **`TeamsShell`** (new, thin) owns the root store, the signing key
  (`installDeviceSigner`, once per launch) and the team index. It renders
  `<TeamApp key={teamId} store={teamStore(root, teamId)}/>`, where `TeamApp`
  is today's `App` with the store as a prop instead of `App.tsx:280`.
  Switching remounts, so the shell's 36 `useState`s start clean and no team's
  state leaks into another.
- **The team index** is one global key, `coaching-app/teams/v1`:
  `{ version, current, teams: [{ id, createdAt, removedAt|null }],
  migration? }`. Team ids are fresh UUIDs, never the `squadId`.
- **A team's name is its squad's name**, read from its session. The index does
  not copy it, so the two cannot disagree. A team whose session will not read
  is listed as "a team that could not be opened", never hidden.
- **Removing a team** (AC6) sets `removedAt`. Its keys stay where they are,
  set aside, until Forget everything.
- **Storage modules move into `src/app/storage/`**: `storage`, `sessionStore`,
  `ledgerStore`, `phoneBackup`, `forget`, `deviceKey`, and the new `teams` /
  `teamStore`. The move is a commit of its own, with no behaviour change.
- **Not now:** splitting `ledger.ts`, a state library, SQLite.

**D3. The one-time migration: copy, prove, commit, set aside.**

The migration runs once, in the shell, before any team mounts, inside
`inTurn(root)`. It is resumable at every step.

1. **No index and no legacy `coaching-app/` keys** (other than the test
   clock): a fresh install. Create one empty team and stop.
2. **No index, but legacy keys exist:** write the index with a new team id and
   `migration: { state: 'copying' }`, then read it back.
3. **Copy** every legacy `coaching-app/` key (except the test clock and
   `teams/`) to the team's prefix, byte for byte, asides included. Read each
   copy back. A mismatch stops the migration: the app opens the legacy data
   read-only and says so. A failure must never present an empty team as the
   coach's data.
4. **Commit:** set `migration.state` to `copied`. From here, team 1 is live.
5. **Set the originals aside:** copy each legacy key to
   `coaching-app/before-teams/<key>`, read it back, then remove the original.
   Removing the originals makes a missed `teamStore` fail loudly, as an empty
   store, instead of quietly reading stale data. Set `migration.state` to `done`.

A crash at any step is repeated from that step on the next launch. Nothing
writes to the legacy keys while it runs, because no team is mounted yet. The
data's bytes are not changed, so ADR-018's migrations, the hash chain and the
signatures are untouched.

**The proof (#167, AC3):** `releaseUpgrade.test.ts` launches each `release-*`
store through migration and then `teamStore`, rather than at the root. It
asserts the same figures as today, then the same again after a second launch,
which is the resume case. The fixtures are never edited. **Precondition:
`release-1.3.0` is frozen** before the first 2.0.0 commit, since Rob's phone
holds 1.3.0 data (signed entries, fixture records).

**D4. Global or per team.**

| Per install (root) | Per team (`teams/<id>/`) |
|---|---|
| Signing key, in the secure store (#193, AC8) | Session: squad, players, fixtures, plans, settings |
| Team index and current team | Ledger, its head, its asides |
| Test clock (beta) | Table sorts, Getting started card (#218, AC4) |
| `before-teams/` migration aside | `before-restore/` of a team restore |
| Forget everything, phone backup | Minutes file export and import (#75; #224 Q3) |

- **Forget everything** runs on the root store unchanged (`forget.ts:48-53`
  already takes every `coaching-app/` key). It says how many teams it will
  forget first (AC7).
- **Phone backup** (#192, AC5) moves to `BACKUP_VERSION = 2`:
  `{ teams: [{ id, session, ledger }] }`. 1.x refuses a v2 backup with
  "made by a newer version" (verified above). Restoring a v2 backup lists each
  team. A team whose id is on the phone is replaced, after its keys are set
  aside. A new id is added. Teams on the phone that are not in the file are
  left alone. **A v1 backup restores into the current team**, set aside first,
  just as it restores the phone today.
- **#224 Q2 (one child in two teams) is already decided** by ADR-010 §4: a
  separate player record per squad, sharing nothing. This ADR adds nothing to it.

**D5. Seasons live in each team's record.**

- **A new ledger record type, `season`**, keyed by `id`, latest wins (ADR-021 D2):

  | Field | Values | Absent or null means |
  |---|---|---|
  | `name` | free text, e.g. "2026–27" | shown as "This season" |
  | `startedAt` | ISO time of the coach's act | — |
  | `mainSide` | players a side (5, 7), a stable primitive | ADR-015 §6a's dominating side, as today |
  | `ageGroup` | code `U7`…`U18` | not set, never guessed |
  | `level` | `development` / `competitive` | not set, never guessed |
  | `lens` | `full` only in 2.0.0 | `full` |
  | `note` | text | — |

- **Membership is explicit, never by date.** The `fixture` record gains an
  optional `season` (an id), written when the fixture is made and never
  re-derived. A match whose fixture has none, which is every match recorded
  before 2.0.0 including pre-1.3.0 matches with no fixture record, belongs to
  the team's **first season**. Dates are not used, because `kickoffAt` can be
  null and back-filled matches are recorded weeks late.
- **The current season** is the one with the latest `startedAt`, so it is
  derived and not stored. A season ends when the next one starts, so there is
  no `endDate`.
- **A team with no `season` record has one implicit first season**, all
  fields absent. That is exactly today's behaviour. The first `season` record
  is written when the coach confirms or names it (#243 AC6), never at launch.
- **No figure is stored per season.** Season figures fold from the intervals
  of the season's matches. `PlayerSeasonTotals` is deleted from
  `src/types/index.ts`, so nobody persists it. `Season` is redrawn to the
  fields above, without `squadId` (the team is the prefix) and without
  `endDate`.
- **Room for #241 without defining it:** the lens ADR gives `lens` its other
  values and adds a per-match `competitive` field to the fixture. Both are
  additive under ADR-021 D1.

**#243 AC8 ("seasons live in the record") is sound**, with three clarifications
for Bea's criteria:

- membership comes from the fixture, never from dates;
- the four settings are the coach's inputs, not derived figures. What
  invariant 1 asks is that no *figure* is stored per season;
- absent means absent: no default is written for the coach (see Q2).

**D6. Seasons and figures.** All season figures (averages, owed time, trend,
headline, the dominating side) filter by season first, then apply today's
rules unchanged. Nothing crosses seasons or teams (#243 AC5).

**D7. ADR-018's revisit point: no.**

- Each team is still two JSON documents plus a head, and teams sit side by side.
- Five teams with full seasons come to a few MB, and each value stays under
  a megabyte.
- SQLite's transactions are not needed, because D3's copy-prove-commit gives
  the one multi-key operation its safety, as #173 and #192 already do.

## Consequences

**Easier:** every screen and storage module works unchanged inside a team.
A team is one prefix to back up, set aside or forget (ADR-010). Seasons
restore with the record. Invariant 1 points at what is actually built.

**Harder:**
- The shell gains a launch step (migration) that must stay resumable.
- `inTurn` must queue on the root.
- Each team's chain publishes the same device key once.
- Backup v2 needs a reader for v1.

**Accepted:**
- About double the bytes after migration, until Forget everything.
- 2.0.0 data cannot be read by 1.x, which Android's `versionCode` rule
  already makes moot.
- Until #244 is fixed, a recorded match's summary reads the session for goals
  and structure.

**Cost to reverse:**
- **D2–D4: high** once phones hold several teams. Going back would mean a
  merge nobody wants.
- **D3: one-way.** `before-teams/` is kept so that a 2.0.x patch could put
  1.3.0's data back.
- **D5: permanent in each chain** (a hash chain cannot drop records). A later
  build can ignore `season` records, and every match falls back to the first
  season.
- **D1: low.** It is docs and one `CLAUDE.md` line. Reviving ADR-007 later
  costs the same engine reshape it costs today.

## Alternatives considered

- **Keep ADR-007 and do #35 with 2.0.0.** Rejected on proportionality. It
  reshapes the engine and shell while D2–D3 already move every byte, so two
  high-risk changes would land in one release, for no change a coach sees.
- **`teamKey()` edited into each write site (S4 as worded).** Rejected for the
  wrapper. It touches ten-odd sites including `App.tsx` and a screen, and a
  missed one silently writes to the root. With the wrapper, a missed module is
  impossible, and D3 step 5 makes the root empty anyway.
- **Team id = `squadId`.** Rejected, because a restore from the record
  replaces it (`App.tsx:675`).
- **Team names in the index.** Rejected, because a copy of the squad name
  could disagree with it.
- **Leave legacy keys in place as the aside.** Rejected, because a stale but
  readable root is the worst failure, as it looks like data.
- **Seasons by date range** (the unused `Season` type). Rejected: null
  kickoffs, late back-fills and clubs' differing dates would split figures
  nobody asked to split.
- **Seasons in the session only.** Rejected: a restore from the record or a
  new phone would lose them (#243 AC8).
- **One database per team, SQLite, or a state library.** Rejected (D7).

## Questions for Rob, each with a recommendation

- **Q1. The first season's main format (#243 AC6).**
  - **What:** AC6 says the migrated season's main format is "the current
    default". If Rob's season so far is mostly another side size than today's
    default, that changes which matches count in the averages, so 1.3.0's
    figures would not open identically (#167, #224 AC3).
  - **Recommendation:** leave it unset, so ADR-015 §6a's dominating side
    applies exactly as today. The coach sets it once, with a line saying what
    changes.
  - **Cost to reverse:** low.
  - **Unblocks:** #243 AC6 and D3's proof.
- **Q2. Age group and level for existing data (#243 AC6).**
  - **What:** whether to save the suggested U10 / development for data that
    already exists.
  - **Recommendation:** offer U10 / development pre-filled, but **save nothing
    until the coach confirms it**. Until then the season shows "Age group not
    set", and the lens is `full` either way. A saved guess cannot later be
    told apart from the coach's choice.
  - **Cost to reverse:** low.
  - **Unblocks:** #243 AC6.
- **Q3. Approve D1.** This supersedes ADR-007, closes #35 as won't-do, and
  restates invariant 1 in `CLAUDE.md` as above.
  - **Recommendation:** approve.
  - **Cost to reverse:** low.
  - **Unblocks:** #239 S2's status pass and the #224 build.

**Switching during a match.** Ada recommended hiding the team chip while a
period runs. **Rob ruled the other way on 26 Oct (#224 T3):** a team whose
match is running can be left, tagged "Match on", and reopening it goes
straight to its clock. That is safe, because switching remounts and the
match's anchors are saved (invariant 2). It needs a test that a period left
running in one team is intact when the team is reopened.
