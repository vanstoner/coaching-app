#!/usr/bin/env python3
"""Build the marketing site into a folder — #108, PO "approve site".

    build_site.py PRIVACY_HTML COACHES_HTML GUIDE_HTML OUT
                                      site/ plus the app icon into OUT, with
                                      PRIVACY.md, COACHES.md and GUIDE.md (as
                                      GitHub renders them) inside
                                      privacy.html, coaches.html and
                                      guide.html
    build_site.py --self-test

PRIVACY.md stays the one privacy policy, COACHES.md the one page for
coaches installing the app, and GUIDE.md the one how-to guide for a new coach:
each page is made from its Markdown on every build, never copied by hand. The
App Store screenshots are served at the same path they have in the repo, so
an image in GUIDE.md shows both on github.com and on the site. Then every page is checked: the privacy text is
really in it, and every local link and image points at a file that exists.
"""

import html
import html.parser
import os
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
MARK = "<!-- PRIVACY.md, rendered by pages.yml -->"
COACHES_MARK = "<!-- COACHES.md, rendered by pages.yml -->"
GUIDE_MARK = "<!-- GUIDE.md, rendered by pages.yml -->"
PAGES = ("index.html", "privacy.html", "support.html", "testers.html", "coaches.html", "guide.html", "releases.html")
# Pages made from Markdown: (page, template, marker).
RENDERED = (
    ("privacy.html", "privacy.template.html", MARK),
    ("coaches.html", "coaches.template.html", COACHES_MARK),
    ("guide.html", "guide.template.html", GUIDE_MARK),
)


def slug(text):
    """A heading's anchor as GitHub writes it: lower case, punctuation
    dropped, spaces to hyphens ("On an iPhone" -> "on-an-iphone")."""
    text = re.sub(r"<[^>]+>", "", html.unescape(text)).strip().lower()
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def own_anchors(rendered):
    """Every heading gets the id a "#heading" link expects. GitHub's API
    gives headings none of their own (github.com adds them with script, and
    any anchor it does emit is prefixed "user-content-"), so without this a
    link to a heading would go nowhere."""
    rendered = rendered.replace('id="user-content-', 'id="')

    def add_id(m):
        if "id=" in m.group(2):
            return m.group(0)
        anchor = slug(m.group(3))
        if f'id="{anchor}"' in rendered:
            return m.group(0)
        return f'<h{m.group(1)}{m.group(2)} id="{anchor}">{m.group(3)}</h{m.group(1)}>'

    return re.sub(r"<h([1-6])([^>]*)>(.*?)</h\1>", add_id, rendered, flags=re.S)
# #182: the made-up test season, served from the site so an iPhone's Safari
# downloads it to Files (a raw GitHub link only opens it as text).
TEST_SEASON = os.path.join("test-data", "test-season.json")
# The approved, captioned App Store shots (made-up data only, #108 E2), served
# at their repo path for index.html and GUIDE.md.
SHOTS = os.path.join("store", "app-store", "screenshots", "iphone")


