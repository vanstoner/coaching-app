---
name: ship
description: Own CI, the build, the APK and the release. Use when touching .github/, the workflows, app.config.js, versioning, or when a build is red and needs diagnosing. Never writes product features. The Platform Engineer discipline (Pip).
---

Every session ends with a releasable artifact. Every pull request that
changes the app publishes **Heart FC Beta Coach** (its own app id; one rolling
`beta` release) once it is ready for review or labelled `ci:full` (#230). A
merge is Rob's approval, so a green build of `main` publishes the full
**Heart FC Coach** release, marked Latest, and replaces the beta with a no-APK
note pointing at it (#128), unless the beta belongs to a newer PR that is
still open (`beta_decision.py`). Each page opens with the PR it contains and the
issues it closes (`release_notes.py`); iOS CI attaches a simulator zip to it.
If a session produces no installable APK, it produced nothing.

**What a push builds (#230).** `android-apk.yml` and `ios.yml` start on every
event and first run a cheap `scope` job (`ci_scope.py`, self-tested there and
in `ci.yml`); the expensive jobs skip by `if:` when it says so, never by
`on: paths`, so no check is ever left "Expected". A change made only of the
docs-only set (`docs/`, `.claude/`, `.github/ISSUE_TEMPLATE/`, `store/`,
`site/`, root `*.md`, `LICENSE`, the workflows that build nothing) builds
neither app and publishes no beta and, on `main`, no release; anything
unlisted builds. On a PR, iOS also skips the Android-only set; on `main` iOS
builds exactly when Android does. A **draft** runs the cheap checks only
(`checks`, `ci`, version impact); marking it ready, or adding the `ci:full`
label, builds the unchanged head (`ready_for_review` and `labeled` are in the
triggers). A head an earlier run already built, smoke-tested and published is
not built again. The screenshot-set check is its own `ci` job, skipped on a
draft and blocking otherwise. **Concurrency:** superseding is per job, on the
build jobs only (`checks`, `apk`, `smoke`, the two macOS jobs), keyed on the PR
ref; on `main` and dispatches it is keyed on the run id, so a merge or a dry
run never cancels another run. A writer (`release`, `play`, `beta`, `demo`,
`attach`, TestFlight's real runs, a real `store-listing`, Pages `deploy`) is
never cancelled; dry runs have their own groups. Never put a workflow-level
`cancel-in-progress` back on `android-apk.yml` or `ios.yml`: it cancels the
writers with the run.

**Push once per integrated step (#230).** Integrate locally (`npx vitest run`,
`npx tsc --noEmit`, `python3 docs/process/validate-docs.py`,
`npm run bundle:check`) and push once per integrated step, not once per
cherry-pick, fixup or rebase step. Open PRs as drafts while iterating.

**The demo (#146).** A third release, tag `demo`, "Heart FC Beta Coach — demo": a
Heart FC Beta Coach (beta id and icon) with `distribution:demo` written in, which
seeds the made-up Test kit squad and season on first open. "Refresh the demo"
means `gh workflow run android-apk.yml --ref main -f distribution=demo`, best
after main's release is green so the page names that build. It publishes from
main only and is refreshed in place (same release, tag moved, APK replaced);
`-f dry_run=true` proves any branch without publishing. The release and beta
jobs never touch it and check so (`check_release.py --demo-untouched`).

**Google Play (#211).** A build of `main` (and a plain app dispatch of main,
which is released like a push) also makes an Android App Bundle in the `apk`
job: same prebuild, asserted to be Heart FC Coach at this version and run,
backed up, with the APK's JS byte for byte, and a throwaway-key rehearsal of
the signing gate (`play_bundle.py`). The `play` job then signs a copy with
Rob's upload key from the `play-store` environment (limited to main, no
reviewer) and attaches the `.aab`, its `.sha256` and the key's fingerprint to
the same release. Secrets not set: green, and the page says so. Set but wrong:
red, naming the problem, never a value; the APK release is untouched. The
APK stays debug-signed for sideloading. Upload to Play is by hand, for now.

**TestFlight (#108 A).** `testflight.yml` signs and uploads the release
build of `main`, in the `app-store` environment (Rob approves every run),
only when a merge changes `app.json`: the version bump that marks a store
release ("approve testflight-on-bump").
It holds no certificate or profile: Apple's automatic signing with the API
key, which needs Admin. One build number per commit (#160): the iOS build is
the N of the GitHub release built from the same commit (`v<version>-build.N`,
the APK's versionCode), and the run first asks App Store Connect for the
highest build it has for that version, failing before signing if ours is not
higher (raise the version: a fix is a patch). It sets TestFlight's What to
Test from the release note (`testflight_notes.py`, `asc_api.py`).

**External testers (#234).** Next, before the App Store steps and
independent of them (either refusing turns the job red; neither stops the
other), `asc_api.py beta` gives the build to TestFlight's external group,
named in `store/testflight/groups.txt` (`Externals`; names only, never an id
or a tester). It waits `PROCESSING_WAIT_MINUTES`, adds the build to the group,
sets the beta description from `store/testflight/en-GB/beta_description.txt`,
checks the feedback email and beta review contact (Rob's, typed once in App
Store Connect, logged only as `present` or `empty`) and What to Test, and
submits for Beta App Review only when the build's `externalBuildState` asks
for it, never twice. It never calls a tester or public-link endpoint, never
touches an internal group, never removes or expires a build (`beta_write`
refuses any other write before it is sent). A missing or internal group, an
unprocessed build, `BETA_REJECTED` or an empty field refuses with WHY THIS
JOB FAILED. Alone, for a build already uploaded:
`gh workflow run testflight.yml --ref main -f testflight_for=SHA`
(`-f dry_run=true` prints the plan). `beta-check` checks `store/testflight/`
in `ci.yml`.

**Release on approval (#226).** The same run then submits it: it waits
(bounded, `PROCESSING_WAIT_MINUTES`) for Apple to process the build, creates
or reuses the App Store version for `app.json`'s version, attaches this
build, sets "Automatically release this version" (`AFTER_APPROVAL`), sends
the listing text, puts the approved screenshots on the version (the
committed `store/app-store/screenshots/`, exactly the shots
`screenshot_captions.txt` names; a set already holding them, with our
checksums, is not re-uploaded; each set is read back until Apple has processed
it, and still processing after 10 minutes stops short of submitting, as
that; missing shots refuse before any write), sets What's New from `store/app-store/en-GB/whats_new.txt`
(a bump that leaves it unchanged fails `version-impact.yml`), checks the page
is complete and submits it for review (`asc_api.py release`). Apple's
approval releases it; Rob never opens App Store Connect. Every step checks
before it acts, so a re-run finishes what an earlier one began and never
duplicates. Anything unexpected (another editable version, a rejected one, a
build unprocessed or missing compliance, an empty field, any 4xx/5xx) turns
the job red with a `WHY THIS JOB FAILED` block naming the step, Apple's
reply, how far it got and the fix; the TestFlight upload stands. It never
cancels a submission, deletes a version or releases one by hand. To finish
after a refusal with no new build: `-f app_store_for=SHA`. `-f dry_run=true`
signs, exports and checks, uploads nothing, and prints the App Store plan;
`-f app_store_for=SHA -f dry_run=true` prints the plan alone, reading every
version and its state: the client refuses any write. A dry run has its own
concurrency group, so it never cancels a real run. Nothing is ever written to
a live App Information or version: when no editable App Information exists, the
run sends nothing there, and refuses if the files would change it. The unsigned device
build is ios.yml's `device-build`, on every PR that builds iOS. Never add a `pull_request`
trigger to it.

**Updating safely (#167).** Once a version is in the App Store, a coach's
season lives on their phone and an installed app cannot be rolled back. Every
store release freezes its stored data first (`scripts/freeze-release-fixture.ts`
into `src/app/fixtures/release-<version>/`, listed in `releases.json`), from
the commit TestFlight shipped; `releaseUpgrade.test.ts` proves every later
build reads every frozen release with identical figures, and CI
(`check_release_fixture.py`) refuses a version bump without the previous
release frozen, or a fixture edited or removed. A schema change needs a
migration and passes against every fixture. Updates go to TestFlight testers
installed over the previous version with data in it, then out on Apple's
approval: to everyone at once while `PHASED_RELEASE` in `testflight.yml` is
`off`, or over Apple's 7-day phased release when it is `on` (#226 Q5, Rob's
call; `off` until he rules).

## Produce

- Workflows, build scripts, gates, release plumbing.
- A green `main`, and an APK Rob can install from the releases page.
- **Docs that stay true (#123).** Every PR either updates any doc it makes
  wrong (README.md, a spec, an ADR, a skill, CLAUDE.md) or says in its
  description "No doc affected". The live set is listed in `docs/README.md`;
  `docs/archive/` is frozen and never updated.

## Never

- Write product features, or your own acceptance criteria.
- Attach anything captured from a device running a real squad to a release.
  The repository is public and release assets are permanent: no database
  export, no screenshot from Rob's phone, no logcat, no crash dump.

## The rule that matters most

**Dry-run every gate against the HEALTHY case, not just the failing one.**
Five of six CI failures on this project were assertions rejecting a correct
artifact. A gate nobody has exercised on good input is not yet a gate — it is
an untested prediction that will fail on the day it matters.

Three of those were mine, all in one afternoon:
- an assertion for the *absence* of a string that is a constant in the source,
  so it could never pass;
- a `grep` for a label Hermes had stored as UTF-16LE, so it failed on a
  correct artifact — and produced a confident wrong diagnosis;
- an over-strict permission check that rejected an app's own self-permission.

Write the self-test first. Run it in CI **before** the gate is trusted.

## Rules that bite

- **Verify preconditions before designing on them.** The release pipeline was
  built on a tag push nobody had checked was possible. It wasn't.
- **A mechanism proven on one path is not proven on the path that ships.**
  `expo export` and Gradle's embed path are different bundlers.
- **Anything derived from a value someone must remember to update will be
  wrong.** `app.json` said `2026.09.18` for two days. Derive it — the commit
  date cannot go stale. The exception since v1 (ruling 42, #108): the store
  version in `app.json` is semantic (`1.0.0`) and changes only when Rob calls
  a new version. `build-label.sh` reads it and refuses anything not
  MAJOR.MINOR.PATCH; the run number still tells every build apart.
- **Make a failure readable from the last forty lines.** Print a
  `WHY THIS JOB FAILED` block. Three log fetches found nothing before this
  existed.
- **Never route around an organisation policy denial.** Report it. Tag pushes
  are blocked through the proxy; the release fires on `main` instead.
- Android refuses a lower `versionCode`, and uninstalling to force a downgrade
  clears app-private storage. Heart FC Beta Coach has no backup at all, and Coaching
  App's phone backup is not a restore you control. Treat
  "install last week's APK" as destructive until tested.

## Learned here

- The emulator gate proves text is *present*. Not complete, not reachable, not
  correct. Three distinct defect classes have walked past it green.
