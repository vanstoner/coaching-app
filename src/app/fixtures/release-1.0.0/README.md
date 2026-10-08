# Release 1.0.0, frozen

What Heart FC Coach 1.0.0 (TestFlight build 401, GitHub release
v1.0.0-build.133) stores, written by that release's own code: commit
`13820e450b8e49e000676256678977c67577a12f`, by
`scripts/freeze-release-fixture.ts` run in a worktree of that commit
(TZ=UTC, clock fixed at 2026-10-07T09:00:00Z). Made-up Test kit names only.

- `store.json`: every stored key and its value, byte for byte.
- `expected.json`: the figures 1.0.0 showed for it (`releaseFigures`).
- `release.json`: the commit, clock, schema and ledger versions and migrations.

**Never edited.** `releaseUpgrade.test.ts` checks these files against the
hashes in `../releases.json`. A later build that cannot read them, or reads
different figures, is the bug (#167).
