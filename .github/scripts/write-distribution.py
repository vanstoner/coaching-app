#!/usr/bin/env python3
"""Write which distribution a build is into the bundle, and prove it took — #146.

ADR-017 §5: the app cannot tell Coaching Beta from Coaching App by itself, so
CI writes the distribution into a checked-in module before bundling, exactly
as it writes the build label (#52, write-build-label.py):

    beta   a pull request's Coaching Beta (the same condition as APP_VARIANT)
    demo   the demo workflow's Coaching Beta (demo.yml), which seeds the
           Test kit squad and season on first open (#146 AC4)
    app    everything else: main, and any other dispatch of android-apk.yml

The module is checked in as `app`, so a missed write only removes features.

    write-distribution.py DIST APP_VARIANT            rewrite the module for DIST,
                                                      if the pair is allowed
    write-distribution.py --assert-bundle BUNDLE DIST the bundle carries DIST's
                                                      marker and no other
    write-distribution.py --self-test

The marker is `distribution:<name>`. The app parses the suffix and never
repeats a full marker elsewhere, so the marker is unique to the written file:
its presence proves the write reached the bundle, and any other marker means
the checked-in value (or a stray copy) survived beside it.

Read in both encodings Hermes may use (ASCII, or UTF-16LE when a string is not
pure ASCII), as assert_label_in_bundle.py does. A plain substring search, on
purpose: Hermes packs its strings with no delimiter, so the bytes after a
marker belong to whatever string was packed next (hermesc 250829098.0.17
stored `distribution:demo` overlapping `demonstrate`). No name below is a
prefix of another, so what follows the real marker can never read as a
different one.

The self-test dry-runs the HEALTHY case first: five of six CI failures on
this project were gates rejecting a correct artifact.
"""

import pathlib
import re
import sys
import tempfile

TARGET = pathlib.Path("src/app/generated-distribution.ts")
DISTRIBUTIONS = ("app", "beta", "demo")
PREFIX = "distribution:"
LINE = re.compile(r"^export const GENERATED_DISTRIBUTION = '[^'\n]*';$", re.MULTILINE)


def marker(dist):
    return f"{PREFIX}{dist}"


# Which identity (APP_VARIANT, app.config.js) each distribution may be built
# with. The app cannot check its own application id, so `demo` written into
# Coaching App would show the Test kit and seed made-up children into the
# real app. `beta` likewise only in Coaching Beta, and `app` only in Coaching
# App. The APK's identity is then read back from the artifact (check_identity).
IDENTITY = {"app": "", "beta": "beta", "demo": "beta"}


def pairing_problem(dist, variant):
    """None when DIST may be written into a build of APP_VARIANT."""
    if dist not in IDENTITY:
        return f"unknown distribution {dist!r}"
    if variant != IDENTITY[dist]:
        return (f"distribution '{dist}' must be built with APP_VARIANT={IDENTITY[dist]!r}, "
                f"not {variant!r}: the app cannot tell its own identity")
    return None


def rewrite(source, dist):
    """The module's text with DIST written in; raises ValueError if it cannot be."""
    if dist not in DISTRIBUTIONS:
        raise ValueError(f"unknown distribution {dist!r}; expected one of {DISTRIBUTIONS}")
    found = LINE.findall(source)
    if len(found) != 1:
        raise ValueError(f"expected exactly one `export const GENERATED_DISTRIBUTION = '...';` line, found {len(found)}")
    return LINE.sub(f"export const GENERATED_DISTRIBUTION = '{marker(dist)}';", source)


def write(path, dist):
    path.write_text(rewrite(path.read_text(encoding="utf-8"), dist), encoding="utf-8")


def encodings(text):
    return (("ascii/utf-8", text.encode("utf-8")), ("utf-16le", text.encode("utf-16-le")))


def bundle_problems(data, dist):
    """Empty when the bundle carries DIST's marker and no other."""
    if dist not in DISTRIBUTIONS:
        return [f"unknown distribution {dist!r}"]
    out = []
    if not any(enc in data for _, enc in encodings(marker(dist))):
        out.append(f"'{marker(dist)}' is NOT in the bundle in either encoding: the write did not reach it")
    for other in DISTRIBUTIONS:
        if other == dist:
            continue
        for name, enc in encodings(marker(other)):
            if enc in data:
                out.append(f"'{marker(other)}' is in the bundle too ({name}): this build would not be only '{dist}'")
    return out


# --- Self-test: healthy cases first --------------------------------------------