class Links(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k in ("href", "src") and v:
                self.found.append(v)


def build(privacy_html, coaches_html, guide_html, out, root=ROOT):
    site = os.path.join(root, "site")
    os.makedirs(out, exist_ok=True)
    templates = {t for _, t, _ in RENDERED}
    for f in os.listdir(site):
        if f not in templates:
            shutil.copy(os.path.join(site, f), out)
    shutil.copy(os.path.join(root, "assets", "images", "icon.png"), os.path.join(out, "icon.png"))
    shutil.copy(os.path.join(root, TEST_SEASON), os.path.join(out, "test-season.json"))
    shutil.copytree(os.path.join(root, SHOTS), os.path.join(out, SHOTS), dirs_exist_ok=True)
    bodies = {"privacy.html": privacy_html, "coaches.html": coaches_html, "guide.html": guide_html}
    for page, template_name, mark in RENDERED:
        with open(os.path.join(site, template_name), encoding="utf-8") as fh:
            template = fh.read()
        if template.count(mark) != 1:
            raise ValueError(f"{template_name} must hold the marker exactly once")
        with open(os.path.join(out, page), "w", encoding="utf-8") as fh:
            fh.write(template.replace(mark, own_anchors(bodies[page])))


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
        if page == "coaches.html" and ("<h1" not in text or COACHES_MARK in text):
            found.append("coaches.html does not hold the rendered COACHES.md")
        if page == "guide.html" and ("<h1" not in text or GUIDE_MARK in text):
            found.append("guide.html does not hold the rendered GUIDE.md")
        p = Links()
        p.feed(text)
        for link in p.found:
            if link.startswith(("http://", "https://", "mailto:")):
                continue
            if link.startswith("#"):
                if f'id="{link[1:]}"' not in text:
                    found.append(f"{page} links to {link}, which is not on the page")
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
    # As GitHub renders a heading and a link to it.
    # As GitHub's API renders a heading and a link to it: no id on the heading.
    coaches = ('<h1>Try Heart FC Coach</h1><p><a href="#on-an-iphone">iPhone</a> '
               '<a href="#getting-started-both-phones">Start</a></p>'
               '<h2>On an iPhone</h2><h2>Getting started (both phones)</h2>')
    # As github.com's own pages carry it: an anchor with the prefixed id.
    prefixed = ('<h1>Try</h1><p><a href="#on-an-iphone">iPhone</a></p><div class="markdown-heading">'
                '<h2 class="heading-element">On an iPhone</h2>'
                '<a id="user-content-on-an-iphone" class="anchor" href="#on-an-iphone"></a></div>')
    guide = ('<h1>How to use Heart FC Coach</h1><p><a href="#1-set-up-your-team">Set up</a></p>'
             '<h2>1. Set up your team</h2><p><a href="store/app-store/screenshots/iphone/08-start.png">'
             '<img src="store/app-store/screenshots/iphone/08-start.png" alt="" width="260"></a></p>')
    with tempfile.TemporaryDirectory() as d:
        build(rendered, coaches, guide, d)
        check("healthy: the committed site builds with every link resolving", problems(d) == [])
        check("healthy: the guide's numbered heading gets the anchor its contents link to",
              'id="1-set-up-your-team"' in open(os.path.join(d, "guide.html"), encoding="utf-8").read())
        page = open(os.path.join(d, "coaches.html"), encoding="utf-8").read()
        check("healthy: a link to a heading on the coaches page lands on it",
              'id="on-an-iphone"' in page and 'id="getting-started-both-phones"' in page)
    with tempfile.TemporaryDirectory() as d:
        build(rendered, prefixed, guide, d)
        check("healthy: a heading GitHub gave a prefixed anchor is reachable too", problems(d) == [])
        check("healthy: the test season is served beside testers.html",
              os.path.getsize(os.path.join(d, "test-season.json")) == os.path.getsize(os.path.join(ROOT, TEST_SEASON)))
        os.remove(os.path.join(d, "icon.png"))
        check("fails: the icon is missing", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build(rendered, coaches, guide, d)
        os.remove(os.path.join(d, "test-season.json"))
        check("fails: testers.html's download is missing", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build("", coaches, guide, d)
        check("fails: the privacy page without the policy", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build(rendered, "", guide, d)
        check("fails: the coaches page without its guide", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build(rendered, coaches.replace("<h2>On an iPhone</h2>", "<h2>On a phone</h2>"), guide, d)
        check("fails: a link to a heading that is not there", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build(rendered, coaches, guide, d)
        with open(os.path.join(d, "support.html"), "a", encoding="utf-8") as fh:
            fh.write('<a href="faq.html">x</a>')
        check("fails: a link to a page that does not exist", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build(rendered, coaches, "", d)
        check("fails: the guide page without the guide", bool(problems(d)))
    with tempfile.TemporaryDirectory() as d:
        build(rendered, coaches, guide, d)
        os.remove(os.path.join(d, SHOTS, "08-start.png"))
        check("fails: a screenshot the guide shows is missing", bool(problems(d)))
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    bodies = []
    for path in argv[1:4]:
        with open(path, encoding="utf-8") as fh:
            bodies.append(fh.read())
    build(*bodies, argv[4])
    found = problems(argv[4])
    for p in found:
        print(f"SITE PROBLEM: {p}")
    if not found:
        print(f"{argv[4]}: {', '.join(PAGES)} built; every local link resolves")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
