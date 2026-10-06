#!/usr/bin/env python3
"""Assert a build of main became THE release — #79, PO ruling "approve 1 2"; #128.

The model: a pull request publishes Heart FC Beta Coach (one rolling `beta`
prerelease); Rob's approval merges it, and the build of main publishes the
full Heart FC Coach release, marked Latest. No in-between prerelease of the
real app.

#128 AC3 ("approve 11"): the merge no longer leaves the beta EMPTY. The `beta`
prerelease is replaced by a note, "Merged into Heart FC Coach build N — install
that instead", linking the release, with NO .apk, until the next PR's beta
replaces it. (Until #128 this check asserted the beta was absent.)

Except: when beta_decision.py chose `keep` because an open PR's newer beta
published while this build ran, that beta (with its APK) must still be there,
untouched. Only the kept case accepts a PR beta.

Read back from GitHub after publishing, not assumed from the flags passed:

    check_release.py RELEASE_JSON LATEST_TAG BETA_JSON EXPECTED_TAG [replace|keep]
    check_release.py --self-test

RELEASE_JSON is `gh release view TAG --json tagName,isPrerelease,isDraft,assets`;
LATEST_TAG is what /releases/latest reports; BETA_JSON is
`gh release view beta --json name,tagName,isPrerelease,isDraft,assets,body`, or
the word `none` when there is no beta release. The last argument is
beta_decision.py's verdict; it defaults to `replace`.

#146, the demo (tag `demo`, "Heart FC Beta Coach — demo"), two more modes:

    check_release.py --demo-untouched BEFORE AFTER
        AC1/AC7: a job that is not demo.yml (main's release job, a PR's beta
        job) left `demo` alone. BEFORE and AFTER are
        `gh api repos/R/releases/tags/demo`, read before the job's first
        write and after its last, or `none`. Same release id, tag, title,
        prerelease, not a draft, and no merged note written into it. Assets
        and body are NOT compared: a refresh demo.yml runs at the same time
        replaces them in place, and must not turn this job red.
    check_release.py --demo DEMO LATEST_TAG [NOTES_MD]
        demo.yml read back after publishing (DEMO as above), or with
        DEMO=`none` and a NOTES_MD, the dry run: the page it would publish.

The self-test runs in PR CI before the release job ever trusts this, and
dry-runs the HEALTHY case first: five of six CI failures on this project were
gates rejecting a correct artifact.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from beta_decision import DEMO_TAG, DEMO_TITLE, parse_title  # noqa: E402
from release_notes import (DEMO_APK, DEMO_MADE_UP, DEMO_NEVER_TOUCHES,  # noqa: E402
                           INSTALL_NOTE, REFRESHED)

MERGED_NOTE = "Merged into Heart FC Coach build"


def demo_untouched_problems(before, after):
    """AC1/AC7: empty when a job other than demo.yml left `demo` as it was."""
    if before is None:
        if after is None:
            return []
        # Only demo.yml creates it; a first refresh racing this job would
        # look like this, so it is judged as a demo, not refused outright.
        return [f"`demo` (created during this job): {p}" for p in demo_shape_problems(after)]
    if after is None:
        return ["the `demo` release was deleted; only demo.yml may replace it (#146 AC1)"]
    out = []
    if after.get("id") != before.get("id"):
        out.append(f"the `demo` release was deleted and re-created (id {before.get('id')} -> {after.get('id')})")
    for key in ("tag_name", "name", "prerelease", "draft"):
        if after.get(key) != before.get(key):
            out.append(f"`demo`'s {key} changed: {before.get(key)!r} -> {after.get(key)!r}")
    if MERGED_NOTE in (after.get("body") or "") and MERGED_NOTE not in (before.get("body") or ""):
        out.append("a merge note was written into `demo`")
    return out


def demo_shape_problems(demo):
    """What the `demo` release must always be, whoever reads it."""
    out = []
    if demo.get("tag_name") != DEMO_TAG:
        out.append(f"tag is {demo.get('tag_name')!r}, expected {DEMO_TAG!r}")
    if demo.get("name") != DEMO_TITLE:
        out.append(f"title is {demo.get('name')!r}, expected {DEMO_TITLE!r}")
    if not demo.get("prerelease"):
        out.append("not a prerelease, so it could compete with Heart FC Coach")
    if demo.get("draft"):
        out.append("a draft, whose assets a phone cannot download")
    if MERGED_NOTE in (demo.get("body") or ""):
        out.append("its page is a merge note")
    return out


def demo_page_problems(body):
    """AC5: what the page must say."""
    out = []
    for phrase, why in ((DEMO_MADE_UP, "that it holds made-up data only"),
                        (INSTALL_NOTE, "how to install it (the beta's install note)"),
                        (DEMO_NEVER_TOUCHES, "that it never touches Heart FC Coach")):
        if phrase not in body:
            out.append(f"the page does not say {why}")
    if not REFRESHED.search(body):
        out.append("the page does not say \"Refreshed from build N on <date>\"")
    return out


def demo_problems(demo, latest_tag, notes=None):
    """demo.yml: the published `demo`, or (dry run) the page it would publish."""
    if demo is None:
        if notes is None:
            return ["there is no `demo` release"]
        return demo_page_problems(notes)
    out = demo_shape_problems(demo)
    if latest_tag == DEMO_TAG:
        out.append("`demo` is marked Latest; Latest is always Heart FC Coach")
    names = [a.get("name", "") for a in demo.get("assets", [])]
    apks = [n for n in names if n.endswith(".apk")]
    if apks != [DEMO_APK]:
        out.append(f"expected exactly one .apk, {DEMO_APK}, found {apks}: a refresh replaces it in place")
    if f"{DEMO_APK}.sha256" not in names:
        out.append(f"no {DEMO_APK}.sha256 beside it")
    return out + demo_page_problems(demo.get("body") or "")


def check(release, latest_tag, beta, expected_tag, beta_action="replace"):
    """Return a list of problems; empty means main's build is the release."""
    problems = []
    if release.get("tagName") != expected_tag:
        problems.append(f"release tag is {release.get('tagName')!r}, expected {expected_tag!r}")
    if release.get("isDraft"):
        problems.append("the release is a draft")
    if release.get("isPrerelease"):
        problems.append("the release is a prerelease; a build of main must be a full release")
    if latest_tag != expected_tag:
        problems.append(f"Latest is {latest_tag!r}, expected {expected_tag!r}")
    apks = [a.get("name", "") for a in release.get("assets", []) if a.get("name", "").endswith(".apk")]
    if len(apks) != 1:
        problems.append(f"expected exactly one .apk asset, found {len(apks)}")
    if beta_action == "keep":
        problems.extend(kept_beta_problems(beta))
    else:
        problems.extend(beta_problems(beta, expected_tag))
    return problems


