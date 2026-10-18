#!/usr/bin/env python3
"""
Every app change says what it does to the version, and brings its notes — #217.

Rob, 18 Oct: "We need to get into the habit of recognising material changes
and nudging the version accordingly and producing up-to-date docs, spec,
release notes and any diagrams." Left to memory, the version moved only when
Rob asked and the docs caught up in sweeps; this makes it a gate.

THE RULE, for a pull request that changes the app (App.tsx, src/ or assets/,
tests aside): its description has a `## Version` section whose first word is

    minor   something a coach can see or do that is new   1.2.0 -> 1.3.0
    patch   a fix, or wording; nothing new to do          1.2.0 -> 1.2.1
    major   Rob's call only                               1.2.0 -> 2.0.0
    none    plus a reason on the same line (e.g. a refactor nobody can see)

and, unless it is none, `app.json` moves by exactly that step from the base
branch's version, and HISTORY.md changes. The release fixture for the version
being superseded is check_release_fixture.py's job, not this one's.

A pull request that changes no app file needs nothing here.

    check_version_impact.py BASE_REF      # PR_BODY in the environment
    check_version_impact.py --self-test

The self-test runs the HEALTHY cases first: five of six CI failures on this
project were assertions rejecting a correct artifact.
"""

import json
import os
import re
import subprocess
import sys

KINDS = ("major", "minor", "patch", "none")


def is_app_file(path):
    if re.search(r"\.test\.tsx?$", path) or "/fixtures/" in path:
        return False
    return path == "App.tsx" or path.startswith("src/") or path.startswith("assets/")


def declared(body):
    """(kind, rest of the line) from the `## Version` section, or (None, '')."""
    lines = (body or "").replace("\r\n", "\n").split("\n")
    for i, line in enumerate(lines):
        if re.match(r"^##\s+Version\s*$", line.strip(), re.I):
            for nxt in lines[i + 1:]:
                if nxt.strip().startswith("## "):
                    break
                text = re.sub(r"[*_`]", "", nxt).strip()
                if not text:
                    continue
                m = re.match(r"^(major|minor|patch|none)\b[\s:.,;—–-]*(.*)$", text, re.I)
                return (m.group(1).lower(), m.group(2).strip()) if m else (None, text)
            return None, ""
    return None, ""


def bump(version, kind):
    a, b, c = (int(x) for x in version.split("."))
    return {"major": f"{a + 1}.0.0", "minor": f"{a}.{b + 1}.0", "patch": f"{a}.{b}.{c + 1}"}[kind]


def problems(changed, body, base_version, head_version):
    app = [p for p in changed if is_app_file(p)]
    if not app:
        return []
    kind, rest = declared(body)
    shown = ", ".join(app[:3]) + (" …" if len(app) > 3 else "")
    if kind is None:
        return [f"this PR changes the app ({shown}) but its description has no `## Version` "
                f"section starting with minor, patch, major or none (#217)"]
    if kind == "none":
        return [] if rest else ["`## Version` says none for an app change but gives no reason on that line (#217)"]
    found = []
    want = bump(base_version, kind)
    if head_version != want:
        found.append(f"`## Version` says {kind}, so app.json should move {base_version} -> {want}, "
                     f"but it is {head_version} (#217)")
    if "HISTORY.md" not in changed:
        found.append("an app change with a version bump needs its HISTORY.md entry (#217)")
    return found


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def version_at(ref):
    return json.loads(git("show", f"{ref}:app.json"))["expo"]["version"]


def self_test():
    failed = total = 0

    def check(name, cond):
        nonlocal failed, total
        total += 1
        failed += not cond
        print(f"  {'ok' if cond else 'x '} {name}")

    app = ["src/screens/SquadScreen.tsx", "HISTORY.md", "app.json"]
    minor = "Intro.\n\n## Version\n**minor: 1.1.1 → 1.2.0.** Coaches can sort tables.\n\n## Other\nx"
    check("healthy: a minor change, bumped, with its history", problems(app, minor, "1.1.1", "1.2.0") == [])
    check("healthy: a patch", problems(app, "## Version\npatch: a fix", "1.2.0", "1.2.1") == [])
    check("healthy: none with a reason", problems(["src/app/x.ts"], "## Version\nnone — a refactor nobody sees", "1.2.0", "1.2.0") == [])
    check("healthy: no app file, no section needed", problems([".github/workflows/ci.yml", "docs/a.md"], "", "1.2.0", "1.2.0") == [])
    check("healthy: tests and fixtures alone are not app changes",
          problems(["src/app/a.test.ts", "src/app/fixtures/release-1.2.0/store.json"], "", "1.2.0", "1.2.0") == [])
    check("healthy: CRLF bodies, as GitHub sends them", problems(app, minor.replace("\n", "\r\n"), "1.1.1", "1.2.0") == [])

    check("fails: an app change with no section", bool(problems(app, "Just words", "1.1.1", "1.2.0")))
    check("fails: a section with no kind", bool(problems(app, "## Version\nbig one", "1.1.1", "1.2.0")))
    check("fails: none with no reason", bool(problems(["src/x.ts"], "## Version\nnone", "1.2.0", "1.2.0")))
    check("fails: minor declared, not bumped", bool(problems(app, minor, "1.1.1", "1.1.1")))
    check("fails: minor declared, patch bumped", bool(problems(app, minor, "1.1.1", "1.1.2")))
    check("fails: bumped but no history", bool(problems(["src/x.ts", "app.json"], minor, "1.1.1", "1.2.0")))
    check("fails: App.tsx counts as the app", bool(problems(["App.tsx"], "", "1.0.0", "1.0.0")))
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    base = argv[1]
    changed = [p for p in git("diff", "--name-only", f"{base}...HEAD").split("\n") if p]
    base_version, head_version = version_at(base), version_at("HEAD")
    body = os.environ.get("PR_BODY", "")
    print(f"version: {base} {base_version} -> HEAD {head_version}; declared: {declared(body)[0] or 'nothing'}")
    print(f"app files changed: {sum(is_app_file(p) for p in changed)} of {len(changed)}")
    found = problems(changed, body, base_version, head_version)
    for p in found:
        print(f"PROBLEM: {p}")
    print("version impact: ok" if not found else "version impact: NOT OK")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
