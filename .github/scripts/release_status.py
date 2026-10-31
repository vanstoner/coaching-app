#!/usr/bin/env python3
"""The release tracker's data, #240: where each version is, and how ideas flow.

    release_status.py gather OUT_DIR [--previous URL]
        Read GitHub (and Apple's public lookup) and write OUT_DIR/status.json
        (criteria 1-13) and OUT_DIR/flow.json (criteria 20-34). Reads only:
        it never writes to GitHub, App Store Connect or Play (criterion 9).
        --previous is the live site; its flow.json keeps each issue's first
        Specified and Ready dates, which are never rewritten (criterion 27).
    release_status.py check FILE...
        The criterion 11/32 privacy check: refuse an '@', a JWT-shaped
        string or a key not on the allow-list.
    release_status.py --self-test

Where a fact comes from (P1-P3, #240):
- Builds and betas: GitHub releases and the Android APK runs.
- iPhone: what the TestFlight runs print ("Uploaded to TestFlight (build N)",
  "added to Externals", "submitted for review"), and Apple's public lookup,
  which says when a version is live. The App Store key is only in the gated
  `app-store` environment, so the refresh never calls App Store Connect.
- Android: what the Google Play runs print ("is on the alpha closed track").
- Waiting on Rob: a run held at its environment gate.
Every date is a recorded timestamp; "waiting N days" is worked out by the
page when it draws (invariant 2, in spirit).
"""

import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "vanstoner/coaching-app")
API = "https://api.github.com"
SITE = f"https://github.com/{REPO}"
LOOKUP = "https://itunes.apple.com/lookup?bundleId=com.vanstoner.coachingapp&country=gb"
CHART_START = "2026-09-16"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
CLOSED_TEST_START = os.path.join(ROOT, "store", "play", "closed-test-start.txt")

STATES = ("done", "rob", "apple", "google", "failed", "not_started")
STAGES = ("idea", "specified", "ready", "building", "beta", "live")

# Criterion 11/32: every key either file may hold. Anything else is refused.
STATUS_KEYS = {
    "schema", "generated_at", "versions", "version", "build", "role", "lanes",
    "lane", "steps", "id", "name", "state", "date", "since", "action", "note",
    "link", "pr_betas", "pr", "title", "notes", "apple_live",
}
FLOW_KEYS = {
    "schema", "generated_at", "first_refresh", "items", "number", "title",
    "stage", "dates", "idea", "specified", "ready", "building", "beta", "live",
    "closed", "reconstructed", "versions", "labels", "link", "left", "reason",
    "releases", "version", "build", "date", "notes",
}


# --------------------------------------------------------------------------
# Reading GitHub

class _KeepRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # surface the redirect as an HTTPError so log() can follow it without the token


_NO_REDIRECT = urllib.request.build_opener(_KeepRedirect)

class GitHub:
    def __init__(self, token, api=API):
        self.token = token
        self.api = api
        self.calls = 0
        self.logs_read = 0
        self.logs_failed = 0

    def get(self, path, raw=False):
        url = path if path.startswith("http") else f"{API}/repos/{REPO}/{path}"
        req = urllib.request.Request(url, headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "coaching-app-release-status",
            **({"Authorization": f"Bearer {self.token}"} if self.token else {}),
        })
        self.calls += 1
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
        return body.decode("utf-8", "replace") if raw else json.loads(body)

    def pages(self, path, key=None, limit=10):
        """Every page of a list, by explicit page numbers (no Link header)."""
        out = []
        sep = "&" if "?" in path else "?"
        for page in range(1, limit + 1):
            got = self.get(f"{path}{sep}per_page=100&page={page}")
            items = got[key] if key else got
            out.extend(items)
            if len(items) < 100:
                break
        return out

    def log(self, job_id):
        """A job's log. GitHub answers with a redirect to its log storage,
        which refuses a request still carrying the GitHub token (HTTP 401),
        so the redirect is followed by hand, without the token."""
        try:
            req = urllib.request.Request(f"{self.api}/repos/{REPO}/actions/jobs/{job_id}/logs", headers={
                "Accept": "application/vnd.github+json", "User-Agent": "coaching-app-release-status",
                **({"Authorization": f"Bearer {self.token}"} if self.token else {})})
            self.calls += 1
            try:
                with _NO_REDIRECT.open(req, timeout=60) as r:
                    self.logs_read += 1
                    return r.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                if e.code not in (301, 302, 303, 307, 308) or not e.headers.get("Location"):
                    raise
                plain = urllib.request.Request(e.headers["Location"], headers={"User-Agent": "coaching-app-release-status"})
                with urllib.request.urlopen(plain, timeout=60) as r:
                    self.logs_read += 1
                    return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if not self.token and shutil.which("gh"):
                # A local dry run with no token: the gh CLI reads the log.
                got = subprocess.run(["gh", "api", f"repos/{REPO}/actions/jobs/{job_id}/logs"],
                                     capture_output=True, text=True)
                if got.returncode == 0:
                    self.logs_read += 1
                    return got.stdout
            print(f"note: job {job_id}'s log could not be read (HTTP {e.code})", file=sys.stderr)
            self.logs_failed += 1
            return ""


