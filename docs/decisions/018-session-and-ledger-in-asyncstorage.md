# ADR-018: Session and ledger as two JSON documents in AsyncStorage

**Status:** Accepted
**Date:** 2026-10-09
**Decision maker:** Architect, recording a choice already shipped in v1.0.0; approved by the Product Owner, 2026-10-09 (`approve 5`)

## Context

Persistence arrived with REQ-11 (#53) and the ledger with #75 (ADR-013) without
an ADR naming the storage engine. Data is small: one squad of about 12, about
30 matches a season, a ledger of a few thousand entries. Everything stays on
the device (ADR-011). Tests must run in Node with no native module.

## Decision

- Storage is `@react-native-async-storage/async-storage`, reached only through
  `src/app/storage.ts` behind the `KeyValueStore` interface
  (`getItem`/`setItem`/`removeItem`). Tests use `createMemoryStore()`.
- Two documents, each rewritten whole on save:
  `coaching-app/session/v1` (squad, defaults, every match, plans) and
  `coaching-app/ledger/v2` (the hash-chained minutes record), plus a chain head.
- Each carries `schemaVersion`/`ledgerVersion` and `minReaderVersion`. Older
  documents are migrated forward; unknown fields are kept on write.
- Storage failure never stops a match: writes are fire-and-forget and the app
  runs on in-memory state.

## Consequences

- Easier: no native schema, no ORM, migrations are pure functions tested in Node.
- Harder: every save serialises the whole season (tens of KB, fine at this
  scale). Two documents can briefly disagree; the ledger is the record of
  minutes, the session the record of everything else.
- Accepted: the session's read path must protect an unreadable document as the
  ledger's does. It does not yet (#173).

## Alternatives considered

- **SQLite (`expo-sqlite`)**: real transactions and partial writes, at the cost
  of a native schema and migrations that need a device to test. Not needed at
  one squad's scale; revisit if multi-squad or sync (ADR-006) lands.
- **MMKV**: faster synchronous reads, but another native module and a
  New Architecture dependency, for a load that happens once at launch.
- **One document**: the ledger's integrity rules (set aside, never overwrite,
  hash chain) would then bind every settings change.
