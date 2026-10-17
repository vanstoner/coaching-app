# Release 1.1.0, frozen

What Heart FC Coach 1.1.0 stores, written by its own code: commit
`40826f7d997c677b285974ed97c2b70cbf74d6e1`, the merge of PR #210. It was
frozen by `scripts/freeze-release-fixture.ts` run in a worktree of that commit
(TZ=UTC, clock fixed at 2026-10-07T09:00:00Z). Made-up Test kit names only.
Entries are signed with the fixed made-up key, as for `release-1.0.1`.

- `store.json`: every stored key and its value, byte for byte. It is the
  same as 1.0.1's, because 1.1.0 changed no stored format.
- `expected.json`: the figures 1.1.0 showed for it (`releaseFigures`).
- `release.json`: the commit, clock, schema and ledger versions and migrations.

**Never edited.** `releaseUpgrade.test.ts` checks these files against the
hashes in `../releases.json`. A later build that cannot read them, or reads
different figures, is the bug (#167).
