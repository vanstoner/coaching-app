# Release 1.2.0, frozen

What Heart FC Coach 1.2.0 stores, written by its own code: commit
`5ce1554df9fd1150bd658bb2bc547ef84f3f5939`, the merge of PR #216. It was
frozen by `scripts/freeze-release-fixture.ts` run in a worktree of that commit
(TZ=UTC, clock fixed at 2026-10-07T09:00:00Z). Made-up Test kit names only.
Entries are signed with the fixed made-up key, as for `release-1.0.1`.

- `store.json`: every stored key and its value, byte for byte. It is the
  same as 1.0.1's: 1.2.0 changed neither the session nor the record (its table sorts, `coaching-app/table-sort/v1`, are a view choice the freeze does not seed).
- `expected.json`: the figures 1.2.0 showed for it (`releaseFigures`).
- `release.json`: the commit, clock, schema and ledger versions and migrations.

**Never edited.** `releaseUpgrade.test.ts` checks these files against the
hashes in `../releases.json`. A later build that cannot read them, or reads
different figures, is the bug (#167).
