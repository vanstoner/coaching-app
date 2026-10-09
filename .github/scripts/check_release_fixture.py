#!/usr/bin/env python3
"""
Every store release leaves its data behind as a fixture — #167 AC3, AC4.

Once a version is in coaches' hands, every later build must read what it
stored (`src/app/releaseUpgrade.test.ts`). That test can only cover releases
someone froze. This makes the freezing impossible to forget:

1. A pull request that CHANGES the app version (app.json `expo.version`) must
   carry `src/app/fixtures/release-<the base branch's version>/`, listed in
   `src/app/fixtures/releases.json`. The base's version is the one being
   superseded: the one now on phones.
2. No release listed in the base branch's `releases.json` may be removed from
   it, or have a file hash changed. A fixture is never edited or deleted.

A PR that leaves the version alone needs nothing new (rule 2 still applies).

    check_release_fixture.py <base-ref>     # compares the working tree to base
    check_release_fixture.py --self-test

Freezing a release: see the header of scripts/freeze-release-fixture.ts.

The self-test runs the HEALTHY cases first, because five of six CI failures
on this project were assertions rejecting a correct artifact.
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

FIXTURES = "src/app/fixtures"
MANIFEST = f"{FIXTURES}/releases.json"
FILES = ("store.json", "expected.json", "release.json")


def check(
    base_version: str,
    head_version: str,
    base_manifest: dict,
    head_manifest: dict,
    head_hashes: dict,
) -> list[str]:
    """
    Every problem, in words; empty when the PR may merge.

    head_hashes: {version: {file: sha256 of the file on disk}} for every
    release-* directory in the head tree (a missing file is simply absent).
    """
    problems: list[str] = []

    if head_version != base_version:
        prev = base_version
        if prev not in head_manifest:
            problems.append(
                f"the version moves {base_version} -> {head_version}, but release {prev} "
                f"is not listed in {MANIFEST}"
            )
        on_disk = head_hashes.get(prev, {})
        missing = [f for f in FILES if f not in on_disk]
        if missing:
            problems.append(
                f"the version moves {base_version} -> {head_version}, but "
                f"{FIXTURES}/release-{prev}/ is missing {', '.join(missing)}: "
                "freeze it with scripts/freeze-release-fixture.ts"
            )

    for version, hashes in base_manifest.items():
        if version not in head_manifest:
            problems.append(f"release {version} was removed from {MANIFEST}; a release fixture is never deleted")
            continue
        for file, sha in hashes.items():
            if head_manifest[version].get(file) != sha:
                problems.append(f"the recorded hash of release-{version}/{file} changed; a release fixture is never edited")
            if head_hashes.get(version, {}).get(file) != sha:
                problems.append(f"release-{version}/{file} was deleted or edited; a release fixture is never edited")

    for version, hashes in head_manifest.items():
        for file, sha in hashes.items():
            if head_hashes.get(version, {}).get(file) != sha:
                problems.append(f"release-{version}/{file} does not match its hash in {MANIFEST}")

    return problems


# --- reading the repository ---------------------------------------------------

def git_show(ref: str, path: str) -> str | None:
    result = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def version_of(app_json: str) -> str:
    return json.loads(app_json)["expo"]["version"]


def hashes_on_disk(root: Path) -> dict:
    out: dict = {}
    fixtures = root / FIXTURES
    if not fixtures.is_dir():
        return out
    for d in sorted(fixtures.glob("release-*")):
        if d.is_dir():
            out[d.name[len("release-"):]] = {
                f: hashlib.sha256((d / f).read_bytes()).hexdigest() for f in FILES if (d / f).is_file()
            }
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_release_fixture.py <base-ref>", file=sys.stderr)
        print("       check_release_fixture.py --self-test", file=sys.stderr)
        return 2
    base = argv[1]
    root = Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip())

    base_app = git_show(base, "app.json")
    if base_app is None:
        print(f"cannot read app.json at {base}", file=sys.stderr)
        return 2
    base_version = version_of(base_app)
    head_version = version_of((root / "app.json").read_text())
    base_manifest = json.loads(git_show(base, MANIFEST) or "{}")
    head_path = root / MANIFEST
    head_manifest = json.loads(head_path.read_text()) if head_path.is_file() else {}

    print(f"version: {base} {base_version} -> working tree {head_version}")
    print(f"releases frozen: {', '.join(sorted(head_manifest)) or 'none'}")
    problems = check(base_version, head_version, base_manifest, head_manifest, hashes_on_disk(root))
    if problems:
        print()
        print("=" * 72)
        print("WHY THIS JOB FAILED")
        print("=" * 72)
        for p in problems:
            print(f"- {p}")
        print()
        print("A coach's season must survive every update (#167). Each store")
        print("release is frozen as a fixture before the next one ships, and")
        print("a frozen fixture is never edited or deleted.")
        return 1
    print("release fixtures: ok")
    return 0


# --- self-test: the healthy cases first -----------------------------------------

def self_test() -> int:
    passed = failed = 0

    def expect(label, problems, wanted_ok):
        nonlocal passed, failed
        if (not problems) == wanted_ok:
            passed += 1
        else:
            failed += 1
            print(f"FAIL {label}\n     wanted {'no problems' if wanted_ok else 'a problem'}\n     got    {problems!r}")

    h100 = {"store.json": "a", "expected.json": "b", "release.json": "c"}
    h101 = {"store.json": "d", "expected.json": "e", "release.json": "f"}
    m100 = {"1.0.0": h100}
    m101 = {"1.0.0": h100, "1.0.1": h101}

    # --- healthy: these must all PASS ------------------------------------------
    expect("version unchanged, no manifest anywhere", check("1.0.1", "1.0.1", {}, {}, {}), True)
    expect("version unchanged, fixture added (this PR)", check("1.0.1", "1.0.1", {}, m100, {"1.0.0": h100}), True)
    expect("version unchanged, fixture kept", check("1.0.1", "1.0.1", m100, m100, {"1.0.0": h100}), True)
    expect("bump 1.0.0 -> 1.0.1 with release-1.0.0", check("1.0.0", "1.0.1", {}, m100, {"1.0.0": h100}), True)
    expect(
        "bump 1.0.1 -> 1.0.2 with release-1.0.1 added beside 1.0.0",
        check("1.0.1", "1.0.2", m100, m101, {"1.0.0": h100, "1.0.1": h101}),
        True,
    )
    expect(
        "bump 1.0.1 -> 1.1.0 with release-1.0.1 frozen earlier",
        check("1.0.1", "1.1.0", m101, m101, {"1.0.0": h100, "1.0.1": h101}),
        True,
    )

    # --- failing: these must all be REJECTED ------------------------------------
    expect("bump with no fixture for the previous version", check("1.0.1", "1.0.2", m100, m100, {"1.0.0": h100}), False)
    expect(
        "bump with the directory but not the manifest entry",
        check("1.0.1", "1.0.2", m100, m100, {"1.0.0": h100, "1.0.1": h101}),
        False,
    )
    expect(
        "bump with the manifest entry but a file missing",
        check("1.0.1", "1.0.2", m100, m101, {"1.0.0": h100, "1.0.1": {"store.json": "d", "release.json": "f"}}),
        False,
    )
    expect("bump with a fixture for the NEW version only", check("1.0.1", "1.0.2", m100, {**m100, "1.0.2": h101}, {"1.0.0": h100, "1.0.2": h101}), False)
    expect("a release removed from the manifest", check("1.0.1", "1.0.1", m100, {}, {}), False)
    expect("a release directory deleted, manifest kept", check("1.0.1", "1.0.1", m100, m100, {}), False)
    expect(
        "a fixture file edited, manifest kept",
        check("1.0.1", "1.0.1", m100, m100, {"1.0.0": {**h100, "expected.json": "X"}}),
        False,
    )
    expect(
        "a fixture file edited and its hash updated to match",
        check("1.0.1", "1.0.1", m100, {"1.0.0": {**h100, "expected.json": "X"}}, {"1.0.0": {**h100, "expected.json": "X"}}),
        False,
    )
    expect(
        "a new fixture whose files do not match its manifest",
        check("1.0.1", "1.0.1", {}, m100, {"1.0.0": {**h100, "store.json": "X"}}),
        False,
    )

    print(f"{passed} expectation(s) passed, {failed} failed.")
    if failed:
        return 1
    print("check_release_fixture.py gates as specified.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        raise SystemExit(self_test())
    raise SystemExit(main(sys.argv))
