#!/usr/bin/env python3
"""Journey capture (#289): walk the match-day journeys on the CI emulator with
the Test kit's made-up squad, and measure what is on screen at each step.

    journey_capture.py run OUT_DIR        drive the emulator (adb on PATH, the app installed)
    journey_capture.py report OUT_DIR     rebuild OUT_DIR/report.html from OUT_DIR/steps.json
    journey_capture.py --self-test

Each step taps one labelled control. Before tapping, it records whether the
control was fully on screen when the step began, and how many swipes it took
to bring it into view. That is the "below the fold" Dee's UX review could
only infer from the code. Every step saves a screenshot and the screen's
view tree. A step that cannot find its control stops the walk and says so,
keeping everything captured so far (criterion 6): it never passes quietly.

Only the Test kit's made-up children are used (CLAUDE.md, Data protection).
"""

import html
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_beta_only import parse, swipe  # noqa: E402  (the smoke test's own dump reader and swipe)

ADB = os.environ.get("JOURNEY_ADB", "adb")
PKG = os.environ.get("JOURNEY_PACKAGE", "com.vanstoner.coachingapp.beta")


# --- Reading a screen (pure, self-tested) --------------------------------------

def find(nodes, label, prefix=False, contains=False):
    """The node whose text or description is `label` (or starts with it, or contains it). The lowest
    on screen wins when several match: a tab beats the screen title of the same word, and a pinned
    Main button beats a hint that mentions it."""
    hits = []
    for n in nodes or []:
        if not n.get("bounds"):
            continue
        for field in ("text", "desc"):
            v = n.get(field, "").strip()
            if v and (v == label or (prefix and v.startswith(label)) or (contains and label in v)):
                hits.append(n)
                break
    return max(hits, key=lambda n: n["bounds"][1]) if hits else None


def screen_box(nodes):
    """The window: the largest bounds in the dump."""
    boxes = [n["bounds"] for n in nodes or [] if n.get("bounds")]
    return max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1])) if boxes else (0, 0, 0, 0)


def fully_visible(node, screen):
    """Every edge of the control inside the window."""
    if not node:
        return False
    x0, y0, x1, y1 = node["bounds"]
    return x0 >= screen[0] and y0 >= screen[1] and x1 <= screen[2] and y1 <= screen[3] and y1 > y0


def centre(node):
    x0, y0, x1, y1 = node["bounds"]
    return (x0 + x1) // 2, (y0 + y1) // 2


# --- The device ------------------------------------------------------------------

def adb(*args, text=True):
    return subprocess.run([ADB, *args], capture_output=True, text=text, timeout=60).stdout


def dump(path):
    for _ in range(5):
        adb("shell", "rm", "-f", "/sdcard/window_dump.xml")
        adb("shell", "uiautomator", "dump", "/sdcard/window_dump.xml")
        xml = adb("exec-out", "cat", "/sdcard/window_dump.xml")
        nodes = parse(xml)
        if nodes:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(xml)
            return nodes
        time.sleep(2)
    return None


def screenshot(path):
    data = subprocess.run([ADB, "exec-out", "screencap", "-p"], capture_output=True, timeout=60).stdout
    with open(path, "wb") as fh:
        fh.write(data)


def keyboard_down():
    if "mInputShown=true" in adb("shell", "dumpsys", "input_method"):
        adb("shell", "input", "keyevent", "4")
        time.sleep(1)


class Walk:
    def __init__(self, out):
        self.out, self.steps, self.n, self.journey = out, [], 0, ""

    def save(self, stopped=None):
        with open(os.path.join(self.out, "steps.json"), "w", encoding="utf-8") as fh:
            json.dump({"steps": self.steps, "stopped": stopped}, fh, indent=1)

    def step(self, what, label, prefix=False, typing=None, wait=2.0, max_swipes=8, optional=False, contains=False):
        """Bring `label` into view, record how, then tap it (and type, if asked)."""
        self.n += 1
        name = f"{self.n:02d}"
        nodes = dump(os.path.join(self.out, f"{name}.xml"))
        screenshot(os.path.join(self.out, f"{name}.png"))
        screen = screen_box(nodes)
        node = find(nodes, label, prefix, contains)
        in_view = fully_visible(node, screen)
        swipes = 0
        while not fully_visible(node, screen) and swipes < max_swipes:
            s = swipe(nodes or [])
            if not s:
                break
            adb("shell", "input", "swipe", *map(str, s), "400")
            time.sleep(1)
            swipes += 1
            nodes = dump(os.path.join(self.out, f"{name}-s{swipes}.xml"))
            screen = screen_box(nodes)
            node = find(nodes, label, prefix, contains)
        record = {"n": self.n, "journey": self.journey, "what": what, "label": label,
                  "in_view": in_view, "swipes": swipes, "found": fully_visible(node, screen),
                  "shot": f"{name}.png", "height": screen[3] - screen[1]}
        self.steps.append(record)
        if not record["found"]:
            self.save(None if optional else f"Step {self.n} ({what}): '{label}' not found after {swipes} swipes")
            if optional:
                record["skipped"] = True
                return False
            raise LookupError(label)
        x, y = centre(node)
        adb("shell", "input", "tap", str(x), str(y))
        time.sleep(1)
        if typing:
            adb("shell", "input", "text", typing.replace(" ", "%s"))
            time.sleep(1)
            keyboard_down()
        time.sleep(wait)
        self.save()
        return True

    def back(self, what):
        self.n += 1
        screenshot(os.path.join(self.out, f"{self.n:02d}.png"))
        self.steps.append({"n": self.n, "journey": self.journey, "what": what, "label": "Android Back",
                           "in_view": True, "swipes": 0, "found": True, "shot": f"{self.n:02d}.png"})
        adb("shell", "input", "keyevent", "4")
        time.sleep(2)
        self.save()


