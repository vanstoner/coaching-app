#!/usr/bin/env python3
"""
Every commit says which issue it serves — D5 of OMP-004 (#47).

WHY THIS IS TIME-SENSITIVE, in the PO's ruling's own words: trailers cannot be
retrofitted. Every session without this adds commits that will never have one.
The cost to reverse going forward is trivial; backwards it is impossible.

THE DEFECT IT FIXES is not hypothetical. The trailing `(#NN)` convention means
the ISSUE number on some commits and the PULL REQUEST number on others, and
nothing tells them apart:

    913bb15 Sub timing, squad persistence, and the truncated times (#57)   <- PR
    3c0b43d Match clock, setup and squad entry (#51)                       <- PR
    07389fc ...                                                            <- issue

So `git log --grep="#4"` cannot answer "what work went into REQ-04?", which is
exactly the question the PO asked for when he said he needed commits to tie to
something.

THE RULE: every commit carries a `Refs:` trailer naming one or more issues.

    Refs: #4
    Refs: #4, #9
    Refs: #52 #10

HISTORY IS EXEMPT. Commits at or before EXEMPT_THROUGH predate the convention
and are left alone; rewriting published history to satisfy a new rule would be
worse than the problem. New commits are checked.

Run the self-test with --self-test. It exercises the HEALTHY cases as well as
the failing ones, because five of six CI failures on this project were
assertions rejecting a correct artifact.
"""

import re
import subprocess
import sys

# main's head when this check landed. Everything up to and including it was
# written before the convention existed.
EXEMPT_THROUGH = "913bb15df69de16090e4053182ecc34723039d9c"

# A trailer line, anywhere in the trailer block: `Refs: #4, #9`
TRAILER = re.compile(r"^Refs:[ \t]*(.+)$", re.MULTILINE)
ISSUE = re.compile(r"#(\d+)")


def referenced_issues(message: str) -> list[int]:
    """The issue numbers a commit message claims, via its Refs: trailer(s)."""
    found: list[int] = []
    for match in TRAILER.finditer(message):
        for number in ISSUE.findall(match.group(1)):
            value = int(number)
            if value > 0 and value not in found:
                found.append(value)
    return found


def check_message(message: str) -> str | None:
    """None when the commit is fine, otherwise why it is not."""
    if not TRAILER.search(message):
        return "no `Refs:` trailer — say which issue this commit serves"
    if not referenced_issues(message):
        return "a `Refs:` trailer with no issue number in it (expected `#NN`)"
    return None


