# Retrospective — 2026-09-18

**Author:** independent analyst, commissioned by the Product Owner. Not a member
of the squad. Every figure below comes from a command run against this repository
or the GitHub API on 2026-09-18; the commands are shown where the number matters.

**Window under review:** first commit `2eb260d` at `2026-09-17T11:42:30+01:00` to
head `2f5bf0b` at `2026-09-18T16:55:35+01:00` — **29 hours 13 minutes elapsed**.

---

## Verdict

Rob is right, and the reason is worse than stalling. There is no APK on his phone
because the job that would publish one has **never executed** — it is gated on
`startsWith(github.ref, 'refs/tags/v')`, the repository has **zero tags and zero
releases**, and the session that built the gate could not push a tag. The fix for
that — re-gating the release on a push to `main` — is **sitting uncommitted in the
working tree right now**, so the fully green build of `main` that finished at
`16:06:36` today skipped the release job for the same reason as every build before
it. Meanwhile **60.8% of every line written on this project is documentation** and
**1.1% is the app**: the Android pipeline that ships a 55-line static screen is
1,629 lines long, and that screen imports nothing from the engine.

---

## Where the time went

Derived from `git log --numstat --pretty='C %h'` over all 12 commits on `main`,
bucketed by path. `package-lock.json` (+8,275/−866) is generated and excluded.

| Category | Lines added | Lines deleted | Share of authored lines |
|---|---:|---:|---:|
| Documentation — specs, ADRs, process, roles, KB, `CLAUDE.md`, `HANDOFF.md` | 6,147 | 301 | **60.8%** |
| CI / build machinery — `.github/`, `.claude/` | 1,973 | 94 | **19.5%** |
| Match engine — `src/` (pure TS, no UI, not imported by the app) | 1,752 | 0 | **17.3%** |
| Build config — `package.json`, `tsconfig.json`, `vitest.config.ts` | 117 | 10 | 1.2% |
| **The app a coach would see** — `App.tsx`, `index.ts`, `app.json`, `app.config.js` | **114** | 2 | **1.1%** |
| **Total (non-lock)** | **10,103** | 407 | 100% |

**80.3% of the project's output is process and plumbing.** Documentation alone
outweighs all executable product code by 3.2:1.

### Was Rob right that "the workflow file is massive"?

Yes, decisively. `wc -l`:

| File | Lines |
|---|---:|
| `.github/workflows/android-apk.yml` (committed at HEAD) | 453 |
| `.github/workflows/android-apk.yml` (working tree, uncommitted) | 514 |
| `.github/scripts/emulator-smoke.sh` | 294 |
| `.github/scripts/smoke_assert.py` | 473 |
| `.github/scripts/test_smoke_assert.py` | 328 |
| `.github/scripts/fixtures/make-fixtures.py` | 81 |
| **APK pipeline total** | **1,629** |
| `App.tsx` + `index.ts` + `app.config.js` + `app.json` | **112** |

**The delivery mechanism is 14.5× the thing it delivers.** The workflow file alone
is 8.2× `App.tsx`. There are 328 lines of unit tests *for the screenshot asserter*
and zero lines of UI that a coach could press.

### Rework — the category to look hardest at

`curl .../actions/runs?per_page=100`: **33 workflow runs**. CI (vitest/tsc/docs):
**18 runs, 18 successes, 0 failures** — the engine lane never broke. Android APK:
**15 runs, 6 failures**. Fetching each failed run's `/jobs` and reading the failed
step name gives the cause of every one:

| Run | Failed step | Cause | Category |
|---|---|---|---|
| APK #1 | Assert the APK is valid, signed and backup-disabled | assertion pipeline died on SIGPIPE under `pipefail` | **self-inflicted assertion** |
| APK #2 | Assert the APK is valid, signed and backup-disabled | assertion parsed an `aapt2` output format build-tools 37 does not emit | **self-inflicted assertion** |
| APK #3 | Build debug APK | Gradle downloading the NDK mid-build | build tooling |
| APK #4 | Ensure the NDK the Gradle build asks for is installed | the NDK install step judged success by exit code, not by the directory | **self-inflicted assertion** |
| APK #12 | Assert the APK is valid, signed and backup-disabled | the #44 permission gate failed the build on `com.example.coachingapp.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, an app-scoped self-permission that grants nothing | **self-inflicted assertion (over-strict gate)** |
| APK #13 | Boot an emulator, install the APK and assert the app renders | the standalone gate tested `[ -s "$OUT/reverse-tunnels.txt" ]`; `adb reverse --list` prints one blank line when nothing is forwarded, so the gate failed **exactly on the healthy case** | **self-inflicted assertion** |