CONTRACT = "/** header */\n\nexport const GENERATED_DISTRIBUTION = 'distribution:app';\n"


def self_test():
    failed = total = 0

    def check(name, cond):
        nonlocal failed, total
        total += 1
        failed += not cond
        print(f"  {'ok' if cond else 'x '} {name}")

    base = TARGET.read_text(encoding="utf-8") if TARGET.is_file() else CONTRACT
    # Healthy: every distribution writes, into the checked-in module itself.
    for dist in DISTRIBUTIONS:
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / "generated-distribution.ts"
            p.write_text(base, encoding="utf-8")
            write(p, dist)
            text = p.read_text(encoding="utf-8")
            others = [d for d in DISTRIBUTIONS if d != dist and f"'{marker(d)}'" in text]
            check(f"healthy: writes '{marker(dist)}' into the module, and nothing else changes",
                  f"'{marker(dist)}'" in text and not others
                  and text.replace(marker(dist), marker("app")) == base.replace(marker(dist), marker("app")))
    # Healthy bundles, as Hermes stores them (packed: other strings run on).
    for dist in DISTRIBUTIONS:
        packed = b"\x00\x01apply" + marker(dist).encode() + b"nstratezetappState" + b"distribution:\x00\x00C"
        check(f"healthy: a packed ASCII bundle carrying only '{marker(dist)}' passes",
              not bundle_problems(packed, dist))
    check("healthy: the marker stored as UTF-16LE passes",
          not bundle_problems(b"\x00" + marker("demo").encode("utf-16-le") + b"\x00", "demo"))
    check("healthy: the bare prefix the app parses with is not a marker",
          not bundle_problems(b"distribution:" + marker("beta").encode(), "beta"))

    for dist, variant in (("app", ""), ("beta", "beta"), ("demo", "beta")):
        check(f"healthy: '{dist}' with APP_VARIANT={variant!r} is allowed", pairing_problem(dist, variant) is None)

    # Wrong cases.
    for dist, variant in (("demo", ""), ("beta", ""), ("app", "beta"), ("demo", "demo")):
        check(f"refuses '{dist}' with APP_VARIANT={variant!r}", pairing_problem(dist, variant) is not None)
    for bad in ("", "gamma", "Demo", "beta "):
        try:
            rewrite(base, bad)
            check(f"refuses distribution {bad!r}", False)
        except ValueError:
            check(f"refuses distribution {bad!r}", True)
    for name, source in (("no export line", "export const OTHER = 'x';\n"),
                         ("two export lines", CONTRACT + CONTRACT)):
        try:
            rewrite(source, "demo")
            check(f"refuses a module with {name}", False)
        except ValueError:
            check(f"refuses a module with {name}", True)
    check("fails: the marker is missing (the write never reached the bundle)",
          bool(bundle_problems(b"distribution:\x00apply", "demo")))
    check("fails: the checked-in 'app' survived beside the written 'demo'",
          bool(bundle_problems(marker("demo").encode() + marker("app").encode(), "demo")))
    check("fails: a beta build that still says app",
          bool(bundle_problems(marker("app").encode(), "beta")))
    check("fails: another marker hidden as UTF-16LE",
          bool(bundle_problems(marker("app").encode() + marker("beta").encode("utf-16-le"), "app")))
    check("fails: an unknown distribution asked of the bundle",
          bool(bundle_problems(marker("app").encode(), "gamma")))
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    args = argv[1:]
    if args == ["--self-test"]:
        return self_test()
    if len(args) == 3 and args[0] == "--assert-bundle":
        path = pathlib.Path(args[1])
        if not path.is_file():
            print(f"ASSERTION FAILED: no bundle at {path}")
            return 1
        data = path.read_bytes()
        print(f"bundle: {path} ({len(data)} bytes); expecting only '{marker(args[2])}'")
        problems = bundle_problems(data, args[2])
        for p in problems:
            print(f"ASSERTION FAILED: {p}")
        if not problems:
            print(f"FOUND '{marker(args[2])}', and no other distribution marker")
        return 1 if problems else 0
    if len(args) == 2 and not args[0].startswith("-"):
        problem = pairing_problem(args[0], args[1])
        if problem:
            print(f"WHY THIS STEP FAILED: {problem}", file=sys.stderr)
            return 1
        try:
            write(TARGET, args[0])
        except (ValueError, OSError) as e:
            print(f"WHY THIS STEP FAILED: could not write the distribution into {TARGET}: {e}", file=sys.stderr)
            return 1
        print(f"wrote '{marker(args[0])}' into {TARGET}")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