def run(out):
    os.makedirs(out, exist_ok=True)
    w = Walk(out)
    try:
        w.journey = "Setup"
        w.step("Start with a team", "Add your team", optional=True)
        if w.steps[-1].get("skipped") is None:
            w.step("Name it", "Team name", typing="Journey FC")
            w.step("Add the team", "Add and open", wait=3)
        w.step("Open Settings", "Settings")
        w.step("Open the Test kit", "Test kit (beta only)", prefix=True)
        w.step("Add the made-up squad and fixtures", "Add test squad and fixtures", wait=3)
        w.step("Back to Home", "Home")

        w.journey = "J2: set up a fixture"
        w.step("Add a fixture", "+ Fixture")
        w.step("Name the opposition", "Opposition", typing="Rovers")
        w.step("Save it", "Save fixture", wait=3)
        w.step("Who's coming", "Who's coming")
        w.step("On to the team sheet", "Next: team sheet", wait=3)
        w.step("Fill the rest", "Fill the rest", wait=3)
        w.step("Done", "Done")

        w.journey = "J3: play a test match"
        w.step("Open Settings", "Settings")
        w.step("Open Test matches", "Test matches", prefix=True)
        w.step("Start a test match", "Start a test match", wait=3)
        w.step("Fill the lineup", "Use suggestion", optional=True)
        w.step("Speed up the clock", "×10", optional=True)
        for period in range(1, 5):
            # "Start quarter", or "Q2 is due: Start" after the team talk (#283).
            w.step(f"Start period {period}", "Start", contains=True, wait=8)
            if not w.step(f"End period {period}", "End ", prefix=True, wait=3):
                break
            if period < 4 and not find(dump(os.path.join(out, "probe.xml")), "Start", contains=True):
                break
        w.step("See the minutes", "See the minutes", wait=3)
        w.step("End match", "End match", wait=3)
        w.save()
        return 0
    except LookupError:
        return 1


# --- The report ------------------------------------------------------------------

def render(data):
    steps, stopped = data.get("steps", []), data.get("stopped")
    off = [s for s in steps if s.get("found") and not s.get("in_view")]
    rows = []
    for s in steps:
        state = ("skipped" if s.get("skipped") else "not found" if not s.get("found")
                 else "on screen" if s.get("in_view") else f"off screen: {s.get('swipes', 0)} swipe{'s' if s.get('swipes') != 1 else ''}")
        cls = "bad" if not s.get("found") else "ok" if s.get("in_view") else "warn"
        rows.append(
            f"<tr><td>{s['n']}</td><td>{html.escape(s.get('journey', ''))}</td><td>{html.escape(s['what'])}</td>"
            f"<td><code>{html.escape(s['label'])}</code></td><td class=\"{cls}\">{state}</td>"
            f"<td><a href=\"{html.escape(s['shot'])}\"><img src=\"{html.escape(s['shot'])}\" alt=\"Step {s['n']}\" loading=\"lazy\"></a></td></tr>")
    summary = (f"<p class=\"bad\">The walk stopped: {html.escape(stopped)}</p>" if stopped else
               "<p class=\"ok\">Every journey was walked to its end.</p>")
    summary += (f"<p>{len(steps)} steps, {sum(s.get('swipes', 0) for s in steps)} swipes. "
                f"Off screen when the step began: {', '.join(html.escape(s['label']) for s in off) or 'none'}.</p>")
    return f"""<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Journey capture</title>
<style>
 body {{ margin: 0; padding: 16px; background: #0b3d2e; color: #fff; font: 15px/1.5 system-ui, sans-serif; }}
 table {{ border-collapse: collapse; width: 100%; }} th, td {{ text-align: left; vertical-align: top; padding: 6px; border-bottom: 1px solid #1c6349; }}
 .wrap {{ overflow-x: auto; }} img {{ width: 120px; height: auto; border-radius: 6px; }}
 .ok {{ color: #7ee2a8; }} .warn {{ color: #ffd166; }} .bad {{ color: #ff8f8f; }} code {{ overflow-wrap: anywhere; }}
</style></head><body>
<h1>Journey capture</h1>
<p>The Test kit's made-up squad on the CI emulator (320×640). "Off screen" means the control was not fully visible when the step began.</p>
{summary}
<div class="wrap"><table><thead><tr><th>#</th><th>Journey</th><th>Step</th><th>Control</th><th>When the step began</th><th>Screen</th></tr></thead>
<tbody>
{chr(10).join(rows)}
</tbody></table></div>
</body></html>
"""


