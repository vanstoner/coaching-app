# ADR-014: Ledger v2 is a hash chain, and it records attendance

**Status:** Accepted
**Date:** 2026-10-04
**Decision maker:** Architect, on the Product Owner's ruling of 2026-10-04 (#98 ruling 2 and 4, `approve 1 2 3 4 5 6 7 8 9`; criteria in #100)

**Relationship:** amends [ADR-013](./013-minutes-ledger.md). Its decisions 1, 2, 5,
6 and 7 stand. Decision 3 (updates by id) and 4 (frozen v1 format) are refined
below; ADR-013 is not superseded.

## Context

> *"The ledger spine is key here, almost blockchainesque in the importance i
> place on it."* — Product Owner, 2026-10-04 (#98)

The v1 ledger only grows, but nothing proves it. An edited or truncated export
imports silently, and `recordMatches` replaces an interval by id with no trace
of the earlier copy. v2 also needs attendance, so games missed can be derived
(#102). Verified on `main` at 64a11af: neither `expo-crypto` nor any SHA-256 is
installed; Hermes has no `crypto.subtle`; the ledger code is synchronous pure TS.

## Decision

1. **The ledger is a list of entries; state is a fold of them.** Each entry is
   `{ seq, prev, at, kind, records, hash }`. `seq` counts from 0; `prev` is the
   previous entry's `hash` (`null` at 0); `at` is the device's wall clock, for
   people only (order is `seq`); `kind` is `genesis` or `record`. The stored
   ledger and the export file hold the entries; players, matches and totals
   are folded from them on read and never stored (invariant 1).
2. **One entry per recording that changes something.** `recordMatches` folds
   the chain, computes the records whose canonical form differs from the
   folded copy, and appends one entry holding exactly those. No change, no
   entry. A changed interval is a new record in a new entry; the old one stays
   in the chain, so a revision is visible rather than overwritten. The fold
   takes the latest revision of each key. Per-record links were rejected
   (below); one block per match fails because a match is recorded in many
   saves.
3. **Records are a tagged union**, keyed for "latest wins": `squad` (id, name),
   `player` (id), `match` (id; header only), `interval` (id, with `matchId`),
   `event` (id, with `matchId`), `attendance` (`matchId` + `playerId`). Fields
   are as in v1. No surname, date of birth, contact or photo (invariant 4).
4. **Attendance** is one record per player in the match's availability:
   `{ matchId, playerId, status }` with the engine's `AvailabilityStatus`. It
   is a snapshot taken when the match kicks off, so a later squad edit cannot
   rewrite it. A change after kick-off is a new attendance record carrying a
   mandatory `note` (invariant 5, #102 AC2). Games missed, matches attended and
   averages are derived (ADR-015); nothing is counted or stored. **Constraint:**
   attendance recording must not reach a release before #102's absent marking
   does, or the default all-available would be stored as if it had been
   measured.
5. **Hash: SHA-256 in pure TypeScript** (`src/app/sha256.ts`, about 80 lines),
   with its own UTF-8 encoder, tested against the NIST vectors (`""`, `"abc"`,
   the 448-bit message, one million `a`) and a non-ASCII first name. The hash
   is lowercase hex. `expo-crypto` was rejected: its digest is async and
   native-only, which would make the ledger async and untestable under vitest.
   A season is at most a few hundred KB, which takes tens of milliseconds.
6. **Canonical form**: JSON with object keys sorted by code unit, no
   whitespace, arrays in stored order, `undefined` omitted, `null` kept,
   strings escaped as `JSON.stringify` escapes them. Numbers must be safe
   integers (all ledger numbers are ms, minutes or counts); anything else is a
   bug and throws. `hash = sha256(canonical(entry without hash))`, and that
   includes fields this build does not know, so a newer writer's additions are
   hashed and carried, not dropped.
7. **Genesis is entry 0.** Upgrading a v1 ledger writes a `genesis` entry whose
   records are the whole v1 content (squad, players, matches, intervals,
   events) and `from: 'v1'`. A new ledger's genesis holds the squad record and
   `from: 'new'`. v1 matches have no attendance records (#100 AC4). v2 is
   written under a new key, `coaching-app/ledger/v2`. The v1 key is left as
   it was and never written again; "Forget everything" clears both.
8. **Verify on every read and every import.** Check `seq` is contiguous from 0,
   entry 0 is the genesis with `prev: null`, each `prev` matches, and each hash
   recomputes. The first failure is reported in plain English, such as "the
   entry recorded on 3 Oct at 10:42 has been changed since it was written", or
   "an entry is missing after 3 Oct at 10:42".
   - **Stored chain broken:** shown as untrusted, never repaired, never
     appended to. Recording is suspended, and the season figures are not
     shown. Nothing is lost, because the working document still holds its
     matches and records them once a good chain is restored.
   - **File broken:** refused, and nothing is imported (#100 AC5).
9. **Import extends, never merges** (#100 AC2). After verifying the file:
   - If our chain is empty, adopt the file's chain.
   - If our chain is a prefix of the file's, append its extra entries verbatim.
   - If the file's chain is a prefix of ours, there is nothing new.
   - Otherwise the chains have diverged, and the import is refused, naming the
     date of the first entry where they differ.
10. **Versions** (with #99). Files carry `ledgerVersion: 2` and
    `minReaderVersion: 2`. A v1 reader built with #99 refuses to write back a
    v2 ledger. A v1 reader built before #99 refuses a v2 file anyway, because
    it has no `players` or `matches` arrays (`parseLedger` in `ledger.ts`
    requires both). This build reads v1 by upgrading it. Unknown record types
    are carried and ignored in the fold. A file with `minReaderVersion` above
    2 can be verified and viewed, but not appended to or imported. The file
    adds `writtenAt` and the human `summary` outside the chain. The summary is
    recomputed and checked, as in v1.

## Consequences

**Easier:** any edit, deletion, insertion or reordering of an entry, on the
phone or in a file, is detected. An import proves that it only appends. A
correction's history is in the chain, not just its outcome.

**Harder:** reading means verifying and folding. Every save rewrites the whole
chain, as v1 already does. Two phones that both record cannot be combined:
the second import is refused (see Flag).

**What this does not protect against, honestly.** There is no key and no
signature. Someone who edits a file and re-hashes every entry after the edit
produces a chain that verifies on its own. It is caught only by a device that
already holds the original prefix. The chain also does not stop a wrong fact
being recorded honestly, the whole ledger being deleted, or loss without an
export. It detects accidental and casual changes, and loss of part of the
chain. That is the bar the ruling set, and the proportionality ruling argues
against keys.

**Flag for Rob:** refusing a diverged chain (AC2, applied literally) means one
phone records and the others import from it. If the coaching team's iPhones
ever record matches independently, the remedy is additive: a `merge` entry
with two parents. Cost to reverse: low. Not built now.

## Alternatives considered

**One chain link per record.** It gives the finest tamper locality. It was
rejected because it adds roughly 3,000 links a season, each with its own
header, and gains nothing: a changed entry already names its own recording.

**`expo-crypto`.** Native and fast, but async and absent under vitest, as
above.

**HMAC or signatures.** Real tamper-proofing needs a key, and a key on the
same phone protects nothing. A server-held key is outside ADR-011.

**Merge diverged chains by id, as v1 does.** This contradicts #100 AC2, which
was ruled.