# --------------------------------------------------------------------------
# Pure helpers (self-tested)

RELEASE_TAG = re.compile(r"^v(\d{1,2}\.\d+\.\d+)-build\.(\d+)$")  # 1.0.0 on; not the 2026.10.x tags before it
CLOSING = re.compile(r"(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*((?:#\d+[\s,]*(?:and\s+)?)+)")
ANY_RELEASE = re.compile(r"^v(\d+\.\d+\.\d+)-build\.(\d+)$")  # the flow counts the early date-tagged releases too
REFS = re.compile(r"(?im)^refs:\s*(.+)$")
RELEASE_PR = re.compile(r"contains \[PR #(\d+)\]")


def closes(text):
    """Issue numbers a PR body or commit message closes ("Closes #54, #252")."""
    found = []
    for m in CLOSING.finditer(text or ""):
        found.extend(int(n) for n in re.findall(r"#(\d+)", m.group(1)))
    return sorted(set(found))


def references(text):
    """Issues a commit or PR names: its closing keywords and its Refs trailer."""
    found = set(closes(text))
    for m in REFS.finditer(text or ""):
        found.update(int(n) for n in re.findall(r"#(\d+)", m.group(1)))
    return sorted(found)


def version_key(v):
    return tuple(int(p) for p in v.split("."))


def has_criteria(body):
    """Specified (Q7): an Acceptance criteria heading with content after it."""
    m = re.search(r"(?im)^#{2,3}\s*acceptance criteria\s*$(.*?)(?=^#{1,3}\s|\Z)", body or "", re.S)
    return bool(m) and m.group(1).strip() not in ("", "_No response_")


def is_ready(body):
    """Ready (D4): the feature form's ticked approval box."""
    return bool(re.search(r"(?im)^\s*[-*]\s*\[x\]\s*rob approved", body or ""))


def targets(labels):
    """Version markers (Q5): target:X.Y.Z labels, lowest first; 'later' last."""
    vs = [n[len("target:"):] for n in labels if n.startswith("target:")]
    nums = sorted((v for v in vs if re.fullmatch(r"\d+\.\d+\.\d+", v)), key=version_key)
    return nums + (["later"] if "later" in vs else [])


def day(ts):
    return ts[:10] if ts else None


def parse_testflight_log(text):
    """What a TestFlight job printed: (version, build) and what happened."""
    clean = "\n".join(l for l in text.splitlines() if "echo " not in l and "$" not in l)
    out = {"version": None, "build": None, "uploaded": False, "externals": False,
           "submitted": False, "failed_step": None}
    m = re.search(r"VERSION: (\d+\.\d+\.\d+)", text)
    out["version"] = m.group(1) if m else None
    m = re.search(r"IOS_BUILD_NUMBER: (\d+)", text)
    out["build"] = int(m.group(1)) if m else None
    out["uploaded"] = bool(re.search(r"Uploaded to TestFlight \(build \d+\)", clean))
    out["externals"] = bool(re.search(r"added to Externals; submitted for Beta App Review", clean))
    out["submitted"] = bool(re.search(r"\(build \d+\) submitted for review", clean))
    m = re.search(r"WHY THIS JOB FAILED\s*\n.*?step:\s*(.+)", clean)
    out["failed_step"] = m.group(1).strip() if m else None
    return out


