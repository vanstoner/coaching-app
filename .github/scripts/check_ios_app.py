#!/usr/bin/env python3
"""Assert the built iOS .app is the app this build should have produced — #107.

Read from the BUILT .app's Info.plist (binary, as Xcode writes it), not from
app.json, because the .app is what would reach a phone. Three things:

  1. CFBundleIdentifier is com.vanstoner.coachingapp on main and
     com.vanstoner.coachingapp.beta on a pull request (PO ruling on #107),
     and the display name matches.
  2. RCTAsyncStorageExcludeFromBackup is present and explicit: FALSE for
     Heart FC Coach (backed up by the phone's own iCloud backup, #112 PO ruling
     "backup b"), TRUE for Heart FC Beta Coach (test data never reaches a cloud).
     This is the key @react-native-async-storage/async-storage 3.1.1 reads in
     apple/legacy_storage/RNCAsyncStorage.mm:529 before setting
     NSURLIsExcludedFromBackupKey on its storage directory. Absent means
     excluded in that version, so the gate requires it explicitly either way.
  3. ITSAppUsesNonExemptEncryption is present and FALSE in both variants
     (#108 B1): the app uses no encryption beyond the OS's own, and saying so
     in the build keeps TestFlight from holding it at "Missing Compliance".
  4. CFBundleVersion is the build number CI injected (the run number), when
     one is given — a silently missing injection would ship build 1.

    check_ios_app.py INFO_PLIST VARIANT [BUILD_NUMBER]   # VARIANT 'beta' or ''
    check_ios_app.py --self-test

The self-test runs first in CI and dry-runs the check against BOTH healthy
cases before it is trusted: five of six CI failures on this project were
gates rejecting a correct artifact.
"""

import plistlib
import sys

BASE_ID = "com.vanstoner.coachingapp"
BASE_NAME = "Heart FC Coach"
BETA_ID = BASE_ID + ".beta"
BETA_NAME = "Heart FC Beta Coach"
BACKUP_KEY = "RCTAsyncStorageExcludeFromBackup"
ENCRYPTION_KEY = "ITSAppUsesNonExemptEncryption"


def expected(variant):
    if variant == "beta":
        return BETA_ID, BETA_NAME
    if variant == "":
        return BASE_ID, BASE_NAME
    raise ValueError(f"unknown variant {variant!r}")


def excluded_from_backup(variant):
    # #112: the released app is backed up; the beta is not.
    if variant == "beta":
        return True
    if variant == "":
        return False
    raise ValueError(f"unknown variant {variant!r}")


def check(plist, variant, build_number=None):
    """Return a list of problems; empty means the .app is right."""
    want_id, want_name = expected(variant)
    problems = []
    got_id = plist.get("CFBundleIdentifier")
    if got_id != want_id:
        problems.append(f"CFBundleIdentifier is {got_id!r}, expected {want_id!r}")
    got_name = plist.get("CFBundleDisplayName")
    if got_name != want_name:
        problems.append(f"CFBundleDisplayName is {got_name!r}, expected {want_name!r}")
    # `is True`, not truthiness: the string "YES" or the integer 1 in a plist
    # is not what the library's NSNumber read expects to find.
    want_excluded = excluded_from_backup(variant)
    if plist.get(BACKUP_KEY) is not want_excluded:
        problems.append(
            f"{BACKUP_KEY} is {plist.get(BACKUP_KEY, '<absent>')!r}, expected {want_excluded} "
            "(#112: Heart FC Coach is backed up, Heart FC Beta Coach is not)"
        )
    # #108 B1: explicit false in both variants. Absent makes TestFlight ask by
    # hand on every build; true declares encryption the app does not use.
    if plist.get(ENCRYPTION_KEY) is not False:
        problems.append(
            f"{ENCRYPTION_KEY} is {plist.get(ENCRYPTION_KEY, '<absent>')!r}, expected False (#108 B1)"
        )
    if build_number:
        got_build = plist.get("CFBundleVersion")
        if got_build != build_number:
            problems.append(f"CFBundleVersion is {got_build!r}, expected {build_number!r}")
    return problems


