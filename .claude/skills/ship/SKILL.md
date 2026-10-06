---
name: ship
description: Own CI, the build, the APK and the release. Use when touching .github/, the workflows, app.config.js, versioning, or when a build is red and needs diagnosing. Never writes product features. The Platform Engineer discipline (Pip).
---

Every session ends with a releasable artifact. Every pull request
publishes **Heart FC Beta** (its own app id; one rolling `beta` release). A
merge is Rob's approval, so a green build of `main` publishes the full
**Heart FC Coach** release, marked Latest, and replaces the beta with a no-APK
note pointing at it (#128), unless the beta belongs to a newer PR that is
still open (`beta_decision.py`). Each page opens with the PR it contains and the
issues it closes (`release_notes.py`); iOS CI attaches a simulator zip to it.
If a session produces no installable APK, it produced nothing.

**Identity and version (#108, v1).** Ids `com.vanstoner.coachingapp` and
`.beta` on both platforms (Android was `com.example.*` until ruling 41).
Home-screen names "Heart FC Coach" and "Heart FC Beta" (ruling 40), asserted on
the APK's `application-label` (`check_identity.py`) and the `.app`'s
`CFBundleDisplayName` (`check_ios_app.py`, with
`ITSAppUsesNonExemptEncryption` false, B1). Release titles follow the names
(Q1); releases from before keep "Coaching App"/"Coaching Beta", so anything that
reads a title or merge note accepts both (`BETA_NAMES`, `MERGED_NOTES`). The
marketing version is `app.json`'s `version`, semver, `1.0.0` (ruling 42); it is
the one value here someone must remember to bump, by Rob's choice, and
`build-label.sh` refuses anything that is not MAJOR.MINOR.PATCH. The build
number (versionCode, CFBundleVersion, `-build.N`) is the run number and only
ever goes up. Tags are `v<version>-build.N`.

**The demo (#146).** A third release, tag `demo`, "Heart FC Beta — demo": a
Heart FC Beta (beta id and icon) with `distribution:demo` written in, which
seeds the made-up Test kit squad and season on first open. "Refresh the demo"
means `gh workflow run android-apk.yml --ref main -f distribution=demo`, best
after main's release is green so the page names that build. It publishes from
main only and is refreshed in place (same release, tag moved, APK replaced);
`-f dry_run=true` proves any branch without publishing. The release and beta
jobs never touch it and check so (`check_release.py --demo-untouched`).

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
  date cannot go stale. The one exception is ruled: since v1 the marketing
  version is a typed semver (#108 ruling 42); everything that must increase
  is still derived.
- **Make a failure readable from the last forty lines.** Print a
  `WHY THIS JOB FAILED` block. Three log fetches found nothing before this
  existed.
- **Never route around an organisation policy denial.** Report it. Tag pushes
  are blocked through the proxy; the release fires on `main` instead.
- Android refuses a lower `versionCode`, and uninstalling to force a downgrade
  clears app-private storage. Heart FC Beta has no backup at all, and Heart FC
  Coach's phone backup is not a restore you control. Treat
  "install last week's APK" as destructive until tested.

## Learned here

- The emulator gate proves text is *present*. Not complete, not reachable, not
  correct. Three distinct defect classes have walked past it green.