def parse_play_log(text):
    clean = "\n".join(l for l in text.splitlines() if "echo " not in l and "$" not in l)
    out = {"version": None, "build": None, "on_track": False, "dry_run": False}
    m = re.search(r"VERSION: (\d+\.\d+\.\d+)", text)
    out["version"] = m.group(1) if m else None
    m = re.search(r"BUILD: (\d+)", text)
    out["build"] = int(m.group(1)) if m else None
    out["on_track"] = bool(re.search(r"is on the \w+ closed track", clean))
    out["dry_run"] = "DRY_RUN: true" in text
    return out


def step(sid, name, state="not_started", date=None, since=None, action=None, note=None, link=None):
    assert state in STATES, state
    return {"id": sid, "name": name, "state": state, "date": date, "since": since,
            "action": action, "note": note, "link": link}


def stage_on(dates, closed_without_release, d):
    """The stage an issue was in on day d, or None if not on the board then."""
    if dates.get("idea") is None or dates["idea"] > d:
        return None
    if dates.get("live") and dates["live"] <= d:
        return "live"
    if closed_without_release and dates.get("closed") and dates["closed"] <= d:
        return None
    best = "idea"
    for s in STAGES[1:5]:
        if dates.get(s) and dates[s] <= d:
            best = s
    return best


# --------------------------------------------------------------------------
# The version tracker (criteria 1-13)

def gather_status(gh, now, lookup):
    releases = [r for r in gh.pages("releases", limit=3) if RELEASE_TAG.match(r["tag_name"]) and not r["draft"]]
    by_version = {}
    for r in releases:
        v, b = RELEASE_TAG.match(r["tag_name"]).groups()
        by_version.setdefault(v, []).append({"build": int(b), "sha": r["target_commitish"],
                                             "date": r["published_at"], "body": r["body"] or "",
                                             "link": r["html_url"]})
    versions = sorted(by_version, key=lambda v: max(b["build"] for b in by_version[v]), reverse=True)[:2]

    tf = read_runs(gh, "testflight.yml", parse_testflight_log)
    play = read_runs(gh, "google-play.yml", parse_play_log)
    apk_push = {r["head_sha"]: r for r in gh.get("actions/workflows/android-apk.yml/runs?event=push&branch=main&per_page=60")["workflow_runs"]}

    out = []
    for i, v in enumerate(versions):
        role = "current" if i == 0 else "previous"
        newer = versions[0] if i else None
        builds = sorted(by_version[v], key=lambda x: x["build"])
        store_builds = {f["build"] for f in tf + play if f["version"] == v and f["build"]}
        rel = next((b for b in builds if b["build"] in store_builds), builds[0])
        out.append({
            "version": v, "build": rel["build"], "role": role,
            "lanes": [
                {"lane": "Build", "steps": build_lane(gh, rel, apk_push)},
                {"lane": "iPhone", "steps": iphone_lane(v, rel, tf, lookup, newer)},
                {"lane": "Android", "steps": android_lane(v, rel, play, now, newer)},
            ],
        })
    return {"schema": 1, "generated_at": now, "versions": out, "pr_betas": pr_betas(gh),
            "apple_live": lookup.get("version")}


def read_runs(gh, workflow, parse):
    """Each recent run of a store workflow: its state, its jobs, what it printed."""
    facts = []
    for run in gh.get(f"actions/workflows/{workflow}/runs?branch=main&per_page=25")["workflow_runs"]:
        jobs = gh.get(f"actions/runs/{run['id']}/jobs?per_page=50")["jobs"]
        for job in jobs:
            if job["conclusion"] == "skipped":
                continue
            f = {"run": run["html_url"], "status": job["status"], "conclusion": job["conclusion"],
                 "job": job["name"], "at": job["completed_at"] or job["started_at"] or run["created_at"],
                 "head_sha": run["head_sha"], "event": run["event"],
                 "failed_steps": [s["name"] for s in job.get("steps", []) if s.get("conclusion") == "failure"]}
            if job["status"] == "completed" and job["conclusion"] in ("success", "failure"):
                f.update(parse(gh.log(job["id"])))
            else:
                f.update(parse(""))
            facts.append(f)
    return sorted(facts, key=lambda f: f["at"] or "")


