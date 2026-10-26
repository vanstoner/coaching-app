# Release 1.3.0, frozen

What Heart FC Coach 1.3.0 stores, written by its own code: commit
`73523c3e3ed569046958745fe124f27f51f64528`, the merge of PR #235 and the
source of build 246, the latest 1.3.0 release. It was frozen by
`scripts/freeze-release-fixture.ts` run in a worktree of that commit (TZ=UTC,
clock fixed at 2026-10-07T09:00:00Z), on 26 October 2026, as ADR-022 D3's
precondition for 2.0.0 (#224). Made-up Test kit names only. Entries are
signed with the fixed made-up key, as for `release-1.0.1`.

- `store.json`: every stored key and its value, byte for byte. It differs
  from 1.2.0's because 1.3.0 also writes fixtures, profiles and settings into
  the record (#195).
- `expected.json`: the figures 1.3.0 showed for it (`releaseFigures`). They
  are the same as every earlier release's.
- `release.json`: the commit, clock, schema and ledger versions and migrations.

A second run at the same commit wrote identical bytes.

**Never edited.** `releaseUpgrade.test.ts` checks these files against the
hashes in `../releases.json`. A later build that cannot read them, or reads
different figures, is the bug (#167).