def plist_of(app_id, name, backup="auto", build="42", encryption=False):
    # The keys that matter, in the shape Xcode writes into a built .app.
    p = {
        "CFBundleIdentifier": app_id,
        "CFBundleDisplayName": name,
        "CFBundleName": name.replace(" ", ""),
        "CFBundleShortVersionString": "1.0.0",
        "CFBundleVersion": build,
        "CFBundleExecutable": name.replace(" ", ""),
    }
    if backup == "auto":
        backup = app_id == BETA_ID
    if backup is not None:
        p[BACKUP_KEY] = backup
    if encryption is not None:
        p[ENCRYPTION_KEY] = encryption
    return p


def self_test():
    cases = [
        # (description, plist, variant, build number, should pass)
        ("main build, healthy", plist_of(BASE_ID, BASE_NAME), "", "42", True),
        ("beta build, healthy", plist_of(BETA_ID, BETA_NAME), "beta", "42", True),
        ("main build, no build number to check", plist_of(BASE_ID, BASE_NAME), "", None, True),
        ("main build carrying the beta id", plist_of(BETA_ID, BETA_NAME), "", "42", False),
        ("beta build that kept the main id", plist_of(BASE_ID, BASE_NAME), "beta", "42", False),
        ("beta id with the main name", plist_of(BETA_ID, BASE_NAME), "beta", "42", False),
        ("backup key absent (means excluded)", plist_of(BASE_ID, BASE_NAME, backup=None), "", "42", False),
        ("main app excluded from backup", plist_of(BASE_ID, BASE_NAME, backup=True), "", "42", False),
        ("beta backed up", plist_of(BETA_ID, BETA_NAME, backup=False), "beta", "42", False),
        ("backup key the string 'YES'", plist_of(BETA_ID, BETA_NAME, backup="YES"), "beta", "42", False),
        ("encryption key absent (B1)", plist_of(BASE_ID, BASE_NAME, encryption=None), "", "42", False),
        ("encryption key true (B1)", plist_of(BASE_ID, BASE_NAME, encryption=True), "", "42", False),
        ("beta: encryption key absent (B1)", plist_of(BETA_ID, BETA_NAME, encryption=None), "beta", "42", False),
        ("beta: encryption key true (B1)", plist_of(BETA_ID, BETA_NAME, encryption=True), "beta", "42", False),
        ("encryption key the string 'NO'", plist_of(BASE_ID, BASE_NAME, encryption="NO"), "", "42", False),
        ("build number not injected", plist_of(BASE_ID, BASE_NAME, build="1"), "", "42", False),
        ("empty plist", {}, "", None, False),
    ]
    failed = 0
    for name, plist, variant, build, should_pass in cases:
        # Round-trip through BINARY plist, the format a built .app carries,
        # so the parse path is the one CI will take.
        parsed = plistlib.loads(plistlib.dumps(plist, fmt=plistlib.FMT_BINARY))
        passed = not check(parsed, variant, build)
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
    if len(argv) not in (3, 4):
        print(__doc__)
        return 2
    path, variant = argv[1], argv[2]
    build_number = argv[3] if len(argv) == 4 and argv[3] else None
    try:
        with open(path, "rb") as f:
            plist = plistlib.load(f)
    except (OSError, plistlib.InvalidFileException) as e:
        print(f"ASSERTION FAILED: cannot read {path}: {e}")
        return 1
    want_id, want_name = expected(variant)
    print(f"expected: {want_id} / {want_name} / {BACKUP_KEY}={excluded_from_backup(variant)} / build {build_number or '(not checked)'}")
    print(
        f"found:    {plist.get('CFBundleIdentifier')} / {plist.get('CFBundleDisplayName')} / "
        f"{BACKUP_KEY}={plist.get(BACKUP_KEY, '<absent>')} / build {plist.get('CFBundleVersion')}"
    )
    problems = check(plist, variant, build_number)
    for p in problems:
        print(f"ASSERTION FAILED: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
