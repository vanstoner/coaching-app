#!/usr/bin/env python3
"""Assert a build of main became THE release — #79, PO ruling "approve 1 2".

The model: a pull request publishes Coaching Beta (one rolling `beta`
prerelease); Rob's approval merges it, and the build of main publishes the
full Coaching App release, marked Latest, and clears the beta. No in-between
prerelease of the real app.

Read back from GitHub after publishing, not assumed from the flags passed:

    check_release.py RELEASE_JSON LATEST_TAG BETA_PRESENT EXPECTED_TAG
    check_release.py --self-test

RELEASE_JSON is `gh release view TAG --json tagName,isPrerelease,isDraft,assets`;
LATEST_TAG is what /releases/latest reports; BETA_PRESENT is 'yes' or 'no'.

The self-test runs in PR CI before the release job ever trusts this, and
dry-runs the HEALTHY case first: five of six CI failures on this project were
gates rejecting a correct artifact.
"""

import json
import sys


def check(release, latest_tag, beta_present, expected_tag):
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
    if beta_present:
        problems.append("the `beta` prerelease is still there; a release clears it")
    return problems


def release_of(tag, pre=False, draft=False, apks=1):
    assets = [{"name": f"coaching-app_2026.10.03_abc1234.apk"} for _ in range(apks)]
    assets.append({"name": "coaching-app_2026.10.03_abc1234.apk.sha256"})
    return {"tagName": tag, "isPrerelease": pre, "isDraft": draft, "assets": assets}


def self_test():
    t = "v2026.10.03-build.74"
    old = "v2026.10.03-build.69"
    cases = [
        # (description, release, latest, beta present, should pass)
        ("healthy: full release, Latest, beta cleared", release_of(t), t, False, True),
        ("still a prerelease (the build-72 confusion)", release_of(t, pre=True), t, False, False),
        ("published but not Latest", release_of(t), old, False, False),
        ("left as a draft", release_of(t, draft=True), t, False, False),
        ("no APK attached", release_of(t, apks=0), t, False, False),
        ("beta not cleared", release_of(t), t, True, False),
        ("wrong release read back", release_of(old), t, False, False),
    ]
    failed = 0
    for name, release, latest, beta, should_pass in cases:
        passed = not check(release, latest, beta, t)
        ok = passed == should_pass
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name} -> {'pass' if passed else 'fail'}")
    print(f"{len(cases) - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) != 5 or argv[3] not in ("yes", "no"):
        print(__doc__)
        return 2
    with open(argv[1], encoding="utf-8") as f:
        release = json.load(f)
    problems = check(release, argv[2], argv[3] == "yes", argv[4])
    print(f"release {release.get('tagName')}: prerelease={release.get('isPrerelease')} "
          f"draft={release.get('isDraft')}  Latest={argv[2]}  beta present={argv[3]}")
    for p in problems:
        print(f"ASSERTION FAILED: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