**5 of 6 Android failures — 83% — were the pipeline failing its own assertions on
a correct artifact.** Not one failure was a product defect. Commit `3299111`
records that run 13 produced a perfect result and failed anyway:

> `content region 320x524 (167680 px); dominant colour #0b3d2e covers 95.4067%` …
> `found 'Example FC' in OCR of the frame` … `frame assertions passed`
> — and then `ASSERTION FAILED: adb reverse tunnels still present`.

Commit `040b3c8` says the same of the permission gate: *"built the release APK
correctly and failed on my own assertion, not on the artifact."*

The fix-up commits inside the infrastructure PRs make the rework visible:
`git log` for PR #40 shows **4 consecutive fix-up commits** (`4f21782`, `1c61504`,
`29f0368`, `1b76348`) after the initial one, and PR #49 shows **2** (`040b3c8`,
`3299111`). **6 of the 13 commits across the three infrastructure PRs — 46% —
existed only to repair the previous commit's CI.**

### Specification versus code

| Artefact | Lines | Executable? |
|---|---:|---|
| `docs/specs/02-match-engine.md` | 948 | no |
| `docs/specs/01-domain-model.md` | 454 | no |
| `docs/specs/03-fairness-ledger.md` | 187 | no |
| 11 ADRs | ~700 | no |
| `docs/process/*` (5 files) + 2 OMPs | ~900 | no |
| `docs/roles/*` (6 files) + `.claude/agents/*` (5) | ~800 | no |
| `src/engine/MatchEngine.ts` | 438 | yes — 66 passing tests |
| `App.tsx` | 55 | yes — renders a static string |

Spec 02 alone was rewritten across **five** commits (`007d44d`, `51f8bc3`,
`181ae66`, `e244fb9`, `9311af9`) totalling +990/−215 lines in a single afternoon,
resolving open questions 1–18. It describes an engine that has never been built:
issue #35, the reshape that would implement the spec-and-ADR-007 shape, is
**parked with zero lines written**.

### The largest single write-off

Issue #35 (ADR-007 event-log reshape) received, in one evening: BA acceptance
criteria, **seven Architect rulings**, **six PO rulings**, a drafted-then-cancelled
ADR-012 and a withdrawn ADR-013 — and was then parked on 2026-09-18 with, in the
park comment's own words, *"not one line has been written."* On 2026-09-17 at
18:13 it had been ruled to go **before** Slice 0, with the accepted cost recorded
as *"a runnable APK is two units of work away rather than one."* That sequencing
decision cost most of an evening and was reversed the next day.

---

## What Rob got right

These are load-bearing and should not be lost in the frustration.

1. **Killing ADR-012 before it was written.** *"ADR-012 is NOT written. Stamp the
   number, nothing more"*, and the steer *"just keep it light and flexible — we'll
   harden an implementation later."* This collapsed a schema-versioning design into
   a four-field `AvailabilityChanged` event. Directly prevented several hundred
   more lines of unexecuted specification.
