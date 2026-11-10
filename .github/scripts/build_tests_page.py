#!/usr/bin/env python3
"""The website's Tests page (#287): every unit test, grouped by area, from
Vitest's JSON report, with the latest emulator check and a button to run the
tests again.

    build_tests_page.py REPORT_JSON META_JSON OUT_HTML [--emulator EMULATOR_JSON]
    build_tests_page.py --none OUT_HTML     a page that says no report has run yet
    build_tests_page.py --self-test

META_JSON:     {"sha", "branch", "ran_at", "run_url", "event", "outcome"}
EMULATOR_JSON: {"conclusion", "sha", "run_url", "ran_at", "screenshot"}
               (screenshot: a file name next to OUT_HTML, or null)

Everything printed comes from the report and is escaped. The tests use
made-up names only (CLAUDE.md, Data protection), so the page is safe to
publish. A failed run is shown as failed, never as the last green page
(criterion 8).
"""

import html
import json
import os
import re
import sys
import tempfile

REPO = "https://github.com/vanstoner/coaching-app"
RUN_WORKFLOW = f"{REPO}/actions/workflows/tests.yml"
MAX_FAILURE_LINES = 8
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def area_of(path):
    """'src/app/powerPlay.test.ts' -> 'Power play'; screens and others say where."""
    rel = path.replace("\\", "/")
    rel = rel[rel.find("src/"):] if "src/" in rel else os.path.basename(rel)
    base = os.path.basename(rel)
    base = re.sub(r"\.test\.(ts|tsx|js)$", "", base)
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", base).replace("_", " ").replace("-", " ").strip()
    name = (words[:1].upper() + words[1:].lower()) if words else rel
    folder = rel.split("/")[1] if rel.startswith("src/") and rel.count("/") >= 2 else ""
    return name if folder in ("", "app") else f"{name} ({folder})"


def failure_text(messages, root):
    """The first lines of the first failure, colour codes and the runner's own paths taken out."""
    if not messages:
        return ""
    text = ANSI.sub("", str(messages[0]))
    if root:
        text = text.replace(root.rstrip("/") + "/", "")
    lines = [l for l in text.splitlines() if l.strip()]
    more = len(lines) > MAX_FAILURE_LINES
    return "\n".join(lines[:MAX_FAILURE_LINES]) + ("\n…" if more else "")


def summarise(report, root=""):
    """-> (totals dict, [(area, file, [tests])]), failed areas first, then by name."""
    groups = []
    totals = {"passed": 0, "failed": 0, "skipped": 0}
    for f in report.get("testResults", []):
        tests = []
        for a in f.get("assertionResults", []):
            status = a.get("status", "")
            kind = "passed" if status == "passed" else "failed" if status == "failed" else "skipped"
            totals[kind] += 1
            title = " › ".join([*a.get("ancestorTitles", []), a.get("title", "")]).strip(" ›")
            tests.append({"title": title, "kind": kind, "failure": failure_text(a.get("failureMessages"), root)})
        name = f.get("name", "")
        if not tests and f.get("status") == "failed":
            # A file that would not even load: shown as one failure, never dropped.
            totals["failed"] += 1
            tests.append({"title": "The test file failed to load", "kind": "failed", "failure": failure_text([f.get("message", "")], root)})
        groups.append((area_of(name), name.replace(root.rstrip("/") + "/", "") if root else name, tests))
    groups.sort(key=lambda g: (not any(t["kind"] == "failed" for t in g[2]), g[0].lower()))
    return totals, groups


def esc(s):
    return html.escape(str(s), quote=True)


def page(body, title="Tests"):
    return f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · Heart of the Game: Coach</title>
