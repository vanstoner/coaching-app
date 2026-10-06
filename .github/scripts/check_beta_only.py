#!/usr/bin/env python3
"""A beta shows its beta-only features; a release never does — #145.

PO ruling 29 (5 October). Rob: "betas allow functionality not available in
the full release (e.g. test data etc)". One switch hides the Test kit in a
release (`showTestKit`, src/app/testKit.ts). A unit test proves the switch,
but nothing proved it on the built app: the smoke test read only the first
screen. The worst case is the Test kit in Coaching App, whose "Add test squad
and fixtures" puts made-up children into the real squad and ledger.

So emulator-smoke.sh opens Settings on every build and scrolls it top to
bottom, saving the view tree (`uiautomator dump`) at each step. This script
reads those dumps:

    beta     a pull request's Coaching Beta: every BETA_ONLY entry a beta
             must show (the Test kit) is on Settings
    release  a build of main: NO BETA_ONLY entry is on Settings (not the
             Test kit, not a "(pr N)" build label), AND Settings was read to
             its end. An absence on a page that was never fully read proves
             nothing.

It reads the view tree, not OCR (smoke_assert.py). The release check is an
absence, and OCR misses text it cannot read, such as small type or white on
green. "OCR did not see it" is no evidence. The view tree holds the exact
text of every node on screen.

    check_beta_only.py --variant beta|'' DUMP...  the verdict: exit 0 pass, 1 fail, 2 misuse
    check_beta_only.py --tab-centre DUMP          "X Y" of the Settings tab, to tap
    check_beta_only.py --swipe DUMP               "X1 Y1 X2 Y2", a swipe up inside the scrolling view
    check_beta_only.py --same A B                 exit 0 if two dumps show the same screen
    check_beta_only.py --self-test

The self-test runs before the emulator is trusted. It dry-runs a healthy
beta and a healthy release first, then a wrong build each way: five of six CI
failures on this project were gates rejecting a correct artifact.
"""

import re
import sys
import xml.etree.ElementTree as ET

def word_pattern(words):
    """Whole words, case-blind, any run of whitespace between them."""
    body = r"\s+".join(re.escape(w) for w in words.split())
    return re.compile(r"(?<![A-Za-z0-9])" + body + r"(?![A-Za-z0-9])", re.I)


# --- The one list (#145 AC3) -------------------------------------------------
#
# Everything only a pull request's Coaching Beta may show. A release of main
# must show NONE of it. Each entry: (name, pattern, a beta must show it too).
# Patterns are matched in each node's text and content description.
#
# ADR-017's performance switch joins this list, as a feature a beta must
# show, when it is built.
BETA_ONLY = (
    # The Test kit's heading on Settings (TestKitSection.tsx). AC1: a beta
    # must show it, a release never.
    ("Test kit", word_pattern("Test kit"), True),
    # The build label's pull-request suffix (build-label.sh), drawn on
    # Settings by BuildLabel.tsx. It is what turns the Test kit on
    # (isBetaBuild), so a release carrying it is wrong even if the kit stayed
    # hidden. Not required in a beta: the Test kit already proves the switch.
    ("a pull-request build label '(pr N)'", re.compile(r"\(pr \d+\)"), False),
)

# The tab that opens Settings (src/app/tabs.ts, TABS). Only two things in the
# app draw this word: the tab and the Settings title (SettingsScreen.tsx).
SETTINGS_TAB = "Settings"