def build_lane(gh, rel, apk_push):
    m = RELEASE_PR.search(rel["body"])
    pr = int(m.group(1)) if m else None
    beta = step("pr_beta", "PR beta", note="no pull request named in the release" if not pr else None)
    if pr:
        p = gh.get(f"pulls/{pr}")
        runs = gh.get(f"actions/workflows/android-apk.yml/runs?event=pull_request&branch={p['head']['ref']}&per_page=10")["workflow_runs"]
        beta = beta_step(gh, runs, f"{SITE}/pull/{pr}") | {"id": "pr_beta", "name": f"PR beta (#{pr})"}
    run = apk_push.get(rel["sha"])
    main = step("main_build", "Main build", link=run["html_url"] if run else rel["link"])
    if run and run["conclusion"] == "success":
        main.update(state="done", date=run["updated_at"])
    elif run and run["conclusion"] == "failure":
        main.update(state="failed", date=run["updated_at"])
    elif run:
        main.update(note="run in progress")
    else:
        main.update(state="done", date=rel["date"], note="release published")
    release = step("main_release", f"Main APK release (build {rel['build']})", "done", date=rel["date"], link=rel["link"])
    return [beta, main, release]


def beta_step(gh, runs, pr_link):
    s = step("pr_beta", "PR beta", link=pr_link)
    for run in runs:
        if run["status"] != "completed":
            s.update(note="run in progress", link=run["html_url"])
            return s
        jobs = gh.get(f"actions/runs/{run['id']}/jobs?per_page=50")["jobs"]
        pub = next((j for j in jobs if j["name"] == "Publish Heart FC Beta Coach"), None)
        if pub and pub["conclusion"] == "success":
            s.update(state="done", date=pub["completed_at"], link=run["html_url"])
            return s
        if run["conclusion"] == "failure":
            s.update(state="failed", date=run["updated_at"], link=run["html_url"], note="see WHY THIS JOB FAILED")
            return s
    s.update(note="no beta published (draft, or no app change)")
    return s


def iphone_lane(v, rel, tf, lookup, newer):
    upload = step("tf_upload", "TestFlight upload")
    external = step("tf_external", "TestFlight external (Externals, Beta App Review)")
    review = step("app_store_review", "App Store review")
    live = step("app_store_live", "Live on the App Store")
    gate = {"Sign and upload to TestFlight, then submit for review": upload,
            "TestFlight external steps only (no build)": external,
            "App Store steps only (no build)": review}
    for f in tf:
        if f["status"] == "waiting" and (f["head_sha"] == rel["sha"] or f["event"] == "workflow_dispatch") and not newer:
            target = gate.get(f["job"], upload)
            target.update(state="rob", since=f["at"], action="Approve the app-store run",
                          link=f["run"])
            continue
        if f["version"] != v:
            continue
        if f["status"] != "completed":
            gate.get(f["job"], upload).update(state="not_started", note="run in progress", link=f["run"])
            continue
        if f["uploaded"]:
            upload.update(state="done", date=f["at"], link=f["run"], note=f"build {f['build']}", action=None)
        if f["externals"]:
            external.update(state="apple", since=f["at"], date=None, link=f["run"], action=None,
                            note="Apple's Beta App Review; the page sees Apple's answer at the next run")
        if f["submitted"]:
            review.update(state="apple", since=f["at"], date=None, link=f["run"], action=None, note=None)
        if f["conclusion"] == "failure":
            stepname = " ".join(f["failed_steps"]) + " " + (f["failed_step"] or "")
            target = review if "App Store" in stepname or "App Store Connect" in stepname else \
                external if "external" in stepname.lower() else upload
            if target["state"] not in ("done", "apple"):
                target.update(state="failed", date=f["at"], link=f["run"], note="see WHY THIS JOB FAILED")
    if lookup.get("version") == v:
        when = lookup.get("date") or None
        review.update(state="done", date=when, note="approved by Apple", since=None)
        live.update(state="done", date=when, link=lookup.get("url"))
        if external["state"] == "apple":
            external.update(state="done", date=None, since=None, note="the version is live")
    elif lookup.get("version") and version_key(lookup["version"]) > version_key(v):
        for s in (external, review, live):
            if s["state"] in ("apple", "rob", "failed", "not_started"):
                s.update(state="not_started", note=f"superseded: {lookup['version']} is live", since=None, date=None)
    if newer:
        for s in (upload, external, review, live):
            if s["state"] in ("rob", "failed", "not_started", "apple") and lookup.get("version") != v:
                s.update(state="not_started", note=f"superseded by {newer}", since=None, date=None, action=None)
    return [upload, external, review, live]


