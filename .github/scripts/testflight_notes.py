#!/usr/bin/env python3
"""The build number and the "What to Test" text for a TestFlight upload — #160.

One number per commit (Rob: "I want a cool build increment"): an iOS upload
takes the build number of the GitHub release built from the same commit, the
N of `v<version>-build.N`, which is also that APK's versionCode. TestFlight,
the releases page and Android then show the same number for the same code.

"What to Test" (#182) covers the whole version, not the one merge that
bumped it: every merge since the previous version that changed the app (App.tsx,
src/ or assets/, tests aside), each with the issues it closes and its PR's
"## Beta test steps", then how to load the made-up test season. Plain text:
TestFlight shows no Markdown. The previous version is found in app.json's
history, so the job checks out the whole history.

    testflight_notes.py number SHA            # prints BUILD=N and TAG=..., or exits 3 (no release yet)
    testflight_notes.py notes SHA N OUTFILE   # writes the What to Test text (needs git history)
    testflight_notes.py --self-test

Needs GITHUB_REPOSITORY and, for the lookups, `gh` with a token.
"""

import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from release_notes import (IPHONE_STATUS, SIMULATOR_LINE, beta_test_steps, build_notes,  # noqa: E402
                           closed_issues, gh_json, main_release_at)

LIMIT = 4000  # App Store Connect's limit for What to Test
TESTERS_PAGE = "https://vanstoner.github.io/coaching-app/testers.html"
# The paths a merge must touch to be an app change a tester can see.
APP_PATHS = ["App.tsx", "src", "assets", ":!*.test.ts", ":!*.test.tsx"]
NO_STEPS = "No written steps: try it as a coach would, and report anything odd."
FOOTER = (
    "BEFORE YOU START\n"
    "This is an update: install it over the version you already have, with your data in it,"
    " and check everything is still there (#167).\n"
    "\n"
    "THE TEST SEASON (made-up names only)\n"
    "1. On the iPhone, open this page in Safari and tap Download the test season:\n"
    f"{TESTERS_PAGE}\n"
    "2. Safari asks to download test-season.json: tap Download. It goes to the Files app, in Downloads.\n"
    "3. In the app: Settings > Import minutes file.\n"
    "4. In the picker, the file is usually at the top of Recents; if not, Browse > Downloads. Tap it.\n"
    "It imports only into an app that hasn't recorded matches of its own; on a phone with a real"
    " season it is refused and nothing changes. When done: Settings > Forget everything.\n"
    "\n"
    "Feedback: take a screenshot in the app and TestFlight offers to send it."
)


# ---------------------------------------------------------------------------
# Pure
# ---------------------------------------------------------------------------

def plain_text(md):
    """Markdown as TestFlight shows it: no link syntax (URLs kept), no emphasis, no headings."""
    out = []
    for line in md.splitlines():
        if IPHONE_STATUS in line or SIMULATOR_LINE in line:
            continue
        line = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1", line)   # [PR #150](url) -> PR #150
        line = re.sub(r"^#{1,6}\s*", "", line)                              # ## Heading -> Heading
        line = re.sub(r"\*\*([^*]+)\*\*", r"\1", line)                      # **bold**
        line = re.sub(r"(?<![\w*])_([^_\n]+)_(?![\w*])", r"\1", line)       # _italic_
        line = line.replace("`", "")
        line = re.sub(r"^\s*[-*]\s+", "- ", line)
        out.append(line.rstrip())
    text = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def previous_version_base(history, version):
    """The commit that bumped app.json to the version before VERSION.

    HISTORY is [(sha, version)] for the commits that changed app.json, newest
    first. Returns (previous version, sha) or None when there is none. The
    previous TestFlight upload was made from that bump (testflight.yml runs
    on a bump), so the merges after it are what is new."""
    i = 0
    while i < len(history) and history[i][1] == version:
        i += 1
    if i == len(history):
        return None
    prev = history[i][1]
    while i + 1 < len(history) and history[i + 1][1] == prev:
        i += 1
    return prev, history[i][0]


def pr_number(subject):
    m = re.search(r"\(#(\d+)\)\s*$", subject)
    return int(m.group(1)) if m else None


