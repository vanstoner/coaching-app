# Release 1.0.1, frozen

What Heart FC Coach 1.0.1 stores, written by its own code: commit
`5231aa65898b88e4720f70a59852aaccbaca24d3`, the last build of `main` at 1.0.1
and the one on Android phones when 1.1.0 was cut. It was frozen by
`scripts/freeze-release-fixture.ts` run in a worktree of that commit (TZ=UTC,
clock fixed at 2026-10-07T09:00:00Z). Made-up Test kit names only.

Unlike 1.0.0, its ledger entries are **signed** (#193). The script signs them
with a fixed, made-up key (device `00000000-0000-4000-8000-00000000fee1`), as
a phone does with its own key, so the bytes are reproducible.

The 1.0.1 TestFlight build (commit `235614f`) wrote unsigned entries. That
format is the 1.0.0 one, and `release-1.0.0` covers it.

- `store.json`: every stored key and its value, byte for byte.
- `expected.json`: the figures 1.0.1 showed for it (`releaseFigures`). These
  are the same as 1.0.0's, because the seed and the figures did not change.
- `release.json`: the commit, clock, schema and ledger versions and migrations.

**Never edited.** `releaseUpgrade.test.ts` checks these files against the
hashes in `../releases.json`. A later build that cannot read them, or reads
different figures, is the bug (#167).
