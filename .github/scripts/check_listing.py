#!/usr/bin/env python3
"""Check the App Store listing files against Apple's limits — #108 D1, D2, D4.

    check_listing.py store/app-store/en-GB     # exit 1 with a reason per problem
    check_listing.py --self-test               # healthy listing first

The files are the source of truth; `asc_api.py listing` uploads them. Limits
are Apple's, in characters: name 30, subtitle 30, keywords 100, promotional
text 170, description 4,000; both URLs https. D1: keywords include "heart".
D4: the description claims nothing v1 does not do, so words for features it
does not have (sync, a parent app, paid features) fail the check.
"""

import os
import shutil
import sys
import tempfile

FIELDS = {  # file -> (required, max characters or None)
    "name.txt": (True, 30),
    "subtitle.txt": (True, 30),
    "keywords.txt": (True, 100),
    "promotional_text.txt": (False, 170),
    "description.txt": (True, 4000),
    "support_url.txt": (True, None),
    "privacy_url.txt": (True, None),
}
NAME = "Heart of the Game: Coach"
NOT_IN_V1 = ("sync", "cloud account", "parent app", "parents' app", "subscription", "premium",
             "in-app purchase available", "pro version", "upgrade to")


def read(folder, f):
    path = os.path.join(folder, f)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return fh.read().strip()


def problems(folder):
    out = []
    values = {}
    for f, (required, limit) in FIELDS.items():
        v = read(folder, f)
        values[f] = v
        if v is None or v == "":
            if required:
                out.append(f"{f} is missing or empty")
            continue
        if limit is not None and len(v) > limit:
            out.append(f"{f} is {len(v)} characters; Apple allows {limit}")
    if values.get("name.txt") not in (None, "") and values["name.txt"] != NAME:
        out.append(f"name.txt is {values['name.txt']!r}, expected {NAME!r} (#108 ruling)")
    kw = values.get("keywords.txt") or ""
    if kw and "heart" not in [k.strip().lower() for k in kw.split(",")]:
        out.append("keywords.txt does not include \"heart\" (D1)")
    if kw and any(k != k.strip() or not k for k in kw.split(",")):
        out.append("keywords.txt has a space around a comma or an empty keyword (wasted characters)")
    for f in ("support_url.txt", "privacy_url.txt"):
        v = values.get(f)
        if v and not v.startswith("https://"):
            out.append(f"{f} is not an https URL")
    desc = (values.get("description.txt") or "").lower()
    for phrase in NOT_IN_V1:
        if phrase in desc:
            out.append(f"description.txt mentions {phrase!r}, which v1 does not have (D4)")
    return out


def self_test():
    failed = 0
    here = os.path.dirname(os.path.abspath(__file__))
    real = os.path.join(here, "..", "..", "store", "app-store", "en-GB")

    def case(name, edit, should_pass):
        nonlocal failed
        with tempfile.TemporaryDirectory() as d:
            for f in os.listdir(real):
                shutil.copy(os.path.join(real, f), d)
            edit(d)
            got = problems(d)
            ok = (not got) == should_pass
            failed += not ok
            print(f"  {'ok' if ok else 'x '} {name} -> {'pass' if not got else got[0]}")

    def write(f, text):
        return lambda d: open(os.path.join(d, f), "w", encoding="utf-8").write(text)

    def remove(f):
        return lambda d: os.remove(os.path.join(d, f))

    case("healthy: the committed listing", lambda d: None, True)
    case("healthy: no promotional text (optional)", remove("promotional_text.txt"), True)
    case("subtitle 31 characters", write("subtitle.txt", "x" * 31), False)
    case("keywords 101 characters", write("keywords.txt", "heart," + "k" * 95), False)
    case("keywords without heart", write("keywords.txt", "football,coach"), False)
    case("keywords with a space after a comma", write("keywords.txt", "heart, football"), False)
    case("description over 4000", write("description.txt", "a" * 4001), False)
    case("description promises sync", write("description.txt", "Sync your squad across phones."), False)
    case("http privacy URL", write("privacy_url.txt", "http://example.com/privacy"), False)
    case("the wrong name", write("name.txt", "Heart FC"), False)
    case("no description", remove("description.txt"), False)
    print(f"{11 - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) != 2:
        print(__doc__)
        return 2
    found = problems(argv[1])
    for p in found:
        print(f"LISTING PROBLEM: {p}")
    if not found:
        print(f"{argv[1]}: every field within Apple's limits; nothing v1 lacks is claimed")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