def version_notes(version, build, prev, changes):
    """What to Test for a whole version. CHANGES, oldest first: dicts of
    title, pr, issues [(n, title)], steps (markdown or None)."""
    out = [f"Heart FC Coach {version} (build {build})", ""]
    if not changes:
        out += [f"No change to the app itself since {prev}: this build is for the store or the build"
                " process. Check the app opens and your data is all there.", ""]
        return "\n".join(out)
    out.append(f"NEW SINCE {prev}" if prev else "WHAT'S IN IT")
    for c in changes:
        out.append(f"- {c['title']}" + (f" (PR #{c['pr']})" if c.get("pr") else ""))
        for n, t in c.get("issues", []):
            out.append(f"  Issue #{n}: {t or '(title not found)'}")
    out += ["", "WHAT TO TEST"]
    for c in changes:
        out.append(f"{c['title']}:")
        out.append(c["steps"].strip() if c.get("steps") else NO_STEPS)
        out.append("")
    return plain_text("\n".join(out))


def git_lines(*args):
    r = subprocess.run(["git", *args], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()[:200]}")
    return [l for l in r.stdout.splitlines() if l.strip()]


def version_at(sha):
    return json.loads("\n".join(git_lines("show", f"{sha}:app.json")))["expo"]["version"]


def collect(sha, repo, fetch=gh_json):
    """(version, previous version, changes) from git history and the PRs."""
    version = version_at(sha)
    history = [(c, version_at(c)) for c in git_lines("log", "--format=%H", sha, "--", "app.json")]
    found = previous_version_base(history, version)
    prev, base = found if found else (None, None)
    rng = f"{base}..{sha}" if base else sha
    changes = []
    for line in reversed(git_lines("log", "--format=%s", rng, "--", *APP_PATHS)):
        n = pr_number(line)
        title = re.sub(r"\s*\(#\d+\)\s*$", "", line)
        change = {"title": title, "pr": n, "issues": [], "steps": None}
        if n:
            try:
                pr = fetch(f"repos/{repo}/pulls/{n}")
                body = pr.get("body") or ""
                change["title"] = pr.get("title") or title
                change["steps"] = beta_test_steps(body)
                for i in closed_issues(body):
                    try:
                        change["issues"].append((i, fetch(f"repos/{repo}/issues/{i}").get("title")))
                    except Exception:  # noqa: BLE001 — degrade
                        change["issues"].append((i, None))
            except Exception as e:  # noqa: BLE001 — degrade, never block the upload
                print(f"warning: PR #{n} lookup failed ({e})", file=sys.stderr)
        changes.append(change)
    return version, prev, changes


def what_to_test(md, limit=LIMIT):
    """The notes as plain text, then the footer, within LIMIT characters."""
    body = plain_text(md)
    tail = "\n\n" + FOOTER
    room = limit - len(tail)
    if len(body) > room:
        cut = body[: room - 2].rsplit("\n", 1)[0].rstrip()
        body = cut + "\n…"
    return body + tail



# ---------------------------------------------------------------------------
# Self-test: healthy cases first
# ---------------------------------------------------------------------------