BOUNDS = re.compile(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")


# --- Reading a dump ------------------------------------------------------------

def parse(xml_text):
    """[node dicts] from a uiautomator dump, or None if it is not one."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    if root.tag != "hierarchy":
        return None
    nodes = []

    def walk(el, in_selected):
        for child in el:
            if child.tag != "node":
                continue
            m = BOUNDS.fullmatch(child.get("bounds", ""))
            selected = child.get("selected") == "true"
            nodes.append({
                "text": child.get("text", ""),
                "desc": child.get("content-desc", ""),
                "bounds": tuple(int(v) for v in m.groups()) if m else None,
                "scrollable": child.get("scrollable") == "true",
                "in_selected": in_selected or selected,
            })
            walk(child, in_selected or selected)

    walk(root, False)
    return nodes


def load(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return parse(f.read())
    except OSError:
        return None


def signature(nodes):
    """What a screen shows: every labelled node and where it is."""
    return tuple((n["text"], n["desc"], n["bounds"]) for n in nodes if n["text"] or n["desc"])


def labels(nodes):
    return [n["text"] or n["desc"] for n in nodes if n["text"] or n["desc"]]


def centre(b):
    return (b[0] + b[2]) // 2, (b[1] + b[3]) // 2


def settings_tab(nodes):
    """The Settings tab: the lowest node labelled exactly `Settings`, by its
    text, or failing that by its content description (in case a dump exposes
    the tab's label only there)."""
    for field in ("text", "desc"):
        tabs = [n for n in nodes if n[field].strip() == SETTINGS_TAB and n["bounds"]]
        if tabs:
            return max(tabs, key=lambda n: n["bounds"][3])
    return None


def on_settings(nodes):
    """Settings is open: its tab is selected, or its title shows beside the tab."""
    named = [n for n in nodes if n["text"].strip() == SETTINGS_TAB]
    return any(n["in_selected"] for n in named) or len(named) >= 2


def swipe(nodes):
    """A swipe up through the middle of the scrolling view (else the window)."""
    boxes = [n["bounds"] for n in nodes if n["scrollable"] and n["bounds"]]
    if not boxes:
        boxes = [n["bounds"] for n in nodes[:1] if n["bounds"]]
    if not boxes:
        return None
    x0, y0, x1, y1 = max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
    x, h = (x0 + x1) // 2, y1 - y0
    return x, y0 + h * 4 // 5, x, y0 + h // 5


# --- The verdict -----------------------------------------------------------------

def verdict(dumps, variant):
    """dumps: [node lists or None], in the order read. -> (ok, [lines])."""
    want_all = variant == "beta"
    required = [name for name, _, must in BETA_ONLY if must]
    lines = [f"build: a pull request's Coaching Beta, which must show {required}" if want_all else
             f"build: a release of main, which must show none of {[name for name, _, _ in BETA_ONLY]}"]
    if not dumps:
        return False, lines + ["ASSERTION FAILED (#145): no view tree was read from Settings"]
    bad = [i for i, d in enumerate(dumps) if d is None]
    if bad:
        return False, lines + [f"ASSERTION FAILED (#145): screen {bad[0]} is not a readable uiautomator dump"]
    first = dumps[0]
    if not on_settings(first):
        return False, lines + [
            "ASSERTION FAILED (#145): Settings did not open after its tab was tapped; the screen shows: "
            + ", ".join(repr(t) for t in labels(first)[:8])]

    sigs = [signature(d) for d in dumps]
    moved = any(s != sigs[0] for s in sigs[1:])
    settled = len(sigs) >= 2 and sigs[-1] == sigs[-2]
    read_all = moved and settled
    lines.append(f"Settings opened; {len(dumps)} screen(s) read; "
                 + ("read to its end (the last swipe moved nothing)" if read_all else
                    "NOT read to its end (" + ("the page never moved" if not moved else
                                               "the page was still moving after the last swipe") + ")"))

    seen = {}
    for i, d in enumerate(dumps):
        for n in d:
            for name, rx, _ in BETA_ONLY:
                for value in (n["text"], n["desc"]):
                    if value and name not in seen and rx.search(value):
                        seen[name] = (i, value)
    for name, (i, value) in seen.items():
        lines.append(f"beta-only {name!r} is on Settings (screen {i}: {value!r})")
    missing = [name for name in required if name not in seen]

    if want_all:
        if missing:
            lines.append(
                f"ASSERTION FAILED (#145): this Coaching Beta does not show {missing} anywhere on Settings. "
                "The beta's Test kit switch did not turn on: see showTestKit in src/app/testKit.ts, "
                "and the build label, which must end '(pr N)'.")
            return False, lines
        lines.append(f"settings assertion passed: this beta shows {required}")
        return True, lines

    if seen:
        lines.append(
            f"ASSERTION FAILED (#145): this release of Coaching App shows {list(seen)} on Settings. "
            "A release must never show what only a beta may: its Test kit can put made-up children "
            "into the real squad. See showTestKit in src/app/testKit.ts and build-label.sh.")
        return False, lines
    if not read_all:
        lines.append(
            "ASSERTION FAILED (#145): Settings was not read to its end, so finding no beta-only "
            "feature proves nothing.")
        return False, lines
    lines.append("settings assertion passed: no beta-only feature anywhere on Settings in this release")
    return True, lines


# --- Self-test: healthy cases first ------------------------------------------------

def _node(text="", desc="", bounds=(0, 0, 0, 0), cls="android.widget.TextView",
          scrollable=False, selected=False, children=""):
    b = "[%d,%d][%d,%d]" % bounds
    return (f'<node index="0" text="{text}" resource-id="" class="{cls}" package="com.example.coachingapp" '
            f'content-desc="{desc}" checkable="false" checked="false" clickable="false" enabled="true" '
            f'focusable="false" focused="false" scrollable="{str(scrollable).lower()}" long-clickable="false" '
            f'password="false" selected="{str(selected).lower()}" bounds="{b}">{children}</node>')


def fake_dump(texts, tab="settings", scrollable=True, desc_texts=(), label=None):
    """A 320x640 screen: a scrolling column of texts, the build label below
    it (as Settings draws BuildLabel), then the three tabs."""
    rows, y = [], 40
    for t in texts:
        rows.append(_node(text=t, bounds=(16, y, 304, y + 30)))
        y += 40
    for d in desc_texts:
        rows.append(_node(desc=d, cls="android.view.ViewGroup", bounds=(16, y, 304, y + 30)))
        y += 40
    column = _node(cls="android.widget.ScrollView", scrollable=scrollable,
                   bounds=(0, 24, 320, 560), children="".join(rows))
    if label is not None:
        column += _node(text=label, bounds=(16, 562, 304, 580))
    tabs = []
    for i, (key, name) in enumerate((("home", "Home"), ("squad", "Squad"), ("settings", "Settings"))):
        box = (i * 107, 584, (i + 1) * 107, 640)
        tabs.append(_node(cls="android.view.ViewGroup", selected=(key == tab), bounds=box,
                          children=_node(text=name, bounds=(box[0] + 20, 600, box[2] - 20, 624))))
    bar = _node(cls="android.view.ViewGroup", bounds=(0, 584, 320, 640), children="".join(tabs))
    window = _node(cls="android.widget.FrameLayout", bounds=(0, 0, 320, 640), children=column + bar)
    return parse(f"<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\">{window}</hierarchy>")


TOP = ["Settings", "Defaults for a new match.", "Team name", "Default match length", "Default periods"]
MID_RELEASE = ["Default shape", "Buzz when a sub is due", "Minutes", "Export the minutes file"]
MID_BETA = ["Default shape", "Buzz when a sub is due", "Minutes", "Test kit (beta only)", "Clock speed"]
END_RELEASE = ["Export the minutes file", "Forget everything"]
END_BETA = ["Add a past season", "Forget everything"]
RELEASE_LABEL = "v2026.10.06-build.124"          # build-label.sh on main
BETA_LABEL = "v2026.10.06-build.123 (pr 146)"    # build-label.sh on a pull request


def pages(texts_list, label):
    return [fake_dump(t, label=label) for t in texts_list]


def self_test():
    release = pages((TOP, MID_RELEASE, END_RELEASE, END_RELEASE), RELEASE_LABEL)
    beta = pages((TOP, MID_BETA, END_BETA, END_BETA), BETA_LABEL)
    home = [fake_dump(["Example FC", "No fixtures yet. Add your first match."], tab="home")]
    # Another tab that scrolls and has no Test kit: read to its end, it would
    # pass as a release unless the check knows it is not Settings.
    squad = [fake_dump(["Squad", "Ava", "Ben", "Cal"], tab="squad"),
             fake_dump(["Dee", "Eli", "Add a player"], tab="squad"),
             fake_dump(["Dee", "Eli", "Add a player"], tab="squad")]
    cases = [
        # (description, dumps, variant, should pass)
        ("healthy beta: the Test kit is on Settings", beta, "beta", True),
        ("healthy release: Settings read to its end, no Test kit", release, "", True),
        ("healthy release, tab selected but title scrolled off at the start",
         [fake_dump(TOP[1:])] + release[1:], "", True),
        ("healthy release, title shown but the tab not reported as selected",
         [fake_dump(TOP, tab=None)] + release[1:], "", True),
        ("healthy release: 'Contest kitchen' is not 'Test kit'",
         release[:-2] + [fake_dump(END_RELEASE + ["Contest kitchen"])] * 2, "", True),
        ("healthy beta: its label missing from the view tree is fine, the Test kit proves it",
         pages((TOP, MID_BETA, END_BETA, END_BETA), None), "beta", True),
        ("wrong build, beta: the switch stayed off (a beta without its Test kit)", release, "beta", False),
        ("wrong build, release: the Test kit shows in Coaching App", beta, "", False),
        ("wrong build, release: a pull-request label '(pr 146)', the Test kit hidden",
         pages((TOP, MID_RELEASE, END_RELEASE, END_RELEASE), BETA_LABEL), "", False),
        ("release: the Test kit only in a content description", release[:-2]
         + [fake_dump(END_RELEASE, desc_texts=["TEST KIT"])] * 2, "", False),
        ("release: Settings never opened (still on the first screen)", home, "", False),
        ("beta: Settings never opened", home, "beta", False),
        ("release: the tap opened another tab, read to its end with no Test kit", squad, "", False),
        ("release: the page never moved, so absence proves nothing", [release[0], release[0]], "", False),
        ("release: still moving after the last swipe", release[:-1], "", False),
        ("release: one dump unreadable", release[:1] + [None] + release[2:], "", False),
        ("release: no dumps at all", [], "", False),
    ]
    failed = total = 0
    for name, dumps, variant, should_pass in cases:
        ok, lines = verdict(dumps, variant)
        good = ok == should_pass
        total += 1
        failed += not good
        print(f"  {'ok' if good else 'x '} {name} -> {'pass' if ok else 'fail'}")
        if not good:
            print("      " + "\n      ".join(lines))

    def check(name, cond):
        nonlocal failed, total
        total += 1
        failed += not cond
        print(f"  {'ok' if cond else 'x '} {name}")

    check("the tab to tap is the lowest 'Settings' (the tab, not the title)",
          centre(settings_tab(fake_dump(TOP))["bounds"]) == (267, 612))
    check("on the first screen the Settings tab is found",
          centre(settings_tab(home[0])["bounds"]) == (267, 612))
    check("no 'Settings' on screen -> no tab to tap",
          settings_tab([n for n in home[0] if n["text"] != SETTINGS_TAB]) is None)
    check("a tab labelled only by its content description is still found",
          settings_tab([dict(n, text="", desc=n["text"]) if n["text"] == SETTINGS_TAB else n
                        for n in home[0]]) is not None)
    check("a swipe runs upward inside the scrolling view", swipe(release[0]) == (160, 452, 160, 131))
    check("two dumps of the same screen are the same", signature(release[2]) == signature(release[3]))
    check("a scrolled screen is not the same", signature(release[0]) != signature(release[1]))
    check("a document that is not a uiautomator dump is refused",
          parse("<html/>") is None and parse("nonsense") is None)
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    args = argv[1:]
    if args == ["--self-test"]:
        return self_test()
    if len(args) == 2 and args[0] == "--tab-centre":
        nodes = load(args[1])
        tab = settings_tab(nodes) if nodes is not None else None
        if tab is None:
            shown = labels(nodes)[:8] if nodes else "an unreadable dump"
            print(f"no {SETTINGS_TAB!r} tab on this screen; it shows: {shown}", file=sys.stderr)
            return 1
        print("%d %d" % centre(tab["bounds"]))
        return 0
    if len(args) == 2 and args[0] == "--swipe":
        nodes = load(args[1])
        s = swipe(nodes) if nodes else None
        if s is None:
            print("no bounds to swipe within", file=sys.stderr)
            return 1
        print("%d %d %d %d" % s)
        return 0
    if len(args) == 3 and args[0] == "--same":
        a, b = load(args[1]), load(args[2])
        if a is None or b is None:
            return 2
        return 0 if signature(a) == signature(b) else 1
    if len(args) >= 2 and args[0] == "--variant":
        if args[1] not in ("beta", ""):
            print(f"--variant must be 'beta' or '' (a release), not {args[1]!r}", file=sys.stderr)
            return 2
        ok, lines = verdict([load(p) for p in args[2:]], args[1])
        print("\n".join(lines))
        return 0 if ok else 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
