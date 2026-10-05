#!/usr/bin/env python3
"""Assert a build of main became THE release — #79, PO ruling "approve 1 2"; #128.

The model: a pull request publishes Coaching Beta (one rolling `beta`
prerelease); Rob's approval merges it, and the build of main publishes the
full Coaching App release, marked Latest. No in-between prerelease of the
real app.

#128 AC3 ("approve 11"): the merge no longer leaves the beta EMPTY. The `beta`
prerelease is replaced by a note, "Merged into Coaching App build N — install
that instead", linking the release, with NO .apk, until the next PR's beta
replaces it. (Until #128 this check asserted the beta was absent.)

Except: when beta_decision.py chose `keep` because an open PR's newer beta
published while this build ran, that beta (with its APK) must still be there,
untouched. Only the kept case accepts a PR beta.

Read back from GitHub after publishing, not assumed from the flags passed:

    check_release.py RELEASE_JSON LATEST_TAG BETA_JSON EXPECTED_TAG [replace|keep]
    check_release.py --self-test

RELEASE_JSON is `gh release view TAG --json tagName,isPrerelease,isDraft,assets`;
LATEST_TAG is what /releases/latest reports; BETA_JSON is
`gh release view beta --json name,tagName,isPrerelease,isDraft,assets,body`, or
the word `none` when there is no beta release. The last argument is
beta_decision.py's verdict; it defaults to `replace`.

The self-test runs in PR CI before the release job ever trusts this, and
dry-runs the HEALTHY case first: five of six CI failures on this project were
gates rejecting a correct artifact.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from beta_decision import parse_title  # noqa: E402


def check(release, latest_tag, beta, expected_tag, beta_action="replace"):
    """Return a list of problems; empty means main's build is the release."""
    problems = []
    if release.get("tagName") != expected_tag:
        problems.append(f"release tag is {release.get('tagName')!r}, expected {expected_tag!r}")
    if release.get("isDraft"):
        problems.append("the release is a draft")
    if release.get("isPrerelease"):
        problems.append("the release is a prerelease; a build of main must be a full release")
    if latest_tag != expected_tag:
        problems.append(f"Latest is {latest_tag!r}, expected {expected_tag!r}")
    apks = [a.get("name", "") for a in release.get("assets", []) if a.get("name", "").endswith(".apk")]
    if len(apks) != 1:
        problems.append(f"expected exactly one .apk asset, found {len(apks)}")
    if beta_action == "keep":
        problems.extend(kept_beta_problems(beta))
    else:
        problems.extend(beta_problems(beta, expected_tag))
    return problems


def kept_beta_problems(beta):
    """The kept case only: a newer open PR's beta, left exactly as it was."""
    if beta is None:
        return ["the `beta` was to be kept, but there is no `beta` release"]
    out = []
    kind, n = parse_title(beta.get("name"))
    if kind != "pr":
        out.append(f"the kept `beta` is not a PR beta (title {beta.get('name')!r})")
    if not beta.get("isPrerelease"):
        out.append("the kept `beta` is not a prerelease, so it could compete with Coaching App")
    if beta.get("isDraft"):
        out.append("the kept `beta` is a draft")
    apks = [a.get("name", "") for a in beta.get("assets", []) if a.get("name", "").endswith(".apk")]
    if len(apks) != 1:
        out.append(f"the kept `beta` should carry its PR's APK; found {len(apks)} .apk asset(s)")
    if "Merged into Coaching App build" in (beta.get("body") or ""):
        out.append("the kept `beta` is a merged note, not a PR beta")
    return out


def beta_problems(beta, expected_tag):
    """#128 AC3: after a merge `beta` is a no-APK note pointing at the release."""
    if beta is None:
        return ["there is no `beta` release; a merge replaces it with a note, not nothing"]
    out = []
    if not beta.get("isPrerelease"):
        out.append("the `beta` note is not a prerelease, so it could compete with Coaching App")
    if beta.get("isDraft"):
        out.append("the `beta` note is a draft")
    apks = [a.get("name", "") for a in beta.get("assets", []) if a.get("name", "").endswith(".apk")]
    if apks:
        out.append(f"the `beta` note still carries an APK ({', '.join(apks)}); the merged beta must not be installable")
    body = beta.get("body") or ""
    if "Merged into Coaching App build" not in body:
        out.append("the `beta` body does not say \"Merged into Coaching App build N\"")
    if f"/releases/tag/{expected_tag}" not in body:
        out.append(f"the `beta` note does not link the release {expected_tag}")
    return out