def self_test():
    failed = 0

    def expect(name, ok):
        nonlocal failed
        print(f"  {'ok' if ok else 'x '} {name}")
        failed += not ok

    repo = "vanstoner/coaching-app"
    rel = lambda tag, sha, pre=False, draft=False: {  # noqa: E731
        "tag_name": tag, "target_commitish": sha, "prerelease": pre, "draft": draft,
        "html_url": f"https://github.com/{repo}/releases/tag/{tag}"}

    found = main_release_at("abc", repo, lambda p: [rel("beta", "abc", pre=True), rel("v1.0.1-build.130", "abc")])
    expect("healthy: the main release of this commit gives its build number", found and found[0] == 130)
    expect("the beta at the same commit is never taken",
           main_release_at("abc", repo, lambda p: [rel("beta", "abc", pre=True)]) is None)
    expect("another commit's release is never taken",
           main_release_at("abc", repo, lambda p: [rel("v1.0.1-build.129", "def")]) is None)
    expect("a draft is never taken",
           main_release_at("abc", repo, lambda p: [rel("v1.0.1-build.130", "abc", draft=True)]) is None)

    md = (
        "## Build 130 contains [PR #160](https://github.com/vanstoner/coaching-app/pull/160)\n\n"
        "**One build number per commit**\n\nCloses:\n"
        "- [#160](https://github.com/vanstoner/coaching-app/issues/160) One build number\n\n"
        f"**{IPHONE_STATUS}**\n\n{SIMULATOR_LINE}\n\n"
        "## Beta test steps\n\n1. Install `build 130`.\n2. Open _Settings_.\n"
    )
    text = what_to_test(md)
    expect("healthy: plain text keeps the build, PR, issue and steps",
           all(s in text for s in ("Build 130 contains PR #160", "One build number per commit",
                                   "#160 One build number", "Beta test steps", "1. Install build 130.",
                                   "2. Open Settings.")))
    expect("no Markdown left (links, bold, headings, backticks)",
           not any(s in text for s in ("](", "**", "## ", "`")))
    expect("the iPhone-status and simulator lines are dropped",
           IPHONE_STATUS not in text and "simulator build" not in text)
    expect("the footer carries the testers page and the import steps",
           TESTERS_PAGE in text and "Settings > Import minutes file" in text and "Browse > Downloads" in text)
    long = what_to_test("line of notes\n" * 600)
    expect("a long note is cut to 4000 with the footer kept", len(long) <= LIMIT and long.endswith(FOOTER))

    # #182: the whole version, healthy first.
    hist = [("c5", "1.0.2"), ("c4", "1.0.1"), ("c3", "1.0.1"), ("c2", "1.0.0"), ("c1", "0.9")]
    expect("healthy: the base is the bump to the previous version",
           previous_version_base(hist, "1.0.2") == ("1.0.1", "c3"))
    expect("the first version has no base", previous_version_base([("c1", "1.0.0")], "1.0.0") is None)
    expect("a squash subject gives its PR number", pr_number("Share plan for parents (#169)") == 169)
    changes = [
        {"title": "Rename a match's position names", "pr": 168, "issues": [(166, "Rename positions")],
         "steps": "1. Open a fixture's Plan.\n2. Tap `CM` and rename it."},
        {"title": "Share plan", "pr": 169, "issues": [(165, "Share plan image")], "steps": None},
    ]
    v = what_to_test(version_notes("1.0.1", "161", "1.0.0", changes))
    expect("healthy: every app change, its issue and its steps, since the previous version",
           all(x in v for x in ("Heart FC Coach 1.0.1 (build 161)", "NEW SINCE 1.0.0",
                                "- Rename a match's position names (PR #168)", "Issue #166: Rename positions",
                                "- Share plan (PR #169)", "Issue #165: Share plan image",
                                "1. Open a fixture's Plan.", "2. Tap CM and rename it.", NO_STEPS)))
    expect("never the release page's placeholders",
           "closes no issue" not in v and "has no \"## Beta test steps\"" not in v and "## " not in v)
    none = what_to_test(version_notes("1.0.2", "170", "1.0.1", []))
    expect("a version with no app change says so", "No change to the app itself since 1.0.1" in none)

    print(f"{15 - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if len(argv) == 3 and argv[1] == "number":
        try:
            found = main_release_at(argv[2], repo, gh_json)
        except Exception as e:  # noqa: BLE001 — a lookup failure is "not yet"
            print(f"release lookup failed: {e}", file=sys.stderr)
            found = None
        if not found:
            return 3
        n, url = found
        print(f"BUILD={n}")
        print(f"TAG={url.rsplit('/', 1)[-1]}")
        return 0
    if len(argv) == 5 and argv[1] == "notes":
        sha, n, out = argv[2], argv[3], argv[4]
        try:
            version, prev, changes = collect(sha, repo)
            md = version_notes(version, n, prev, changes)
        except Exception as e:  # noqa: BLE001 — degrade to the one merge's note, never block the upload
            print(f"warning: the version's changes could not be listed ({e})", file=sys.stderr)
            md = build_notes("main", sha, n, repo)
        text = what_to_test(md)
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {len(text)} characters of What to Test to {out}")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
