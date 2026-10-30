#!/usr/bin/env python3
"""What a push builds: Android, iOS, or only the cheap checks (#230).

    ci_scope.py decide FILES_TXT     reads EVENT, DRAFT, LABELS, PRIOR_OK, WORKFLOW
                                     from the environment and prints
                                     android=, ios=, full=, build=, reason=
                                     (append to $GITHUB_OUTPUT)
    ci_scope.py --self-test          every row of #230 criterion 11, the
                                     draft rule (25-28) and the one-smoke
                                     rule (14), healthy cases first

Both android-apk.yml and ios.yml run this in a cheap `scope` job, and every
expensive job there is skipped by `if:` when it says so. NOT `on: paths`:
a workflow filtered out by path never reports, so a required check from it
would wait forever ("Expected"); a job skipped by `if:` reports skipped,
which counts as passing (#230 criterion 13).

Path rules (#230 criteria 5-8, Rob's Q1):
  * Android builds unless EVERY changed file is in the docs-only set. An
    exclusion list, so a path nobody listed (metro.config.js, plugins/)
    still builds: unknown means build (6).
  * iOS, on a pull request, builds unless every changed file is in the
    docs-only set or the Android-only set (7). Also an exclusion list.
  * On main, iOS builds exactly when Android does (Q1), so a release always
    gets its simulator zip and `attach` always has a release to wait for (8).
  * A dispatch builds both, whatever changed.
  * No list of changed files (a diff that could not be computed) builds
    both: the fail-safe direction.

Draft rule (#230 criteria 25-28, Rob's Q7 = c): on a pull request, the
expensive jobs run only when it is not a draft or carries the `ci:full`
label. The decision reads the event's own PR state, never the event's
action, so the same head in the same state always gets the same answer
whichever event started the run: an unrelated label never turns a red job
into a skipped one.

One smoke per head (#230 criterion 14): PRIOR_OK=true means an earlier
completed run of this workflow for this PR head already built, smoke-tested
and published it, so this run (ready_for_review or a `ci:full` label on an
unchanged head) does not do it again. The workflow works PRIOR_OK out from
the Actions API; any failure there leaves it false, so the head builds.
"""

import json
import os
import re
import sys

FULL_LABEL = "ci:full"

# #230 criterion 5. A change made only of these builds no Android and no iOS.
DOCS_ONLY = [
    "docs/**",
    ".claude/**",
    ".github/ISSUE_TEMPLATE/**",
    "store/**",
    "site/**",
    "*.md",            # root only: `*` never crosses a `/`
    "LICENSE",
    ".github/workflows/ci.yml",
    ".github/workflows/pages.yml",
    ".github/workflows/promote-release.yml",
    ".github/workflows/runner-smoke-test.yml",
    ".github/workflows/store-listing.yml",
    ".github/workflows/store-media.yml",
    ".github/workflows/testflight.yml",
    ".github/workflows/version-impact.yml",
    # #232 criterion 16: the Play upload adds no build to any PR.
    ".github/workflows/google-play.yml",
    ".github/scripts/play_api.py",
]

# #230 criterion 7: builds Android but not iOS.
ANDROID_ONLY = [
    ".github/workflows/android-apk.yml",
    "test-data/**",
    "eslint.config.mjs",
    "vitest.config.ts",
    "tsconfig.test.json",
    ".github/scripts/**",
]
# ...except the scripts ios.yml itself runs, which build iOS too.
IOS_READS = [
    ".github/scripts/assert_label_in_bundle.py",
    ".github/scripts/build-label.sh",
    ".github/scripts/check_ios_app.py",
    ".github/scripts/ios-archive.sh",
    ".github/scripts/write-build-label.py",
    ".github/scripts/write-distribution.py",
]


def _regex(pattern):
    """GitHub's path-filter glob: `**` crosses directories, `*` does not."""
    out = ""
    i = 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile(out + r"\Z")


def matches(path, patterns):
    return any(_regex(p).match(path) for p in patterns)


def in_docs_only(path):
    return matches(path, DOCS_ONLY)


def in_android_only(path):
    return matches(path, ANDROID_ONLY) and not matches(path, IOS_READS)


def by_path(event, files):
    """(android, ios) from the changed files alone. files=None: unknown."""
    if event == "workflow_dispatch" or files is None:
        return True, True
    files = [f for f in files if f]
    android = any(not in_docs_only(f) for f in files)
    if event == "push":
        return android, android                      # Q1: coupled on main
    ios = any(not in_docs_only(f) and not in_android_only(f) for f in files)
    return android, ios