def release_of(tag, pre=False, draft=False, apks=1):
    assets = [{"name": f"coaching-app_2026.10.03_abc1234.apk"} for _ in range(apks)]
    assets.append({"name": "coaching-app_2026.10.03_abc1234.apk.sha256"})
    return {"tagName": tag, "isPrerelease": pre, "isDraft": draft, "assets": assets}


def note_of(tag, pre=True, draft=False, apk=False, body=None):
    if body is None:
        body = (f"## Merged into Coaching App build 74 — install that instead\n\n"
                f"[Coaching App build 74](https://github.com/vanstoner/coaching-app/releases/tag/{tag})")
    assets = [{"name": "coaching-beta_pr-127_abc1234.apk"}] if apk else []
    return {"name": "Coaching Beta — merged into build 74", "tagName": "beta",
            "isPrerelease": pre, "isDraft": draft, "assets": assets, "body": body}


def pr_beta_of(pr=132, pre=True, draft=False, apk=True):
    assets = [{"name": f"coaching-beta_pr-{pr}_def5678.apk"}] if apk else []
    assets.append({"name": f"coaching-beta_pr-{pr}_def5678.apk.sha256"})
    return {"name": f"Coaching Beta (PR #{pr})", "tagName": "beta", "isPrerelease": pre,
            "isDraft": draft, "assets": assets, "body": f"## Coaching Beta — PR #{pr}"}


def self_test():
    t = "v2026.10.03-build.74"
    old = "v2026.10.03-build.69"
    note = note_of(t)
    cases = [
        # (description, release, latest, beta, should pass[, beta action])
        ("healthy: full release, Latest, beta replaced by a no-APK note", release_of(t), t, note, True),
        ("healthy (kept): a newer open PR's beta left in place, APK and all",
         release_of(t), t, pr_beta_of(), True, "keep"),
        ("healthy: a simulator zip on the release does not count as an APK",
         dict(release_of(t), assets=release_of(t)["assets"] + [{"name": "coaching-app-ios-simulator_2026.10.03_abc1234.zip"}]),
         t, note, True),
        ("still a prerelease (the build-72 confusion)", release_of(t, pre=True), t, note, False),
        ("published but not Latest", release_of(t), old, note, False),
        ("left as a draft", release_of(t, draft=True), t, note, False),
        ("no APK attached", release_of(t, apks=0), t, note, False),
        ("two APKs attached", release_of(t, apks=2), t, note, False),
        ("wrong release read back", release_of(old), t, note, False),
        ("beta left empty: no note at all (the build-100 confusion)", release_of(t), t, None, False),
        ("old PR beta left in place, APK and all", release_of(t), t, note_of(t, apk=True, body="## Coaching Beta — PR #127"), False),
        ("note still carries the APK", release_of(t), t, note_of(t, apk=True), False),
        ("note not a prerelease", release_of(t), t, note_of(t, pre=False), False),
        ("note links an older build", release_of(t), t, note_of(old), False),
        ("replace case: an open PR's beta is not accepted", release_of(t), t, pr_beta_of(), False),
        ("kept beta gone", release_of(t), t, None, False, "keep"),
        ("kept beta lost its APK", release_of(t), t, pr_beta_of(apk=False), False, "keep"),
        ("kept beta is a merged note", release_of(t), t, note, False, "keep"),
        ("kept beta not a prerelease", release_of(t), t, pr_beta_of(pre=False), False, "keep"),
        ("kept beta, but the release is not Latest", release_of(t), old, pr_beta_of(), False, "keep"),
    ]
    failed = 0
    for name, release, latest, beta, should_pass, *action in cases:
        passed = not check(release, latest, beta, t, *action)
        ok = passed == should_pass
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name} -> {'pass' if passed else 'fail'}")
    print(f"{len(cases) - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) not in (5, 6) or (len(argv) == 6 and argv[5] not in ("replace", "keep")):
        print(__doc__)
        return 2
    with open(argv[1], encoding="utf-8") as f:
        release = json.load(f)
    beta = None
    if argv[3] != "none":
        with open(argv[3], encoding="utf-8") as f:
            beta = json.load(f)
    action = argv[5] if len(argv) == 6 else "replace"
    problems = check(release, argv[2], beta, argv[4], action)
    print(f"release {release.get('tagName')}: prerelease={release.get('isPrerelease')} "
          f"draft={release.get('isDraft')}  Latest={argv[2]}  beta action={action}  "
          f"beta={'none' if beta is None else 'prerelease=%s assets=%s' % (beta.get('isPrerelease'), [a.get('name') for a in beta.get('assets', [])])}")
    for p in problems:
        print(f"ASSERTION FAILED: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