2. **The proportionality clause in `CLAUDE.md`** (*"this app reminds the coach to
   make a substitution … not audit-grade timing"*). It is the only written brake on
   this project's dominant failure mode, and it is the standard the park ruling was
   eventually decided against.
3. **Noticing spine-versus-production drift and naming the platform gap.** The
   Platform Engineer role (`docs/roles/platform-engineer.md`, 104 lines,
   `.claude/agents/platform-engineer.md`) exists because Rob identified that nobody
   owned the path from source to phone. Commit `c081256`.
4. **Insisting a release be cut automatically by CI.** *"actually let's use github
   to store release artifacts and it's 'release' mechanism. I need the CI pipeline
   to create these and use githubs native stores."* This overturned a proposal to
   have Claude hand-upload builds to Google Drive — which would have made every
   release depend on a session being awake, and which the session has since been
   proven incapable of doing anyway (403 on the releases API).
5. **Demanding empirical verification of Pip's release-design claims** rather than
   accepting inference. That instruction is what uncovered the 403s that explain
   this whole retrospective.
6. **Waiving A6 knowingly and on the record** (#40, 2026-09-18) rather than
   silently. It was a defensible trade and it is documented as a trade.

## What Rob cost

Even-handed, and quantified where possible.

1. **Approval latency on green builds: 13 h 09 m of a 29 h 13 m project — 45% of
   elapsed time.** PR #40's last commit and green run were at `22:21:40`; it merged
   at `05:03:28` (6 h 42 m). PR #45 went green at `05:35:03` and merged at
   `12:02:23` (6 h 27 m). Both were overnight and entirely human, which is normal —
   but it means throughput was never the constraint, and the squad spent that time
   producing more documents instead of queueing the next build.
2. **Reversing the #35 sequencing ruling.** Ruling it first (17th, 18:13) and
   parking it (18th, 12:12) wrote off a full BA + Architect + PO specification pass.
   The park comment is honest that *"that cost estimate turned out to be badly
   wrong"* — but it was Rob's ruling, made against an explicit alternative that had
   been put to him and rejected.
3. **Four redesigns of the release mechanism in one afternoon, none shipped.**
   D6 (Claude uploads to Drive) → D6 superseded (GitHub Releases on tag) → D9
   (draft on tag, published at test sign-off) → D10 (the PO publishes by hand,
   because the session cannot) → and now, uncommitted, publish-a-prerelease-on-main.
   Every one of these was ruled between `11:47` and `15:55` on 2026-09-18, the same
   hours in which Rob wanted an APK. **Zero releases exist.**
4. **Process work commissioned while nothing shipped.** OMP-003 (#27, model
   selection by task complexity), #38 (CODEOWNERS and per-role GitHub identities),
   OMP-004 (#47, Dev/Test/Prod promotion and audit trail), and
   `docs/process/site-and-metrics.md` (165 lines, status *"Design — for Product
   Owner review"*, never built). All four were requested by Rob. None of them puts
   an APK on a phone. OMP-004 in particular consumed the 11:47–12:12 window
   designing a promotion ladder for an artifact that has never once been released.
5. **Mid-flight scope additions inside open work.** The `quarterCount` →
   `periodCount` rename (≈474 occurrences in `src/`) and the folding of issue #25
   were both added into #35 *after* its acceptance criteria were drafted. Both were
   individually reasonable; together they made the one blocking item bigger, which
   is part of why it became unparkable-sized and then parked.

---

## Why this is not operating as a team

Four structural findings. Each is checkable.

**1. There is one person in this repository, and it is Rob.**
```
curl .../issues?state=all&per_page=100  → Counter({'vanstoner': 49})
curl .../pulls?state=all&per_page=100   → Counter({'vanstoner': 15})
curl .../issues/comments?per_page=100   → Counter({'vanstoner': 40})
```
Every issue, every pull request and all 40 comments — including every "QA
verification", "Architect ruling" and "BA acceptance criteria" — are authored by
the Product Owner's own GitHub account. The approval gate in `CLAUDE.md` ("he says
`approve <n>`; Claude merges") is a gate the approver also wrote both sides of.
Issue #38 states this plainly: *"the audit trail is currently fiction."* It is
backlogged, not fixed.

**2. The `Squad-Role:` convention, which `CLAUDE.md` makes mandatory for every
commit, is honoured on 1 commit in 12.**
```
git log --pretty='%h%n%B' | grep -c 'Squad-Role'  → 1  (Pip, Platform Engineer)
```
Squash-merging collapses per-role branch commits into one PO-authored commit, so
the chain of custody the role names exist to create does not survive into `main`.

**3. Implementers set their own pass mark, which the charters forbid.**
`CLAUDE.md`: *"The Engineer does not write its own acceptance criteria."* No BA
acceptance criteria were ever written for the release pipeline (#47) or for #46;
the workflow, the permission gate and the release job were specified and judged by
whoever wrote them. Predictably, three of the six CI failures are that author's own
assertion being wrong about its own artifact. Compare the engine lane, where the BA
wrote criteria and QA verified against them: **18 CI runs, zero failures.**

**4. Work reverts silently to the orchestrator when an agent dies.**
PR #49's body: *"Pip wrote the smoke script and the config (commit `6037adb`) and
was cut off mid-task by a session rate limit. The orchestrator wrote the workflow
(`93e31bd`) rather than respawning an agent."* Commit `93e31bd` is the one that
introduced the over-strict permission gate that failed run 12. Issue #48 documents
the related failure: the stop hook cannot tell an agent mid-edit from abandoned
work. There is no supervision, no retry and no handback — a dead agent becomes the
orchestrator doing the work without the role's constraints.

**5. Decisions are being lost exactly as the written rule predicts.**
`docs/process/operating-model.md:114`: *"A decision that exists only in chat has
not been made."* Yet:
- The parking of #35 — the single largest scope decision of the project — appears
  **nowhere in `docs/`**: `grep -rln "PARKED\|parked" docs/ .claude/` returns
  nothing. `docs/process/delivery-slices.md` still instructs that *"the ADR-007
  engine reshape (#35) goes first, before Slice 0"* and that Slice 0b waits for it.
  Its changelog stops at 2026-09-17.
- All three specs still read `Status: Draft for Product Owner review`, while
  `CLAUDE.md` requires *"Specs are approved before implementation"* and 438 lines
  of engine have been implemented against them.
- `ADR-003` is marked **Superseded**; the shipping engine implements ADR-003.
  `ADR-007` is marked **Accepted** with no note that its implementation is parked
  indefinitely. A reader of `docs/decisions/` today gets the wrong answer about
  what this codebase does.
- **21 of 34 issues are open**, including all ten REQ-* requirement issues.

---

## Why there is no APK

The blocker chain, in order, each link evidenced.

1. **17th 19:12 — 19:51.** The APK pipeline failed four consecutive runs on its own
   assertions and on NDK provisioning. Fixed by `4f21782`, `1c61504`, `29f0368`,
   `1b76348`. First green Android build: run 5, `2026-09-17T19:51:13Z`.
2. **17th 22:21 — 18th 05:03.** PR #40 sat green awaiting approval for 6 h 42 m.
3. **18th 05:03.** #40 merged with **A6 waived** — nothing had ever confirmed the
   app renders. The merge comment states the accepted risk exactly: *"Slice 0a is
   merged on proof that it compiles, signs and declares the right manifest, not on
   proof that it works."*
4. **18th 05:21 — 12:02.** The emulator smoke test (#43/#45) was built to close that
   gap: 1,176 lines of harness, including 328 lines of tests for the asserter. It
   went green at `05:35` and merged at `12:02` — 6 h 27 m of approval wait.
5. **18th 11:20.** #46: the artifact being published **was a debug APK with no
   embedded JS bundle** — it needed a Metro dev server to render. Had Rob sideloaded
   any build before this point, he would have got a red error box. The smoke test had
   been masking it by running Metro inside CI, so the harness built in step 4 was
   proving the app code renders, not that *the artifact* does.
6. **18th 15:12, 15:26.** The fix (release variant + permission gate) failed twice
   more on the two self-inflicted assertions described above.
7. **18th 15:40 / 15:55.** PR #49 green, merged.
8. **The actual, present blocker.** The release job has **never executed once**:
   ```
   curl .../releases → []      curl .../tags → []
   ```
   At HEAD it is gated on a tag:
   ```
   git show HEAD:.github/workflows/android-apk.yml | grep -A4 '^  release:'
     if: startsWith(github.ref, 'refs/tags/v')
   ```
   **Nobody verified that this session could push a tag before building the pipeline
   on that assumption.** It cannot: `git push` of a tag ref disconnects, and
   `POST /git/refs` returns `403 "Write access to this GitHub API path is not
   permitted through this proxy"`. The same session type is also refused by
   `POST /repos/.../releases` — `403 "Creating, editing, or deleting releases is not
   permitted for this session type"` (#47, 12:07). So the release mechanism was
   designed in the 11:47–12:12 window around a human act the session had no way to
   perform and had not tested.
9. **And the fix is not committed.** `git status --short` returns
   `M .github/workflows/android-apk.yml` — **94 insertions, 32 deletions,
   uncommitted**. Those changes re-gate the release on `github.ref ==
   'refs/heads/main'` and have CI create the tag itself with `gh release create
   --target`. They exist only on this disk. Consequently the fully green push build
   of `main` (run 15, `apk` success `16:03:28`, `smoke` success `16:06:36`) ended:
   ```
   JOB: Cut the release   completed   skipped   2026-09-18T16:06:36Z
   ```
   **A correct, standalone, smoke-tested release APK was built 50 minutes ago, has
   an emulator screenshot proving it renders, and was thrown away because the job
   that would publish it is still gated on a tag that cannot exist.**

The artifact is not missing. It is sitting in an Actions artifact that expires in
89 days, one uncommitted file away from Rob's phone.

> **Addendum, 16:11 UTC, written while this retrospective was being compiled.**
> The working-tree change described in step 9 was committed at `16:09:32` as
> `596b243` *"Cut a release on every green build of main, and publish it"* and has
> reached `main` (head `000eb17`), with Android APK run 17 `in_progress` at the time
> of writing. `curl .../releases` still returns `[]`. The finding above is recorded
> as measured — the gate was tag-only and the fix was uncommitted for the whole of
> the day in question, which is why run 15 skipped the release job at `16:06:36`
> on a fully green build. Whether run 17 finally publishes an asset is now the
> first real test of the pipeline; it has never passed one.

---

## The five changes that would matter most

**1. Land the release gate and then watch it actually publish.**
Ranked first because it is the entire remaining distance to the deliverable. The
commit landed at `16:09:32` (`596b243`) while this was being written; what has *not*
happened is a release object existing. Do not report this as done until
`curl .../releases` returns a non-empty array with an `.apk` asset and Rob has
installed it. Every prior claim of progress on this pipeline has been a claim about
a build, not about a downloadable file.
*Prevents:* a finished, verified artifact being discarded on every build.

**2. Verify the hard precondition before designing on top of it.**
The whole release design assumed a tag could be pushed. Thirty seconds of `git push
--dry-run origin refs/tags/probe` or a `POST /git/refs` on the 17th would have
killed the tag-gated design before 500 lines of YAML were written around it.
Make it a rule: any pipeline whose trigger depends on an action this environment
must perform gets that action probed, and the probe output pasted, before the
pipeline is written.
*Prevents:* the class of failure that produced 0 releases from 15 builds.

**3. Every assertion gate must be proven against the healthy case before it gates
anything.** Five of six Android failures were gates wrong about a correct artifact.
The `[ -s ]`/blank-line bug and the self-permission bug were both found by CI at
~11 minutes a run; both would have been found in seconds by a local dry-run against
a stub — which `3299111` shows Pip did, *after* being burned. Make it mandatory and
make the dry-run output part of the PR evidence, exactly as `npx vitest run` already is.
*Prevents:* ~6 CI cycles and roughly an hour of Rob's day per infrastructure PR.

**4. No acceptance criteria, no merge — including for infrastructure.**
`CLAUDE.md` already forbids an implementer writing its own pass mark, and the
engine lane (BA criteria + QA verification) is 18-for-18 on CI while the
infrastructure lane, which had none for #46/#47/#49, is 9-for-15. Apply the
existing rule to Pip's work instead of exempting it.
*Prevents:* the implementer-judges-itself failures in items 3, 5 and 6 of the
rework table.

**5. Cap process work against shipped product, and make the cap a number.**
Documentation is 60.8% of this project and the app is 1.1%. Until a coach can
press something, freeze OMP-003 (#27), #38, `site-and-metrics.md` and OMP-004's
promotion ladder, and require that any new document names the working feature it
describes. `CLAUDE.md`'s proportionality clause is the right principle and it lost
every contest it was in today; give it a measurable form.
*Prevents:* the next 29 hours going the way of the last 29.

---

### Two smaller things worth fixing while they are cheap

- **Record the #35 park in `docs/`.** It currently exists only as a GitHub issue
  comment, in a project whose own operating model says that means it has not been
  decided. `docs/process/delivery-slices.md` actively contradicts it.
- **Correct the ADR statuses.** ADR-003 is Superseded but is what runs; ADR-007 is
  Accepted but is parked. Add the deferral note to ADR-007 and a "still in force
  pending ADR-007 implementation" note to ADR-003.

---

*Commands used for every figure in this document: `git log --date=short
--pretty='%h %ad %s'`, `git log --numstat`, `git status --short`, `git show
HEAD:.github/workflows/android-apk.yml`, `wc -l`, `npx vitest run` (66 passed),
`python3 docs/process/validate-docs.py` (78 links, 11 ADRs, 3 specs — passed), and
`curl https://api.github.com/repos/vanstoner/coaching-app/{issues,pulls,releases,tags,actions/runs,actions/runs/:id/jobs,issues/comments}`.
GitHub Actions job logs could not be downloaded — the log endpoint redirects to a
host the egress proxy refuses with `CONNECT tunnel failed, response 403` — so
failure causes were taken from failed **step names** plus the fix commits'
messages, which quote the run output verbatim.*