def decide(event, draft, labels, prior_ok, files, workflow):
    """The outputs of the scope job for one workflow (android-apk or ios)."""
    android, ios = by_path(event, files)
    if event == "pull_request":
        full = (not draft) or (FULL_LABEL in labels)
    else:
        full = True
    wanted = android if workflow == "android-apk" else ios
    if not wanted:
        build, reason = False, ("only files this workflow does not build from changed "
                                "(docs-only" + (", or Android-only" if workflow == "ios" else "") + ")")
    elif not full:
        build, reason = False, f"draft pull request without the {FULL_LABEL} label: cheap checks only"
    elif event == "pull_request" and prior_ok:
        build, reason = False, "an earlier run already built, smoke-tested and published this head"
    else:
        build, reason = True, "build"
    return {"android": android, "ios": ios, "full": full, "build": build, "reason": reason}


# Pages keeps its own `on: paths` (criterion 9); read from pages.yml so the
# matrix below is checked against the real file, not a copy of it.
def pages_paths(pages_yml):
    with open(pages_yml, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"\s*paths:\s*\[(.*)\]\s*$", line)
            if m:
                return [p.strip() for p in m.group(1).split(",") if p.strip()]
    return None


def self_test():
    here = os.path.dirname(os.path.abspath(__file__))
    pages = pages_paths(os.path.join(here, "..", "workflows", "pages.yml"))
    failed = 0

    def expect(name, got, want):
        nonlocal failed
        ok = got == want
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name} -> {got}{'' if ok else f' (want {want})'}")

    if not pages:
        print("  x  could not read the paths of pages.yml")
        failed += 1
        pages = []

    # Criterion 11, row by row: (files, Android, iOS, Pages) for a PR.
    rows = [
        (["src/engine/clock.ts"], True, True, False),
        (["App.tsx"], True, True, False),
        (["index.ts"], True, True, False),
        (["app.json"], True, True, False),
        (["app.config.js"], True, True, False),
        (["package.json"], True, True, False),
        (["package-lock.json"], True, True, False),
        (["tsconfig.json"], True, True, False),
        (["assets/images/icon.png"], True, True, True),
        (["assets/fonts/Barlow-Bold.ttf"], True, True, False),
        ([".github/workflows/ios.yml"], True, True, False),
        ([".github/scripts/ios-archive.sh"], True, True, False),
        ([".github/workflows/android-apk.yml"], True, False, False),
        ([".github/scripts/emulator-smoke.sh"], True, False, False),
        (["test-data/test-season.json"], True, False, True),
        (["metro.config.js"], True, True, False),
        (["plugins/withThing.js"], True, True, False),
        (["docs/decisions/ADR-007.md"], False, False, False),
        ([".github/workflows/google-play.yml"], False, False, False),
        ([".github/scripts/play_api.py"], False, False, False),
        ([".github/scripts/play_bundle.py"], True, False, False),
        (["HISTORY.md"], False, False, False),
        (["README.md"], False, False, False),
        ([".github/ISSUE_TEMPLATE/bug.yml"], False, False, False),
        (["store/app-store/en-GB/description.txt"], False, False, False),
        (["site/index.html"], False, False, True),
        (["PRIVACY.md"], False, False, True),
        (["COACHES.md"], False, False, True),
        (["docs/x.md", "src/x.ts"], True, True, False),
        # beyond the matrix: the edges of the two lists
        ([".claude/skills/ship/SKILL.md"], False, False, False),
        (["LICENSE"], False, False, False),
        ([".github/workflows/ci.yml"], False, False, False),
        ([".github/workflows/testflight.yml"], False, False, False),
        (["docs/nested/deep/x.md"], False, False, False),
        (["src/README.md"], True, True, False),              # `*.md` is root only
        ([".github/scripts/assert_label_in_bundle.py"], True, True, False),
        ([".github/scripts/build-label.sh"], True, True, False),
        ([".github/scripts/check_ios_app.py"], True, True, False),
        ([".github/scripts/write-build-label.py"], True, True, False),
        ([".github/scripts/write-distribution.py"], True, True, False),
        ([".github/scripts/ci_scope.py"], True, False, False),
        ([".github/pull_request_template.md"], True, True, False),  # unlisted: builds
        ([], False, False, False),
    ]
    print("criterion 11 (pull request):")
    for files, want_a, want_i, want_p in rows:
        a, i = by_path("pull_request", files)
        p = any(matches(f, pages) for f in files)
        expect(f"{' + '.join(files) or '(nothing)'}", (a, i, p), (want_a, want_i, want_p))

    print("Q1 (main): iOS builds exactly when Android does:")
    expect("main, android-apk.yml only", by_path("push", [".github/workflows/android-apk.yml"]), (True, True))
    expect("main, test-data only", by_path("push", ["test-data/test-season.json"]), (True, True))
    expect("main, docs only", by_path("push", ["docs/x.md", "HISTORY.md"]), (False, False))
    expect("main, app.json (version bump)", by_path("push", ["app.json", "HISTORY.md", "store/app-store/en-GB/whats_new.txt"]), (True, True))
    print("fail-safe: no file list, or a dispatch, builds both:")
    expect("pull request, diff unknown", by_path("pull_request", None), (True, True))
    expect("dispatch, nothing changed", by_path("workflow_dispatch", []), (True, True))

    print("criteria 25-28 and 14 (the build decision):")
    app = ["src/x.ts"]
    docs = ["docs/x.md"]
    table = [
        # name, event, draft, labels, prior_ok, files, workflow, want build
        ("ready PR, app change", "pull_request", False, [], False, app, "android-apk", True),
        ("ready PR, app change (iOS)", "pull_request", False, [], False, app, "ios", True),
        ("draft PR, app change", "pull_request", True, [], False, app, "android-apk", False),
        ("draft PR, app change (iOS)", "pull_request", True, [], False, app, "ios", False),
        ("draft PR labelled ci:full", "pull_request", True, ["ci:full"], False, app, "android-apk", True),
        ("draft PR labelled ci:full (iOS)", "pull_request", True, ["ci:full", "x"], False, app, "ios", True),
        ("draft PR, other label only", "pull_request", True, ["decision-needed"], False, app, "android-apk", False),
        ("ready PR, docs only", "pull_request", False, [], False, docs, "android-apk", False),
        ("ci:full PR, docs only", "pull_request", True, ["ci:full"], False, docs, "ios", False),
        ("ready PR, store text only", "pull_request", False, [], False, ["store/app-store/en-GB/whats_new.txt"], "android-apk", False),
        ("ready PR, head already built (ready after ci:full)", "pull_request", False, ["ci:full"], True, app, "android-apk", False),
        ("ready PR, head already built (iOS)", "pull_request", False, [], True, app, "ios", False),
        ("main, app change", "push", False, [], False, app, "android-apk", True),
        ("main, app change (iOS)", "push", False, [], False, app, "ios", True),
        ("main, prior_ok is ignored", "push", False, [], True, app, "android-apk", True),
        ("main, docs only", "push", False, [], False, docs, "android-apk", False),
        ("main, docs only (iOS)", "push", False, [], False, docs, "ios", False),
        ("dispatch", "workflow_dispatch", False, [], True, [], "android-apk", True),
        ("dispatch (iOS)", "workflow_dispatch", False, [], False, [], "ios", True),
    ]
    for name, event, draft, labels, prior, files, wf, want in table:
        got = decide(event, draft, labels, prior, files, wf)["build"]
        expect(name, got, want)

    print(f"{failed} failed." if failed else "every expectation held.")
    return 1 if failed else 0