<link rel="icon" href="icon.png">
<link rel="stylesheet" href="styles.css">
<style>
  .tests h1 {{ margin: 8px 0 4px; }}
  .tests .card {{ margin: 12px 0; overflow-wrap: anywhere; }}
  .tests .big {{ font-size: 22px; font-weight: 700; margin: 0 0 6px; }}
  .tests .ok {{ color: #7ee2a8; }}
  .tests .bad {{ color: #ff8f8f; }}
  .tests .skip {{ color: var(--muted); }}
  .tests .meta {{ color: var(--muted); font-size: 15px; margin: 2px 0; }}
  .tests .run {{ display: inline-block; margin-top: 10px; padding: 12px 20px; border-radius: 999px;
    background: var(--accent); color: var(--ink); font-weight: 600; text-decoration: none; }}
  .tests details {{ border-top: 1px solid var(--line); padding: 10px 0; }}
  .tests summary {{ cursor: pointer; font-weight: 600; overflow-wrap: anywhere; }}
  .tests summary .count {{ font-weight: 400; color: var(--muted); }}
  .tests ul {{ list-style: none; padding: 0; margin: 8px 0 0; }}
  .tests li {{ padding: 4px 0; font-size: 15px; overflow-wrap: anywhere; }}
  .tests li .st {{ display: inline-block; min-width: 4.2em; font-weight: 600; }}
  .tests pre {{ white-space: pre-wrap; overflow-wrap: anywhere; background: #08291f; border-radius: 8px;
    padding: 8px; font-size: 13px; margin: 6px 0 0; }}
  .tests img.shot {{ display: block; max-width: 100%; width: 240px; height: auto; border-radius: 8px; margin-top: 8px; }}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="home" href="./"><img src="icon.png" alt=""></a>
    <a class="home" href="./"><span>Heart of the Game: Coach</span></a>
    <nav><a href="guide.html">Guide</a><a href="releases.html">Releases</a><a href="tests.html">Tests</a><a href="support.html">Support</a></nav>
  </header>
  <main class="tests">
{body}
  </main>
</div>
</body>
</html>
"""


def run_button():
    return (f'    <a class="run" href="{RUN_WORKFLOW}">Run the tests now</a>\n'
            '    <p class="meta">Opens GitHub’s Run workflow (sign in, then Run workflow). This page updates when the run ends.</p>\n')


def emulator_card(emu):
    if not emu:
        return '    <section class="card"><p class="big">Emulator check</p><p class="meta">No emulator check on main yet.</p></section>\n'
    ok = emu.get("conclusion") == "success"
    shot = emu.get("screenshot")
    out = ['    <section class="card">',
           f'      <p class="big">Emulator check: <span class="{"ok" if ok else "bad"}">{"passed" if ok else esc(emu.get("conclusion") or "unknown")}</span></p>',
           f'      <p class="meta">The app installed and drawn on an Android emulator, on commit {esc((emu.get("sha") or "")[:7])}, {esc(emu.get("ran_at") or "")}. <a href="{esc(emu.get("run_url") or REPO)}">The run</a></p>']
    if shot:
        out.append(f'      <img class="shot" src="{esc(shot)}" alt="The emulator’s screenshot of the app (the made-up smoke team)">')
    out.append('    </section>\n')
    return "\n".join(out)


def render(report, meta, emu=None, root=""):
    totals, groups = summarise(report, root)
    failed = totals["failed"] > 0 or meta.get("outcome") == "failure"
    sha = meta.get("sha") or ""
    head = [
        '    <h1>Tests</h1>',
        '    <section class="card">',
        f'      <p class="big {"bad" if failed else "ok"}">{"Failing" if failed else "All passing"}</p>',
        f'      <p>{totals["passed"]} passed · <span class="{"bad" if totals["failed"] else ""}">{totals["failed"]} failed</span> · {totals["skipped"]} skipped</p>',
        f'      <p class="meta">Commit <a href="{REPO}/commit/{esc(sha)}">{esc(sha[:7])}</a> on {esc(meta.get("branch") or "?")}, {esc(meta.get("ran_at") or "")} ({esc(meta.get("event") or "")}). <a href="{esc(meta.get("run_url") or REPO)}">The run</a></p>',
        run_button() + '    </section>',
    ]
    body = ["\n".join(head), emulator_card(emu), '    <h2>Every test, by area</h2>']
    for area, file, tests in groups:
        bad = sum(t["kind"] == "failed" for t in tests)
        good = sum(t["kind"] == "passed" for t in tests)
        skip = sum(t["kind"] == "skipped" for t in tests)
        count = f"{good} passed" + (f", {bad} failed" if bad else "") + (f", {skip} skipped" if skip else "")
        items = []
        for t in tests:
            cls = {"passed": "ok", "failed": "bad", "skipped": "skip"}[t["kind"]]
            fail = f'<pre>{esc(t["failure"])}</pre>' if t["failure"] else ""
            items.append(f'        <li><span class="st {cls}">{t["kind"]}</span> {esc(t["title"])}{fail}</li>')
        body.append(
            f'    <details{" open" if bad else ""}>\n'
            f'      <summary><span class="{"bad" if bad else ""}">{esc(area)}</span> <span class="count">· {count}</span></summary>\n'
            f'      <p class="meta">{esc(file)}</p>\n'
            f'      <ul>\n' + "\n".join(items) + '\n      </ul>\n    </details>')
    return page("\n".join(body))


def render_none(emu=None):
    return page("    <h1>Tests</h1>\n    <section class=\"card\"><p class=\"big\">No test report yet</p>"
                "<p>The Tests workflow has not finished a run on main yet.</p>\n" + run_button() + "    </section>\n" + emulator_card(emu))


# --- self-test ------------------------------------------------------------------

def self_test():
    failed = total = 0

    def check(name, ok):
        nonlocal failed, total
        total += 1
        print(f"  {'ok' if ok else 'x '}  {name}")
        if not ok:
            failed += 1

    root = "/home/runner/work/coaching-app/coaching-app"
    report = {"testResults": [
        {"name": f"{root}/src/app/powerPlay.test.ts", "status": "passed", "assertionResults": [
            {"ancestorTitles": ["the allowance"], "title": "counts the steps", "status": "passed", "failureMessages": []},
            {"ancestorTitles": [], "title": "a later idea", "status": "skipped", "failureMessages": []}]},
        {"name": f"{root}/src/screens/fitGuard.test.ts", "status": "failed", "assertionResults": [
            {"ancestorTitles": ["at 360dp"], "title": "three extras fit <one row>", "status": "failed",
             "failureMessages": ["\x1b[31mAssertionError: expected 330 to be <= 324\x1b[39m\n    at " + root + "/src/screens/fitGuard.test.ts:12:5\n" + "\n".join(f"line {i}" for i in range(20))]}]},
        {"name": f"{root}/src/app/broken.test.ts", "status": "failed", "message": "SyntaxError: Unexpected token", "assertionResults": []},
    ]}
    meta = {"sha": "0123456789abcdef", "branch": "main", "ran_at": "2026-11-10 16:00 UTC", "run_url": f"{REPO}/actions/runs/1", "event": "push", "outcome": "failure"}
    totals, groups = summarise(report, root)
    check("totals count passed, failed and skipped; a file that will not load counts as a failure",
          totals == {"passed": 1, "failed": 2, "skipped": 1})
    check("areas are named in words: 'Power play', 'Fit guard (screens)'",
          {g[0] for g in groups} == {"Power play", "Fit guard (screens)", "Broken"})
    check("failed areas come first", groups[0][0] in ("Fit guard (screens)", "Broken") and groups[-1][0] == "Power play")
    out = render(report, meta, None, root)
    check("a failing run says Failing, never All passing (criterion 8)", "Failing" in out and "All passing" not in out)
    check("a failed test shows its first error lines, colour codes and runner paths taken out",
          "AssertionError: expected 330 to be &lt;= 324" in out and "\x1b" not in out and root not in out)
    check("a long failure is cut to its first lines", "line 19" not in out and "…" in out)
    check("every name is escaped: no markup from a test title reaches the page", "&lt;one row&gt;" in out and "<one row>" not in out)
    check("a failed area opens; a passing one stays closed", "<details open>" in out and out.count("<details open>") == 2)
    check("the run button opens the Tests workflow (criterion 6)", f'href="{RUN_WORKFLOW}"' in out and "Run the tests now" in out)
    check("the summary links the commit and the run", f"{REPO}/commit/0123456789abcdef" in out and f"{REPO}/actions/runs/1" in out)
    check("no sideways scroll at 360dp: long text wraps", "overflow-wrap: anywhere" in out and "white-space: pre-wrap" in out)
    green = {"testResults": [report["testResults"][0]]}
    ok = render(green, dict(meta, outcome="success"))
    check("a green run says All passing", "All passing" in ok and "Failing" not in ok)
    emu = {"conclusion": "success", "sha": "abcdef1234", "run_url": f"{REPO}/actions/runs/2", "ran_at": "2026-11-10", "screenshot": "tests-emulator.png"}
    withemu = render(green, dict(meta, outcome="success"), emu)
    check("the emulator check shows its result and screenshot (criterion 5)", "Emulator check: <span class=\"ok\">passed</span>" in withemu and 'src="tests-emulator.png"' in withemu)
    bad_emu = render(green, dict(meta, outcome="success"), dict(emu, conclusion="failure", screenshot=None))
    check("a failed emulator check says so", "Emulator check: <span class=\"bad\">failure</span>" in bad_emu)
    none = render_none()
    check("with no report yet, the page says so and still offers the run button", "No test report yet" in none and "Run the tests now" in none)
    with tempfile.TemporaryDirectory() as d:
        paths = [os.path.join(d, n) for n in ("r.json", "m.json", "out.html")]
        json.dump(report, open(paths[0], "w"))
        json.dump(meta, open(paths[1], "w"))
        code = main([paths[0], paths[1], paths[2]])
        check("the command line writes the page", code == 0 and "Failing" in open(paths[2]).read())
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[:1] == ["--self-test"]:
        return self_test()
    emu = None
    if "--emulator" in argv:
        i = argv.index("--emulator")
        with open(argv[i + 1], encoding="utf-8") as fh:
            emu = json.load(fh)
        argv = argv[:i] + argv[i + 2:]
    if argv[:1] == ["--none"] and len(argv) == 2:
        with open(argv[1], "w", encoding="utf-8") as fh:
            fh.write(render_none(emu))
        return 0
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[0], encoding="utf-8") as fh:
        report = json.load(fh)
    with open(argv[1], encoding="utf-8") as fh:
        meta = json.load(fh)
    root = meta.get("root", "")
    with open(argv[2], "w", encoding="utf-8") as fh:
        fh.write(render(report, meta, emu, root))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