def kept_beta_problems(beta):
    """The kept case only: a newer open PR's beta, left exactly as it was."""
    if beta is None:
        return ["the `beta` was to be kept, but there is no `beta` release"]
    out = []
    kind, n = parse_title(beta.get("name"))
    if kind != "pr":
        out.append(f"the kept `beta` is not a PR beta (title {beta.get('name')!r})")
    if not beta.get("isPrerelease"):
        out.append("the kept `beta` is not a prerelease, so it could compete with Heart FC Coach")
    if beta.get("isDraft"):
        out.append("the kept `beta` is a draft")
    apks = [a.get("name", "") for a in beta.get("assets", []) if a.get("name", "").endswith(".apk")]
    if len(apks) != 1:
        out.append(f"the kept `beta` should carry its PR's APK; found {len(apks)} .apk asset(s)")
    if "Merged into Heart FC Coach build" in (beta.get("body") or ""):
        out.append("the kept `beta` is a merged note, not a PR beta")
    return out


def beta_problems(beta, expected_tag):
    """#128 AC3: after a merge `beta` is a no-APK note pointing at the release."""
    if beta is None:
        return ["there is no `beta` release; a merge replaces it with a note, not nothing"]
    out = []
    if not beta.get("isPrerelease"):
        out.append("the `beta` note is not a prerelease, so it could compete with Heart FC Coach")
    if beta.get("isDraft"):
        out.append("the `beta` note is a draft")
    apks = [a.get("name", "") for a in beta.get("assets", []) if a.get("name", "").endswith(".apk")]
    if apks:
        out.append(f"the `beta` note still carries an APK ({', '.join(apks)}); the merged beta must not be installable")
    body = beta.get("body") or ""
    if "Merged into Heart FC Coach build" not in body:
        out.append("the `beta` body does not say \"Merged into Heart FC Coach build N\"")
    if f"/releases/tag/{expected_tag}" not in body:
        out.append(f"the `beta` note does not link the release {expected_tag}")
    return out


def release_of(tag, pre=False, draft=False, apks=1):
    assets = [{"name": f"coaching-app_2026.10.03_abc1234.apk"} for _ in range(apks)]
    assets.append({"name": "coaching-app_2026.10.03_abc1234.apk.sha256"})
    return {"tagName": tag, "isPrerelease": pre, "isDraft": draft, "assets": assets}


