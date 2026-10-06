#!/usr/bin/env python3
"""The build number and the "What to Test" text for a TestFlight upload — #160.

One number per commit (Rob: "I want a cool build increment"): an iOS upload
takes the build number of the GitHub release built from the same commit, the
N of `v<version>-build.N`, which is also that APK's versionCode. TestFlight,
the releases page and Android then show the same number for the same code.

"What to Test" is that release's own note, from release_notes.py, with the
PR's test steps, as plain text: TestFlight shows no Markdown.

    testflight_notes.py number SHA            # prints BUILD=N and TAG=..., or exits 3 (no release yet)
    testflight_notes.py notes SHA N OUTFILE   # writes the What to Test text
    testflight_notes.py --self-test

Needs GITHUB_REPOSITORY and, for the lookups, `gh` with a token.
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from release_notes import IPHONE_STATUS, SIMULATOR_LINE, build_notes, gh_json, main_release_at  # noqa: E402

LIMIT = 4000  # App Store Connect's limit for What to Test
TEST_SEASON = "https://github.com/vanstoner/coaching-app/raw/main/test-data/test-season.json"
FOOTER = (
    "Test data: a made-up season to import (Settings > Import minutes file):\n"
    f"{TEST_SEASON}\n"
    "Made-up names only. Settings > Forget everything when done."
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


def what_to_test(md, limit=LIMIT):
    """The release note as plain text, then the footer, within LIMIT characters."""
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
    expect("the footer carries the test-season link", TEST_SEASON in text and text.endswith("when done."))
    long = what_to_test("line of notes\n" * 600)
    expect("a long note is cut to 4000 with the footer kept", len(long) <= LIMIT and long.endswith("when done."))

    print(f"{9 - failed} expectation(s) passed, {failed} failed.")
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
        md = ""
        try:
            pulls = gh_json(f"repos/{repo}/commits/{sha}/pulls")
            merged = [p for p in pulls if p.get("merge_commit_sha") == sha] or pulls
            if merged:
                md = build_notes("beta", str(merged[0]["number"]), n, repo)
        except Exception as e:  # noqa: BLE001 — degrade, never block the upload
            print(f"warning: PR lookup for {sha[:7]} failed ({e})", file=sys.stderr)
        if not md:
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
