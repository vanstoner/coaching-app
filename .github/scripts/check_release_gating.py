#!/usr/bin/env python3
"""Assert a red `checks` job stops the release, the beta AND the demo — #99 AC6, #146.

GitHub skips a job whose `needs` did not all succeed, unless its `if:` uses
a status function (always(), failure(), cancelled(), success() with `||`)
that overrides that. So the release and the beta are gated on the unit
tests exactly when (1) each lists `checks` in `needs`, and (2) neither `if:`
contains a status function. Read from the workflow file itself, because a
later edit to either line is how the gate would quietly stop gating.

    check_release_gating.py WORKFLOW_YML
    check_release_gating.py --self-test

The self-test dry-runs the healthy case first: five of six CI failures on
this project were gates rejecting a correct artifact.
"""

import re
import sys

import yaml

GATED = ("release", "beta", "demo")
STATUS_FN = re.compile(r"\b(always|failure|cancelled|success)\s*\(")


def problems(doc):
    jobs = (doc or {}).get("jobs") or {}
    out = []
    if "checks" not in jobs:
        out.append("there is no `checks` job")
    for name in GATED:
        job = jobs.get(name)
        if job is None:
            out.append(f"there is no `{name}` job")
            continue
        needs = job.get("needs") or []
        needs = [needs] if isinstance(needs, str) else list(needs)
        if "checks" not in needs:
            out.append(f"`{name}` does not need `checks` (needs: {needs})")
        cond = str(job.get("if", ""))
        if STATUS_FN.search(cond):
            out.append(f"`{name}`'s if: uses a status function, which can run it after `checks` failed: {cond.strip()!r}")
    return out


def self_test():
    def wf(release_needs, beta_needs, release_if="github.event_name == 'push'", beta_if="github.event_name == 'pull_request'",
           checks=True, demo_needs=("checks", "apk", "smoke"), demo_if="inputs.distribution == 'demo'"):
        jobs = {
            "apk": {}, "smoke": {"needs": "apk"},
            "release": {"needs": release_needs, "if": release_if},
            "beta": {"needs": beta_needs, "if": beta_if},
            "demo": {"needs": list(demo_needs or ()), "if": demo_if},
        }
        if demo_needs is None:
            del jobs["demo"]
        if checks:
            jobs["checks"] = {}
        return {"jobs": jobs}

    ok = ["checks", "apk", "smoke"]
    cases = [
        ("healthy: both need checks, plain if", wf(ok, ok), True),
        ("release forgot checks", wf(["apk", "smoke"], ok), False),
        ("beta forgot checks", wf(ok, ["apk", "smoke"]), False),
        ("release runs always()", wf(ok, ok, release_if="always() && github.ref == 'refs/heads/main'"), False),
        ("beta runs on failure()", wf(ok, ok, beta_if="failure() || github.event_name == 'pull_request'"), False),
        ("no checks job at all", wf(ok, ok, checks=False), False),
        ("#146: demo forgot checks", wf(ok, ok, demo_needs=("apk", "smoke")), False),
        ("#146: demo runs always()", wf(ok, ok, demo_if="always() && inputs.distribution == 'demo'"), False),
        ("#146: no demo job at all", wf(ok, ok, demo_needs=None), False),
    ]
    failed = 0
    for name, doc, should_pass in cases:
        passed = not problems(doc)
        good = passed == should_pass
        failed += not good
        print(f"  {'ok' if good else 'x '} {name} -> {'pass' if passed else 'fail'}")
    print(f"{len(cases) - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) != 2:
        print(__doc__)
        return 2
    with open(argv[1], encoding="utf-8") as f:
        found = problems(yaml.safe_load(f))
    for p in found:
        print(f"ASSERTION FAILED: {p}")
    if found:
        print("WHY THIS JOB FAILED: a red `checks` job would no longer stop a release, a beta or the demo (#99 AC6, #146).")
        return 1
    print("release, beta and demo all need `checks`, with no status function in their if: — a red `checks` stops each.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
