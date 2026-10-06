#!/usr/bin/env python3
"""Check the App Store listing text against Apple's limits — #108 D2.

    check_listing.py [DIR]      # default store/ios/en-GB
    check_listing.py --self-test

One plain-text file per field. Lengths are counted in characters after the
trailing newline is dropped, except keywords, counted in UTF-8 bytes (the
stricter reading). Both URLs must be https. Every field must be present and
non-empty.

The self-test runs first in CI and dry-runs the healthy listing before any
failing case: five of six CI failures on this project were gates rejecting a
correct artifact.
"""

import os
import sys

LIMITS = {  # field: (limit, unit)
    "name": (30, "chars"),
    "subtitle": (30, "chars"),
    "keywords": (100, "bytes"),
    "promotional_text": (170, "chars"),
    "description": (4000, "chars"),
}
URLS = ("support_url", "privacy_url")
FIELDS = tuple(LIMITS) + URLS


def check(fields):
    """Return a list of problems; empty means the listing fits."""
    problems = []
    for field in FIELDS:
        text = fields.get(field)
        if not text:
            problems.append(f"{field}: missing or empty")
            continue
        if field in LIMITS:
            limit, unit = LIMITS[field]
            size = len(text.encode("utf-8")) if unit == "bytes" else len(text)
            if size > limit:
                problems.append(f"{field}: {size} {unit}, over Apple's limit of {limit}")
        elif not text.startswith("https://") or any(c.isspace() for c in text):
            problems.append(f"{field}: not a single https URL: {text!r}")
    return problems


def read(directory):
    fields = {}
    for field in FIELDS:
        try:
            with open(os.path.join(directory, f"{field}.txt"), encoding="utf-8") as f:
                fields[field] = f.read().rstrip("\n")
        except OSError:
            pass
    return fields


def self_test():
    here = os.path.dirname(os.path.abspath(__file__))
    real = read(os.path.join(here, "..", "..", "store", "ios", "en-GB"))
    healthy = {
        "name": "Heart of the Game: Coach",
        "subtitle": "Fair play for grassroots teams",  # exactly 30
        "keywords": "heart," + "x" * 94,  # exactly 100 bytes
        "promotional_text": "p" * 170,
        "description": "d" * 4000,
        "support_url": "https://example.org/issues",
        "privacy_url": "https://example.org/privacy",
    }

    def with_(**changes):
        return {**healthy, **changes}

    cases = [
        # (description, fields, should pass)
        ("the listing in the repo, healthy", real, True),
        ("every field exactly at its limit, healthy", healthy, True),
        ("name over 30", with_(name="n" * 31), False),
        ("subtitle over 30", with_(subtitle="s" * 31), False),
        ("keywords over 100 bytes", with_(keywords="k" * 101), False),
        ("keywords 99 chars but 101 bytes", with_(keywords="é" * 2 + "k" * 97), False),
        ("promotional text over 170", with_(promotional_text="p" * 171), False),
        ("description over 4000", with_(description="d" * 4001), False),
        ("support URL not https", with_(support_url="http://example.org"), False),
        ("privacy URL not https", with_(privacy_url="example.org/privacy"), False),
        ("privacy URL with a second line", with_(privacy_url="https://a.org\nhttps://b.org"), False),
        ("a field missing", {k: v for k, v in healthy.items() if k != "description"}, False),
        ("a field empty", with_(subtitle=""), False),
    ]
    failed = 0
    for name, fields, should_pass in cases:
        problems = check(fields)
        ok = (not problems) == should_pass
        failed += not ok
        detail = "pass" if not problems else "fail: " + "; ".join(problems)
        print(f"  {'ok' if ok else 'x '} {name} -> {detail}")
    print(f"{len(cases) - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) > 2:
        print(__doc__)
        return 2
    directory = argv[1] if len(argv) == 2 else "store/ios/en-GB"
    fields = read(directory)
    for field in FIELDS:
        if field in LIMITS and fields.get(field):
            limit, unit = LIMITS[field]
            text = fields[field]
            size = len(text.encode("utf-8")) if unit == "bytes" else len(text)
            print(f"{field}: {size}/{limit} {unit}")
    problems = check(fields)
    for p in problems:
        print(f"ASSERTION FAILED: {p}")
    if not problems:
        print(f"The listing in {directory} fits Apple's limits.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