def note_of(tag, pre=True, draft=False, apk=False, body=None):
    if body is None:
        body = (f"## Merged into Heart FC Coach build 74 — install that instead\n\n"
                f"[Heart FC Coach build 74](https://github.com/vanstoner/coaching-app/releases/tag/{tag})")
    assets = [{"name": "coaching-beta_pr-127_abc1234.apk"}] if apk else []
    return {"name": "Heart FC Beta Coach — merged into build 74", "tagName": "beta",
            "isPrerelease": pre, "isDraft": draft, "assets": assets, "body": body}


def pr_beta_of(pr=132, pre=True, draft=False, apk=True):
    assets = [{"name": f"coaching-beta_pr-{pr}_def5678.apk"}] if apk else []
    assets.append({"name": f"coaching-beta_pr-{pr}_def5678.apk.sha256"})
    return {"name": f"Heart FC Beta Coach (PR #{pr})", "tagName": "beta", "isPrerelease": pre,
            "isDraft": draft, "assets": assets, "body": f"## Heart FC Beta Coach — PR #{pr}"}


def self_test():
    t = "v2026.10.03-build.74"
    old = "v2026.10.03-build.69"
    note = note_of(t)
    cases = [
        # (description, release, latest, beta, should pass[, beta action])
        ("healthy: full release, Latest, beta replaced by a no-APK note", release_of(t), t, note, True),
        ("healthy (kept): a newer open PR's beta left in place, APK and all",
         release_of(t), t, pr_beta_of(), True, "keep"),
        ("healthy: a simulator zip on the release does not count as an APK",
         dict(release_of(t), assets=release_of(t)["assets"] + [{"name": "coaching-app-ios-simulator_2026.10.03_abc1234.zip"}]),
         t, note, True),
        ("still a prerelease (the build-72 confusion)", release_of(t, pre=True), t, note, False),
        ("published but not Latest", release_of(t), old, note, False),
        ("left as a draft", release_of(t, draft=True), t, note, False),
        ("no APK attached", release_of(t, apks=0), t, note, False),
        ("two APKs attached", release_of(t, apks=2), t, note, False),
        ("wrong release read back", release_of(old), t, note, False),
        ("beta left empty: no note at all (the build-100 confusion)", release_of(t), t, None, False),
        ("old PR beta left in place, APK and all", release_of(t), t, note_of(t, apk=True, body="## Heart FC Beta Coach — PR #127"), False),
        ("note still carries the APK", release_of(t), t, note_of(t, apk=True), False),
        ("note not a prerelease", release_of(t), t, note_of(t, pre=False), False),
        ("note links an older build", release_of(t), t, note_of(old), False),
        ("replace case: an open PR's beta is not accepted", release_of(t), t, pr_beta_of(), False),
        ("kept beta gone", release_of(t), t, None, False, "keep"),
        ("kept beta lost its APK", release_of(t), t, pr_beta_of(apk=False), False, "keep"),
        ("kept beta is a merged note", release_of(t), t, note, False, "keep"),
        ("kept beta not a prerelease", release_of(t), t, pr_beta_of(pre=False), False, "keep"),
        ("kept beta, but the release is not Latest", release_of(t), old, pr_beta_of(), False, "keep"),
    ]
    failed = 0
    for name, release, latest, beta, should_pass, *action in cases:
        passed = not check(release, latest, beta, t, *action)
        ok = passed == should_pass
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name} -> {'pass' if passed else 'fail'}")
    total = len(cases)

    # #146: the demo. Healthy cases first, each way it is read.
    from release_notes import demo_notes
    page = demo_notes("abc1234def", "demo (2026.10.06, build 160)", "6 October 2026", "vanstoner/coaching-app",
                      fetch=lambda path: [{"tag_name": "v2026.10.06-build.153", "target_commitish": "abc1234def", "prerelease": False,
                                           "draft": False, "html_url": "u"}])

    def demo_of(**kw):
        d = {"id": 7, "tag_name": "demo", "name": DEMO_TITLE, "prerelease": True, "draft": False,
             "body": page, "assets": [{"name": DEMO_APK}, {"name": DEMO_APK + ".sha256"}]}
        d.update(kw)
        return d

    refreshed = demo_of(body=page.replace("build 160", "build 161"),
                        assets=[{"name": DEMO_APK, "id": 99}, {"name": DEMO_APK + ".sha256"}])
    untouched = [
        # (description, before, after, should pass)
        ("healthy: release or beta job left `demo` exactly as it was", demo_of(), demo_of(), True),
        ("healthy: there is no `demo`, before or after", None, None, True),
        ("healthy: a demo refresh replaced its APK and page during this job", demo_of(), refreshed, True),
        ("healthy: demo.yml's first publish raced this job", None, demo_of(), True),
        ("`demo` deleted (a run that touches demo)", demo_of(), None, False),
        ("`demo` deleted and re-created", demo_of(), demo_of(id=8), False),
        ("`demo` retitled as a merged note", demo_of(), demo_of(name="Heart FC Beta Coach — merged into build 74"), False),
        ("a merge note written into `demo`", demo_of(), demo_of(body="## Merged into Heart FC Coach build 74"), False),
        ("`demo` made a full release", demo_of(), demo_of(prerelease=False), False),
        ("a `demo` that is not a demo appeared", None, demo_of(name="Heart FC Beta Coach (PR #147)"), False),
    ]
    for name, before, after, should_pass in untouched:
        passed = not demo_untouched_problems(before, after)
        ok = passed == should_pass
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name} -> {'pass' if passed else 'fail'}")
    total += len(untouched)

    published = [
        # (description, demo, latest, notes, should pass)
        ("healthy demo.yml: prerelease, not Latest, one APK, the whole page", demo_of(), t, None, True),
        ("healthy dry run: the page it would publish", None, t, page, True),
        ("healthy: a refresh before main's release names the commit",
         demo_of(body=page.replace("Refreshed from build 153", "Refreshed from main at `abc1234`")), t, None, True),
        ("demo marked Latest", demo_of(), "demo", None, False),
        ("demo published as a full release", demo_of(prerelease=False), t, None, False),
        ("demo titled like a PR beta", demo_of(name="Heart FC Beta Coach (PR #147)"), t, None, False),
        ("a refresh left the old APK beside the new",
         demo_of(assets=[{"name": DEMO_APK}, {"name": "coaching-beta-demo_old.apk"}, {"name": DEMO_APK + ".sha256"}]),
         t, None, False),
        ("no APK on the demo", demo_of(assets=[]), t, None, False),
        ("page lost 'made-up data only'", demo_of(body=page.replace(DEMO_MADE_UP, "")), t, None, False),
        ("page lost the install note", demo_of(body=page.replace(INSTALL_NOTE, "")), t, None, False),
        ("page lost 'refreshed from build N on date'",
         demo_of(body=page.replace("Refreshed from build 153 on 6 October 2026", "Refreshed")), t, None, False),
        ("dry run: a page that says nothing", None, t, "## Heart FC Beta Coach — demo", False),
        ("published, but there is no demo", None, t, None, False),
    ]
    for name, demo, latest, notes, should_pass in published:
        passed = not demo_problems(demo, latest, notes)
        ok = passed == should_pass
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name} -> {'pass' if passed else 'fail'}")
    total += len(published)
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def load_or_none(path):
    if path == "none":
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def report(problems, ok_line):
    for p in problems:
        print(f"ASSERTION FAILED: {p}")
    if not problems:
        print(ok_line)
    return 1 if problems else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) == 4 and argv[1] == "--demo-untouched":
        before, after = load_or_none(argv[2]), load_or_none(argv[3])
        print(f"demo before: {'none' if before is None else before.get('id')}  "
              f"after: {'none' if after is None else after.get('id')}")
        return report(demo_untouched_problems(before, after), "`demo` was left alone (#146 AC1/AC7)")
    if len(argv) in (4, 5) and argv[1] == "--demo":
        demo = load_or_none(argv[2])
        notes = None
        if len(argv) == 5:
            with open(argv[4], encoding="utf-8") as f:
                notes = f.read()
        return report(demo_problems(demo, argv[3], notes),
                      "the demo page says what it is" if demo is None else
                      "`demo` is a prerelease, not Latest, with one APK and the whole page (#146)")
    if len(argv) not in (5, 6) or (len(argv) == 6 and argv[5] not in ("replace", "keep")):
        print(__doc__)
        return 2
    with open(argv[1], encoding="utf-8") as f:
        release = json.load(f)
    beta = None
    if argv[3] != "none":
        with open(argv[3], encoding="utf-8") as f:
            beta = json.load(f)
    action = argv[5] if len(argv) == 6 else "replace"
    problems = check(release, argv[2], beta, argv[4], action)
    print(f"release {release.get('tagName')}: prerelease={release.get('isPrerelease')} "
          f"draft={release.get('isDraft')}  Latest={argv[2]}  beta action={action}  "
          f"beta={'none' if beta is None else 'prerelease=%s assets=%s' % (beta.get('isPrerelease'), [a.get('name') for a in beta.get('assets', [])])}")
    for p in problems:
        print(f"ASSERTION FAILED: {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