def android_lane(v, rel, play, now, newer):
    internal = step("play_internal", "Play internal",
                    note="not used since #232: bundles go straight to the closed test")
    closed = step("play_closed", "Play closed test")
    prod = step("play_production", "Play production",
                note="off until the closed test qualifies (12 testers, 14 days)")
    for f in play:
        if f["status"] == "waiting" and f["head_sha"] == rel["sha"] and not newer:
            closed.update(state="rob", since=f["at"], action="Approve the google-play run", link=f["run"])
            continue
        if f["version"] != v or f["dry_run"]:
            continue
        if f["on_track"]:
            closed.update(state="google", since=f["at"], date=None, link=f["run"], action=None,
                          note="count not available from Google" + day_of_14(now))
        elif f["conclusion"] == "failure" and closed["state"] != "google":
            closed.update(state="failed", date=f["at"], link=f["run"], note="see WHY THIS JOB FAILED")
    if newer and closed["state"] in ("rob", "failed", "not_started"):
        closed.update(state="not_started", note=f"superseded by {newer}", action=None, since=None, date=None)
    return [internal, closed, prod]


def day_of_14(now):
    try:
        start = open(CLOSED_TEST_START, encoding="utf-8").read().strip()
        n = (dt.date.fromisoformat(now[:10]) - dt.date.fromisoformat(start)).days + 1
        return f" · day {min(n, 14)} of 14" if n < 14 else " · 14 days passed"
    except (OSError, ValueError):
        return " · start date not recorded"


def pr_betas(gh):
    out = []
    for p in gh.get("pulls?state=open&per_page=30"):
        runs = gh.get(f"actions/workflows/android-apk.yml/runs?event=pull_request&branch={p['head']['ref']}&per_page=10")["workflow_runs"]
        s = beta_step(gh, runs, p["html_url"])
        out.append({"pr": p["number"], "title": p["title"], "state": s["state"], "date": s["date"],
                    "note": s["note"], "link": s["link"]})
    return out


def apple_lookup():
    try:
        with urllib.request.urlopen(LOOKUP, timeout=30) as r:
            res = json.load(r).get("results") or []
    except Exception:
        return {}
    if not res:
        return {}
    a = res[0]
    return {"version": a.get("version"), "date": a.get("currentVersionReleaseDate"),
            "url": (a.get("trackViewUrl") or "").split("?")[0]}


# --------------------------------------------------------------------------
# The idea flow (criteria 20-34)

