#!/usr/bin/env python3
"""Assert the built APK's identity matches the build it came from — #79.

A pull-request build is Coaching Beta (`com.vanstoner.coachingapp.beta`) so it
installs next to the released app; a build of main is Coaching App
(`com.vanstoner.coachingapp`), unchanged. Read from the ARTIFACT with
`aapt2 dump badging`, not from config, because the APK is what reaches the
phone.

    check_identity.py BADGING_FILE VARIANT   # VARIANT is 'beta' or ''
    check_identity.py --self-test

The self-test runs first in CI and dry-runs the check against BOTH healthy
cases before anything is trusted: five of six CI failures on this project were
gates rejecting a correct artifact.
"""

import re
import sys

BASE_ID = "com.vanstoner.coachingapp"
BASE_LABEL = "Coaching App"
BETA_ID = BASE_ID + ".beta"
BETA_LABEL = "Coaching Beta"


def expected(variant):
    if variant == "beta":
        return BETA_ID, BETA_LABEL
    if variant == "":
        return BASE_ID, BASE_LABEL
    raise ValueError(f"unknown variant {variant!r}")


def read(badging):
    app_id = re.search(r"^package: name='([^']*)'", badging, re.M)
    label = re.search(r"^application-label:'([^']*)'", badging, re.M)
    return (app_id.group(1) if app_id else None, label.group(1) if label else None)


def check(badging, variant):
    """Return a list of problems; empty means the identity is right."""
    want_id, want_label = expected(variant)
    got_id, got_label = read(badging)
    problems = []
    if got_id != want_id:
        problems.append(f"applicationId is {got_id!r}, expected {want_id!r}")
    if got_label != want_label:
        problems.append(f"application-label is {got_label!r}, expected {want_label!r}")
    return problems


def badging_of(app_id, label):
    # The shape build-tools 37 prints, trimmed to the lines that matter.
    return (
        f"package: name='{app_id}' versionCode='61' versionName='2026.10.03'\n"
        "minSdkVersion:'24'\n"
        f"application-label:'{label}'\n"
        f"application: label='{label}' icon='res/mipmap-mdpi-v4/ic_launcher.webp'\n"
    )


def self_test():
    cases = [
        # (description, badging, variant, should pass)
        ("main build, healthy", badging_of(BASE_ID, BASE_LABEL), "", True),
        ("beta build, healthy", badging_of(BETA_ID, BETA_LABEL), "beta", True),
        ("main build carrying the beta id", badging_of(BETA_ID, BETA_LABEL), "", False),
        ("beta build that kept the main id", badging_of(BASE_ID, BASE_LABEL), "beta", False),
        ("beta id with the main label", badging_of(BETA_ID, BASE_LABEL), "beta", False),
        ("unreadable badging", "", "", False),
    ]
    failed = 0
    for name, badging, variant, should_pass in cases:
        passed = not check(badging, variant)
        ok = passed == should_pass
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name} -> {'pass' if passed else 'fail'}")
    try:
        expected("gamma")
        print("  x  an unknown variant was accepted")
        failed += 1
    except ValueError:
        print("  ok an unknown variant is refused")
    print(f"{len(cases) + 1 - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) != 3:
        print(__doc__)
        return 2
    with open(argv[1], encoding="utf-8", errors="replace") as f:
        badging = f.read()
    problems = check(badging, argv[2])
    want_id, want_label = expected(argv[2])
    print(f"expected: {want_id} / {want_label}")
    print(f"found:    {read(badging)[0]} / {read(badging)[1]}")
    for p in problems:
        print(f"ASSERTION FAILED: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