def report(out):
    with open(os.path.join(out, "steps.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    with open(os.path.join(out, "report.html"), "w", encoding="utf-8") as fh:
        fh.write(render(data))
    return 1 if data.get("stopped") else 0


# --- Self-test -------------------------------------------------------------------

def self_test():
    failed = total = 0

    def check(name, ok):
        nonlocal failed, total
        total += 1
        print(f"  {'ok' if ok else 'x '}  {name}")
        failed += not ok

    nodes = [
        {"text": "", "desc": "", "bounds": (0, 0, 320, 640), "scrollable": False, "in_selected": False},
        {"text": "Settings", "desc": "", "bounds": (16, 30, 120, 60), "scrollable": False, "in_selected": False},
        {"text": "Settings", "desc": "", "bounds": (220, 600, 300, 630), "scrollable": False, "in_selected": False},
        {"text": "End quarter", "desc": "", "bounds": (16, 610, 304, 670), "scrollable": False, "in_selected": False},
        {"text": "", "desc": "Add a fixture", "bounds": (16, 100, 304, 148), "scrollable": False, "in_selected": False},
        {"text": "Q2 is due: Start", "desc": "", "bounds": (16, 500, 304, 548), "scrollable": False, "in_selected": False},
    ]
    screen = screen_box(nodes)
    check("the window is the largest box", screen == (0, 0, 320, 640))
    check("of two 'Settings', the lowest (the tab) is found", find(nodes, "Settings")["bounds"][1] == 600)
    check("a control is found by its description too", find(nodes, "Add a fixture") is not None)
    check("an exact label never matches a longer one", find(nodes, "Start ") is None and find(nodes, "End") is None)
    check("a prefix matches the start only, so the team talk's button needs 'contains'",
          find(nodes, "Start ", prefix=True) is None and find(nodes, "Start", contains=True)["text"] == "Q2 is due: Start")
    check("'End ' as a prefix finds End quarter", find(nodes, "End ", prefix=True)["text"] == "End quarter")
    check("a control running past the bottom edge is not fully visible", not fully_visible(find(nodes, "End quarter"), screen))
    check("a control inside the window is fully visible", fully_visible(find(nodes, "Add a fixture"), screen))
    check("nothing found is not visible", not fully_visible(None, screen))
    data = {"steps": [
        {"n": 1, "journey": "J3", "what": "End period 1", "label": "End quarter", "in_view": False, "swipes": 1, "found": True, "shot": "01.png"},
        {"n": 2, "journey": "J3", "what": "See the minutes", "label": "See the minutes", "in_view": True, "swipes": 0, "found": True, "shot": "02.png"},
        {"n": 3, "journey": "J3", "what": "End match", "label": "End <match>", "in_view": False, "swipes": 3, "found": False, "shot": "03.png"},
    ], "stopped": "Step 3 (End match): 'End <match>' not found after 3 swipes"}
    page = render(data)
    check("the report says where the walk stopped", "The walk stopped" in page)
    check("an off-screen control is listed with its swipes", "off screen: 1 swipe" in page and "Off screen when the step began: End quarter." in page)
    check("everything from the walk is escaped", "<match>" not in page)
    check("each step links its screenshot", 'href="01.png"' in page and 'src="03.png"' in page)
    check("a complete walk says so", "walked to its end" in render({"steps": data["steps"][:2], "stopped": None}))
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "steps.json"), "w") as fh:
            json.dump(data, fh)
        code = report(d)
        check("report exits non-zero when the walk stopped, and writes the page", code == 1 and os.path.exists(os.path.join(d, "report.html")))
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[:1] == ["--self-test"]:
        return self_test()
    if len(argv) == 2 and argv[0] == "run":
        code = run(argv[1])
        return report(argv[1]) or code
    if len(argv) == 2 and argv[0] == "report":
        return report(argv[1])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
