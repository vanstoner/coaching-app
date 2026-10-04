#!/usr/bin/env python3
"""Assert android:allowBackup in the built APK matches the variant — #112.

PO ruling "backup b": Coaching App is backed up by the phone's own backup, so
a lost phone keeps the season; Coaching Beta is not, so test data never
reaches a coach's cloud (ADR-011 amendment). Read from the ARTIFACT with
`aapt2 dump xmltree --file AndroidManifest.xml`, not from config, because the
APK is what reaches the phone.

    check_backup.py MANIFEST_DUMP VARIANT   # VARIANT is 'beta' or ''
    check_backup.py --self-test

build-tools 37 renders booleans as `=true`/`=false`; older ones as
`=(type 0x12)0xffffffff`/`=(type 0x12)0x0`. An absent attribute means ON to
Android, but it is required to be explicit here either way.

The self-test runs first in CI and dry-runs the check against BOTH healthy
cases before anything is trusted: five of six CI failures on this project were
gates rejecting a correct artifact.
"""

import sys

TRUE_SUFFIXES = ("=true", "=(type 0x12)0xffffffff")
FALSE_SUFFIXES = ("=false", "=(type 0x12)0x0")


def wanted(variant):
    if variant == "beta":
        return False
    if variant == "":
        return True
    raise ValueError(f"unknown variant {variant!r}")


def read(manifest):
    """The first line mentioning allowBackup, as `grep | sed -n 1p` took it."""
    for line in manifest.splitlines():
        if "allowBackup" in line:
            return line
    return None


def check(manifest, variant):
    """Return a list of problems; empty means allowBackup is right."""
    want = wanted(variant)
    line = read(manifest)
    if line is None:
        return [f"allowBackup attribute absent; expected {str(want).lower()}"]
    suffixes = TRUE_SUFFIXES if want else FALSE_SUFFIXES
    if not line.endswith(suffixes):
        return [f"allowBackup is not {str(want).lower()}: {line.strip()!r}"]
    return []


ATTR = "        A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)"


def manifest_with(value):
    # The shape aapt2 prints, trimmed to the lines around the attribute.
    lines = [
        "N: android=http://schemas.android.com/apk/res/android (line=2)",
        "  E: manifest (line=2)",
        "      E: application (line=15)",
        '        A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.example.coachingapp.MainApplication"',
    ]
    if value is not None:
        lines.append(ATTR + value)
    lines.append('        A: http://schemas.android.com/apk/res/android:label(0x01010001)=@0x7f0f001c')
    return "\n".join(lines) + "\n"


def self_test():
    cases = [
        # (description, manifest dump, variant, should pass)
        ("Coaching App, allowBackup=true, healthy", manifest_with("=true"), "", True),
        ("Coaching Beta, allowBackup=false, healthy", manifest_with("=false"), "beta", True),
        ("Coaching App, older build-tools true, healthy", manifest_with("=(type 0x12)0xffffffff"), "", True),
        ("Coaching Beta, older build-tools false, healthy", manifest_with("=(type 0x12)0x0"), "beta", True),
        ("Coaching App with backup off", manifest_with("=false"), "", False),
        ("Coaching App with backup off, older build-tools", manifest_with("=(type 0x12)0x0"), "", False),
        ("Coaching Beta with backup on", manifest_with("=true"), "beta", False),
        ("Coaching Beta with backup on, older build-tools", manifest_with("=(type 0x12)0xffffffff"), "beta", False),
        ("Coaching App, attribute missing", manifest_with(None), "", False),
        ("Coaching Beta, attribute missing", manifest_with(None), "beta", False),
        ("Coaching App, unreadable dump", "", "", False),
        ("Coaching Beta, unreadable dump", "", "beta", False),
        ("Coaching App, value unparseable", manifest_with("=@0x7f040001"), "", False),
    ]
    failed = 0
    for name, manifest, variant, should_pass in cases:
        passed = not check(manifest, variant)
        ok = passed == should_pass
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name} -> {'pass' if passed else 'fail'}")
    try:
        wanted("gamma")
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
    try:
        with open(argv[1], encoding="utf-8", errors="replace") as f:
            manifest = f.read()
    except OSError as e:
        print(f"ASSERTION FAILED: cannot read the manifest dump: {e}")
        return 1
    variant = argv[2]
    line = read(manifest)
    print(line if line is not None else "<allowBackup attribute absent>")
    problems = check(manifest, variant)
    want = str(wanted(variant)).lower()
    if not problems:
        print(f"allowBackup is {want} in the artifact that reaches the phone (APP_VARIANT='{variant}')")
    for p in problems:
        print(f"ASSERTION FAILED: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
