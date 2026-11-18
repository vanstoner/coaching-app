# ADR-025: One match from another phone

**Status:** Proposed. Rob approved #281's questions 1–4 (7 Nov: "Approve
all"); this ADR records the design under them and is accepted when Rob
approves it, before Dee's screens and Bea's criteria.
**Date:** 2026-11-07
**Decision maker:** Architect, for the Product Owner's ruling (#281)

**Rulings.** [#281](https://github.com/vanstoner/coaching-app/issues/281),
7 Nov: (1) the coach sends a recorder one file with the fixture, its team
sheet and first names; (2) the recorder sends one match file back, matched to
the fixture by its id; (3) it is trusted as the coach's own phone, labelled
"Recorded on another phone", with the recorder's signature kept; (4) a match
the coach's record already holds is refused, and merging is for later (#258).

**Relationship:** stays inside [ADR-021](./021-the-record-of-truth.md) D1
(additive only: two new record types, no version bump) and D4 (signatures,
provenance derived). Stays inside [ADR-022](./022-teams-and-seasons.md)
(a team is a key prefix; one install key signs every team). Keeps
[ADR-009](./009-single-clock-owner-per-match.md) (one phone owns a match's
clock) and [ADR-011](./011-player-data-stays-on-device.md) §4 (data leaves a
phone only by an explicit export to a place the coach chooses). A first step
towards [#258](https://github.com/vanstoner/coaching-app/issues/258) phase 1,
with no relay and no merge.

## Context

A helper runs the clock on their own phone when the coach cannot make it.
The coach wants that match in their record with the helper's real times, not
reconstructed (#281). Verified on `claude/2.4.0` (fresh from `main`, 2.3.0):

- **`importLedger` (`src/app/ledger.ts:2106`) takes a whole chain.** It adopts
  the file's chain when this phone holds no match, appends when one chain is
  a prefix of the other, and otherwise refuses: "Only one phone should record
  matches". A recorder's chain never shares the coach's history, so a single
  match cannot come in on this path.
- **A signature covers the whole entry**, `from`, `seq` and `prev` included
  (`signedBytes`, `src/app/entrySigning.ts:58`). Re-chaining a recorder's
  entries into the coach's chain would break every signature. The recorder's
  entries can travel only verbatim.
- **Provenance is derived per match** (`src/app/provenance.ts`): pristine
  needs every interval, event and attendance record written in entries signed
  by one install, each within 2 hours before kick-off to 3 hours after the
  planned end. A copy appended by the coach's phone that evening would read
  as written by the coach's install, possibly outside the window, so as
  reconstructed or, worse, as the coach's own.
- **`squadMatch.ts` pairs children by name** for a whole-record import
  (#195). Ruling 2 needs no pairing: the pack carries the coach's own ids.
- **`parseLedger` refuses any file whose `ledger` is not
  `coaching-app/minutes`** (`ledger.ts:1813`), so a wrapped file is refused by
  2.3.0's Import minutes file with "This is not a minutes file from this app."
- **The plan and Who's coming are session data** (ADR-024 D1, D6), not in the
  record, so a minutes file alone cannot carry the team sheet.
- **Removing a team sets it aside** until Forget everything (ADR-022,
  `removeTeam`, `src/app/storage/teams.ts:377`). Its keys stay on the phone.

## Decision

**D1. Two files, each a wrapper around an ordinary minutes file.**

| File | `kind` | Holds |
|---|---|---|
| Recorder pack | `coaching-app/recorder-pack` | `version: 1`, `minReaderVersion: 1`, `writtenAt`, `fixtureId`, `record` (a minutes file, below), `plan` (the fixture's plan as the session stores it), `availability` (Coming, Can't or Not heard per child) |
| Match file | `coaching-app/recorded-match` | `version: 1`, `minReaderVersion: 1`, `writtenAt`, `fixtureId`, `record` (the recorder team's whole minutes file) |

`record` is the same JSON object a minutes file holds (ledger v2), read with
`parseLedger`'s checks: the chain verifies and the summary agrees, or the file
is refused. The wrapper's own `minReaderVersion` above 1 is refused with
"made by a newer version". One file picker in Settings routes by `kind`; a
bare minutes file goes to Import minutes file as today.

**D2. The pack is a new, minimal chain, never the coach's record.** The
coach's install writes a fresh genesis holding only what recording needs:

- the `squad` record (the team's name);
- a `player` record (id, first name, confirmed suffix, active) for each
  **active child of the squad**, so Here today can tick a child marked Can't
  who turns up; the plan and `availability` say who is expected;
- a `pack` record naming the fixture (D3);
- the fixture's `fixture` record, the `settings` record (position labels),
  the active `event-type` records (the coach's tallies), the fixture's
  `season` record and its `power-play-rule` (ADR-026), so the recorder's
  prompts match the coach's.

No `profile`, no award, no match already played, no figure. Season history
and fairness marks stay on the coach's phone. The entries are signed by the
coach's install, as any entry is.

**D3. The recorder records as usual, in a borrowed team.** Opening a pack
creates a team on the recorder's phone (ADR-022) whose record is the pack's
chain, adopted as `importLedger` already adopts a chain onto an empty team.
It is borrowed because its record says so: the pack's first entry holds a
`pack` record, `{ fixtureId }`, a fact about where the chain came from, never
a setting. In a borrowed
team the recorder cannot add or rename children (ids must stay the coach's)
and has one fixture. Everything else is the normal match day; the recorder's
install signs what it records.

**D4. Send to the coach** appears at full time (a completed match only) and
shares the match file through the share sheet, as the minutes file is shared
today (`ledgerFile.ts`). It carries the whole borrowed record: the pack's
entries, signed by the coach, then the recorder's, signed by the recorder.

**D5. The import appends one entry, signed by the coach's install.** It is
refused, with a reason and nothing written, unless all of these hold:

1. the match file reads (D1), and its match `fixtureId` is completed;
2. the coach's current team holds a `fixture` with that id, not cancelled;
3. **the coach's record holds no play for that match**: no interval, event or
   attendance record, and the phone is not holding it live
   (`HELD_MATCH_REFUSAL`). This is ruling 4. Importing the same file twice
   meets this rule and is told "This match is already in your record";
4. every child in the match's records is a child in the coach's record.

The entry holds:

- **the match's records, copied unchanged with their ids:** every record of
  type `match`, `structure`, `interval`, `event`, `attendance` and
  `exclusion` keyed to that match. Never `award`, `match-kind`,
  `format-count` or `origin`: those are the coach's acts. The coach's own
  `fixture` record stands;
- the recorder's `device` record, if the coach's chain does not yet publish
  that key;
- **one new record, `received`**, keyed by `matchId`: `{ matchId, device,
  entries }`, where `entries` are the recorder's original entries that hold
  any of the copied records, **verbatim**, signatures and hashes included.

Figures fold from the copied records, so every reader, the released 2.3.0
included, sees the match as an ordinary recorded match. `received` is the
evidence, carried by older builds as an unknown record type (ADR-014 §10).
No `importLedger` path changes: this is a new function beside it, sharing
`parseLedger`, `appendRecords` and the refusal wording. `squadMatch.ts` is not
used (ruling 2).

**D6. Trust: the same three states; "Recorded on another phone" is derived
from `received`.** No new provenance state. For a match with a `received`
record, `provenance.ts` judges the recorder's entries in `received`, not the
coach's import entry:

- each original entry's signature is checked against the published key of
  the device named in `received`, and its `at` against the match's window;
- the copied records must equal the records of the same id in those
  entries (`sameRecord`). If any differs or is missing, the match is
  reconstructed: "The copy differs from what the recording phone signed";
- the existing rules then apply unchanged: one device, no corrected interval,
  no `origin: reconstructed`, nothing added after the match. A goal the coach
  adds afterwards makes it reconstructed, exactly as on the coach's own
  phone.

So a match recorded live on the recorder's phone and imported unchanged is
**pristine**, as ruling 3 says. `ProvenanceInfo` gains one derived field,
`recordedElsewhere: boolean`, true when the match has a `received` record,
and the match page reads "Recorded on another phone" beside its state. It
reads the record of the import, not the signing device: a coach's own new
phone, restored from a backup, signs with a new key and must not label every
old match as recorded elsewhere.

**D7. The recorder's phone keeps nothing it does not need.** Children's first
names on another adult's phone are the data-protection cost of this feature.

- The pack holds first names only, of one squad, and no history (D2).
- After Send to the coach, the app asks "Remove this team from your phone?",
  with Remove as the recommended choice. **Removing a borrowed team erases its
  keys**, unlike removing one's own team, which sets them aside (ADR-022).
  The original is on the coach's phone; the match has been sent.
- A borrowed team kept after sending shows "Borrowed for one match: remove
  it once the coach has it", and asks again a week after full time. It is
  never deleted without the recorder's tap.
- A borrowed team is left out of the recorder's phone backup.
- Removing before sending warns that the match has not been sent.

The coach's share screen says, as Export minutes file does, that the file
holds the children's first names and should go only to the adult recording.

## Consequences

**Easier:**
- A helper's match enters the record with real times and full trust, and the
  audit trail names the phone that recorded it.
- The pieces #258 phase 1 needs (a minimal shared chain, a second install's
  signature in the coach's record, evidence that travels) are built small,
  with no relay.

**Harder:**
- The match's records are held twice in the coach's file: once as the record,
  once inside `received` as evidence. A match is tens of kilobytes.
- `provenance.ts` reads a second source of entries for received matches.
- A borrowed team is a second kind of team, with an erasing removal.

**Accepted:**
- **Older builds read a received match as written by the coach's install,**
  pristine or reconstructed by the import's time. Builds before 2.4.0 are
  frozen; Rob's phone runs the newest.
- **No undo by re-import.** A wrongly imported match is voided (ADR-021 D3,
  with a note); importing a replacement for the same fixture is refused by
  D5.3, as ruling 4 says. Merging and replacing are for later (#258).
- The share sheet cannot confirm delivery, so D7's prompt follows the share,
  not the coach's receipt.

**Destructive changes:** none to the record. D7's removal erases a borrowed
copy on the recorder's phone, at the recorder's tap.

**Cost to reverse:** the two `kind`s and the `pack` and `received` records are written
into files and records, so they are permanent once released (readable for
ever). D6's derivation and D7's prompts are low.

## Alternatives considered

- **Append the recorder's entries to the coach's chain.** Impossible without
  breaking every signature (`prev` and `seq` are signed). Rejected.
- **Fold the match only from inside `received`, with no copy.** One copy, so
  nothing could disagree, but every build before 2.4.0 would not see the
  match at all, and every reader of the record would need a second path.
  Rejected; D6 makes a disagreeing copy visible and never pristine.
- **Send the coach's whole record as the pack.** Every child's season history
  on another adult's phone, for one match. Rejected (D2, D7).
- **Pair children by name on the way back (`squadMatch.ts`).** Ruling 2 needs
  none: the ids are the coach's. A guessed pairing is the failure #195
  guarded against. Rejected.
- **A new provenance state, "imported".** Ruling 3 trusts the match as the
  coach's own; a fourth state would treat it differently in every figure and
  toggle. Rejected for a derived label (D6).
- **Label from the signing device** (device differs from this install's).
  Mislabels every match after a phone is replaced. Rejected (D6).
- **The team sheet only, no other children.** A child marked Can't who turns
  up could not be ticked, and the recorder could not add them without a new
  id. Rejected; listed for Rob below because it widens ruling 1 slightly.

## Open for Rob

1. **D2 sends every active child's first name, not only those on the team
   sheet.** Recommend yes: an unexpected arrival can be ticked, and it is one
   squad's first names. Cost to reverse: low (a filter on the pack).
2. **A second adult holding children's names** is the consent question #258
   raised (a DPIA-lite with the club). Recommend: build 2.4 as above, with
   D7's minimisation and erasure, and take the club step with #258 and #113,
   since no data reaches a server.
