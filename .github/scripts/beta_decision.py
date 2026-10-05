#!/usr/bin/env python3
"""May main's release job replace `beta` with its "merged" note? — #128 AC3.

The note stands only "until the next PR's beta replaces it". A main build
runs for many minutes (the emulator test), and another PR's beta can publish
in that window. Replacing THAT beta with an older merge's note would destroy
the newest thing Rob has to test. So the note replaces the current `beta`
only when:

    there is no beta                        -> replace (create the note)
    it is already a merged note             -> replace
    it is the beta of the PR merged now     -> replace
    its PR is no longer open                -> replace
    otherwise (an open PR's beta, an
    unreadable title or PR state)           -> keep, and say why

    beta_decision.py REPO MERGE_SHA     prints `replace` or `keep` on stdout,
                                        the reason on stderr
    beta_decision.py --self-test

Titles come from android-apk.yml: the beta job's
"Coaching Beta (PR #N)" and the release job's
"Coaching Beta — merged into build N".
"""

import json
import re
import subprocess
import sys

PR_TITLE = re.compile(r"^Coaching Beta \(PR #(\d+)\)$")
NOTE_TITLE = re.compile(r"^Coaching Beta — merged into build \d+$")


def parse_title(title):
    """('none', None) | ('note', None) | ('pr', N) | ('unknown', None)."""
    if title is None:
        return ("none", None)
    t = title.strip()
    if NOTE_TITLE.match(t):
        return ("note", None)
    m = PR_TITLE.match(t)
    if m:
        return ("pr", int(m.group(1)))
    return ("unknown", None)


def decide(beta_title, merged_pr, beta_pr_state):
    """Pure. beta_title None = no beta; merged_pr None = unknown;
    beta_pr_state 'open' | 'closed' | None (unknown). Returns (action, reason)."""
    kind, n = parse_title(beta_title)
    if kind == "none":
        return ("replace", "there is no beta; create the note")
    if kind == "note":
        return ("replace", "the beta is already a merged note")
    if kind == "unknown":
        return ("keep", f"cannot parse the beta title {beta_title!r}; leaving it alone")
    if merged_pr is not None and n == merged_pr:
        return ("replace", f"the beta is PR #{n}'s, the PR merged now")
    if beta_pr_state == "closed":
        return ("replace", f"the beta is PR #{n}'s, which is no longer open")
    if beta_pr_state == "open":
        return ("keep", f"the beta is open PR #{n}'s, newer than this merge; leaving it alone")
    return ("keep", f"could not read PR #{n}'s state; leaving its beta alone")


# ---------------------------------------------------------------------------
# Impure: GitHub lookups. A failed lookup becomes "unknown", never a crash.
# ---------------------------------------------------------------------------

def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[:200])
    return r.stdout


def lookup(repo, sha):
    try:
        title = json.loads(gh("api", f"repos/{repo}/releases/tags/beta"))["name"]
    except Exception as e:
        if "404" in str(e) or "not found" in str(e).lower():
            title = None
        else:
            print(f"warning: could not read the beta release ({e})", file=sys.stderr)
            title = "(unreadable)"
    merged_pr = None
    try:
        pulls = json.loads(gh("api", f"repos/{repo}/commits/{sha}/pulls"))
        merged = [p for p in pulls if p.get("merge_commit_sha") == sha] or pulls
        if merged:
            merged_pr = int(merged[0]["number"])
    except Exception as e:
        print(f"warning: could not find the PR for {sha[:7]} ({e})", file=sys.stderr)
    state = None
    kind, n = parse_title(title)
    if kind == "pr" and n != merged_pr:
        try:
            state = json.loads(gh("api", f"repos/{repo}/pulls/{n}"))["state"]
        except Exception as e:
            print(f"warning: could not read PR #{n} ({e})", file=sys.stderr)
    return title, merged_pr, state


def self_test():
    note = "Coaching Beta — merged into build 101"
    cases = [
        # (description, title, merged PR, beta PR state, expected action)
        ("healthy: beta of the PR merged now -> replace", "Coaching Beta (PR #129)", 129, None, "replace"),
        ("healthy: no beta -> create the note", None, 129, None, "replace"),
        ("healthy: existing merged note -> replace", note, 129, None, "replace"),
        ("healthy: merged PR unknown, beta's PR closed -> replace", "Coaching Beta (PR #129)", None, "closed", "replace"),
        ("open newer PR's beta -> keep (the #132 race)", "Coaching Beta (PR #132)", 129, "open", "keep"),
        ("closed PR's beta -> replace", "Coaching Beta (PR #120)", 129, "closed", "replace"),
        ("unparseable title -> keep", "Coaching Beta", 129, None, "keep"),
        ("unreadable beta release -> keep", "(unreadable)", 129, None, "keep"),
        ("other PR, state unknown -> keep", "Coaching Beta (PR #132)", 129, None, "keep"),
    ]
    failed = 0
    for name, title, merged, state, want in cases:
        got, why = decide(title, merged, state)
        ok = got == want
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name} -> {got} ({why})")
    print(f"{len(cases) - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) != 3:
        print(__doc__)
        return 2
    title, merged_pr, state = lookup(argv[1], argv[2])
    action, why = decide(title, merged_pr, state)
    print(f"beta={title!r} merged PR={merged_pr} beta PR state={state}: {action} — {why}", file=sys.stderr)
    print(action)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
