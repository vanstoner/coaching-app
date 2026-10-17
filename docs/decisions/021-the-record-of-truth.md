# ADR-021: The minutes record becomes the record of truth: fixtures, results, awards, provenance

**Status:** Proposed
**Date:** 2026-10-17
**Decision maker:** Architect, for the Product Owner's ruling (epic #191)

**Relationship:** extends [ADR-014](./014-ledger-hash-chain.md) §3 (new record
types) and reverses part of its "HMAC or signatures" alternative (§D4 below).
ADR-007, 008, 010, 011, 015, 017 and 020 stand. Nothing here moves data off the
phone (ADR-011): a central store stays future work (#113).

## Context

> *"There's a future date where the record of truth might be centralised, i.e.
> many coaches (and parents) feeding input that will go through a validation
> workflow and committed to the record. Given we may make decisions based on
> the data I do want to keep it to a position when we are happy to lock it
> down, though that needn't be right now."* — Product Owner, 2026-10-17

The PO asked for four things (epic #191):

1. more agreed metrics in the record: goals, minutes in positions, the match's
   structure, the result and customisable awards as the core, plus a more
   subjective second layer (tackles, saves, corners, free kicks);
2. restoring a phone from a sanctioned record, fixtures included, with
   everything derived from the ledger where possible;
3. knowing when a match is tainted, meaning it was not recorded in real time,
   even after it has been imported elsewhere;
4. test matches that can be deleted and never seen again.

Verified on `main` at c56343d:

- The ledger holds `squad`, `player`, `match`, `interval`, `event`,
  `attendance` and `exclusion` records. Fixtures, plans, squad settings and
  player preferences live only in the session document
  (`coaching-app/session/v1`), so a minutes file cannot restore a phone.
  Imported matches are missing from Played because Played reads the session.
- Parsing carries unknown record types and unknown fields (ADR-014 §10). An
  `event` must have a numeric `atMs`, or the whole record is refused as
  damaged.
- `@noble/ed25519` 3.2.0, `@noble/hashes` 2.4.0, and the SDK-57 builds of
  `expo-secure-store` and `expo-crypto` (57.0.4) all exist on npm. Hermes has
  no `crypto.subtle`. `uuid()` falls back to `Math.random`, which is fine for
  ids and wrong for keys.
- Entries carry `{ from, seq, prev, at, kind, records, hash }`. The hash
  covers the entry minus `hash`, *including fields this build does not know*.

## Decision

**D1. Additive only, no version bump while the format is unlocked.**
Everything below is a new record type or a new optional field.
`ledgerVersion` and `minReaderVersion` stay at 2, so the released app reads
every file this slice writes and carries what it does not understand. A
change that would make today's build refuse a record (a non-numeric `atMs`,
for example) is not allowed.

**D2. New record types**, each keyed "latest wins" like ADR-014 §3:

| Type | Key | Fields | Purpose |
|---|---|---|---|
| `fixture` | `id` | `kickoffAt`, `opponent`, `competition`, `homeAway`, `venue`, `periodCount`, `periodMinutes`, `shape`, `excludeFromStats`, `state` (`planned`/`cancelled`) | Fixtures enter the record when created, so the record can restore them. A cancelled fixture is a new record, never a deletion |
| `structure` | `matchId` | `periodCount`, `periodMs[]`, `shape`, `onField` | How the match was actually played, e.g. halves turned into quarters |
| `award-type` | `id` | `name`, `active` | Customisable awards. Retiring one keeps its history |
| `award` | `matchId`+`awardTypeId` | `playerId`, `note` | Player of the Week, Mr Assister… |
| `event-type` | `id` | `label`, `tier` (`core`/`tally`), `credited` | The second layer; new kinds without a release |
| `profile` | `playerId` | `keeperPreference`, `outfieldTarget`, `fairness` (`counted`/`not-counted`, #190) | What restore needs about a child |
| `settings` | `squad` | default shape, minutes, periods | What restore needs about the squad |
| `match-kind` | `matchId` | `kind` (`real`/`test`/`void`), `note` | Hides test or voided matches everywhere |
| `origin` | `matchId` | `how` (`live`/`reconstructed`), `source`, `note` | A coach's statement of where a match came from (#189) |

The `interval` record gains optional `role` (the position's role code, e.g.
`RB`), so minutes in positions are recorded, not inferred. The `event` record
gains optional `timeKnown: false`, with `atMs` set to the start of its period,
so a goal from a match report can be recorded without inventing a time. The
`playerId` on a goal can be null (scorer unknown). The **result is always
derived** from goal and conceded events, never stored (invariant 1).

**D3. Test matches never enter the record.** A test match is a session-only
match started from Settings. It is never passed to `recordMatches` and can be
deleted outright. A played real match is never deleted. It can be left out of
the figures (ADR-020) or voided (`match-kind: void`, with a note), which hides
it from every screen while it stays in the chain. Past test matches already in
a ledger are hidden the same way, with `match-kind: test`.

**D4. Each install signs its entries; provenance is derived.**

- At first launch, an install generates an Ed25519 key pair from
  `expo-crypto` random bytes. The private key is stored in `expo-secure-store`
  (Android Keystore). The public key is published once in a `device` record
  in the chain.
- Each entry the install writes carries `device` (its id) and `sig`, the
  signature over the canonical form of the entry without `hash` and `sig`.
  `hash` is then computed over the entry **including** `sig`, exactly as
  ADR-014 §6 already hashes unknown fields. So today's build still verifies
  signed chains.
- **Pristine** is derived, never stored. A match is pristine when:
  - every interval and event in it was written in an entry signed by the
    install that started its first period;
  - each of those entries' `at` falls within the match's own clock window;
  - it carries no `origin: reconstructed`, no corrected interval, and no
    attendance or event added after the match ended.

  Importing a signed match elsewhere keeps it pristine, because the
  signatures travel with it.
- **Live, unsigned:** recorded before signing existed, with entries written
  within the match window (e.g. 10 Oct). **Reconstructed:** anything else,
  including this season's back-filled matches, whose entries were written
  weeks after kick-off.
- **Display, everywhere the same:** a dashed outline and a ◐ tag on cards, and
  italic muted figures in tables. A view toggle, "Include reconstructed
  matches", recomputes the figures without writing a record. ADR-020 still
  leaves out an individual match.

**What signing proves, honestly.** It proves that this install wrote this
entry and that nothing has changed since, wherever the file has travelled.
It does not prove the wall-clock time was true. A coach can set the phone's
clock wrong, and someone with root access can extract the key. That is enough
for this app's honest-coach threat model and for the PO's proportionality
ruling. A trusted time arrives when a central store countersigns entries on
upload (#113).

**D5. Restore.** A **phone backup** (session document plus ledger in one
file) restores the phone exactly, and comes first because it helps
development. **Restore from the record** rebuilds squad, players, profiles,
settings, fixtures and played matches from a minutes file alone, once D2 has
been recorded for long enough to be useful. Both restores copy what is on the
phone aside first and read the copy back (the #173 rule), so a restore never
deletes anything.

**D6. Locking.** While this ADR is Proposed, the format may change additively
and the PO may still reshape it. Locking means:
- this ADR is Accepted;
- `minReaderVersion` moves to 3 on a date the PO picks;
- from then on, a format change needs a new ADR.

Rob's real season already in the ledger stays valid throughout, because
nothing here rewrites an existing record.

## Consequences

**Easier:**
- One file restores a phone.
- Played lists every match in the record.
- Stats can say how far they can be trusted.
- A central store later receives signed, append-only entries and decides what
  to commit, rather than receiving a mutable database.

**Harder:**
- More record types to fold, and the session document becomes a cache of the
  ledger for fixtures (#179 gets smaller rather than bigger).
- Four native or crypto dependencies. Signing adds roughly 1–3 ms per entry,
  and needs a new native build, which CI already produces.

**Backward compatibility (verified against D1):**
- The released build reads every file written by this slice.
- It ignores what it doesn't know. In that build, a test or void match marked
  with `match-kind` still shows, and an unsigned/signed distinction is
  invisible. One recording phone makes that acceptable.
- A session document at schema 7 is refused for writing by a build at 6. Since
  #173, that build opens read-only rather than overwriting.

**Destructive changes:** none. No existing record is rewritten. Deleting a
test match removes data that was never in the record.

## Alternatives considered

- **HMAC with a device secret.** Only the same phone can verify it, so it says
  nothing to another phone or a future server. Rejected.
- **A stored `pristine` flag.** It is derived state, and could disagree with
  the chain (invariant 1). Rejected.
- **Recording test matches and hiding them.** Leaves test data in a record
  meant to be sanctioned. Rejected for new test matches. It is the only option
  for past ones, which are already in the chain.
- **A null `atMs` for unknown times.** Today's build would refuse the record
  as damaged and the chain would fail to open. Rejected in favour of
  `timeKnown: false` (D1).
- **Bumping to ledger v3 now.** Locks a format the PO has said is not ready to
  lock (D6).
