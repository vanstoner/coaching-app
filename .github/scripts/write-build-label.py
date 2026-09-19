#!/usr/bin/env python3
"""
Write the build label into the generated module — #52.

Run immediately before the bundle is built. Takes the label as its only
argument and rewrites `src/app/generated-build-label.ts`, preserving the
file's explanatory header so the next reader is not mystified.

Deliberately NOT an env var read at bundle time. See the header of the
generated file: that route worked under `expo export` and silently did
nothing in the Gradle embed path that actually ships.
"""

import pathlib
import re
import sys

TARGET = pathlib.Path("src/app/generated-build-label.ts")
LINE = re.compile(r"^export const GENERATED_BUILD_LABEL = '.*';$", re.MULTILINE)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: write-build-label.py <label>", file=sys.stderr)
        return 2
    label = argv[1].strip()
    if not label:
        print("refusing to write an empty label", file=sys.stderr)
        return 1
    if "'" in label or "\\" in label or "\n" in label:
        # The label goes into a single-quoted TS literal. Anything that could
        # escape it would produce a file that does not compile, eight minutes
        # into a Gradle build. Fail here instead.
        print(f"label contains a character that cannot be embedded: {label!r}", file=sys.stderr)
        return 1

    source = TARGET.read_text(encoding="utf-8")
    if not LINE.search(source):
        print(f"{TARGET} does not contain the expected export line", file=sys.stderr)
        return 1
    updated = LINE.sub(f"export const GENERATED_BUILD_LABEL = '{label}';", source)
    TARGET.write_text(updated, encoding="utf-8")
    print(f"wrote build label into {TARGET}: {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
