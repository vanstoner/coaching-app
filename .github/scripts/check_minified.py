#!/usr/bin/env python3
"""Was this Android release build shrunk and obfuscated by R8? (#296 AC4)

Google Play flagged build 396: "DEX code optimisation is below our threshold
... Obfuscation (1%)". R8 is switched on in app.json (expo-build-properties).
This gate stops it silently switching off again: a release build is minified
only if R8 wrote its mapping file, the file is not empty, and it renames at
least one class. An unminified build writes no mapping file at all.

    check_minified.py check MAPPING [LABEL]   exit 0 minified, 1 not (WHY line)
    check_minified.py --self-test              healthy cases first, then refusals

The mapping file holds class and method names of the app's code and its
libraries: no squad data, which lives only on the phone.
"""

import os
import re
import sys
import tempfile

# "com.example.Thing -> a.b:" at the start of a line: one class and its new name.
CLASS_LINE = re.compile(r"^(\S+) -> (\S+):$")


def verdict(path):
    """(ok, line) for the mapping file at path."""
    if not os.path.isfile(path):
        return False, f"no R8 mapping file at {path}: R8 did not run, so the build is not minified"
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    if not text.strip():
        return False, f"the R8 mapping file at {path} is empty"
    classes = renamed = 0
    for line in text.splitlines():
        m = CLASS_LINE.match(line)
        if m:
            classes += 1
            renamed += m.group(1) != m.group(2)
    if classes == 0:
        return False, f"the R8 mapping file at {path} maps no classes"
    if renamed == 0:
        return False, f"R8 ran but renamed none of {classes} classes: obfuscation is off (a -dontobfuscate rule?)"
    return True, f"minified: R8 renamed {renamed} of {classes} classes ({os.path.getsize(path)} bytes of mapping)"


def self_test():
    failed = 0

    def expect(name, ok):
        nonlocal failed
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name}")

    d = tempfile.mkdtemp()

    def write(name, text):
        p = os.path.join(d, name)
        with open(p, "w") as fh:
            fh.write(text)
        return p

    healthy = write("healthy.txt", "# compiler: R8\n# pg_map_id: 1\n"
                    "com.facebook.react.ReactActivity -> com.facebook.react.ReactActivity:\n"
                    "    void onCreate(android.os.Bundle) -> onCreate\n"
                    "com.example.Helper -> a.a:\n    int count -> a\n"
                    "com.example.Other -> a.b:\n")
    print("healthy cases")
    ok, line = verdict(healthy)
    expect("an R8 mapping that renames classes passes, and counts them", ok and "renamed 2 of 3 classes" in line)
    print("refusals")
    ok, line = verdict(os.path.join(d, "missing.txt"))
    expect("no mapping file (an unminified build) fails, saying R8 did not run", not ok and "R8 did not run" in line)
    ok, line = verdict(write("empty.txt", "  \n"))
    expect("an empty mapping file fails", not ok and "is empty" in line)
    ok, line = verdict(write("comments.txt", "# compiler: R8\n# pg_map_id: 1\n"))
    expect("a mapping with no classes fails", not ok and "maps no classes" in line)
    ok, line = verdict(write("kept.txt", "com.example.A -> com.example.A:\ncom.example.B -> com.example.B:\n"))
    expect("a mapping that renames nothing (obfuscation off) fails", not ok and "renamed none of 2" in line)
    print(f"check_minified.py self-test: {'all passed' if not failed else f'{failed} FAILED'}")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) in (3, 4) and argv[1] == "check":
        ok, line = verdict(argv[2])
        label = f"{argv[3]}: " if len(argv) == 4 else ""
        print(f"{label}{line}" if ok else f"WHY THIS JOB FAILED: {label}{line} (#296)")
        return 0 if ok else 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