def gather_flow(gh, now, previous, status):
    issues = [i for i in gh.pages("issues?state=all", limit=10) if "pull_request" not in i]
    pulls = gh.pages("pulls?state=all", limit=10)
    commits = gh.pages("commits?sha=main", limit=8)
    releases = sorted(((ANY_RELEASE.match(r["tag_name"]).groups(), r) for r in gh.pages("releases", limit=3)
                       if ANY_RELEASE.match(r["tag_name"]) and not r["draft"]),
                      key=lambda x: int(x[0][1]))
    order = {c["sha"]: n for n, c in enumerate(reversed(commits))}  # oldest = 0

    # Issue -> its merges: the main commits (squashed PRs) whose message
    # closes it or names it in Refs:, and open PRs that do the same.
    refs_on_main, open_prs = {}, {}
    for c in commits:
        for n in references(c["commit"]["message"]):
            refs_on_main.setdefault(n, []).append((c["commit"]["committer"]["date"], c["sha"]))
    for p in pulls:
        if p["state"] == "open":
            for n in references((p["body"] or "") + "\n" + p["title"]):
                open_prs.setdefault(n, []).append(p)

    def shipped_by(n, closed_at):
        """The last main commit naming the issue before it closed (a day's grace)."""
        limit = (dt.datetime.fromisoformat(closed_at.replace("Z", "+00:00")) + dt.timedelta(days=1)).isoformat()
        hits = [r for r in refs_on_main.get(n, []) if r[0].replace("Z", "+00:00") <= limit]
        return max(hits) if hits else None

    rel_list = [(order.get(r["target_commitish"]), v, int(b), r["published_at"]) for (v, b), r in releases]
    rel_list = [r for r in rel_list if r[0] is not None]

    def first_release(sha):
        pos = order.get(sha)
        if pos is None:
            return None
        hits = [r for r in rel_list if r[0] >= pos]
        return min(hits, key=lambda r: r[0]) if hits else None

    betas = {b["pr"]: b for b in status.get("pr_betas", [])}
    prev = {i["number"]: i for i in (previous or {}).get("items", [])}
    first_refresh = (previous or {}).get("first_refresh") or day(now)
    backfill = not previous
    approvals, criteria = ({}, {})
    if backfill:
        approvals, criteria = comment_dates(gh)

    items = []
    for i in issues:
        n = i["number"]
        labels = [l["name"] for l in i["labels"]]
        d = {"idea": day(i["created_at"]), "closed": day(i["closed_at"])}
        recon = []
        old = prev.get(n, {}).get("dates", {})
        stage = None
        if i["state"] == "closed":
            mg = shipped_by(n, i["closed_at"])
            rel = first_release(mg[1]) if mg else None
            if i.get("state_reason") == "completed" and rel:
                stage = "live"
                d["live"] = day(rel[3])
                d["beta"] = day(mg[0])
                version = rel[1]
            elif i.get("state_reason") == "completed" and mg:
                stage = "beta"
                d["beta"] = day(mg[0])
                version = None
            else:
                version = None
        else:
            version = None
            prs = open_prs.get(n, [])
            if any(betas.get(p["number"], {}).get("state") == "done" for p in prs):
                stage = "beta"
                d["beta"] = min(day(betas[p["number"]]["date"]) for p in prs if betas.get(p["number"], {}).get("date"))
            elif prs:
                stage = "building"
            elif is_ready(i["body"]):
                stage = "ready"
            elif has_criteria(i["body"]):
                stage = "specified"
            else:
                stage = "idea"
            if prs:
                d["building"] = min(day(p["created_at"]) for p in prs)
        # First-seen dates for Specified and Ready, never rewritten (27).
        for s in ("specified", "ready"):
            if old.get(s):
                d[s] = old[s]
                if s in prev.get(n, {}).get("reconstructed", []):
                    recon.append(s)
            elif stage in STAGES[STAGES.index(s):] and i["state"] == "open":
                if backfill and (approvals if s == "ready" else criteria).get(n):
                    d[s] = (approvals if s == "ready" else criteria)[n]
                    recon.append(s)
                else:
                    d[s] = day(now)
            elif backfill and stage == "live" and (approvals if s == "ready" else criteria).get(n):
                d[s] = (approvals if s == "ready" else criteria)[n]
                recon.append(s)
        left = None
        if i["state"] == "closed" and stage != "live":
            r = i.get("state_reason")
            left = "not_planned" if r == "not_planned" else "duplicate" if r == "duplicate" else "no_app_change"
            stage = None
        items.append({"number": n, "title": i["title"], "stage": stage,
                      "dates": {k: v for k, v in d.items() if v}, "reconstructed": sorted(set(recon)),
                      "versions": [version] if version else targets(labels),
                      "labels": [l for l in labels if not l.startswith("target:")],
                      "link": i["html_url"], "left": left})
    rels = []
    for (v, b), r in releases:
        if RELEASE_TAG.match(r["tag_name"]) and not any(x["version"] == v for x in rels):
            rels.append({"version": v, "build": int(b), "date": day(r["published_at"])})
    return {"schema": 1, "generated_at": now, "first_refresh": first_refresh,
            "items": sorted(items, key=lambda x: x["number"]), "releases": rels}


def comment_dates(gh):
    """Q6 back-fill, once: Ready from Rob's recorded approval, Specified from
    the first criteria comment. Marked "reconstructed" on the chart."""
    approvals, criteria = {}, {}
    for c in gh.pages("issues/comments?sort=created&direction=asc", limit=30):
        n = int(c["issue_url"].rsplit("/", 1)[1])
        body = c["body"] or ""
        when = day(c["created_at"])
        if re.search(r"(?i)\*\*(ruling|approved)\b[^*]*\(rob", body) or re.search(r"(?i)^\*\*approved \(rob", body):
            approvals.setdefault(n, when)
        if re.search(r"(?im)^#{2,3}\s*acceptance criteria|^\*\*criteria\b", body):
            criteria.setdefault(n, when)
    return approvals, criteria


