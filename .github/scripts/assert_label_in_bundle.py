#!/usr/bin/env python3
"""
Assert the build label reached the APK's embedded bundle — #52.

WHY THIS IS NOT `grep -F`. Hermes stores a string in its string table as
ASCII when every character fits, and as UTF-16LE the moment one does not.
A label containing `·` is therefore absent from the bundle in its UTF-8 form
and present in its UTF-16 form, so a byte-grep for the obvious encoding finds
nothing and fails a perfectly correct build.

That is exactly what happened on runs 35428198347 and 35428846931, and it sent
me chasing a bundler-injection bug that may never have existed. The assertion
was wrong, not the artifact. Checking both encodings is the fix; it costs four
lines and removes a whole class of false red.

usage: assert_label_in_bundle.py <bundle-file> <expected-label>
"""

import pathlib
import sys


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: assert_label_in_bundle.py <bundle> <label>", file=sys.stderr)
        return 2

    bundle = pathlib.Path(argv[1])
    label = argv[2]
    if not bundle.is_file():
        print(f"no bundle at {bundle}")
        return 1

    data = bundle.read_bytes()
    print(f"bundle: {bundle} ({len(data)} bytes)")
    print(f"expecting label: {label}")
    print(f"label is pure ASCII: {label.isascii()}")

    for name, encoded in (
        ("ascii/utf-8", label.encode("utf-8")),
        ("utf-16le", label.encode("utf-16-le")),
    ):
        if encoded in data:
            print(f"FOUND, stored as {name}")
            return 0

    print()
    print("NOT FOUND in either encoding.")
    print("The label was not written into the bundle. Check the")
    print("'Write the build label into the bundle' step ran before Gradle.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
