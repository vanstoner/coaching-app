#!/usr/bin/env python3
"""Build the marketing site into a folder — #108, PO "approve site".

    build_site.py PRIVACY_HTML OUT    site/ plus the app icon into OUT, with
                                      PRIVACY_HTML (PRIVACY.md as GitHub
                                      renders it) inside privacy.html
    build_site.py --self-test

PRIVACY.md stays the one privacy policy: the page is made from it on every
build, never copied by hand. Then every page is checked: the privacy text is
really in it, and every local link and image points at a file that exists.
"""

import html.parser
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
MARK = "<!-- PRIVACY.md, rendered by pages.yml -->"
PAGES = ("index.html", "privacy.html", "support.html", "testers.html")
# #182: the made-up test season, served from the site so an iPhone's Safari
# downloads it to Files (a raw GitHub link only opens it as text).
TEST_SEASON = os.path.join("test-data", "test-season.json")


class Links(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k in ("href", "src") and v:
                self.found.append(v)


def build(privacy_html, out, root=ROOT):
    site = os.path.join(root, "site")
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(site):
        if f != "privacy.template.html":
            shutil.copy(os.path.join(site, f), out)
    shutil.copy(os.path.join(root, "assets", "images", "icon.png"), os.path.join(out, "icon.png"))
    shutil.copy(os.path.join(root, TEST_SEASON), os.path.join(out, "test-season.json"))
    with open(os.path.join(site, "privacy.template.html"), encoding="utf-8") as fh:
        template = fh.read()
    if template.count(MARK) != 1:
        raise ValueError("privacy.template.html must hold the marker exactly once")
    with open(os.path.join(out, "privacy.html"), "w", encoding="utf-8") as fh:
        fh.write(template.replace(MARK, privacy_html))


def problems(out):
    found = []
    for page in PAGES:
        path = os.path.join(out, page)
        if not os.path.isfile(path):
            found.append(f"{page} is missing")
            continue
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        if page == "privacy.html" and ("<h1" not in text or MARK in text):
            found.append("privacy.html does not hold the rendered PRIVACY.md")
        p = Links()
        p.feed(text)
        for link in p.found:
            if link.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target = link.split("#")[0] or "index.html"
            if target in ("./", "."):
                target = "index.html"
            if not os.path.exists(os.path.join(out, target)):
                found.append(f"{page} links to {link}, which is not in the site")
    return found


def self_test():
    failed = total = 0

    def check(name, cond):
        nonlocal failed, total
        total += 1
        failed += not cond
        print(f"  {'ok' if cond else 'x '} {name}")

    rendered = "<h1>Privacy policy: Heart of the Game: Coach</h1><p>Nothing.</p>"
    with tempfile.TemporaryDirectory() as d:
        build(rendered, d)
        check("healthy: the committed site builds with every link resolving", problems(d) == [])
        check("healthy: the test season is served beside testers.html",
              os.path.getsize(os.path.join(d, "test-season.json")) == os.path.getsize(os.path.join(ROOT, TEST_SEASON)))
        os.remove(os.path.join(d, "icon.png"))
        check("fails: the icon is missing", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build(rendered, d)
        os.remove(os.path.join(d, "test-season.json"))
        check("fails: testers.html's download is missing", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build("", d)
        check("fails: the privacy page without the policy", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build(rendered, d)
        with open(os.path.join(d, "support.html"), "a", encoding="utf-8") as fh:
            fh.write('<a href="faq.html">x</a>')
        check("fails: a link to a page that does not exist", bool(problems(d)))
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as fh:
        build(fh.read(), argv[2])
    found = problems(argv[2])
    for p in found:
        print(f"SITE PROBLEM: {p}")
    if not found:
        print(f"{argv[2]}: {', '.join(PAGES)} built; every local link resolves")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