def truthy(value):
    return str(value).strip().lower() == "true"


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) != 3 or argv[1] != "decide":
        print(__doc__)
        return 2
    event = os.environ.get("EVENT", "")
    workflow = os.environ.get("WORKFLOW", "")
    if workflow not in ("android-apk", "ios"):
        print(f"WHY THIS JOB FAILED: WORKFLOW must be android-apk or ios, not {workflow!r}")
        return 2
    # toJSON(github.event.pull_request.labels.*.name): a JSON list, or empty.
    raw = os.environ.get("LABELS", "").strip()
    try:
        labels = [str(l) for l in (json.loads(raw) or [])] if raw else []
    except ValueError:
        labels = [l for l in raw.splitlines() if l]
    files = None
    if argv[2] != "-" and os.path.exists(argv[2]):
        with open(argv[2], encoding="utf-8") as f:
            files = [line.strip() for line in f if line.strip()]
    d = decide(event, truthy(os.environ.get("DRAFT")), labels,
               truthy(os.environ.get("PRIOR_OK")), files, workflow)
    shown = "unknown (build everything)" if files is None else f"{len(files)}"
    print(f"# event={event} draft={os.environ.get('DRAFT')} labels={labels} "
          f"prior_ok={os.environ.get('PRIOR_OK')} changed files={shown}", file=sys.stderr)
    for f in (files or [])[:50]:
        tag = "docs-only" if in_docs_only(f) else ("android-only" if in_android_only(f) else "app")
        print(f"#   {tag:12} {f}", file=sys.stderr)
    for key in ("android", "ios", "full", "build"):
        print(f"{key}={'true' if d[key] else 'false'}")
    print(f"reason={d['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