def is_merge(sha: str) -> bool:
    parents = subprocess.run(
        ["git", "rev-list", "--parents", "-n", "1", sha],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    return len(parents) > 2


def commits_in_range(base: str, head: str) -> list[str]:
    out = subprocess.run(
        ["git", "rev-list", f"{base}..{head}"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    return out


def message_of(sha: str) -> str:
    return subprocess.run(
        ["git", "log", "-1", "--format=%B", sha],
        capture_output=True, text=True, check=True,
    ).stdout


def is_exempt(sha: str) -> bool:
    """True when sha is EXEMPT_THROUGH or one of its ancestors."""
    if not EXEMPT_THROUGH:
        return False
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", sha, EXEMPT_THROUGH],
        capture_output=True, text=True,
    )
    return result.returncode == 0


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: check_refs_trailer.py <base-ref> <head-ref>", file=sys.stderr)
        print("       check_refs_trailer.py --self-test", file=sys.stderr)
        return 2

    base, head = argv[1], argv[2]
    shas = commits_in_range(base, head)
    if not shas:
        print(f"no commits in {base}..{head} — nothing to check")
        return 0

    failures = 0
    checked = 0
    for sha in shas:
        short = sha[:9]
        subject = message_of(sha).splitlines()[0] if message_of(sha) else ""
        if is_merge(sha):
            print(f"  skip {short}  (merge commit) {subject}")
            continue
        if is_exempt(sha):
            print(f"  skip {short}  (predates the convention) {subject}")
            continue
        checked += 1
        problem = check_message(message_of(sha))
        if problem:
            print(f"  FAIL {short}  {subject}")
            print(f"       {problem}")
            failures += 1
        else:
            refs = ", ".join(f"#{n}" for n in referenced_issues(message_of(sha)))
            print(f"  ok   {short}  {subject}")
            print(f"       Refs: {refs}")

    print()
    if failures:
        print("=" * 72)
        print("WHY THIS JOB FAILED")
        print("=" * 72)
        print(f"{failures} of {checked} commit(s) do not say which issue they serve.")
        print()
        print("Add a trailer to the commit message, alongside Squad-Role:")
        print()
        print("    Refs: #4")
        print()
        print("To fix the most recent commit:   git commit --amend")
        print("To fix several:                  git rebase -i <base>")
        print()
        print("Why this is enforced: `(#NN)` in a subject line means the PR on")
        print("some commits and the issue on others, so git log cannot answer")
        print("'what went into REQ-04?'. OMP-004 D5 (#47).")
        return 1

    print(f"{checked} commit(s) checked, all reference an issue.")
    return 0


# ---------------------------------------------------------------------------
# Self-test — the healthy cases too, not just the failures
# ---------------------------------------------------------------------------

def self_test() -> int:
    passed = failed = 0

    def expect(label, actual, wanted):
        nonlocal passed, failed
        if actual == wanted:
            passed += 1
        else:
            failed += 1
            print(f"FAIL {label}\n     wanted {wanted!r}\n     got    {actual!r}")

    # --- healthy: these must all be ACCEPTED ------------------------------
    good = {
        "one issue": "Do a thing\n\nBody.\n\nRefs: #4\nSquad-Role: Ellis (Engineer)\n",
        "two issues, comma": "Subject\n\nRefs: #4, #9\nSquad-Role: Ellis (Engineer)\n",
        "two issues, space": "Subject\n\nRefs: #52 #10\n",
        "trailer last line, no newline": "Subject\n\nRefs: #7",
        "alongside other trailers": (
            "Subject\n\nBody\n\nRefs: #4\n"
            "Squad-Role: Ellis (Engineer)\n"
            "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n"
        ),
        "tab after colon": "Subject\n\nRefs:\t#12\n",
        "large issue number": "Subject\n\nRefs: #1234\n",
    }
    for label, message in good.items():
        expect(f"accepts {label}", check_message(message), None)

    expect("reads one issue", referenced_issues("x\n\nRefs: #4\n"), [4])
    expect("reads two, comma", referenced_issues("x\n\nRefs: #4, #9\n"), [4, 9])
    expect("reads two, space", referenced_issues("x\n\nRefs: #52 #10\n"), [52, 10])
    expect("dedupes", referenced_issues("x\n\nRefs: #4, #4\n"), [4])
    expect(
        "reads two trailers",
        referenced_issues("x\n\nRefs: #4\nRefs: #9\n"),
        [4, 9],
    )

    # --- failing: these must all be REJECTED ------------------------------
    expect(
        "rejects a commit with no trailer",
        check_message("Subject\n\nBody only.\nSquad-Role: Ellis (Engineer)\n") is None,
        False,
    )
    expect(
        "rejects a subject-only (#NN), which is the defect this exists for",
        check_message("Subject (#57)\n\nBody.\n") is None,
        False,
    )
    expect(
        "rejects an empty trailer",
        check_message("Subject\n\nRefs:\n") is None,
        False,
    )
    expect(
        "rejects a trailer with no number",
        check_message("Subject\n\nRefs: see the issue\n") is None,
        False,
    )
    expect(
        "rejects #0",
        check_message("Subject\n\nRefs: #0\n") is None,
        False,
    )
    expect(
        "does not match Refs inside prose",
        check_message("Subject\n\nThis Refs: #4 is mid-sentence.\n") is None,
        # A line that BEGINS with `Refs:` is a trailer; this one does not.
        False,
    )

    print()
    print(f"{passed} expectation(s) passed, {failed} failed.")
    if failed:
        return 1
    print("check_refs_trailer.py gates as specified.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        raise SystemExit(self_test())
    raise SystemExit(main(sys.argv))
