# The released 1.2.0 reader, frozen

`ledger.ts`, `ledgerChain.ts`, `entrySigning.ts`, `sha256.ts` and `types.ts`
exactly as Heart FC Coach 1.2.0 shipped them (commit
`5ce1554df9fd1150bd658bb2bc547ef84f3f5939`), with only the import of
`../types/index` pointed at `./types`.

Tests import it to prove that files this build writes are still read by the
released app (ADR-021 D1: additive only while the format is unlocked; #195
AC7). The app never imports it.

**Never edited.** A later build whose files this reader refuses, or reads
different minutes from, is the bug.