# --------------------------------------------------------------------------
# Privacy (criteria 11, 12, 32)

def privacy_problems(obj, allowed, where="$"):
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k not in allowed and not re.fullmatch(r"\d+", k):
                found.append(f"{where}: key '{k}' is not on the allow-list")
            found.extend(privacy_problems(v, allowed, f"{where}.{k}"))
    elif isinstance(obj, list):
        for n, v in enumerate(obj):
            found.extend(privacy_problems(v, allowed, f"{where}[{n}]"))
    elif isinstance(obj, str):
        if "@" in obj:
            found.append(f"{where}: holds an '@'")
        if "eyJ" in obj:
            found.append(f"{where}: holds a JWT-shaped string")
    return found


def scrub(obj):
    """Titles are public already; an '@' in one (a package name) is spelled
    out rather than failing the refresh."""
    if isinstance(obj, dict):
        return {k: scrub(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    if isinstance(obj, str):
        return obj.replace("@", " (at) ")
    return obj


def check_files(paths):
    bad = 0
    for p in paths:
        data = json.load(open(p, encoding="utf-8"))
        allowed = FLOW_KEYS if "items" in data else STATUS_KEYS
        for problem in privacy_problems(data, allowed):
            print(f"PRIVACY PROBLEM: {p}: {problem}")
            bad += 1
    if not bad:
        print(f"{', '.join(paths)}: no personal data, no secrets, every key allowed")
    return 1 if bad else 0


# --------------------------------------------------------------------------

def previous_flow(url):
    if not url:
        return None
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/flow.json", timeout=30) as r:
            data = json.load(r)
        return data if data.get("schema") == 1 else None
    except Exception:
        return None


def gather(out_dir, previous_url):
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    gh = GitHub(os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"))
    lookup = apple_lookup()
    status = scrub(gather_status(gh, now, lookup))
    if gh.logs_failed and not gh.logs_read:
        # Every store run's log was unreadable: publishing would show every
        # store step as Not started. Fail, so the last good data is kept (10).
        print(f"WHY THIS STEP FAILED: none of {gh.logs_failed} job logs could be read", file=sys.stderr)
        return 1
    flow = scrub(gather_flow(gh, now, previous_flow(previous_url), status))
    os.makedirs(out_dir, exist_ok=True)
    for name, data in (("status.json", status), ("flow.json", flow)):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=1, sort_keys=True)
    print(f"{gh.calls} GitHub calls; status.json and flow.json written to {out_dir}")
    return check_files([os.path.join(out_dir, "status.json"), os.path.join(out_dir, "flow.json")])


def self_test():
    failed = total = 0

    def check(name, cond):
        nonlocal failed, total
        total += 1
        failed += not cond
        print(f"  {'ok' if cond else 'x '} {name}")

    check("closes: a list after one keyword", closes("Closes #54, #252\nCloses #254") == [54, 252, 254])
    check("closes: Fixes and Resolves", closes("Fixes #1. resolves #2") == [1, 2])
    check("closes: Refs is not a close", closes("Refs: #271, #232") == [])
    check("references: closing keywords and the Refs trailer",
          references("Closes #249\n\nRefs: #249, #232\nSquad-Role: Pip") == [232, 249])
    check("Specified: the criteria heading with content",
          has_criteria("### Acceptance criteria\n\n1. One page.\n\n### Out of scope\n"))
    check("Specified: the form's empty answer is not criteria",
          not has_criteria("### Acceptance criteria\n\n_No response_\n\n### Ready\n"))
    check("Ready: the ticked approval box", is_ready("### Ready\n\n- [x] Rob approved, once (25 Oct)"))
    check("Ready: an unticked box is not", not is_ready("- [ ] Rob approved, once"))
    check("targets: versions in order, later last",
          targets(["target:2.3.0", "target:later", "target:2.2.10", "bug"]) == ["2.2.10", "2.3.0", "later"])
    tf = parse_testflight_log(
        "  VERSION: 2.2.0\n  IOS_BUILD_NUMBER: 319\n"
        "\x1b[36;1m  echo \"Uploaded to TestFlight (build $IOS_BUILD_NUMBER).\"\n"
        "TestFlight: Heart FC Coach 2.2.0 (build 319) added to Externals; submitted for Beta App Review.\n"
        "Uploaded to TestFlight (build 319). Not submitted for review: see WHY THIS JOB FAILED.\n"
        "WHY THIS JOB FAILED\n  step:          check what App Store Connect holds\n")
    check("TestFlight log: version, build, upload, externals, the failed step",
          tf["version"] == "2.2.0" and tf["build"] == 319 and tf["uploaded"] and tf["externals"]
          and not tf["submitted"] and tf["failed_step"] == "check what App Store Connect holds")
    check("TestFlight log: an echo line alone proves nothing",
          not parse_testflight_log('echo "Uploaded to TestFlight (build $IOS_BUILD_NUMBER)"')["uploaded"])
    check("TestFlight log: submitted for review",
          parse_testflight_log("Heart FC Coach 2.2.0 (build 319) submitted for review; it releases")["submitted"])
    pl = parse_play_log("  VERSION: 2.2.0\n  BUILD: 319\n  DRY_RUN: false\n"
                        "Heart FC Coach 2.2.0 (build 319) is on the alpha closed track; Google's review")
    check("Play log: on the closed track", pl["on_track"] and pl["build"] == 319 and not pl["dry_run"])
    d = {"idea": "2026-10-01", "ready": "2026-10-05", "building": "2026-10-10"}
    check("stage on a day: before it existed", stage_on(d, False, "2026-09-30") is None)
    check("stage on a day: the latest stage reached", stage_on(d, False, "2026-10-07") == "ready")
    check("stage on a day: closed without a release leaves the board",
          stage_on({"idea": "2026-10-01", "closed": "2026-10-03"}, True, "2026-10-04") is None)
    check("stage on a day: live stays live", stage_on({"idea": "2026-10-01", "live": "2026-10-02"}, False, "2026-10-30") == "live")
    healthy = {"schema": 1, "versions": [{"version": "2.2.0", "lanes": [{"lane": "Build", "steps": [
        {"id": "x", "name": "Main build", "state": "done", "date": None, "since": None,
         "action": None, "note": None, "link": "https://github.com/x"}]}]}]}
    check("privacy: the healthy file passes", privacy_problems(healthy, STATUS_KEYS) == [])
    planted = json.loads(json.dumps(healthy))
    planted["versions"][0]["lanes"][0]["steps"][0]["note"] = "tester ann@example.com"
    check("privacy: a planted email is refused", bool(privacy_problems(planted, STATUS_KEYS)))
    planted["versions"][0]["lanes"][0]["steps"][0]["note"] = "eyJhbGciOi"
    check("privacy: a JWT-shaped string is refused", bool(privacy_problems(planted, STATUS_KEYS)))
    planted = json.loads(json.dumps(healthy))
    planted["versions"][0]["email"] = "x"
    check("privacy: a key not on the allow-list is refused", bool(privacy_problems(planted, STATUS_KEYS)))
    check("scrub: an '@' in a title is spelled out", "@" not in json.dumps(scrub({"title": "@types/node"})))
    check("log redirect: followed without the token, as the log storage needs", redirect_case())
    with tempfile.TemporaryDirectory() as tmp:
        p = os.path.join(tmp, "status.json")
        json.dump(healthy, open(p, "w"))
        check("check: the healthy file exits 0", check_files([p]) == 0)
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def redirect_case():
    """A local stand-in for GitHub: /repos/.../logs redirects to /blob, which
    refuses any request carrying an Authorization header (as Azure does)."""
    import http.server
    import threading

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.endswith("/logs"):
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/blob")
                self.end_headers()
            elif self.headers.get("Authorization"):
                self.send_response(401)
                self.end_headers()
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Uploaded to TestFlight (build 7).")

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        gh = GitHub("secret-token", api=f"http://127.0.0.1:{srv.server_port}")
        return "build 7" in gh.log(1) and gh.logs_read == 1
    finally:
        srv.shutdown()


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) >= 3 and argv[1] == "check":
        return check_files(argv[2:])
    if len(argv) >= 3 and argv[1] == "gather":
        prev = argv[argv.index("--previous") + 1] if "--previous" in argv else None
        return gather(argv[2], prev)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
