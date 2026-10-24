#!/usr/bin/env python3
"""App Store Connect API: TestFlight (#160), the listing (#108), release on approval (#226)
and TestFlight external testers (#234).

    asc_api.py max-build BUNDLE_ID VERSION
        Prints the highest build number Apple already has for VERSION of the
        app (0 if none). The upload refuses a number that is not higher
        (AC2): Apple would reject it after a full build.

    asc_api.py what-to-test BUNDLE_ID VERSION BUILD TEXT_FILE [WAIT_MINUTES]
        Waits for Apple to register that build, then sets its TestFlight
        "What to Test" (en-GB) to the file's text (AC3). Exits 0 with a
        warning if it cannot: the upload has already happened.

    asc_api.py listing BUNDLE_ID VERSION FOLDER [--dry-run]
        #108 D3: the listing text from FOLDER (check_listing.py's files) to the
        app's en-GB App Information (name, subtitle, privacy URL) and to that
        VERSION's en-GB page (description, keywords, promotional text, support
        URL), then read back and compared. --dry-run prints the differences
        and changes nothing.

    asc_api.py screenshots BUNDLE_ID VERSION FOLDER [--dry-run]
        #108 E: FOLDER/iphone/*.png and FOLDER/ipad/*.png (store-media.yml's
        shots, checked by check_store_media.py) to that VERSION's en-GB page,
        in file-name order, replacing what each display's set held, unless it
        already holds exactly those files (names and our checksums). Then read
        back, polling up to SHOT_WAIT_MINUTES until Apple has processed each
        one (COMPLETE): the names in order, none FAILED, and our checksum
        wherever Apple returns one. Still processing when the wait ends is
        reported as that, never as a mismatch.

    asc_api.py release BUNDLE_ID VERSION BUILD WHATS_NEW_FILE --screenshots FOLDER
               [--captions FILE] [--listing FOLDER] [--phased on|off]
               [--wait-minutes N] [--summary FILE] [--dry-run]
        #226: refuses first, writing nothing, unless FOLDER holds the approved
        screenshots for both displays (with --captions: exactly the shots
        that file captions). Then waits (bounded) for Apple to process BUILD,
        creates or reuses VERSION, attaches BUILD, sets "release automatically
        after approval" (AFTER_APPROVAL), phased release on or off, sends the
        listing, puts the screenshots on the version (a set already holding
        them is left alone), sets What's New, checks the page is complete, and submits it
        for review (reviewSubmissions). Every step checks before it acts, so a
        re-run finishes what an earlier one started and never duplicates.
        Refuses, red, with a WHY THIS JOB FAILED block, on anything it does not
        expect. --dry-run reads everything, prints the plan and writes nothing:
        the client itself refuses POST, PATCH and DELETE.

    asc_api.py beta BUNDLE_ID VERSION BUILD --groups FILE --description FILE
               [--wait-minutes N] [--summary FILE] [--rerun CMD] [--dry-run]
        #234: waits (bounded) for Apple to process BUILD, adds it to each
        external TestFlight group FILE names (store/testflight/groups.txt),
        sets the beta description from the repo, checks the rest of the Test
        Information is present (Rob's, never logged) and submits the build for
        Beta App Review when Apple asks, once. Never touches testers, the
        public link or an internal group. Refuses, red, with WHY THIS JOB
        FAILED. --dry-run prints the plan and writes nothing.

    asc_api.py beta-check FOLDER
        #234: store/testflight/ holds a group name (no tester data) and a
        1 to 4,000 character beta description. Run on every PR.

    asc_api.py --self-test

Credentials from the environment, as the workflow already holds them:
ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (the .p8 asc-key.sh wrote). The token
is an ES256 JWT signed with `openssl`, so nothing is installed; it lives 15
minutes and is never printed (AC5).
"""

import base64
import contextlib
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.appstoreconnect.apple.com/v1"
LOCALE = "en-GB"


# ---------------------------------------------------------------------------
# Pure
# ---------------------------------------------------------------------------

def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def der_to_raw(der):
    """An ECDSA DER signature (openssl's output) as the 64-byte r||s a JWT carries."""
    if len(der) < 8 or der[0] != 0x30:
        raise ValueError("not a DER sequence")
    i = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    parts = []
    for _ in range(2):
        if der[i] != 0x02:
            raise ValueError("not a DER integer")
        n = der[i + 1]
        value = der[i + 2:i + 2 + n].lstrip(b"\x00")
        if len(value) > 32:
            raise ValueError("integer longer than 32 bytes")
        parts.append(value.rjust(32, b"\x00"))
        i += 2 + n
    return parts[0] + parts[1]


def highest(versions):
    """The highest numeric build number among Apple's build `version` strings (0 if none)."""
    best = 0
    for v in versions:
        head = str(v).split(".")[0]
        if head.isdigit():
            best = max(best, int(head))
    return best


# ---------------------------------------------------------------------------
# Token and requests
# ---------------------------------------------------------------------------

def token(key_id, issuer, key_path, now=None):
    now = int(now if now is not None else time.time())
    header = b64url(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}).encode())
    payload = b64url(json.dumps({"iss": issuer, "iat": now, "exp": now + 900,
                                 "aud": "appstoreconnect-v1"}).encode())
    signing_input = f"{header}.{payload}".encode()
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key_path], input=signing_input,
                         capture_output=True, check=True).stdout
    return f"{header}.{payload}.{b64url(der_to_raw(der))}"


TOKEN_SHAPE = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


def trim(detail, limit=300):
    """Apple's error body, cut short, with anything shaped like a JWT removed (#226 AC22)."""
    return TOKEN_SHAPE.sub("<token>", str(detail))[:limit]


class ReadOnlyViolation(RuntimeError):
    pass


class Asc:
    """The App Store Connect client. read_only=True refuses every POST, PATCH
    and DELETE before it is sent: the dry run's guarantee (#226 AC19)."""

    WRITES = ("POST", "PATCH", "DELETE")

    def __init__(self, read_only=False):
        missing = [v for v in ("ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH") if not os.environ.get(v)]
        if missing:
            raise SystemExit(f"WHY THIS JOB FAILED: not set: {' '.join(missing)}")
        self.read_only = read_only
        self.jwt = token(os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"], os.environ["ASC_KEY_PATH"])

    def send(self, method, url, body):
        """(status, parsed JSON or {}). Raises urllib.error.HTTPError on 4xx/5xx."""
        req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                     headers={"Authorization": f"Bearer {self.jwt}",
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})

    def call(self, method, path, body=None, missing_ok=False):
        url = path if path.startswith("http") else API + path
        if self.read_only and method in self.WRITES:
            raise ReadOnlyViolation(f"dry run: refused to send {method} {url.split('?')[0]}")
        try:
            return self.send(method, url, body)[1]
        except urllib.error.HTTPError as e:
            if missing_ok and e.code == 404:
                return {"data": None}
            detail = trim(e.read().decode(errors="replace"))
            raise RuntimeError(f"{method} {url.split('?')[0]}: HTTP {e.code} {detail}") from None

    def upload(self, op, part):
        """One of Apple's upload operations for an asset (a PUT to Apple's asset host)."""
        if self.read_only:
            raise ReadOnlyViolation("dry run: refused to upload a screenshot")
        put_part(op, part)

    def app_id(self, bundle_id):
        q = urllib.parse.urlencode({"filter[bundleId]": bundle_id, "limit": 1})
        data = self.call("GET", f"/apps?{q}")["data"]
        if not data:
            raise RuntimeError(f"no App Store Connect app has bundle id {bundle_id}")
        return data[0]["id"]

    def builds(self, app, version, build=None):
        q = {"filter[app]": app, "filter[preReleaseVersion.version]": version, "limit": 200}
        if build is not None:
            q["filter[version]"] = str(build)
        return self.call("GET", "/builds?" + urllib.parse.urlencode(q))["data"]


# ---------------------------------------------------------------------------
# Listing (#108 D3)
# ---------------------------------------------------------------------------

# file -> (where, API attribute)
LISTING = {
    "name.txt": ("info", "name"),
    "subtitle.txt": ("info", "subtitle"),
    "privacy_url.txt": ("info", "privacyPolicyUrl"),
    "description.txt": ("version", "description"),
    "keywords.txt": ("version", "keywords"),
    "promotional_text.txt": ("version", "promotionalText"),
    "support_url.txt": ("version", "supportUrl"),
    # Not localised: an attribute of the version itself.
    "copyright.txt": ("appversion", "copyright"),
    # The Notes box under App Review Information. The contact details beside
    # it are Rob's and are typed in App Store Connect, never kept here.
    "review_notes.txt": ("review", "notes"),
}


def listing_wanted(folder):
    """{(where, attribute): text} from the folder's files that exist."""
    out = {}
    for f, key in LISTING.items():
        path = os.path.join(folder, f)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                out[key] = fh.read().strip()
    return out


def listing_diff(wanted, have):
    """[(where, attribute, have, wanted)] for every field that differs."""
    return [(w, a, have.get((w, a)), v) for (w, a), v in sorted(wanted.items()) if have.get((w, a)) != v]


# States in which Apple lets an app info or a version's page be edited. Any
# other state (READY_FOR_SALE, READY_FOR_DISTRIBUTION, IN_REVIEW, ...) is
# never written: the live listing is not this script's to change (#226 QA R1).
WRITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "READY_FOR_REVIEW"}


def record_state(attrs):
    """An app info's or a version's state, under either of Apple's attribute names."""
    s = attrs.get("appVersionState") or attrs.get("state") or attrs.get("appStoreState") or "UNKNOWN"
    return {"READY_FOR_SALE": "READY_FOR_DISTRIBUTION"}.get(s, s)


def writable_info(infos):
    """(id of the app info that may be written or None, id of the one to read)."""
    ok = [i["id"] for i in infos if record_state(i["attributes"]) in WRITABLE]
    return (ok[0] if ok else None), (ok[0] if ok else infos[0]["id"])


def listing(bundle_id, version, folder, dry_run=False, asc=None):
    asc = asc or Asc(read_only=dry_run)
    app = asc.app_id(bundle_id)
    infos = asc.call("GET", f"/apps/{app}/appInfos")["data"]
    info_id, read_info_id = writable_info(infos)
    q = urllib.parse.urlencode({"filter[versionString]": version, "filter[platform]": "IOS"})
    versions = [v for v in asc.call("GET", f"/apps/{app}/appStoreVersions?{q}")["data"]
                if v["attributes"].get("versionString") == version]
    if not versions:
        raise SystemExit(f"WHY THIS JOB FAILED: App Store Connect has no iOS version {version}; "
                         "its version page must read exactly this (#108).")
    version_id = versions[0]["id"]
    version_state_now = record_state(versions[0]["attributes"])

    def locs():
        info = [x for x in asc.call("GET", f"/appInfos/{read_info_id}/appInfoLocalizations")["data"]
                if x["attributes"]["locale"] == LOCALE]
        ver = [x for x in asc.call("GET", f"/appStoreVersions/{version_id}/appStoreVersionLocalizations")["data"]
               if x["attributes"]["locale"] == LOCALE]
        if not info or not ver:
            raise SystemExit(f"WHY THIS JOB FAILED: no {LOCALE} localisation on the app or on version {version}")
        have = {("info", k): v for k, v in info[0]["attributes"].items()}
        have.update({("version", k): v for k, v in ver[0]["attributes"].items()})
        own = asc.call("GET", f"/appStoreVersions/{version_id}")["data"]["attributes"]
        have.update({("appversion", k): v for k, v in own.items()})
        review = asc.call("GET", f"/appStoreVersions/{version_id}/appStoreReviewDetail").get("data")
        if review:
            have.update({("review", k): v for k, v in review["attributes"].items()})
        return info[0]["id"], ver[0]["id"], (review or {}).get("id"), have

    info_loc, ver_loc, review_id, have = locs()
    wanted = listing_wanted(folder)
    if any(w == "review" for w, _ in wanted) and not review_id:
        raise SystemExit("WHY THIS JOB FAILED: version " + version + " has no App Review Information yet. "
                         "Save the contact details on its page in App Store Connect once, then re-run.")
    diff = listing_diff(wanted, have)
    info_diff = [a for w, a, _, _ in diff if w == "info"]
    page_diff = [f"{w}.{a}" for w, a, _, _ in diff if w != "info"]
    if info_id is None and info_diff:
        raise SystemExit("WHY THIS JOB FAILED: no editable app info (the only one is "
                         f"{record_state(infos[0]['attributes'])}), and the files change its {', '.join(info_diff)}. "
                         "Nothing was sent to the live listing. Change those files back, or send them while "
                         "App Store Connect shows an editable App Information (after a version is added).")
    if info_id is None and not info_diff:
        print("app info: no editable app info; name, subtitle and privacy URL already match, nothing sent to it")
    if version_state_now not in WRITABLE and page_diff:
        raise SystemExit(f"WHY THIS JOB FAILED: version {version} is {version_state_now}, not editable, and the "
                         f"files change its {', '.join(page_diff)}. Nothing was sent to it.")
    for w, a, old, new in diff:
        print(f"{'would change' if dry_run else 'changing'} {w}.{a}: {len(old or '')} -> {len(new)} characters")
    if not diff:
        print("App Store Connect already matches the listing files")
        return 0
    if dry_run:
        print("Dry run: nothing was changed.")
        return 0
    info_attrs = {a: v for (w, a), v in wanted.items() if w == "info"}
    ver_attrs = {a: v for (w, a), v in wanted.items() if w == "version"}
    own_attrs = {a: v for (w, a), v in wanted.items() if w == "appversion"}
    review_attrs = {a: v for (w, a), v in wanted.items() if w == "review"}
    if info_attrs and info_diff and info_id is not None:
        asc.call("PATCH", f"/appInfoLocalizations/{info_loc}",
                 {"data": {"type": "appInfoLocalizations", "id": info_loc, "attributes": info_attrs}})
    if ver_attrs:
        asc.call("PATCH", f"/appStoreVersionLocalizations/{ver_loc}",
                 {"data": {"type": "appStoreVersionLocalizations", "id": ver_loc, "attributes": ver_attrs}})
    if own_attrs:
        asc.call("PATCH", f"/appStoreVersions/{version_id}",
                 {"data": {"type": "appStoreVersions", "id": version_id, "attributes": own_attrs}})
    if review_attrs:
        asc.call("PATCH", f"/appStoreReviewDetails/{review_id}",
                 {"data": {"type": "appStoreReviewDetails", "id": review_id, "attributes": review_attrs}})
    _, _, _, back = locs()
    left = listing_diff(wanted, back)
    if left:
        for w, a, old, new in left:
            print(f"READ-BACK DIFFERS: {w}.{a}")
        raise SystemExit("WHY THIS JOB FAILED: App Store Connect does not hold the listing files after the update")
    print(f"read back: all {len(wanted)} fields match the listing files")
    return 0


# ---------------------------------------------------------------------------
# Screenshots (#108 E)
# ---------------------------------------------------------------------------

# folder -> App Store Connect display type. APP_IPHONE_67 is the 6.9" and
# 6.7" set (1320x2868, 1290x2796); APP_IPAD_PRO_3GEN_129 the 13" iPad set.
DISPLAYS = {"iphone": "APP_IPHONE_67", "ipad": "APP_IPAD_PRO_3GEN_129"}


def screenshot_plan(folder):
    """{display type: [png path, ...]} in file-name order, for each folder present."""
    plan = {}
    for sub, display in DISPLAYS.items():
        d = os.path.join(folder, sub)
        if os.path.isdir(d):
            files = sorted(f for f in os.listdir(d) if f.lower().endswith(".png"))
            if files:
                plan[display] = [os.path.join(d, f) for f in files]
    return plan


def chunks(data, operations):
    """(operation, bytes) for each of Apple's upload operations."""
    return [(op, data[op["offset"]:op["offset"] + op["length"]]) for op in operations]


def put_part(op, part):
    headers = {h["name"]: h["value"] for h in op.get("requestHeaders", [])}
    req = urllib.request.Request(op["url"], method=op.get("method", "PUT"), data=part, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        r.read()


def version_localization(asc, bundle_id, version):
    app = asc.app_id(bundle_id)
    q = urllib.parse.urlencode({"filter[versionString]": version, "filter[platform]": "IOS"})
    versions = [v for v in asc.call("GET", f"/apps/{app}/appStoreVersions?{q}")["data"]
                if v["attributes"].get("versionString") == version]
    if not versions:
        raise SystemExit(f"WHY THIS JOB FAILED: App Store Connect has no iOS version {version}")
    state = record_state(versions[0]["attributes"])
    if state not in WRITABLE:
        raise SystemExit(f"WHY THIS JOB FAILED: version {version} is {state}, not editable; "
                         "its screenshots are not changed (#226 QA R1).")
    locs = [x for x in asc.call("GET", f"/appStoreVersions/{versions[0]['id']}/appStoreVersionLocalizations")["data"]
            if x["attributes"]["locale"] == LOCALE]
    if not locs:
        raise SystemExit(f"WHY THIS JOB FAILED: version {version} has no {LOCALE} page")
    return locs[0]["id"]


def md5(path):
    with open(path, "rb") as fh:
        return hashlib.md5(fh.read()).hexdigest()


def shots_wanted(plan):
    """{display: [(file name, md5), ...]} in upload order."""
    return {display: [(os.path.basename(f), md5(f)) for f in files] for display, files in plan.items()}


def shots_held(asc, set_id):
    """[(file name, checksum, delivery state)] of one screenshot set, in Apple's order."""
    out = []
    for x in asc.call("GET", f"/appScreenshotSets/{set_id}/appScreenshots")["data"]:
        a = x.get("attributes") or {}
        out.append((a.get("fileName"), a.get("sourceFileChecksum"),
                    (a.get("assetDeliveryState") or {}).get("state"), x["id"]))
    return out


SHOT_NOT_DONE = {"FAILED", "AWAITING_UPLOAD"}
# #226, run 40049619707: right after an upload is committed Apple reads a
# screenshot back as UPLOAD_COMPLETE with no sourceFileChecksum until it has
# processed it. The read-back polls, bounded, for COMPLETE.
SHOT_WAIT_MINUTES = 10
SHOT_POLL_SECONDS = 15


class StillProcessing(Exception):
    """Every screenshot is in place and none failed, but Apple had not
    finished processing them all when the wait ran out. Not a fault."""
    def __init__(self, waiting):
        super().__init__(", ".join(f"{d} ({', '.join(names)})" for d, names in waiting.items()))
        self.waiting = waiting


def _sum(checksum):
    return (checksum or "").strip().lower() or None


def same_shots(held, wanted):
    """True when the set already holds exactly these files, in this order, not
    failed, each with OUR checksum (#226). A shot Apple holds with no checksum
    could be anything with that name, so it is never taken as ours: the set is
    uploaded again, which is always safe."""
    return ([(n, _sum(c)) for n, c, _, _ in held] == [(n, _sum(c)) for n, c in wanted]
            and not any(st in SHOT_NOT_DONE for _, _, st, _ in held))


def shots_verdict(held, wanted):
    """('complete' | 'processing' | 'failed', detail) for a set just written or
    kept: names in order, nothing FAILED, a checksum compared only where Apple
    returns one, and complete only when every shot reads COMPLETE."""
    names = [n for n, _ in wanted]
    if [n for n, *_ in held] != names:
        return "failed", f"holds {len(held)} of {len(names)} ({', '.join(n or '?' for n, *_ in held)})"
    failed = [n for n, _, st, _ in held if st == "FAILED"]
    if failed:
        return "failed", f"Apple marked FAILED: {', '.join(failed)}"
    ours = dict(wanted)
    wrong = [f"{n} (Apple {c}, ours {ours[n]})" for n, c, _, _ in held if _sum(c) and _sum(c) != _sum(ours[n])]
    if wrong:
        return "failed", f"checksum is not ours: {', '.join(wrong)}"
    waiting = [f"{n} {st or 'no state'}" for n, _, st, _ in held if st != "COMPLETE"]
    if waiting:
        return "processing", ", ".join(waiting)
    return "complete", ""


def await_shots(asc, set_id, display, wanted, wait_minutes, sleep):
    """Poll the set until every shot is COMPLETE (True), or the wait runs out
    with them still processing (False). Anything wrong is a SystemExit."""
    polls = max(1, int(wait_minutes * 60) // SHOT_POLL_SECONDS + 1)
    for attempt in range(polls):
        held = shots_held(asc, set_id)
        verdict, detail = shots_verdict(held, wanted)
        sums = "; ".join(f"{n}={c or 'null'}/{st}" for n, c, st, _ in held)
        if verdict == "failed":
            raise SystemExit(f"WHY THIS JOB FAILED: {display} {detail}. Read back: {sums}")
        if verdict == "complete":
            print(f"read back: {display} holds all {len(wanted)}, in order")
            return True
        print(f"{display}: Apple is still processing {detail} (read {attempt + 1} of {polls})")
        if attempt + 1 < polls:
            sleep(SHOT_POLL_SECONDS)
    return False


def sync_screenshots(asc, loc, plan, dry_run=False, wait_minutes=SHOT_WAIT_MINUTES, sleep=time.sleep):
    """Make each display's set on version localisation `loc` hold exactly the
    plan's files, in order. A set that already holds them (same names and
    checksums, not failed) is left alone, so a re-run uploads nothing twice.
    Then each set is read back until Apple has processed it (await_shots).
    The caller has checked `loc` belongs to an editable version.
    Returns the displays that changed (or would). Raises StillProcessing,
    after every display is written, if Apple had not finished by the end of
    the wait."""
    wanted = shots_wanted(plan)
    sets = {x["attributes"]["screenshotDisplayType"]: x["id"]
            for x in asc.call("GET", f"/appStoreVersionLocalizations/{loc}/appScreenshotSets")["data"]}
    changed, waiting = [], {}
    for display, files in plan.items():
        held = shots_held(asc, sets[display]) if display in sets else []
        names = ", ".join(n for n, _ in wanted[display])
        if same_shots(held, wanted[display]):
            print(f"{display}: already holds these {len(files)} screenshot(s); nothing uploaded")
            if not dry_run and not await_shots(asc, sets[display], display, wanted[display], wait_minutes, sleep):
                waiting[display] = [n for n, _ in wanted[display]]
            continue
        changed.append(display)
        print(f"{display}: {'would replace' if dry_run else 'replacing'} {len(held)} with {len(files)}: {names}")
        if dry_run:
            continue
        set_id = sets.get(display)
        if set_id is None:
            set_id = asc.call("POST", "/appScreenshotSets", {"data": {
                "type": "appScreenshotSets", "attributes": {"screenshotDisplayType": display},
                "relationships": {"appStoreVersionLocalization": {
                    "data": {"type": "appStoreVersionLocalizations", "id": loc}}}}})["data"]["id"]
        for *_, old in held:
            asc.call("DELETE", f"/appScreenshots/{old}")
        for path in files:
            with open(path, "rb") as fh:
                data = fh.read()
            shot = asc.call("POST", "/appScreenshots", {"data": {
                "type": "appScreenshots",
                "attributes": {"fileName": os.path.basename(path), "fileSize": len(data)},
                "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})["data"]
            for op, part in chunks(data, shot["attributes"]["uploadOperations"]):
                asc.upload(op, part)
            asc.call("PATCH", f"/appScreenshots/{shot['id']}", {"data": {
                "type": "appScreenshots", "id": shot["id"],
                "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
        if not await_shots(asc, set_id, display, wanted[display], wait_minutes, sleep):
            waiting[display] = [n for n, _ in wanted[display]]
    if waiting:
        raise StillProcessing(waiting)
    return changed


def screenshots(bundle_id, version, folder, dry_run=False, asc=None):
    plan = screenshot_plan(folder)
    if not plan:
        raise SystemExit(f"WHY THIS JOB FAILED: no iphone/ or ipad/ screenshots in {folder}")
    asc = asc or Asc(read_only=dry_run)
    loc = version_localization(asc, bundle_id, version)
    try:
        sync_screenshots(asc, loc, plan, dry_run)
    except StillProcessing as e:
        print(f"read back: every screenshot is in place and none failed; Apple is still processing {e}. "
              "Nothing is wrong: look again in App Store Connect in a few minutes.")
        return 0
    if dry_run:
        print("Dry run: nothing was changed.")
    return 0


def screenshot_refusal(folder, captions=None):
    """Why the release must not use FOLDER's screenshots, or None. Read before
    anything is written: both displays present, each within Apple's rules,
    and (with the captions file) exactly the approved set (#226)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import check_store_media as media  # noqa: PLC0415 — beside this script, stdlib only

    if captions:
        problems = media.set_problems(folder, captions)
    else:
        problems = []
        for sub in DISPLAYS:
            d = os.path.join(folder, sub)
            if not os.path.isdir(d) or not any(f.lower().endswith(".png") for f in os.listdir(d)):
                problems.append(f"no {sub} screenshots in {d}")
            else:
                problems.extend(f"{sub}: {p}" for p in media.shot_problems(d, sub))
    return "; ".join(problems) if problems else None


# ---------------------------------------------------------------------------
# Release on approval (#226)
#
# Apple's App Store Connect API, as documented:
#   GET    /v1/apps/{id}/appStoreVersions                       every iOS version and its state
#   POST   /v1/appStoreVersions                                 create (releaseType AFTER_APPROVAL)
#   PATCH  /v1/appStoreVersions/{id}                            releaseType
#   GET    /v1/appStoreVersions/{id}/build                      the attached build
#   PATCH  /v1/appStoreVersions/{id}/relationships/build        attach a build
#   GET    /v1/appStoreVersions/{id}/appStoreVersionPhasedRelease
#   POST   /v1/appStoreVersionPhasedReleases                    phased release on
#   DELETE /v1/appStoreVersionPhasedReleases/{id}               phased release off
#   GET    /v1/appStoreVersions/{id}/appStoreVersionLocalizations
#   PATCH  /v1/appStoreVersionLocalizations/{id}                whatsNew
#   GET    /v1/appStoreVersionLocalizations/{id}/appScreenshotSets
#   GET    /v1/appScreenshotSets/{id}/appScreenshots            fileName, sourceFileChecksum, state
#   POST   /v1/appScreenshotSets                                a display's set, on the editable version
#   DELETE /v1/appScreenshots/{id}                              a shot on the editable version only
#   POST   /v1/appScreenshots, PUT (uploadOperations), PATCH {uploaded, sourceFileChecksum}
#   GET    /v1/builds?filter[app]&filter[preReleaseVersion.version]&filter[version]
#                                                               processingState, usesNonExemptEncryption
#   GET    /v1/apps/{id}/appInfos, /v1/appInfos/{id}/ageRatingDeclaration
#   GET    /v1/reviewSubmissions?filter[app]&filter[platform]&filter[state]
#   GET    /v1/reviewSubmissions/{id}/items?include=appStoreVersion
#   POST   /v1/reviewSubmissions                                a submission for the app
#   POST   /v1/reviewSubmissionItems                            the version, added to it
#   PATCH  /v1/reviewSubmissions/{id}  {submitted: true}        submitted for review
# Never: cancel a submission (canceled: true), DELETE a version or an item,
# or touch a version that is Ready for Distribution (AC14).
# ---------------------------------------------------------------------------

AFTER_APPROVAL = "AFTER_APPROVAL"
STATE_ALIASES = {"READY_FOR_SALE": "READY_FOR_DISTRIBUTION",
                 "PROCESSING_FOR_APP_STORE": "PROCESSING_FOR_DISTRIBUTION"}
# Out of the way: the live version and the ones it replaced.
HISTORICAL = {"READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION", "REMOVED_FROM_SALE",
              "DEVELOPER_REMOVED_FROM_SALE"}
EDITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "READY_FOR_REVIEW"}
SUBMITTED = {"WAITING_FOR_REVIEW", "IN_REVIEW"}
# Approved and on its way out by itself: nothing left for this job to do.
ON_ITS_WAY = {"ACCEPTED", "PENDING_APPLE_RELEASE", "PROCESSING_FOR_DISTRIBUTION", "READY_FOR_DISTRIBUTION"}
REJECTED = {"REJECTED", "METADATA_REJECTED", "INVALID_BINARY"}
OPEN_SUBMISSION = ("READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES")
WHATS_NEW_LIMIT = 4000
PLACEHOLDER = "placeholder"
ASC_PAGE = "App Store Connect › Apps › Heart of the Game: Coach › iOS App"


def version_state(attrs):
    s = attrs.get("appVersionState") or attrs.get("appStoreState") or "UNKNOWN"
    return STATE_ALIASES.get(s, s)


def decide(versions, target, build_number, build, whats_new, phased=False, dry_run=False, shots=False):
    """The release plan, from what App Store Connect holds. Pure: no calls.

    versions: [{"id", "version", "state", "releaseType", "build", "phased"}], the
      last three read for the target only (build is its number, or None).
    build: this run's build as Apple has it, {"processing", "encryption",
      "expired"}, or None if Apple does not have it (yet).
    shots: whether the run carries the approved screenshots, which go on the
      version after the listing and before anything is submitted (#226).
    Returns {"outcome": "act" | "nothing" | "refuse", "lines": [...] (what a
    person reads), "steps": [(kind, value)], "version_id", "why", "fix"}.
    """
    n = str(build_number)

    def refuse(why, fix):
        return {"outcome": "refuse", "why": why, "fix": fix, "lines": [], "steps": [], "version_id": None}

    mine = next((v for v in versions if v["version"] == target), None)
    if mine:
        st, have = mine["state"], mine.get("build")
        if st in SUBMITTED | ON_ITS_WAY:
            if str(have) == n:
                return {"outcome": "nothing", "lines": [f"{target} is already {st} with build {n}; nothing to do"],
                        "steps": [], "version_id": mine["id"], "why": None, "fix": None}
            return refuse(f"{target} is already {st} with build {have}, not build {n}. "
                          "This job never cancels or withdraws a submission (AC14, AC16).",
                          f"Rob decides whether build {have} stands; if it must be replaced, that is a new "
                          "version (a patch bump), since cancelling the submission is not this job's to do.")
        if st == "PENDING_DEVELOPER_RELEASE":
            return refuse(f"{target} is approved and waiting for a manual release (PENDING_DEVELOPER_RELEASE).",
                          f"Rob releases it in {ASC_PAGE} › {target} › Release This Version.")
        if st in REJECTED:
            return refuse(f"{target} is {st}. Rejections are out of scope here (#226 Q4).",
                          f"Read Apple's message in {ASC_PAGE} › App Review (Resolution Center); "
                          "the fix path is its own issue.")
        if st not in EDITABLE:
            return refuse(f"{target} is in {st}, a state this job does not handle; nothing was changed (AC18).",
                          f"Look at {target} in {ASC_PAGE} and raise an issue for this state.")
    for v in versions:
        if v["version"] == target or v["state"] in HISTORICAL:
            continue
        if v["state"] in EDITABLE:
            return refuse(f"version {v['version']} is {v['state']}, an editable version this job did not expect. "
                          f"Apple allows one, so {target} cannot go ahead; it renames and deletes nothing (AC17, Q3).",
                          f"Rob decides in {ASC_PAGE}: rename {v['version']} to {target} (keeps its typed fields) "
                          "or delete it; then re-run the App Store steps.")
        return refuse(f"version {v['version']} is still {v['state']}, so {target} cannot go ahead.",
                      f"Wait for {v['version']} to leave {v['state']} in {ASC_PAGE} (or release it there), "
                      "then re-run the App Store steps.")

    if build is None:
        if not dry_run:
            return refuse(f"Apple has no build {n} of {target}, so there is nothing to attach.",
                          "Check the upload step; then re-run the App Store steps for this commit.")
        build_line = f"build: {n} (uploaded by this run; processing and compliance are checked after the upload)"
    else:
        if build.get("expired"):
            return refuse(f"build {n} of {target} has expired.", "Upload a new build: raise the version (a patch).")
        if build.get("processing") != "VALID":
            return refuse(f"build {n} of {target} is {build.get('processing')}, not VALID (processed).",
                          "If it is still PROCESSING, re-run the App Store steps later; if it FAILED or is "
                          "INVALID, read Apple's email and upload a new build.")
        if build.get("encryption") is not False:
            return refuse(f"build {n} reads usesNonExemptEncryption={build.get('encryption')}: Missing Compliance. "
                          "It is never attached (AC8).",
                          "Check ITSAppUsesNonExemptEncryption is false in app.json and in the signed "
                          "Info.plist (check_ios_app.py); then upload a new build.")
        build_line = f"build: {n} (processed, usesNonExemptEncryption false)"

    text = (whats_new or "").strip()
    if not text or len(text) > WHATS_NEW_LIMIT:
        return refuse(f"What's New is {len(text)} characters; Apple needs 1 to {WHATS_NEW_LIMIT}.",
                      "Write store/app-store/en-GB/whats_new.txt in a pull request.")
    if text.lower().startswith(PLACEHOLDER):
        return refuse("What's New is still the placeholder line.",
                      "Write store/app-store/en-GB/whats_new.txt for this version in a pull request.")

    lines, steps = [], []
    if mine:
        lines.append(f"version {target}: {'would reuse' if dry_run else 'reusing'} ({mine['state']})")
        rt = mine.get("releaseType") or "unset"
        if rt != AFTER_APPROVAL:
            steps.append(("release_type", rt))
            lines.append(f"release type: {rt} -> {AFTER_APPROVAL}")
        else:
            lines.append(f"release type: {AFTER_APPROVAL} already")
        have = mine.get("build")
        if str(have) != n:
            steps.append(("attach", have))
            lines.append(f"build: {have or 'none'} -> {n}" if build is not None else build_line)
        else:
            lines.append(f"build: {n} already attached")
        have_phased = bool(mine.get("phased"))
    else:
        steps.append(("create", None))
        lines.append(f"version {target}: {'would create' if dry_run else 'creating'} (none in App Store Connect yet)")
        lines.append(f"release type: (new) -> {AFTER_APPROVAL}")
        steps.append(("attach", None))
        lines.append(build_line)
        have_phased = False
    if have_phased != bool(phased):
        steps.append(("phased", bool(phased)))
    lines.append(f"phased release: {'on' if have_phased else 'off'} -> {'on (7 days)' if phased else 'off'}"
                 if have_phased != bool(phased) else f"phased release: {'on' if phased else 'off'} already")
    steps.append(("listing", None))
    if shots:
        steps.append(("screenshots", None))
        lines.append("screenshots: the approved set onto the en-GB page, before submitting "
                     "(sets that already hold them are left alone)")
    steps.append(("whats_new", text))
    lines.append(f"What's New ({len(text)} characters):")
    lines.extend("  | " + ln for ln in text.splitlines())
    steps.append(("check_page", None))
    steps.append(("submit", None))
    lines.append("would submit for review" if dry_run else "submitting for review")
    return {"outcome": "act", "lines": lines, "steps": steps, "version_id": mine["id"] if mine else None,
            "why": None, "fix": None}


REQUIRED_PAGE = (("description", "description"), ("keywords", "keywords"), ("supportUrl", "support URL"),
                 ("whatsNew", "What's New"))


def page_gaps(loc_attrs, screenshot_counts):
    """The fields Apple would bounce, in words (AC5). Empty when the page is complete."""
    gaps = [label for key, label in REQUIRED_PAGE if not (loc_attrs.get(key) or "").strip()]
    for folder, display in DISPLAYS.items():
        if not screenshot_counts.get(display):
            gaps.append(f"the {'iPhone' if folder == 'iphone' else 'iPad'} screenshot set ({display})")
    return gaps


class Refused(Exception):
    def __init__(self, step, why, fix):
        super().__init__(why)
        self.step, self.why, self.fix = step, why, fix


def read_versions(asc, app, target):
    q = urllib.parse.urlencode({"filter[platform]": "IOS", "limit": 200})
    out = []
    for v in asc.call("GET", f"/apps/{app}/appStoreVersions?{q}")["data"]:
        a = v["attributes"]
        out.append({"id": v["id"], "version": a.get("versionString"), "state": version_state(a),
                    "releaseType": a.get("releaseType"), "build": None, "phased": False})
    for v in out:
        if v["version"] == target:
            b = asc.call("GET", f"/appStoreVersions/{v['id']}/build", missing_ok=True).get("data")
            v["build"] = b["attributes"]["version"] if b else None
            p = asc.call("GET", f"/appStoreVersions/{v['id']}/appStoreVersionPhasedRelease",
                         missing_ok=True).get("data")
            v["phased"] = p["id"] if p else False
    return out


def read_build(asc, app, target, n, wait_minutes, sleep=time.sleep, clock=time.time):
    """Apple's record of build n, once processed or after wait_minutes; None if Apple has none."""
    deadline = clock() + wait_minutes * 60
    while True:
        found = asc.builds(app, target, n)
        b = found[0] if found else None
        state = b["attributes"].get("processingState") if b else None
        if (b and state != "PROCESSING") or clock() >= deadline:
            break
        print(f"build {n}: {'not registered' if not b else state} yet; waiting 30s")
        sleep(30)
    if not b:
        return None, None
    a = b["attributes"]
    return b["id"], {"processing": a.get("processingState"), "encryption": a.get("usesNonExemptEncryption"),
                     "expired": a.get("expired")}


def en_gb(asc, version_id):
    locs = [x for x in asc.call("GET", f"/appStoreVersions/{version_id}/appStoreVersionLocalizations")["data"]
            if x["attributes"]["locale"] == LOCALE]
    return locs[0] if locs else None


def screenshot_counts(asc, loc_id):
    out = {}
    for s in asc.call("GET", f"/appStoreVersionLocalizations/{loc_id}/appScreenshotSets")["data"]:
        out[s["attributes"]["screenshotDisplayType"]] = len(
            asc.call("GET", f"/appScreenshotSets/{s['id']}/appScreenshots")["data"])
    return out


def open_submission(asc, app):
    q = urllib.parse.urlencode({"filter[app]": app, "filter[platform]": "IOS",
                                "filter[state]": ",".join(OPEN_SUBMISSION)})
    subs = asc.call("GET", f"/reviewSubmissions?{q}")["data"]
    return subs[0] if subs else None


def submission_versions(asc, sub_id):
    items = asc.call("GET", f"/reviewSubmissions/{sub_id}/items?include=appStoreVersion")["data"]
    return [((i.get("relationships") or {}).get("appStoreVersion") or {}).get("data", {}) .get("id")
            for i in items if ((i.get("relationships") or {}).get("appStoreVersion") or {}).get("data")]


def print_preconditions(asc, app, versions):
    """AC9: every iOS version with its state, and the age rating, read only."""
    print("App Store Connect holds these iOS versions:")
    for v in versions:
        print(f"  {v['version']}: {v['state']}" + (f", releaseType {v['releaseType']}" if v["releaseType"] else ""))
    if not versions:
        print("  (none)")
    for info in asc.call("GET", f"/apps/{app}/appInfos")["data"]:
        st = info["attributes"].get("appStoreState") or info["attributes"].get("state")
        decl = asc.call("GET", f"/appInfos/{info['id']}/ageRatingDeclaration", missing_ok=True).get("data")
        answered = sum(1 for val in ((decl or {}).get("attributes") or {}).values() if val is not None)
        print(f"  app info ({st}): age rating declaration {'present, ' + str(answered) + ' answers' if decl else 'MISSING'}")
    print("  App Privacy answers are not in Apple's API; they are app-wide and were accepted with 1.0.1.")


def release(asc, bundle_id, target, build_number, whats_new, folder=None, phased=False, dry_run=False,
            wait_minutes=30, sleep=time.sleep, clock=time.time, shots_folder=None, captions=None,
            shot_wait_minutes=SHOT_WAIT_MINUTES):
    """Create or reuse `target`, attach build_number, release after approval,
    send the listing and the screenshots, set What's New and submit.
    Returns (exit code, one-line summary)."""
    n = str(build_number)
    done = []

    def progress():
        if not done:
            return "nothing changed in App Store Connect"
        if "submitted" in done:
            return ", ".join(done) + "; not yet read back as Waiting for Review"
        return ", ".join(done) + ", not submitted"

    step = "check the screenshots"
    try:
        # Before anything is read or written: a version is never created, or
        # submitted, without the approved shots to put on it (#226).
        if shots_folder is not None:
            why = screenshot_refusal(shots_folder, captions)
            if why:
                raise Refused(step, f"the screenshots for {target} are missing or not the approved set: {why}",
                              "Run store-media.yml on the branch, have Rob approve the shots, and commit them "
                              "under store/app-store/screenshots/ (one per caption in screenshot_captions.txt).")
            shot_plan = screenshot_plan(shots_folder)
        step = "read App Store Connect"
        app = asc.app_id(bundle_id)
        versions = read_versions(asc, app, target)
        print_preconditions(asc, app, versions)
        step = "wait for Apple to process the build"
        build_id, build = read_build(asc, app, target, n, 0 if dry_run else wait_minutes, sleep, clock)
        plan = decide(versions, target, n, build, whats_new, phased, dry_run, shots=shots_folder is not None)
        print("--- plan" + (" (dry run: nothing will be changed)" if dry_run else "") + " ---")
        for ln in plan["lines"]:
            print(ln)
        if plan["outcome"] == "refuse":
            raise Refused("check what App Store Connect holds", plan["why"], plan["fix"])
        if plan["outcome"] == "nothing":
            return 0, plan["lines"][0]
        if dry_run:
            vid = plan["version_id"]
            if vid and folder:
                step = "listing (dry run)"
                listing(bundle_id, target, folder, dry_run=True, asc=asc)
            if shots_folder is not None:
                step = "screenshots (dry run)"
                loc = en_gb(asc, vid) if vid else None
                if loc:
                    sync_screenshots(asc, loc["id"], shot_plan, dry_run=True)
                else:
                    for display, files in shot_plan.items():
                        print(f"{display}: would upload {len(files)} to {target} once it is created")
            if vid:
                loc = en_gb(asc, vid)
                gaps = page_gaps(dict(loc["attributes"], whatsNew=whats_new) if loc else {},
                                 screenshot_counts(asc, loc["id"]) if loc else {})
                print("page check: " + ("complete" if not gaps else "would refuse; empty: " + ", ".join(gaps)))
                if gaps:
                    raise Refused("check the version page", "empty on the en-GB page: " + ", ".join(gaps),
                                  "Run store-listing.yml from main (it sends the text and the screenshots), "
                                  "then re-run the App Store steps.")
            else:
                print(f"page check: after {target} is created (its listing is sent, then every field is checked)")
            print("Dry run: nothing was changed in App Store Connect.")
            return 0, f"Dry run: Heart FC Coach {target} (build {n}) would be submitted for review."

        vid = plan["version_id"]
        for kind, value in plan["steps"]:
            step = kind
            if kind == "create":
                vid = asc.call("POST", "/appStoreVersions", {"data": {
                    "type": "appStoreVersions",
                    "attributes": {"platform": "IOS", "versionString": target, "releaseType": AFTER_APPROVAL},
                    "relationships": {"app": {"data": {"type": "apps", "id": app}}}}})["data"]["id"]
                print(f"{target} created, release type {AFTER_APPROVAL}")
                done.append(f"{target} created")
            elif kind == "release_type":
                attrs = {"releaseType": AFTER_APPROVAL}
                if value == "SCHEDULED":
                    attrs["earliestReleaseDate"] = None
                asc.call("PATCH", f"/appStoreVersions/{vid}",
                         {"data": {"type": "appStoreVersions", "id": vid, "attributes": attrs}})
                print(f"releaseType {value} -> {AFTER_APPROVAL}")
                done.append("release type set")
            elif kind == "attach":
                asc.call("PATCH", f"/appStoreVersions/{vid}/relationships/build",
                         {"data": {"type": "builds", "id": build_id}})
                print(f"build {value} -> {n}" if value else f"build {n} attached")
                done.append(f"build {n} attached")
            elif kind == "phased":
                if value:
                    asc.call("POST", "/appStoreVersionPhasedReleases", {"data": {
                        "type": "appStoreVersionPhasedReleases", "attributes": {"phasedReleaseState": "INACTIVE"},
                        "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})
                else:
                    pid = asc.call("GET", f"/appStoreVersions/{vid}/appStoreVersionPhasedRelease",
                                   missing_ok=True).get("data")
                    if pid:
                        asc.call("DELETE", f"/appStoreVersionPhasedReleases/{pid['id']}")
                done.append(f"phased release {'on' if value else 'off'}")
            elif kind == "listing" and folder:
                listing(bundle_id, target, folder, asc=asc)
                done.append("listing sent")
            elif kind == "screenshots":
                loc = en_gb(asc, vid)
                if not loc:
                    raise Refused(kind, f"{target} has no {LOCALE} page.", f"Add {LOCALE} to {target} in {ASC_PAGE}.")
                if version_state(asc.call("GET", f"/appStoreVersions/{vid}")["data"]["attributes"]) not in EDITABLE:
                    raise Refused(kind, f"{target} is no longer editable, so its screenshots were not touched.",
                                  f"Look at {target} in {ASC_PAGE}.")
                try:
                    if sync_screenshots(asc, loc["id"], shot_plan, wait_minutes=shot_wait_minutes, sleep=sleep):
                        done.append("screenshots uploaded")
                except StillProcessing as e:
                    done.append("screenshots uploaded")
                    raise Refused(kind, f"the screenshots are in place and none failed, but Apple was still "
                                  f"processing {e} after {shot_wait_minutes} min, so {target} was not submitted. "
                                  "Nothing is wrong with them.",
                                  "Re-run only the App Store steps in a few minutes (testflight.yml with "
                                  "app_store_for=<this commit>): it keeps these shots and submits.")
            elif kind == "whats_new":
                loc = en_gb(asc, vid)
                if not loc:
                    raise Refused(kind, f"{target} has no {LOCALE} page.", f"Add {LOCALE} to {target} in {ASC_PAGE}.")
                if (loc["attributes"].get("whatsNew") or "").strip() != value:
                    asc.call("PATCH", f"/appStoreVersionLocalizations/{loc['id']}", {"data": {
                        "type": "appStoreVersionLocalizations", "id": loc["id"], "attributes": {"whatsNew": value}}})
                    done.append("What's New set")
                back = (en_gb(asc, vid)["attributes"].get("whatsNew") or "").strip()
                if back != value:
                    raise Refused(kind, "What's New does not read back as written.", "Re-run the App Store steps.")
                print(f"What's New: read back, {len(value)} characters")
            elif kind == "check_page":
                loc = en_gb(asc, vid)
                gaps = page_gaps(loc["attributes"], screenshot_counts(asc, loc["id"]))
                if gaps:
                    raise Refused(kind, "empty on the en-GB page: " + ", ".join(gaps),
                                  "Run store-listing.yml from main (it sends the text and the screenshots), "
                                  "then re-run the App Store steps.")
                print("page check: description, keywords, support URL, What's New and both screenshot sets present")
            elif kind == "submit":
                sub = open_submission(asc, app)
                if sub and sub["attributes"].get("state") != "READY_FOR_REVIEW":
                    raise Refused(kind, f"an App Review submission is already {sub['attributes'].get('state')}.",
                                  f"Look at App Review in {ASC_PAGE}; this job never cancels a submission.")
                if not sub:
                    sub = asc.call("POST", "/reviewSubmissions", {"data": {
                        "type": "reviewSubmissions", "attributes": {"platform": "IOS"},
                        "relationships": {"app": {"data": {"type": "apps", "id": app}}}}})["data"]
                if vid not in submission_versions(asc, sub["id"]):
                    asc.call("POST", "/reviewSubmissionItems", {"data": {
                        "type": "reviewSubmissionItems",
                        "relationships": {"reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                                          "appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})
                asc.call("PATCH", f"/reviewSubmissions/{sub['id']}", {"data": {
                    "type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}})
                done.append("submitted")

        step = "read back"
        for _ in range(12):
            own = asc.call("GET", f"/appStoreVersions/{vid}")["data"]["attributes"]
            state = version_state(own)
            if state in SUBMITTED:
                break
            sleep(10)
        b = asc.call("GET", f"/appStoreVersions/{vid}/build", missing_ok=True).get("data")
        got_build = b["attributes"]["version"] if b else None
        print(f"read back: state {state}, build {got_build}, releaseType {own.get('releaseType')}")
        if state not in SUBMITTED or str(got_build) != n or own.get("releaseType") != AFTER_APPROVAL:
            raise Refused(step, f"after submitting, {target} reads state {state}, build {got_build}, "
                          f"releaseType {own.get('releaseType')}.",
                          f"Apple may still be updating it: look at {target} in {ASC_PAGE}, then re-run the "
                          "App Store steps, which say 'nothing to do' once it reads Waiting for Review.")
        return 0, (f"Heart FC Coach {target} (build {n}) submitted for review; "
                   f"it releases automatically when Apple approves{' (phased over 7 days)' if phased else ''}.")
    except Refused as r:
        why_block(r.step, r.why, progress(), r.fix)
    except Exception as e:  # noqa: BLE001 — every failure after the upload ends in a WHY block (AC20)
        why_block(step, trim(e), progress(), "Read Apple's message above; fix it in App Store Connect or here, "
                  "then re-run the App Store steps (no new build needed).")
    except SystemExit as e:
        why_block(step, trim(e.code), progress(), "Fix what the message names, then re-run the App Store steps.")
    if "submitted" in done:
        return 1, (f"Uploaded to TestFlight (build {n}) and submitted for review, but not yet read back as "
                   "Waiting for Review: see WHY THIS JOB FAILED.")
    return 1, f"Uploaded to TestFlight (build {n}). Not submitted for review: see WHY THIS JOB FAILED."


def why_block(step, why, got_to, fix):
    print("==============================================================")
    print("WHY THIS JOB FAILED")
    print(f"  step:          {step}")
    print(f"  reason:        {why}")
    print(f"  got as far as: {got_to}")
    print(f"  fix:           {fix}")
    print("==============================================================")


def release_command(argv, asc_factory=None):
    """release BUNDLE_ID VERSION BUILD WHATS_NEW_FILE --screenshots FOLDER [--captions FILE]
       [--listing FOLDER] [--phased on|off] [--wait-minutes N] [--summary FILE] [--dry-run]"""
    args = argv[2:]
    if len(args) < 4:
        print(release_command.__doc__)
        return 2
    bundle_id, version, build, text_file = args[:4]
    rest = args[4:]
    opts = {"--listing": None, "--phased": "off", "--wait-minutes": "30", "--summary": None,
            "--screenshots": None, "--captions": None}
    dry = "--dry-run" in rest
    rest = [r for r in rest if r != "--dry-run"]
    for k, v in zip(rest[::2], rest[1::2]):
        if k not in opts:
            print(release_command.__doc__)
            return 2
        opts[k] = v
    if opts["--listing"] and not os.path.isdir(opts["--listing"]):
        print(f"WHY THIS JOB FAILED: no listing folder {opts['--listing']}")
        return 2
    if not opts["--screenshots"]:
        print("WHY THIS JOB FAILED: --screenshots FOLDER is required: a version is never submitted "
              "without the approved screenshots on it (#226).")
        return 2
    if opts["--phased"] not in ("on", "off"):
        print("--phased is on or off")
        return 2
    with open(text_file, encoding="utf-8") as f:
        text = f.read()
    asc = (asc_factory or Asc)(read_only=dry)
    code, line = release(asc, bundle_id, version, build, text, folder=opts["--listing"],
                         phased=opts["--phased"] == "on", dry_run=dry, wait_minutes=int(opts["--wait-minutes"]),
                         shots_folder=opts["--screenshots"], captions=opts["--captions"])
    print(line)
    if opts["--summary"]:
        with open(opts["--summary"], "w", encoding="utf-8") as f:
            f.write(line + "\n")
    return code


# ---------------------------------------------------------------------------
# TestFlight external testers (#234)
#
# After the upload and What to Test, the release build goes to the external
# group(s) named in store/testflight/groups.txt and, if Apple asks, to Beta
# App Review, so Rob's friends can install it without anyone opening App
# Store Connect. Apple's App Store Connect API, as documented
# (developer.apple.com/documentation/appstoreconnectapi):
#   GET   /v1/betaGroups?filter[app]&filter[name]           name, isInternalGroup ("List beta groups")
#   GET   /v1/builds?filter[app]&filter[preReleaseVersion.version]&filter[version]&filter[betaGroups]
#                                                           is this build in that group ("List builds")
#   GET   /v1/builds?...&filter[betaAppReviewSubmission.betaReviewState]=APPROVED
#                                                           has any build of this version passed review
#   GET   /v1/builds/{id}/buildBetaDetail                   externalBuildState (ExternalBetaState)
#   GET   /v1/builds/{id}/betaAppReviewSubmission           betaReviewState (BetaReviewState)
#   GET   /v1/builds/{id}/betaBuildLocalizations            What to Test (whatsNew)
#   GET   /v1/apps/{id}/betaAppLocalizations                description, feedbackEmail
#   GET   /v1/apps/{id}/betaAppReviewDetail                 the beta review contact
#   PATCH /v1/betaAppLocalizations/{id}, POST /v1/betaAppLocalizations   the description only
#   POST  /v1/betaGroups/{id}/relationships/builds          "Add builds to a beta group"
#   POST  /v1/betaAppReviewSubmissions                      "Submit an app for beta review"
# Never: betaTesters, betaTesterInvitations, a group's testers, the public
# link, an internal group, removing a build from a group, expiring a build,
# or creating, renaming or deleting a group (AC7). beta_write() refuses any
# other write before it is sent.
# ---------------------------------------------------------------------------

BETA_CONTACT = ("contactFirstName", "contactLastName", "contactPhone", "contactEmail")
BETA_CONTACT_WORDS = {"contactFirstName": "review contact first name", "contactLastName": "review contact last name",
                      "contactPhone": "review contact phone", "contactEmail": "review contact email"}
BETA_PENDING = {"WAITING_FOR_BETA_REVIEW", "IN_BETA_REVIEW"}
BETA_OPEN = {"BETA_APPROVED", "IN_BETA_TESTING", "READY_FOR_BETA_TESTING"}
BETA_DONE = BETA_PENDING | BETA_OPEN
BETA_DESCRIPTION_LIMIT = 4000
TESTFLIGHT_PAGE = "App Store Connect › Apps › Heart of the Game: Coach › TestFlight"
RERUN = "gh workflow run testflight.yml --ref main -f testflight_for=<this commit>"
BETA_WRITES = (("POST", re.compile(r"/betaGroups/[^/]+/relationships/builds")),
               ("POST", re.compile(r"/betaAppReviewSubmissions")),
               ("POST", re.compile(r"/betaAppLocalizations")),
               ("PATCH", re.compile(r"/betaAppLocalizations/[^/]+")))
TESTER_DATA = re.compile(r"betaTester|publicLink", re.IGNORECASE)


class ForbiddenWrite(RuntimeError):
    pass


def beta_allowed(method, path):
    """Whether a write is one this issue names (AC7)."""
    path = path.split("?")[0]
    if path.startswith(API):
        path = path[len(API):]
    return not TESTER_DATA.search(path) and any(m == method and rx.fullmatch(path) for m, rx in BETA_WRITES)


def beta_write(asc, method, path, body, external_ids):
    """The only way the beta steps write. Refuses, before sending, anything
    outside BETA_WRITES and a build added to any group not checked external."""
    group = re.fullmatch(r"/betaGroups/([^/]+)/relationships/builds", path)
    if not beta_allowed(method, path) or (group and group.group(1) not in external_ids):
        raise ForbiddenWrite(f"refused to send {method} {path}: not a write #234 allows")
    return asc.call(method, path, body)


def beta_groups(path):
    """The group names in groups.txt: one per line; blank lines and # comments ignored."""
    with open(path, encoding="utf-8") as fh:
        return [ln.strip() for ln in fh if ln.strip() and not ln.strip().startswith("#")]


def beta_problems(folder):
    """What is wrong with store/testflight/ (checked on every PR): at least
    one group name, none shaped like an email or an id; a description of 1
    to 4,000 characters, not the placeholder."""
    problems = []
    groups = os.path.join(folder, "groups.txt")
    if not os.path.exists(groups):
        problems.append(f"no {groups}")
    else:
        names = beta_groups(groups)
        if not names:
            problems.append("groups.txt names no group")
        for n in names:
            if "@" in n or re.fullmatch(r"[0-9a-f-]{8,}", n):
                problems.append("groups.txt holds something that is not a group name (an email or an id); "
                                "names only, no tester data (#234 AC5)")
    desc = os.path.join(folder, LOCALE, "beta_description.txt")
    text = open(desc, encoding="utf-8").read().strip() if os.path.exists(desc) else ""
    if not text or len(text) > BETA_DESCRIPTION_LIMIT or text.lower().startswith(PLACEHOLDER):
        problems.append(f"{LOCALE}/beta_description.txt is {len(text)} characters (or the placeholder); "
                        f"Apple needs 1 to {BETA_DESCRIPTION_LIMIT}")
    return problems


def decide_beta(names, groups, build, approved, info, description, build_number, target, dry_run=False,
                rerun=RERUN):
    """The TestFlight external plan, from what App Store Connect holds. Pure: no calls.

    names: the group names in groups.txt, in order.
    groups: {name: {"id", "internal"} or None if App Store Connect has no such group}.
    build: this build as Apple has it, {"processing", "expired", "external"
      (externalBuildState), "in_groups" [names], "review" (betaReviewState or
      None)}, or None if Apple does not have it (yet).
    approved: whether any build of this version has passed Beta App Review.
    info: {"locales": {locale: {"id", "description", "feedbackEmail" (bool)}},
      "contact": {field: bool}, "whats_new": bool, or None when this run sets it}.
    Returns {"outcome": "act" | "nothing" | "refuse", "lines", "steps":
    [(kind, value)], "review": "submit" | "if_asked" | "pending" | "none", "why", "fix"}.
    """
    n = str(build_number)

    def refuse(why, fix):
        return {"outcome": "refuse", "why": why, "fix": fix, "lines": lines, "steps": [], "review": None}

    lines, steps = [], []
    would = "would " if dry_run else ""
    for name in names:
        g = groups.get(name)
        if g is None:
            return refuse(f"there is no TestFlight group named '{name}' for this app; no group was created.",
                          f"Correct store/testflight/groups.txt in a pull request to the external group's exact "
                          f"name in {TESTFLIGHT_PAGE}.")
        if g["internal"]:
            return refuse(f"'{name}' is an internal TestFlight group; the run adds builds to external groups only.",
                          "Name an external group in store/testflight/groups.txt (a pull request).")

    if build is None:
        if not dry_run:
            return refuse(f"Apple has no build {n} of {target}, so there is nothing to add to a group.",
                          f"Check the upload; then run the TestFlight steps alone: {rerun}")
        lines.append(f"build {n}: uploaded by this run; processing and externalBuildState are checked after it")
        in_groups, external, review = [], None, None
    else:
        external, review = build.get("external"), build.get("review")
        lines.append(f"build {n}: processing {build.get('processing')}, externalBuildState {external}")
        if build.get("expired") or external == "EXPIRED":
            return refuse(f"build {n} of {target} has expired; it is never added to a group.",
                          "Upload a new build: raise the version (a patch).")
        if build.get("processing") == "PROCESSING" or external in ("PROCESSING", "IN_EXPORT_COMPLIANCE_REVIEW"):
            state = external if external in ("PROCESSING", "IN_EXPORT_COMPLIANCE_REVIEW") else "PROCESSING"
            return refuse(f"build {n} of {target} is still {state} after the wait; it was added to no group.",
                          f"Nothing is wrong yet: finish later, when Apple is done, with {rerun}")
        if build.get("processing") != "VALID":
            return refuse(f"build {n} of {target} is {build.get('processing')}, not VALID; it is never added to a group.",
                          "Read Apple's email about the build, then upload a new build (a patch).")
        if external in ("MISSING_EXPORT_COMPLIANCE", "PROCESSING_EXCEPTION"):
            return refuse(f"build {n} reads externalBuildState {external}; it is never added to a group.",
                          "Check ITSAppUsesNonExemptEncryption is false in app.json and the signed Info.plist, "
                          "then upload a new build.")
        if external == "BETA_REJECTED" or review == "REJECTED":
            return refuse(f"build {n} is BETA_REJECTED by Beta App Review; nothing was changed or resubmitted.",
                          f"Read Apple's email and {TESTFLIGHT_PAGE}; what happens next is its own issue (#234 AC11).")
        if external not in BETA_DONE | {"READY_FOR_BETA_SUBMISSION"}:
            return refuse(f"build {n} reads externalBuildState {external}, a state this job does not handle; "
                          "nothing was changed.", f"Look at build {n} in {TESTFLIGHT_PAGE} and raise an issue.")
        in_groups = list(build.get("in_groups") or [])

    for name in names:
        if name in in_groups:
            lines.append(f"group {name}: found, external, already holds build {n}")
        else:
            lines.append(f"group {name}: found, external, build {n} not in it: {'would add' if dry_run else 'adding'}")
            steps.append(("add", name))

    # Review: Apple's own state for this build decides; never a second submission.
    if build is None:
        need = "if_asked" if approved else "submit"
    elif review or external in BETA_DONE:
        need = "pending" if (external in BETA_PENDING or review in ("WAITING_FOR_REVIEW", "IN_REVIEW")) else "none"
    else:
        need = "if_asked" if approved else "submit"

    # Test Information (AC3): the description from the repo; the rest is Rob's, checked as present or empty.
    locs = info.get("locales") or {}
    mine = locs.get(LOCALE)
    if not mine or (mine.get("description") or "").strip() != description:
        steps.insert(0, ("description", mine["id"] if mine else None))
        lines.append(f"Test Information: beta description ({LOCALE}): {'would set' if dry_run else 'setting'} "
                     f"({len(description)} characters)")
    else:
        lines.append(f"Test Information: beta description ({LOCALE}): matches")
    gaps = [f"beta description ({loc})" for loc, x in sorted(locs.items())
            if loc != LOCALE and not (x.get("description") or "").strip()]
    feedback = bool(mine and mine.get("feedbackEmail"))
    lines.append(f"Test Information: feedback email: {'present' if feedback else 'empty'}")
    if not feedback:
        gaps.append("feedback email")
    for f_ in BETA_CONTACT:
        have = bool((info.get("contact") or {}).get(f_))
        lines.append(f"Test Information: {BETA_CONTACT_WORDS[f_]}: {'present' if have else 'empty'}")
        if not have:
            gaps.append(BETA_CONTACT_WORDS[f_])
    wtt = info.get("whats_new")
    lines.append(f"Test Information: What to Test ({LOCALE}): "
                 + ("set by this run" if wtt is None else "present" if wtt else "empty"))
    if wtt is False:
        gaps.append(f"What to Test ({LOCALE})")

    if need in ("submit", "if_asked") and gaps:
        if dry_run:
            lines.append("empty: would refuse")
        return refuse("empty in TestFlight's Test Information: " + ", ".join(gaps)
                      + "; Beta App Review needs it, so nothing was written.",
                      f"Rob types the feedback email and the review contact once in {TESTFLIGHT_PAGE} › "
                      "Test Information (What to Test: re-run with what_to_test_for=<this commit>); then " + rerun)
    if need == "submit":
        steps.append(("submit", None))
        lines.append(f"{would}submit for Beta App Review" if dry_run else "submitting for Beta App Review")
    elif need == "if_asked":
        steps.append(("submit_if_asked", None))
        lines.append(f"{target} already approved for external testing; no review expected "
                     "(submitted only if Apple still asks for one)")
    else:
        lines.append("no review needed" if need == "none" else f"Beta App Review: already {external}")

    if not steps:
        lines.append(f"build {n} is already in {', '.join(names)}, {external}; nothing to do")
        return {"outcome": "nothing", "lines": lines, "steps": [], "review": need, "why": None, "fix": None}
    return {"outcome": "act", "lines": lines, "steps": steps, "review": need, "why": None, "fix": None}


def read_groups(asc, app, names):
    out = {}
    for name in names:
        q = urllib.parse.urlencode({"filter[app]": app, "filter[name]": name, "limit": 200,
                                    "fields[betaGroups]": "name,isInternalGroup"})
        found = [g for g in asc.call("GET", f"/betaGroups?{q}")["data"] if g["attributes"].get("name") == name]
        out[name] = {"id": found[0]["id"], "internal": bool(found[0]["attributes"].get("isInternalGroup"))} \
            if found else None
    return out


def beta_state(asc, build_id):
    """(externalBuildState, betaReviewState or None) of one build."""
    d = asc.call("GET", f"/builds/{build_id}/buildBetaDetail", missing_ok=True).get("data")
    s = asc.call("GET", f"/builds/{build_id}/betaAppReviewSubmission", missing_ok=True).get("data")
    return (d or {}).get("attributes", {}).get("externalBuildState"), \
        ((s or {}).get("attributes") or {}).get("betaReviewState")


def in_group(asc, app, target, n, group_id):
    q = urllib.parse.urlencode({"filter[app]": app, "filter[preReleaseVersion.version]": target,
                                "filter[version]": n, "filter[betaGroups]": group_id, "limit": 1})
    return bool(asc.call("GET", f"/builds?{q}")["data"])


def read_beta_build(asc, app, target, n, groups, wait_minutes, sleep=time.sleep, clock=time.time):
    """(build id, build dict for decide_beta) once processed or after the wait; (None, None) if Apple has none."""
    deadline = clock() + wait_minutes * 60
    while True:
        found = asc.builds(app, target, n)
        b = found[0] if found else None
        ext, review = beta_state(asc, b["id"]) if b else (None, None)
        state = b["attributes"].get("processingState") if b else None
        busy = (not b or state == "PROCESSING" or ext in (None, "PROCESSING", "IN_EXPORT_COMPLIANCE_REVIEW"))
        if not busy or clock() >= deadline:
            break
        print(f"build {n}: {'not registered' if not b else f'{state}, {ext}'} yet; waiting 30s")
        sleep(30)
    if not b:
        return None, None
    a = b["attributes"]
    in_groups = [name for name, g in groups.items() if g and not g["internal"] and in_group(asc, app, target, n, g["id"])]
    return b["id"], {"processing": a.get("processingState"), "expired": a.get("expired"), "external": ext,
                     "in_groups": in_groups, "review": review}


def read_test_info(asc, app, build_id):
    """Test Information as decide_beta wants it: the description's text (it is
    ours, from the repo); everything of Rob's only as present or not (AC15)."""
    locales = {}
    for x in asc.call("GET", f"/apps/{app}/betaAppLocalizations")["data"]:
        a = x["attributes"]
        locales[a.get("locale")] = {"id": x["id"], "description": a.get("description") or "",
                                    "feedbackEmail": bool((a.get("feedbackEmail") or "").strip())}
    d = asc.call("GET", f"/apps/{app}/betaAppReviewDetail", missing_ok=True).get("data")
    contact = {f_: bool(str(((d or {}).get("attributes") or {}).get(f_) or "").strip()) for f_ in BETA_CONTACT}
    wtt = None
    if build_id:
        wtt = any(x["attributes"].get("locale") == LOCALE and (x["attributes"].get("whatsNew") or "").strip()
                  for x in asc.call("GET", f"/builds/{build_id}/betaBuildLocalizations")["data"])
    return {"locales": locales, "contact": contact, "whats_new": wtt}


def version_beta_approved(asc, app, target):
    q = urllib.parse.urlencode({"filter[app]": app, "filter[preReleaseVersion.version]": target,
                                "filter[betaAppReviewSubmission.betaReviewState]": "APPROVED", "limit": 1})
    return bool(asc.call("GET", f"/builds?{q}")["data"])


def beta(asc, bundle_id, target, build_number, names, description, dry_run=False, wait_minutes=30,
         sleep=time.sleep, clock=time.time, rerun=RERUN):
    """Add build_number of target to the external groups `names`, set the beta
    description, and submit it for Beta App Review if Apple asks (#234).
    Returns (exit code, one-line summary)."""
    n = str(build_number)
    done = []
    description = (description or "").strip()

    def progress():
        return ", ".join(done) + ("" if "submitted for Beta App Review" in done else
                                  ", not submitted for Beta App Review") if done else "nothing changed in TestFlight"

    step = "read App Store Connect"
    try:
        app = asc.app_id(bundle_id)
        step = "find the TestFlight groups"
        groups = read_groups(asc, app, names)
        step = "wait for Apple to process the build"
        build_id, build = read_beta_build(asc, app, target, n, groups, 0 if dry_run else wait_minutes, sleep, clock)
        step = "read the beta Test Information"
        info = read_test_info(asc, app, build_id)
        if build is None and not dry_run:
            info["whats_new"] = False
        approved = version_beta_approved(asc, app, target)
        plan = decide_beta(names, groups, build, approved, info, description, n, target, dry_run, rerun)
        print("--- TestFlight plan" + (" (dry run: nothing will be changed)" if dry_run else "") + " ---")
        for ln in plan["lines"]:
            print(ln)
        if plan["outcome"] == "refuse":
            raise Refused("check what TestFlight holds", plan["why"], plan["fix"])
        if plan["outcome"] == "nothing":
            ext = build["external"]
            return 0, f"TestFlight: build {n} in {', '.join(names)}, {ext}; nothing to do."
        if dry_run:
            print("Dry run: nothing was changed in TestFlight.")
            what = {"submit": "submitted for Beta App Review", "if_asked": "made available (no review expected)"}
            return 0, (f"Dry run: TestFlight build {n} would be added to {', '.join(names)} and "
                       f"{what.get(plan['review'], 'needs no review')}.")

        external_ids = {groups[x]["id"] for x in names}
        submitted = False
        for kind, value in plan["steps"]:
            step = kind
            if kind == "description":
                if value:
                    beta_write(asc, "PATCH", f"/betaAppLocalizations/{value}", {"data": {
                        "type": "betaAppLocalizations", "id": value, "attributes": {"description": description}}},
                        external_ids)
                else:
                    beta_write(asc, "POST", "/betaAppLocalizations", {"data": {
                        "type": "betaAppLocalizations", "attributes": {"locale": LOCALE, "description": description},
                        "relationships": {"app": {"data": {"type": "apps", "id": app}}}}}, external_ids)
                done.append("beta description set")
            elif kind == "add":
                beta_write(asc, "POST", f"/betaGroups/{groups[value]['id']}/relationships/builds",
                           {"data": [{"type": "builds", "id": build_id}]}, external_ids)
                print(f"build {n} added to {value}")
                done.append(f"build {n} added to {value}")
            elif kind in ("submit", "submit_if_asked"):
                ext, review = beta_state(asc, build_id)   # Apple may have approved it on adding
                if review or ext != "READY_FOR_BETA_SUBMISSION":
                    print(f"{target} already approved for external testing; build {n} added, no review needed"
                          if ext in BETA_OPEN else f"build {n} is {ext}; no submission made")
                    continue
                beta_write(asc, "POST", "/betaAppReviewSubmissions", {"data": {
                    "type": "betaAppReviewSubmissions",
                    "relationships": {"build": {"data": {"type": "builds", "id": build_id}}}}}, external_ids)
                submitted = True
                done.append("submitted for Beta App Review")
                print(f"Apple still asks for a Beta App Review of build {n}: submitted" if kind == "submit_if_asked"
                      else f"build {n} submitted for Beta App Review")

        step = "read back"
        for _ in range(12):
            ext, review = beta_state(asc, build_id)
            if ext in BETA_DONE:
                break
            sleep(10)
        missing = [x for x in names if not in_group(asc, app, target, n, groups[x]["id"])]
        for x in names:
            if x not in missing:
                print(f"read back: build {n} is in {x}")
        print(f"read back: externalBuildState {ext}" + (f", Beta App Review {review}" if review else ""))
        if missing or ext not in BETA_DONE:
            raise Refused(step, f"after the beta steps, build {n} reads externalBuildState {ext}"
                          + (f" and is not in {', '.join(missing)}" if missing else "") + ".",
                          f"Apple may still be updating it: look at {TESTFLIGHT_PAGE}, then {rerun}")
        if submitted:
            return 0, (f"TestFlight: Heart FC Coach {target} (build {n}) added to {', '.join(names)}; submitted for "
                       "Beta App Review. Testers can install it once Apple approves.")
        return 0, f"TestFlight: build {n} in {', '.join(names)}, {ext}."
    except Refused as r:
        why_block(r.step, r.why, progress(), r.fix)
    except Exception as e:  # noqa: BLE001 — every beta failure ends in a WHY block (AC14)
        why_block(step, trim(e), progress(), f"Read Apple's message above; fix it in {TESTFLIGHT_PAGE} or here, "
                  f"then {rerun}")
    except SystemExit as e:
        why_block(step, trim(e.code), progress(), f"Fix what the message names, then {rerun}")
    return 1, f"Uploaded to TestFlight (build {n}). Not available to external testers: see WHY THIS JOB FAILED."


def beta_command(argv, asc_factory=None):
    """beta BUNDLE_ID VERSION BUILD --groups FILE --description FILE
       [--wait-minutes N] [--summary FILE] [--rerun CMD] [--dry-run]"""
    args = argv[2:]
    if len(args) < 3:
        print(beta_command.__doc__)
        return 2
    bundle_id, version, build = args[:3]
    rest = [r for r in args[3:] if r != "--dry-run"]
    dry = "--dry-run" in args[3:]
    opts = {"--groups": None, "--description": None, "--wait-minutes": "30", "--summary": None, "--rerun": RERUN}
    for k, v in zip(rest[::2], rest[1::2]):
        if k not in opts:
            print(beta_command.__doc__)
            return 2
        opts[k] = v
    if not opts["--groups"] or not opts["--description"]:
        print("WHY THIS JOB FAILED: --groups and --description are required (store/testflight/).")
        return 2
    names = beta_groups(opts["--groups"])
    with open(opts["--description"], encoding="utf-8") as fh:
        description = fh.read()
    asc = (asc_factory or Asc)(read_only=dry)
    code, line = beta(asc, bundle_id, version, build, names, description, dry_run=dry,
                      wait_minutes=int(opts["--wait-minutes"]), rerun=opts["--rerun"])
    print(line)
    if opts["--summary"]:
        with open(opts["--summary"], "w", encoding="utf-8") as fh:
            fh.write(line + "\n")
    return code


class FakeBeta(Asc):
    """A fake App Store Connect's TestFlight side: Apple's documented beta
    endpoints over an in-memory store, behind the real client's read-only
    guard. Made-up groups only, and no tester records at all: any tester or
    public-link endpoint, and adding a build to an internal group, is an error.
    groups: {name: isInternalGroup}. approve_on_add: Apple approves a later
    build of an approved version when it is added to a group (P2's open question)."""

    def __init__(self, builds, groups=None, locs=None, contact=None, approve_on_add=False, read_only=False):
        self.read_only, self.jwt, self.sent = read_only, "unused", []
        self.groups = {f"G{i + 1}": {"name": k, "internal": v} for i, (k, v) in
                       enumerate((groups or {"Externals": False, "Team (Expected)": True}).items())}
        self.b = {f"B{i}": dict(x, groups=list(x.get("groups", []))) for i, x in enumerate(builds)}
        self.locs = {f"BL{i + 1}": dict(v, locale=k) for i, (k, v) in enumerate(
            (locs if locs is not None else {LOCALE: {"description": "", "feedbackEmail": "ann@x.example"}}).items())}
        self.contact = contact if contact is not None else {
            "contactFirstName": "Ann", "contactLastName": "Example", "contactPhone": "07700 900000",
            "contactEmail": "ann@x.example"}
        self.approve_on_add = approve_on_add

    def send(self, method, url, body):
        path, _, query = url[len(API):].partition("?")
        q = dict(urllib.parse.parse_qsl(query))
        self.sent.append((method, path))
        if TESTER_DATA.search(path):
            raise RuntimeError(f"fake App Store Connect: {method} {path} touches testers or the public link")
        p = path.strip("/").split("/")
        data = (body or {}).get("data", {})
        if method == "GET":
            if path == "/apps":
                return 200, {"data": [{"id": "APP"}]}
            if path == "/betaGroups":
                return 200, {"data": [{"id": k, "attributes": {"name": g["name"], "isInternalGroup": g["internal"]}}
                                      for k, g in self.groups.items() if g["name"] == q.get("filter[name]")]}
            if path == "/builds":
                out = []
                for k, x in self.b.items():
                    if x["pre"] != q.get("filter[preReleaseVersion.version]") or \
                            q.get("filter[version]") not in (None, x["n"]):
                        continue
                    if "filter[betaGroups]" in q and q["filter[betaGroups]"] not in x["groups"]:
                        continue
                    if q.get("filter[betaAppReviewSubmission.betaReviewState]") not in (None, x["review"]):
                        continue
                    out.append({"id": k, "attributes": {"version": x["n"], "processingState": x["processing"],
                                                        "expired": x["expired"], "usesNonExemptEncryption": False}})
                return 200, {"data": out}
            if p[0] == "builds" and p[2] == "buildBetaDetail":
                return 200, {"data": {"id": p[1], "attributes": {"externalBuildState": self.b[p[1]]["external"]}}}
            if p[0] == "builds" and p[2] == "betaAppReviewSubmission":
                r = self.b[p[1]]["review"]
                return 200, {"data": {"id": "R" + p[1], "attributes": {"betaReviewState": r}} if r else None}
            if p[0] == "builds" and p[2] == "betaBuildLocalizations":
                w = self.b[p[1]]["whatsNew"]
                return 200, {"data": [{"id": "W", "attributes": {"locale": LOCALE, "whatsNew": w}}] if w else []}
            if p[0] == "apps" and p[2] == "betaAppLocalizations":
                return 200, {"data": [{"id": k, "attributes": dict(v)} for k, v in self.locs.items()]}
            if p[0] == "apps" and p[2] == "betaAppReviewDetail":
                return 200, {"data": {"id": "D", "attributes": dict(self.contact)}}
        if method == "PATCH" and p[0] == "betaAppLocalizations":
            self.locs[p[1]].update(data["attributes"])
            return 200, {"data": {"id": p[1]}}
        if method == "POST" and path == "/betaAppLocalizations":
            k = f"BL{len(self.locs) + 1}"
            self.locs[k] = dict(data["attributes"])
            return 201, {"data": {"id": k}}
        if method == "POST" and p[0] == "betaGroups" and p[2:] == ["relationships", "builds"]:
            g = self.groups[p[1]]
            if g["internal"]:
                raise RuntimeError(f"fake App Store Connect: build added to internal group {g['name']}")
            for x in data:
                b = self.b[x["id"]]
                if p[1] not in b["groups"]:
                    b["groups"].append(p[1])
                if self.approve_on_add and any(o["review"] == "APPROVED" and o["pre"] == b["pre"]
                                               for o in self.b.values()):
                    b["external"] = "IN_BETA_TESTING"
            return 204, {}
        if method == "POST" and path == "/betaAppReviewSubmissions":
            b = self.b[data["relationships"]["build"]["data"]["id"]]
            if b["review"]:
                raise RuntimeError("fake App Store Connect: HTTP 409 this build already has a submission")
            b["review"], b["external"] = "WAITING_FOR_REVIEW", "WAITING_FOR_BETA_REVIEW"
            return 201, {"data": {"id": "R"}}
        raise RuntimeError(f"fake App Store Connect has no route for {method} {path}")

    def writes(self):
        return [f"{m} {p}" for m, p in self.sent if m in self.WRITES]


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def max_build(bundle_id, version):
    asc = Asc()
    app = asc.app_id(bundle_id)
    print(highest(b["attributes"]["version"] for b in asc.builds(app, version)))
    return 0


def what_to_test(bundle_id, version, build, text_file, wait_minutes=20):
    with open(text_file, encoding="utf-8") as f:
        text = f.read()[:4000]
    try:
        asc = Asc()
        app = asc.app_id(bundle_id)
        found = []
        deadline = time.time() + wait_minutes * 60
        while not found and time.time() < deadline:
            found = asc.builds(app, version, build)
            if not found:
                print(f"Apple has not registered {version} ({build}) yet; waiting 30s")
                time.sleep(30)
        if not found:
            print(f"warning: {version} ({build}) did not appear within {wait_minutes} min; "
                  "What to Test was not set. Paste it in App Store Connect › TestFlight.")
            return 0
        build_id = found[0]["id"]
        existing = asc.call("GET", f"/builds/{build_id}/betaBuildLocalizations")["data"]
        mine = [x for x in existing if x["attributes"].get("locale") == LOCALE]
        if mine:
            asc.call("PATCH", f"/betaBuildLocalizations/{mine[0]['id']}",
                     {"data": {"type": "betaBuildLocalizations", "id": mine[0]["id"],
                               "attributes": {"whatsNew": text}}})
        else:
            asc.call("POST", "/betaBuildLocalizations",
                     {"data": {"type": "betaBuildLocalizations",
                               "attributes": {"locale": LOCALE, "whatsNew": text},
                               "relationships": {"build": {"data": {"type": "builds", "id": build_id}}}}})
        back = asc.call("GET", f"/builds/{build_id}/betaBuildLocalizations")["data"]
        ok = any(x["attributes"].get("locale") == LOCALE and x["attributes"].get("whatsNew") == text for x in back)
        print(f"What to Test for {version} ({build}): {'set and read back' if ok else 'set, but the read-back differs'} "
              f"({len(text)} characters, {LOCALE})")
    except (RuntimeError, OSError, KeyError, subprocess.CalledProcessError) as e:
        print(f"warning: What to Test was not set ({e}). The upload itself succeeded.")
    return 0


# ---------------------------------------------------------------------------
# A fake App Store Connect for the self-test: Apple's documented endpoints over
# an in-memory store, behind the real client's read-only guard. One assumption
# is Apple's, not ours: a new version starts with the previous version's
# en-GB page and screenshots, as App Store Connect does when a version is
# added. If the API does not copy them, the page check refuses (AC5) and the
# first real run says so.
# ---------------------------------------------------------------------------

FULL_PAGE = {"description": "A coach's app.", "keywords": "heart,football", "supportUrl": "https://x.example/s"}
FULL_SHOTS = {"APP_IPHONE_67": 7, "APP_IPAD_PRO_3GEN_129": 7}


class FakeAsc(Asc):
    def __init__(self, versions, builds, submissions=(), read_only=False, info=None, info_on_create=True):
        """info: the live app info's en-GB fields (name, subtitle, privacyPolicyUrl).
        info_on_create: whether creating a version also makes an editable app
        info, as App Store Connect does when a new version is added (assumed)."""
        self.read_only, self.jwt, self.sent, self.ids = read_only, "unused", [], 0
        self.shot_ids, self.uploaded, self.shot_writes = 0, {}, []
        # #226 run 40049619707: how Apple reads a screenshot back after the
        # upload is committed. None: COMPLETE at once with our checksum.
        # {"reads": n, "checksum": "ours"|"none"|"other", "state": "COMPLETE"|"FAILED"}:
        # UPLOAD_COMPLETE with a null checksum for n reads, then that.
        self.shot_processing = None
        self.v, self.locs, self.b, self.subs, self.review = {}, {}, {}, {}, {}
        self.infos = {"I0": {"attrs": {"appStoreState": "READY_FOR_SALE"}, "loc": dict(info or {}, locale=LOCALE)}}
        self.info_on_create = info_on_create
        for n, (number, pre, state, enc) in enumerate(builds):
            self.b[f"B{n}"] = {"version": str(number), "pre": pre, "processingState": state,
                               "usesNonExemptEncryption": enc, "expired": False}
        for spec in versions:
            self.add_version(spec)
        for state, version in submissions:
            vid = next(k for k, x in self.v.items() if x["versionString"] == version)
            self.subs[self.new_id("S")] = {"state": state, "items": [vid]}

    def new_id(self, prefix):
        self.ids += 1
        return f"{prefix}{self.ids}"

    def add_version(self, spec):
        vid = self.new_id("V")
        build = next((k for k, x in self.b.items() if x["version"] == str(spec.get("build")) and
                      x["pre"] == spec["version"]), None)
        self.v[vid] = {"versionString": spec["version"], "appVersionState": spec["state"],
                       "releaseType": spec.get("releaseType", "MANUAL"), "build": build, "phased": None}
        self.review[vid] = {"notes": spec.get("notes", "")}
        loc = self.new_id("L")
        self.locs[loc] = {"version": vid, "attrs": dict(spec.get("page", FULL_PAGE), locale=LOCALE,
                                                        whatsNew=spec.get("whatsNew")),
                          "shots": {d: self.shots_from(x) for d, x in spec.get("shots", FULL_SHOTS).items()}}
        return vid

    def shots_from(self, spec):
        """A display's set: a count of old shots, or [(file name, md5)], or a set to copy."""
        if isinstance(spec, int):
            spec = [(f"old-{i}.png", f"old{i}") for i in range(spec)]
        out = []
        for x in spec:
            name, checksum, *state = (x["fileName"], x["sourceFileChecksum"], x["state"]) if isinstance(x, dict) else x
            self.shot_ids += 1
            out.append({"id": f"SS{self.shot_ids}", "fileName": name, "sourceFileChecksum": checksum,
                        "state": state[0] if state else "COMPLETE"})
        return out

    def shot(self, shot_id):
        for loc, x in self.locs.items():
            for d, shots in x["shots"].items():
                for s in shots:
                    if s["id"] == shot_id:
                        return loc, d, s
        raise RuntimeError(f"fake App Store Connect has no screenshot {shot_id}")

    def touch(self, loc):
        """Note a screenshot write that lands on a version not editable at that moment."""
        if self.v[self.locs[loc]["version"]]["appVersionState"] not in EDITABLE:
            self.shot_writes.append(loc)

    def live_shot_writes(self):
        """Screenshot writes that landed on a version that was not editable (AC14, QA R1)."""
        return list(self.shot_writes)

    def upload(self, op, part):
        if self.read_only:
            raise ReadOnlyViolation("dry run: refused to upload a screenshot")
        self.sent.append(("PUT", "/upload"))
        self.uploaded[op["url"]] = self.uploaded.get(op["url"], b"") + part

    def send(self, method, url, body):
        path, _, query = url[len(API):].partition("?")
        q = dict(urllib.parse.parse_qsl(query))
        self.sent.append((method, path))
        p = path.strip("/").split("/")
        data = (body or {}).get("data", {})
        attrs = data.get("attributes", {})
        if method == "GET":
            if path == "/apps":
                return 200, {"data": [{"id": "APP"}]}
            if p[0] == "apps" and p[2] == "appStoreVersions":
                return 200, {"data": [{"id": k, "attributes": {a: x[a] for a in
                             ("versionString", "appVersionState", "releaseType")}} for k, x in self.v.items()
                             if q.get("filter[versionString]") in (None, x["versionString"])]}
            if p[0] == "apps" and p[2] == "appInfos":
                return 200, {"data": [{"id": k, "attributes": dict(x["attrs"])} for k, x in self.infos.items()]}
            if p[0] == "appInfos" and p[2] == "ageRatingDeclaration":
                return 200, {"data": {"id": "AR", "attributes": {"gambling": False, "violenceRealistic": "NONE"}}}
            if p[0] == "appInfos" and p[2] == "appInfoLocalizations":
                return 200, {"data": [{"id": "L" + p[1], "attributes": dict(self.infos[p[1]]["loc"])}]}
            if p[0] == "appStoreVersions" and len(p) > 2 and p[2] == "appStoreReviewDetail":
                return 200, {"data": {"id": f"R~{p[1]}", "attributes": dict(self.review[p[1]])}}
            if path == "/builds":
                return 200, {"data": [{"id": k, "attributes": {a: x[a] for a in
                             ("version", "processingState", "usesNonExemptEncryption", "expired")}}
                             for k, x in self.b.items() if x["pre"] == q.get("filter[preReleaseVersion.version]")
                             and q.get("filter[version]") in (None, x["version"])]}
            if p[0] == "appStoreVersions" and len(p) == 2:
                return 200, {"data": {"id": p[1], "attributes": {a: x for a, x in self.v[p[1]].items()
                                                                 if a not in ("build", "phased")}}}
            if p[0] == "appStoreVersions" and p[2] == "build":
                b = self.v[p[1]]["build"]
                return 200, {"data": {"id": b, "attributes": {"version": self.b[b]["version"]}} if b else None}
            if p[0] == "appStoreVersions" and p[2] == "appStoreVersionPhasedRelease":
                ph = self.v[p[1]]["phased"]
                return 200, {"data": {"id": ph, "attributes": {"phasedReleaseState": "INACTIVE"}} if ph else None}
            if p[0] == "appStoreVersions" and p[2] == "appStoreVersionLocalizations":
                return 200, {"data": [{"id": k, "attributes": dict(x["attrs"])}
                                      for k, x in self.locs.items() if x["version"] == p[1]]}
            if p[0] == "appStoreVersionLocalizations" and p[2] == "appScreenshotSets":
                return 200, {"data": [{"id": f"{p[1]}~{d}", "attributes": {"screenshotDisplayType": d}}
                                      for d in self.locs[p[1]]["shots"]]}
            if p[0] == "appScreenshotSets":
                loc, d = p[1].split("~")
                for x in self.locs[loc]["shots"][d]:
                    if x.get("pending"):
                        x["pending"][0] -= 1
                        if x["pending"][0] <= 0:
                            _, x["state"], x["sourceFileChecksum"] = x.pop("pending")
                return 200, {"data": [{"id": x["id"], "attributes": {
                    "fileName": x["fileName"], "sourceFileChecksum": x["sourceFileChecksum"],
                    "assetDeliveryState": {"state": x["state"]}}} for x in self.locs[loc]["shots"][d]]}
            if path == "/reviewSubmissions":
                wanted = q.get("filter[state]", "").split(",")
                return 200, {"data": [{"id": k, "attributes": {"state": x["state"]}}
                                      for k, x in self.subs.items() if x["state"] in wanted]}
            if p[0] == "reviewSubmissions" and p[2] == "items":
                return 200, {"data": [{"id": f"{p[1]}-{v}", "relationships": {"appStoreVersion": {
                    "data": {"type": "appStoreVersions", "id": v}}}} for v in self.subs[p[1]]["items"]]}
        if method == "POST" and path == "/appStoreVersions":
            live = next((x for x in self.locs.values()
                         if self.v[x["version"]]["appVersionState"] == "READY_FOR_DISTRIBUTION"), None)
            vid = self.add_version({"version": attrs["versionString"], "state": "PREPARE_FOR_SUBMISSION",
                                    "releaseType": attrs.get("releaseType"),
                                    "page": {k: v for k, v in (live or {"attrs": {}})["attrs"].items()
                                             if k in FULL_PAGE},
                                    "shots": {d: [dict(x) for x in shots]
                                              for d, shots in (live or {}).get("shots", {}).items()}})
            if self.info_on_create:
                self.infos[f"I{len(self.infos)}"] = {"attrs": {"state": "PREPARE_FOR_SUBMISSION"},
                                                "loc": dict(self.infos["I0"]["loc"])}
            return 201, {"data": {"id": vid}}
        if method == "POST" and path == "/appScreenshotSets":
            loc = data["relationships"]["appStoreVersionLocalization"]["data"]["id"]
            self.touch(loc)
            self.locs[loc]["shots"].setdefault(attrs["screenshotDisplayType"], [])
            return 201, {"data": {"id": f"{loc}~{attrs['screenshotDisplayType']}"}}
        if method == "DELETE" and p[0] == "appScreenshots":
            loc, d, x = self.shot(p[1])
            self.touch(loc)
            self.locs[loc]["shots"][d].remove(x)
            return 204, {}
        if method == "POST" and path == "/appScreenshots":
            loc, d = data["relationships"]["appScreenshotSet"]["data"]["id"].split("~")
            self.touch(loc)
            self.shot_ids += 1
            sid, size = f"SS{self.shot_ids}", attrs["fileSize"]
            self.locs[loc]["shots"][d].append({"id": sid, "fileName": attrs["fileName"],
                                               "sourceFileChecksum": None, "state": "AWAITING_UPLOAD"})
            half = size // 2
            ops = [{"url": f"https://upload.example/{sid}", "method": "PUT", "offset": 0, "length": half},
                   {"url": f"https://upload.example/{sid}", "method": "PUT", "offset": half, "length": size - half}]
            return 201, {"data": {"id": sid, "attributes": {"uploadOperations": ops}}}
        if method == "PATCH" and p[0] == "appScreenshots":
            loc, d, x = self.shot(p[1])
            self.touch(loc)
            got = self.uploaded.get(f"https://upload.example/{p[1]}", b"")
            x["sourceFileChecksum"] = attrs["sourceFileChecksum"]
            x["state"] = "COMPLETE" if hashlib.md5(got).hexdigest() == attrs["sourceFileChecksum"] else "FAILED"
            mode = self.shot_processing
            if mode:
                final = {"ours": x["sourceFileChecksum"], "none": None, "other": "0" * 32}[mode["checksum"]]
                x["pending"] = [mode["reads"], mode.get("state", x["state"]), final]
                x["state"], x["sourceFileChecksum"] = "UPLOAD_COMPLETE", None
            return 200, {"data": {"id": p[1]}}
        if method == "PATCH" and p[0] == "appStoreVersions" and len(p) == 2:
            self.v[p[1]].update(attrs)
            return 200, {"data": {"id": p[1]}}
        if method == "PATCH" and p[0] == "appStoreVersions" and p[3] == "build":
            self.v[p[1]]["build"] = data["id"]
            return 204, {}
        if method == "POST" and path == "/appStoreVersionPhasedReleases":
            self.v[data["relationships"]["appStoreVersion"]["data"]["id"]]["phased"] = self.new_id("P")
            return 201, {"data": {"id": "P"}}
        if method == "DELETE" and p[0] == "appStoreVersionPhasedReleases":
            for x in self.v.values():
                if x["phased"] == p[1]:
                    x["phased"] = None
            return 204, {}
        if method == "PATCH" and p[0] == "appInfoLocalizations":
            self.infos[p[1][1:]]["loc"].update(attrs)
            return 200, {"data": {"id": p[1]}}
        if method == "PATCH" and p[0] == "appStoreReviewDetails":
            self.review[p[1].split("~")[1]].update(attrs)
            return 200, {"data": {"id": p[1]}}
        if method == "PATCH" and p[0] == "appStoreVersionLocalizations":
            self.locs[p[1]]["attrs"].update(attrs)
            return 200, {"data": {"id": p[1]}}
        if method == "POST" and path == "/reviewSubmissions":
            sid = self.new_id("S")
            self.subs[sid] = {"state": "READY_FOR_REVIEW", "items": []}
            return 201, {"data": {"id": sid, "attributes": {"state": "READY_FOR_REVIEW"}}}
        if method == "POST" and path == "/reviewSubmissionItems":
            rel = data["relationships"]
            vid = rel["appStoreVersion"]["data"]["id"]
            self.subs[rel["reviewSubmission"]["data"]["id"]]["items"].append(vid)
            self.v[vid]["appVersionState"] = "READY_FOR_REVIEW"
            return 201, {"data": {"id": "I"}}
        if method == "PATCH" and p[0] == "reviewSubmissions" and attrs.get("submitted"):
            self.subs[p[1]]["state"] = "WAITING_FOR_REVIEW"
            for vid in self.subs[p[1]]["items"]:
                self.v[vid]["appVersionState"] = "WAITING_FOR_REVIEW"
            return 200, {"data": {"id": p[1]}}
        raise RuntimeError(f"fake App Store Connect has no route for {method} {path}")

    def writes(self):
        return [f"{m} {p}" for m, p in self.sent if m in self.WRITES]


# ---------------------------------------------------------------------------
# Self-test: healthy cases first
# ---------------------------------------------------------------------------

def self_test():
    failed = total = 0

    def expect(name, ok):
        nonlocal failed, total
        print(f"  {'ok' if ok else 'x '} {name}")
        failed += not ok
        total += 1

    with tempfile.TemporaryDirectory() as d:
        key = os.path.join(d, "k.p8")
        gen = subprocess.run("openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt",
                             shell=True, capture_output=True, check=True).stdout
        with open(key, "wb") as f:
            f.write(gen)
        jwt = token("KEYID12345", "issuer-uuid", key, now=1_000_000)
        h, p, s = jwt.split(".")
        pad = lambda x: x + "=" * (-len(x) % 4)  # noqa: E731
        header = json.loads(base64.urlsafe_b64decode(pad(h)))
        payload = json.loads(base64.urlsafe_b64decode(pad(p)))
        sig = base64.urlsafe_b64decode(pad(s))
        expect("healthy: the token is ES256 with the key id",
               header == {"alg": "ES256", "kid": "KEYID12345", "typ": "JWT"})
        expect("healthy: issuer, audience and a 15-minute life",
               payload == {"iss": "issuer-uuid", "iat": 1_000_000, "exp": 1_000_900, "aud": "appstoreconnect-v1"})
        expect("healthy: the signature is 64 raw bytes", len(sig) == 64)
        # The raw signature verifies against the key, re-encoded as DER for openssl.
        r, s_ = sig[:32], sig[32:]
        enc = lambda x: b"\x02" + bytes([len(x)]) + x  # noqa: E731
        norm = lambda x: (b"\x00" + x.lstrip(b"\x00")) if x.lstrip(b"\x00")[:1] >= b"\x80" else x.lstrip(b"\x00")  # noqa: E731
        der = enc(norm(r)) + enc(norm(s_))
        der = b"\x30" + bytes([len(der)]) + der
        with open(os.path.join(d, "sig.der"), "wb") as f:
            f.write(der)
        pub = os.path.join(d, "pub.pem")
        subprocess.run(["openssl", "pkey", "-in", key, "-pubout", "-out", pub], check=True, capture_output=True)
        v = subprocess.run(["openssl", "dgst", "-sha256", "-verify", pub, "-signature", os.path.join(d, "sig.der")],
                           input=f"{h}.{p}".encode(), capture_output=True)
        expect("healthy: the signature verifies against the key", v.returncode == 0)

    expect("healthy: highest of Apple's build numbers", highest(["301", "401", "99"]) == 401)
    expect("no builds yet is 0", highest([]) == 0)
    expect("dotted numbers compare by their first part", highest(["4.2", "130"]) == 130)
    want = {("info", "name"): "Heart of the Game: Coach", ("version", "keywords"): "heart,football"}
    expect("healthy: nothing to change when App Store Connect matches",
           listing_diff(want, dict(want)) == [])
    expect("a changed field is listed once, with both values",
           listing_diff(want, {("info", "name"): "Old"}) ==
           [("info", "name", "Old", "Heart of the Game: Coach"), ("version", "keywords", None, "heart,football")])
    with tempfile.TemporaryDirectory() as d:
        open(os.path.join(d, "copyright.txt"), "w").write("2026 Someone\n")
        expect("the copyright goes to the version itself, not a localisation",
               listing_wanted(d) == {("appversion", "copyright"): "2026 Someone"})
    with tempfile.TemporaryDirectory() as d:
        for sub, names in (("iphone", ["02-b.png", "01-a.png", "notes.txt"]), ("ipad", ["01-a.png"])):
            os.makedirs(os.path.join(d, sub))
            for n in names:
                open(os.path.join(d, sub, n), "w").close()
        plan = screenshot_plan(d)
        expect("healthy: screenshots go to the 6.9\" and 13\" sets, in file-name order, PNGs only",
               [os.path.basename(f) for f in plan.get("APP_IPHONE_67", [])] == ["01-a.png", "02-b.png"]
               and len(plan.get("APP_IPAD_PRO_3GEN_129", [])) == 1 and len(plan) == 2)
    ops = [{"offset": 0, "length": 3}, {"offset": 3, "length": 2}]
    expect("healthy: the upload is cut exactly as Apple's operations say",
           [p for _, p in chunks(b"abcde", ops)] == [b"abc", b"de"])
    try:
        der_to_raw(b"\x31\x00")
        expect("a malformed signature is refused", False)
    except ValueError:
        expect("a malformed signature is refused", True)

    # ----- #226: release on approval. Healthy cases first (AC23). -----
    live = {"id": "V0", "version": "1.0.1", "state": "READY_FOR_DISTRIBUTION", "releaseType": "MANUAL",
            "build": None, "phased": False}
    ok_build = {"processing": "VALID", "encryption": False, "expired": False}
    text = "Tables sort by their numbers.\nNames go in one after another."

    def kinds(plan):
        return [k for k, _ in plan["steps"]]

    a = decide([live], "1.3.0", 412, ok_build, text)
    expect("healthy (a): no 1.3.0 yet: create, attach 412, after approval, What's New, submit",
           a["outcome"] == "act"
           and kinds(a) == ["create", "attach", "listing", "whats_new", "check_page", "submit"]
           and f"release type: (new) -> {AFTER_APPROVAL}" in a["lines"] and "submitting for review" in a["lines"])
    hand = dict(live, id="V3", version="1.3.0", state="PREPARE_FOR_SUBMISSION", releaseType="MANUAL")
    b_ = decide([live, hand], "1.3.0", 412, ok_build, text)
    expect("healthy (b): 1.3.0 made by hand, Manual: reused, MANUAL -> AFTER_APPROVAL, nothing created",
           b_["outcome"] == "act" and b_["version_id"] == "V3" and "create" not in kinds(b_)
           and kinds(b_)[0] == "release_type" and "release type: MANUAL -> AFTER_APPROVAL" in b_["lines"])
    waiting = dict(hand, state="WAITING_FOR_REVIEW", releaseType=AFTER_APPROVAL, build="412")
    c = decide([live, waiting], "1.3.0", 412, ok_build, text)
    expect("healthy (c): 1.3.0 already Waiting for Review with 412: nothing to do, success",
           c["outcome"] == "nothing" and c["steps"] == []
           and c["lines"] == ["1.3.0 is already WAITING_FOR_REVIEW with build 412; nothing to do"])
    d = decide([live], "1.3.0", 412, None, text, dry_run=True)
    expect("healthy (d): the dry run of (a) is the same plan, the build 'uploaded by this run'",
           d["outcome"] == "act" and kinds(d) == kinds(a)
           and any(ln.startswith("build: 412 (uploaded by this run") for ln in d["lines"])
           and "would submit for review" in d["lines"] and any("would create" in ln for ln in d["lines"]))
    expect("healthy: In Review, or approved and on its way, with 412 is nothing to do",
           decide([live, dict(waiting, state="IN_REVIEW")], "1.3.0", 412, ok_build, text)["outcome"] == "nothing"
           and decide([live, dict(waiting, state="PENDING_APPLE_RELEASE")], "1.3.0", 412, ok_build,
                      text)["outcome"] == "nothing")
    expect("healthy: phased release on adds exactly that step",
           kinds(decide([live], "1.3.0", 412, ok_build, text, phased=True)) ==
           ["create", "attach", "phased", "listing", "whats_new", "check_page", "submit"])
    expect("healthy: the older appStoreState names read the same (READY_FOR_SALE is live)",
           version_state({"appStoreState": "READY_FOR_SALE"}) == "READY_FOR_DISTRIBUTION"
           and version_state({"appVersionState": "WAITING_FOR_REVIEW", "appStoreState": "x"}) == "WAITING_FOR_REVIEW")
    expect("healthy: a complete page has no gaps",
           page_gaps(dict(FULL_PAGE, whatsNew=text), FULL_SHOTS) == [])

    def refused(plan, *words):
        return plan["outcome"] == "refuse" and plan["steps"] == [] and all(w in plan["why"] for w in words)

    expect("refuses: another editable version (1.2.0), named with its state",
           refused(decide([live, dict(hand, version="1.2.0")], "1.3.0", 412, ok_build, text),
                   "1.2.0", "PREPARE_FOR_SUBMISSION"))
    expect("refuses: a previous version still Pending Developer Release",
           refused(decide([dict(live, state="PENDING_DEVELOPER_RELEASE")], "1.3.0", 412, ok_build, text),
                   "1.0.1", "PENDING_DEVELOPER_RELEASE"))
    expect("refuses: 1.3.0 submitted with a different build, and cancels nothing",
           refused(decide([live, dict(waiting, build="400")], "1.3.0", 412, ok_build, text), "400", "never cancels"))
    expect("refuses: a build still processing",
           refused(decide([live], "1.3.0", 412, dict(ok_build, processing="PROCESSING"), text), "PROCESSING"))
    expect("refuses: Missing Compliance (encryption unanswered or true)",
           refused(decide([live], "1.3.0", 412, dict(ok_build, encryption=None), text), "Missing Compliance")
           and refused(decide([live], "1.3.0", 412, dict(ok_build, encryption=True), text), "Missing Compliance"))
    expect("refuses: a real run with no build 412 at Apple",
           refused(decide([live], "1.3.0", 412, None, text), "no build 412"))
    expect("refuses: What's New empty, over 4000 characters, or the placeholder",
           refused(decide([live], "1.3.0", 412, ok_build, "  \n"), "0 characters")
           and refused(decide([live], "1.3.0", 412, ok_build, "a" * 4001), "4001 characters")
           and refused(decide([live], "1.3.0", 412, ok_build, "Placeholder: x"), "placeholder"))
    expect("refuses: Rejected and Metadata Rejected (Q4), naming the state",
           refused(decide([live, dict(hand, state="REJECTED")], "1.3.0", 412, ok_build, text), "REJECTED")
           and refused(decide([live, dict(hand, state="METADATA_REJECTED")], "1.3.0", 412, ok_build, text),
                       "METADATA_REJECTED"))
    expect("refuses: an unknown state, changing nothing",
           refused(decide([live, dict(hand, state="SOMETHING_NEW")], "1.3.0", 412, ok_build, text), "SOMETHING_NEW"))
    expect("refuses: a page missing keywords and the iPad set, naming both",
           page_gaps(dict(FULL_PAGE, keywords="", whatsNew=text), {"APP_IPHONE_67": 7}) ==
           ["keywords", "the iPad screenshot set (APP_IPAD_PRO_3GEN_129)"])

    # The executor, against the fake App Store Connect.
    quiet = io.StringIO
    v101 = {"version": "1.0.1", "state": "READY_FOR_DISTRIBUTION", "whatsNew": "Old."}
    b412 = (412, "1.3.0", "VALID", False)

    def run(fake, dry=False, phased=False):
        out = quiet()
        with contextlib.redirect_stdout(out):
            code, line = release(fake, "com.example", "1.3.0", 412, text, phased=phased, dry_run=dry,
                                 wait_minutes=0, sleep=lambda s: None)
        return code, line, out.getvalue()

    f = FakeAsc([v101], [b412])
    code, line, log = run(f)
    vid = next(k for k, x in f.v.items() if x["versionString"] == "1.3.0")
    expect("healthy (a) end to end: created, attached, What's New, submitted, read back",
           code == 0 and f.writes() == ["POST /appStoreVersions", f"PATCH /appStoreVersions/{vid}/relationships/build",
                                        "PATCH /appStoreVersionLocalizations/L4", "POST /reviewSubmissions",
                                        "POST /reviewSubmissionItems", "PATCH /reviewSubmissions/S5"]
           and f.v[vid]["appVersionState"] == "WAITING_FOR_REVIEW" and f.v[vid]["releaseType"] == AFTER_APPROVAL
           and "read back: state WAITING_FOR_REVIEW, build 412, releaseType AFTER_APPROVAL" in log)
    expect("healthy: the summary line says it in one line (AC6)",
           line == "Heart FC Coach 1.3.0 (build 412) submitted for review; it releases automatically when Apple approves.")
    before = len(f.writes())
    code, line, log = run(f)
    expect("healthy (c) end to end: a re-run writes nothing and exits 0",
           code == 0 and len(f.writes()) == before and "nothing to do" in line)
    f = FakeAsc([v101], [b412], read_only=True)
    code, line, log = run(f, dry=True)
    expect("healthy (d) end to end: the dry run sends no POST, PATCH or DELETE and exits 0",
           code == 0 and f.writes() == [] and "would submit for review" in log
           and "1.0.1: READY_FOR_DISTRIBUTION" in log and "Dry run: nothing was changed" in log)
    f = FakeAsc([v101, {"version": "1.3.0", "state": "PREPARE_FOR_SUBMISSION", "releaseType": "MANUAL",
                        "build": 400}], [(400, "1.3.0", "VALID", False), b412])
    code, line, log = run(f)
    expect("healthy (b) end to end: reused, MANUAL -> AFTER_APPROVAL and build 400 -> 412 logged, no create",
           code == 0 and "POST /appStoreVersions" not in f.writes()
           and "releaseType MANUAL -> AFTER_APPROVAL" in log and "build 400 -> 412" in log)
    f = FakeAsc([v101, {"version": "1.3.0", "state": "READY_FOR_REVIEW", "releaseType": AFTER_APPROVAL,
                        "build": 412, "whatsNew": text}], [b412], submissions=[("READY_FOR_REVIEW", "1.3.0")])
    code, line, log = run(f)
    expect("healthy: a run that stopped part-way finishes, reusing the open submission (AC12)",
           code == 0 and f.writes() == ["PATCH /reviewSubmissions/S5"])
    f = FakeAsc([v101], [b412])
    code, line, log = run(f, phased=True)
    expect("healthy: phased release on is created on the new version",
           code == 0 and "POST /appStoreVersionPhasedReleases" in f.writes())
    f = FakeAsc([v101, {"version": "1.2.0", "state": "PREPARE_FOR_SUBMISSION"}], [b412])
    code, line, log = run(f)
    expect("refuses end to end: an unexpected 1.2.0 stops the run red, writes nothing, WHY block names it",
           code == 1 and f.writes() == [] and "WHY THIS JOB FAILED" in log and "1.2.0 is PREPARE_FOR_SUBMISSION" in log
           and "got as far as: nothing changed in App Store Connect" in log
           and line == "Uploaded to TestFlight (build 412). Not submitted for review: see WHY THIS JOB FAILED.")
    f = FakeAsc([dict(v101, shots={"APP_IPHONE_67": 7})], [b412])
    code, line, log = run(f)
    expect("refuses end to end: no iPad screenshots: not submitted, and says how far it got",
           code == 1 and not any("reviewSubmission" in w for w in f.writes())
           and "the iPad screenshot set" in log
           and "1.3.0 created, build 412 attached, What's New set, not submitted" in log)
    f = FakeAsc([v101], [b412])
    out = quiet()
    with contextlib.redirect_stdout(out):
        code, line = release(f, "com.example", "1.3.0", 412, text, folder=os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "..", "store", "app-store", "en-GB"),
            wait_minutes=0, sleep=lambda s: None)
    vid = next(k for k, x in f.v.items() if x["versionString"] == "1.3.0")
    expect("healthy: with the committed listing files, the text is sent to 1.3.0 and read back before submitting",
           code == 0 and "read back: all 9 fields match the listing files" in out.getvalue()
           and f"PATCH /appStoreReviewDetails/R~{vid}" in f.writes()
           and f.writes().index("PATCH /appInfoLocalizations/LI1") < f.writes().index("POST /reviewSubmissions")
           and "eyJ" not in out.getvalue())

    def live_writes(fake):
        """Writes that land on anything live: the 1.0.1 version, its page, its
        review details, the live app info or its localisation (AC14, QA R1)."""
        ids = {k for k, x in fake.v.items() if x["versionString"] == "1.0.1"}
        ids |= {k for k, x in fake.locs.items() if x["version"] in ids}
        ids |= {"I0", "LI0"}
        return [w for w in fake.writes() if w.rsplit("/", 1)[-1].split("~")[-1] in ids]

    expect("no write touches the live 1.0.1, its page, its review details or the live app info (AC14)",
           live_writes(f) == [])
    listing_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "store", "app-store", "en-GB")
    f = FakeAsc([v101], [b412], info_on_create=False)
    out = quiet()
    with contextlib.redirect_stdout(out):
        code, line = release(f, "com.example", "1.3.0", 412, text, folder=listing_dir,
                             wait_minutes=0, sleep=lambda s: None)
    expect("refuses: only a live app info, and its name, subtitle or privacy URL differ: nothing written to it, "
           "not submitted (QA R1)",
           code == 1 and live_writes(f) == [] and not any("reviewSubmission" in w for w in f.writes())
           and "Nothing was sent to the live listing" in out.getvalue())
    wanted_info = {a: v for (w, a), v in listing_wanted(listing_dir).items() if w == "info"}
    f = FakeAsc([v101], [b412], info_on_create=False, info=wanted_info)
    out = quiet()
    with contextlib.redirect_stdout(out):
        code, line = release(f, "com.example", "1.3.0", 412, text, folder=listing_dir,
                             wait_minutes=0, sleep=lambda s: None)
    expect("healthy: only a live app info that already matches: skipped with a line, the rest sent and submitted",
           code == 0 and live_writes(f) == [] and "PATCH /reviewSubmissions/S5" in f.writes()
           and "app info: no editable app info; name, subtitle and privacy URL already match" in out.getvalue())
    class SlowApple(FakeAsc):
        """Takes the submission but has not shown Waiting for Review yet."""
        def send(self, method, url, body):
            out = super().send(method, url, body)
            if method == "PATCH" and "/reviewSubmissions/" in url:
                for x in self.v.values():
                    if x["appVersionState"] == "WAITING_FOR_REVIEW":
                        x["appVersionState"] = "READY_FOR_REVIEW"
            return out

    f = SlowApple([v101], [b412])
    code, line, log = run(f)
    expect("refuses truthfully: submitted but not yet read back says so, never 'not submitted' (QA R2)",
           code == 1 and "got as far as: 1.3.0 created, build 412 attached, What's New set, submitted; "
           "not yet read back as Waiting for Review" in log and "not submitted" not in log.split("WHY THIS JOB")[1]
           and line.startswith("Uploaded to TestFlight (build 412) and submitted for review, but not yet read back"))
    f = FakeAsc([v101], [b412])
    shots = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "store", "app-store", "screenshots")
    try:
        with contextlib.redirect_stdout(quiet()):
            screenshots("com.example", "1.0.1", shots, asc=f)
        expect("refuses: screenshots for the live 1.0.1 are never replaced (QA R1)", False)
    except SystemExit as e:
        expect("refuses: screenshots for the live 1.0.1 are never replaced (QA R1)",
               f.writes() == [] and "not editable" in str(e.code))
    except Exception:  # noqa: BLE001 — it tried to write and the fake had no route for it
        expect("refuses: screenshots for the live 1.0.1 are never replaced (QA R1)", False)
    f = FakeAsc([v101], [b412], read_only=True)
    try:
        f.call("POST", "/appStoreVersions", {})
        expect("the read-only client refuses a write before sending it", False)
    except ReadOnlyViolation:
        expect("the read-only client refuses a write before sending it", f.sent == [])
    except Exception:  # noqa: BLE001 — the write was sent and the fake choked on it
        expect("the read-only client refuses a write before sending it", False)
    expect("no credential in an error: a JWT-shaped string is removed",
           "eyJ" not in trim("HTTP 401 Bearer eyJhbGciOi.eyJpc3Mi.c2ln-x_y failed"))

    # ----- #226: the approved screenshots go on the version before it is submitted. -----
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from check_store_media import make_png  # noqa: PLC0415 — beside this script

    def shot_folder(d, names=("01-alert", "02-fairness"), displays=("iphone", "ipad"), size=None):
        root = os.path.join(d, "shots")
        for display in displays:
            os.makedirs(os.path.join(root, display), exist_ok=True)
            w, h = size or ((1320, 2868) if display == "iphone" else (2064, 2752))
            for n in names:
                make_png(os.path.join(root, display, n + ".png"), w, h, 2)
        caps = os.path.join(d, "captions.txt")
        with open(caps, "w", encoding="utf-8") as fh:
            fh.write("".join(f"{n}: KICKER | Headline\n" for n in ("01-alert", "02-fairness")))
        return root, caps

    def run_shots(fake, root, caps, dry=False):
        out = quiet()
        with contextlib.redirect_stdout(out):
            code, line = release(fake, "com.example", "1.3.0", 412, text, dry_run=dry, wait_minutes=0,
                                 sleep=lambda s: None, shots_folder=root, captions=caps)
        return code, line, out.getvalue()

    def shot_writes(fake):
        return [w for w in fake.writes() if "Screenshot" in w]

    def held(fake, version, display):
        vid = next(k for k, x in fake.v.items() if x["versionString"] == version)
        loc = next(k for k, x in fake.locs.items() if x["version"] == vid)
        return [(x["fileName"], x["sourceFileChecksum"], x["state"]) for x in fake.locs[loc]["shots"].get(display, [])]

    with tempfile.TemporaryDirectory() as d:
        root, caps = shot_folder(d)
        wanted = shots_wanted(screenshot_plan(root))
        f = FakeAsc([v101], [b412])
        code, line, log = run_shots(f, root, caps)
        w = f.writes()
        first_submit = w.index("POST /reviewSubmissions")
        expect("healthy: a new 1.3.0 gets the approved shots, old ones replaced, all before it is submitted",
               code == 0 and all(i < first_submit for i, x in enumerate(w) if "Screenshot" in x)
               and w.count("POST /appScreenshots") == 4 and f.sent.count(("PUT", "/upload")) == 8
               and [(n, c) for n, c, _ in held(f, "1.3.0", "APP_IPHONE_67")] == wanted["APP_IPHONE_67"]
               and [(n, c) for n, c, _ in held(f, "1.3.0", "APP_IPAD_PRO_3GEN_129")] == wanted["APP_IPAD_PRO_3GEN_129"]
               and all(st == "COMPLETE" for *_, st in held(f, "1.3.0", "APP_IPHONE_67"))
               and "read back: APP_IPHONE_67 holds all 2, in order" in log)
        expect("healthy: the live 1.0.1's screenshots are untouched (AC14, QA R1)",
               f.live_shot_writes() == [] and len(held(f, "1.0.1", "APP_IPHONE_67")) == 7
               and held(f, "1.0.1", "APP_IPHONE_67")[0][0] == "old-0.png")
        expect("healthy: the summary names the screenshots in how far it got",
               code == 0 and "submitted for review" in line)
        f = FakeAsc([v101, {"version": "1.3.0", "state": "PREPARE_FOR_SUBMISSION", "releaseType": AFTER_APPROVAL,
                            "build": 412, "whatsNew": text,
                            "shots": {d_: list(v) for d_, v in wanted.items()}}], [b412])
        code, line, log = run_shots(f, root, caps)
        expect("healthy: a re-run on a version already holding the approved shots uploads nothing, then submits",
               code == 0 and shot_writes(f) == [] and ("PUT", "/upload") not in f.sent
               and "already holds these 2 screenshot(s); nothing uploaded" in log
               and "PATCH /reviewSubmissions/S5" in f.writes())
        f = FakeAsc([v101], [b412])
        run_shots(f, root, caps)
        f.v[next(k for k, x in f.v.items() if x["versionString"] == "1.3.0")]["appVersionState"] = \
            "PREPARE_FOR_SUBMISSION"   # as if the run had stopped before submitting
        for sub in f.subs.values():
            sub["state"] = "COMPLETE"
        before = len(shot_writes(f))
        code, line, log = run_shots(f, root, caps)
        expect("healthy: the same run twice uploads the shots once",
               code == 0 and len(shot_writes(f)) == before and f.sent.count(("PUT", "/upload")) == 8)
        f = FakeAsc([v101, {"version": "1.3.0", "state": "PREPARE_FOR_SUBMISSION", "releaseType": AFTER_APPROVAL,
                            "build": 412, "whatsNew": text,
                            "shots": {"APP_IPHONE_67": list(reversed(wanted["APP_IPHONE_67"])),
                                      "APP_IPAD_PRO_3GEN_129": list(wanted["APP_IPAD_PRO_3GEN_129"])}}], [b412])
        code, line, log = run_shots(f, root, caps)
        expect("healthy: a set in the wrong order is replaced; the matching set is left alone",
               code == 0 and f.writes().count("POST /appScreenshots") == 2
               and [(n, c) for n, c, _ in held(f, "1.3.0", "APP_IPHONE_67")] == wanted["APP_IPHONE_67"])
        failed_one = [wanted["APP_IPHONE_67"][0] + ("FAILED",), wanted["APP_IPHONE_67"][1]]
        f = FakeAsc([v101, {"version": "1.3.0", "state": "PREPARE_FOR_SUBMISSION", "releaseType": AFTER_APPROVAL,
                            "build": 412, "whatsNew": text,
                            "shots": {"APP_IPHONE_67": failed_one,
                                      "APP_IPAD_PRO_3GEN_129": list(wanted["APP_IPAD_PRO_3GEN_129"])}}], [b412])
        code, line, log = run_shots(f, root, caps)
        expect("healthy: a set with the right files but one Apple marked FAILED is uploaded again",
               code == 0 and f.writes().count("POST /appScreenshots") == 2
               and all(st == "COMPLETE" for *_, st in held(f, "1.3.0", "APP_IPHONE_67")))
        # #226 run 40049619707: right after the upload Apple read the shots
        # back with no checksum (still processing), and the read-back called
        # that a mismatch. Both displays, healthy cases first.
        for label, mode in (
                ("null checksum while processing, then ours", {"reads": 3, "checksum": "ours"}),
                ("null checksum while processing, and never one", {"reads": 3, "checksum": "none"}),
                ("null checksum at once, COMPLETE on the first read", {"reads": 1, "checksum": "none"})):
            f = FakeAsc([v101], [b412])
            f.shot_processing = mode
            code, line, log = run_shots(f, root, caps)
            expect(f"healthy: {label}: both displays verified, then submitted",
                   code == 0
                   and "read back: APP_IPHONE_67 holds all 2, in order" in log
                   and "read back: APP_IPAD_PRO_3GEN_129 holds all 2, in order" in log
                   and "PATCH /reviewSubmissions/S5" in f.writes())
        f = FakeAsc([v101], [b412])
        f.shot_processing = {"reads": 10 ** 6, "checksum": "ours"}
        code, line, log = run_shots(f, root, caps)
        expect("still processing after the wait: both displays uploaded, not submitted, and said so (not a fault)",
               code == 1 and f.writes().count("POST /appScreenshots") == 4
               and "POST /reviewSubmissions" not in f.writes()
               and "still processing" in log and "APP_IPAD_PRO_3GEN_129" in log
               and "app_store_for" in log)
        f = FakeAsc([v101], [b412])
        f.shot_processing = {"reads": 2, "checksum": "ours", "state": "FAILED"}
        code, line, log = run_shots(f, root, caps)
        expect("refuses: Apple marks the processed shots FAILED; not submitted",
               code == 1 and "POST /reviewSubmissions" not in f.writes() and "FAILED" in log
               and "01-alert.png" in log)
        f = FakeAsc([v101], [b412])
        f.shot_processing = {"reads": 2, "checksum": "other"}
        code, line, log = run_shots(f, root, caps)
        expect("refuses: Apple returns a checksum that is not ours; not submitted",
               code == 1 and "POST /reviewSubmissions" not in f.writes() and "checksum" in log)
        no_sum = {d_: [(n, None) for n, _ in v] for d_, v in wanted.items()}
        f = FakeAsc([v101, {"version": "1.3.0", "state": "PREPARE_FOR_SUBMISSION", "releaseType": AFTER_APPROVAL,
                            "build": 412, "whatsNew": text, "shots": no_sum}], [b412])
        code, line, log = run_shots(f, root, caps)
        expect("healthy: a re-run where Apple holds our names with no checksum uploads them again (never "
               "assumes they are ours), then submits",
               code == 0 and f.writes().count("POST /appScreenshots") == 4 and "PATCH /reviewSubmissions/S5" in f.writes())
        processing = {d_: [(n, c, "UPLOAD_COMPLETE") for n, c in v] for d_, v in wanted.items()}
        f = FakeAsc([v101, {"version": "1.3.0", "state": "PREPARE_FOR_SUBMISSION", "releaseType": AFTER_APPROVAL,
                            "build": 412, "whatsNew": text, "shots": processing}], [b412])
        for x in f.locs.values():
            for shots in x["shots"].values():
                for sh in shots:
                    if sh["state"] == "UPLOAD_COMPLETE":
                        sh["pending"] = [2, "COMPLETE", sh["sourceFileChecksum"]]
        code, line, log = run_shots(f, root, caps)
        expect("healthy: a re-run on our shots still processing uploads nothing, waits for them, then submits",
               code == 0 and shot_writes(f) == [] and "PATCH /reviewSubmissions/S5" in f.writes())
        f = FakeAsc([v101], [b412], read_only=True)
        code, line, log = run_shots(f, root, caps, dry=True)
        expect("healthy: the dry run plans the upload and sends nothing",
               code == 0 and f.writes() == [] and "would upload 2 to 1.3.0 once it is created" in log)
        f = FakeAsc([v101, {"version": "1.3.0", "state": "PREPARE_FOR_SUBMISSION", "build": 412}], [b412],
                    read_only=True)
        code, line, log = run_shots(f, root, caps, dry=True)
        expect("healthy: the dry run on an existing 1.3.0 says which sets it would replace, and sends nothing",
               code == 0 and f.writes() == [] and "APP_IPHONE_67: would replace 7 with 2" in log)

    for name, kw, words in (
            ("no iPad shots", {"displays": ("iphone",)}, ("no ipad screenshots",)),
            ("a stale set (names the captions do not have)", {"names": ("01-home", "02-squad")},
             ("01-alert.png", "no caption for 01-home.png")),
            ("shots at the wrong size", {"size": (1080, 1920)}, ("1080x1920",))):
        with tempfile.TemporaryDirectory() as d:
            root, caps = shot_folder(d, **kw)
            f = FakeAsc([v101], [b412])
            code, line, log = run_shots(f, root, caps)
            expect(f"refuses before any read or write, for a new version: {name}",
                   code == 1 and f.writes() == [] and f.sent == [] and "WHY THIS JOB FAILED" in log
                   and "step:          check the screenshots" in log and all(x in log for x in words)
                   and "got as far as: nothing changed in App Store Connect" in log)
    with tempfile.TemporaryDirectory() as d:
        root, caps = shot_folder(d, displays=())
        f = FakeAsc([v101, {"version": "1.3.0", "state": "PREPARE_FOR_SUBMISSION", "build": 412}], [b412])
        code, line, log = run_shots(f, root, None)
        expect("refuses: no screenshots folder content, even without a captions file, and even for a re-run",
               code == 1 and f.writes() == [] and "no iphone screenshots" in log)
        wn = os.path.join(d, "whats_new.txt")
        with open(wn, "w", encoding="utf-8") as fh:
            fh.write(text)
        out = quiet()
        with contextlib.redirect_stdout(out):
            rc = release_command(["asc_api.py", "release", "com.example", "1.3.0", "412", wn],
                                 asc_factory=lambda read_only: FakeAsc([v101], [b412], read_only=read_only))
        expect("refuses: the release command without --screenshots, before any call",
               rc == 2 and "--screenshots FOLDER is required" in out.getvalue())

    # ----- #234: TestFlight external testers. Healthy cases first (AC20). -----
    wtt = "How to test: import the test season."
    ext = {"Externals": {"id": "G1", "internal": False}}
    desc = "Heart of the Game: Coach for grassroots coaches."
    full_info = {"locales": {"en-GB": {"id": "BL1", "description": desc, "feedbackEmail": True}},
                 "contact": {f: True for f in BETA_CONTACT}, "whats_new": True}
    bare_info = dict(full_info, locales={"en-GB": {"id": "BL1", "description": "", "feedbackEmail": True}})
    fresh = {"processing": "VALID", "expired": False, "external": "READY_FOR_BETA_SUBMISSION",
             "in_groups": [], "review": None}

    def bkinds(plan):
        return [k for k, _ in plan["steps"]]

    def bdecide(build=fresh, info=full_info, approved=False, groups=ext, dry=False, names=("Externals",)):
        return decide_beta(list(names), groups, build, approved, info, desc, "412", "1.3.0", dry_run=dry)

    ba = bdecide(info=bare_info)
    expect("beta healthy (a): first build of 1.3.0: set the description, add to Externals, submit once",
           ba["outcome"] == "act" and bkinds(ba) == ["description", "add", "submit"]
           and "would submit" not in " ".join(ba["lines"]) and ba["review"] == "submit")
    bb = bdecide(approved=True)
    expect("beta healthy (b): 1.3.0 already approved: add to Externals; a review only if Apple asks",
           bb["outcome"] == "act" and bkinds(bb) == ["add", "submit_if_asked"]
           and any("1.3.0 already approved for external testing" in ln for ln in bb["lines"]))
    for st, rv in (("WAITING_FOR_BETA_REVIEW", "WAITING_FOR_REVIEW"), ("IN_BETA_REVIEW", "IN_REVIEW"),
                   ("BETA_APPROVED", "APPROVED"), ("IN_BETA_TESTING", "APPROVED")):
        bc = bdecide(build=dict(fresh, external=st, review=rv, in_groups=["Externals"]))
        expect(f"beta healthy (c): already in Externals and {st}: nothing to do, success",
               bc["outcome"] == "nothing" and bc["steps"] == []
               and bc["lines"][-1] == f"build 412 is already in Externals, {st}; nothing to do")
    bd = bdecide(info=bare_info, dry=True)
    expect("beta healthy (d): the dry run of (a) is the same plan, in 'would' words",
           bd["outcome"] == "act" and bkinds(bd) == bkinds(ba)
           and "would submit for Beta App Review" in bd["lines"]
           and any("would set" in ln and "description" in ln for ln in bd["lines"])
           and any("Externals: found, external, build 412 not in it: would add" in ln for ln in bd["lines"]))
    bd2 = bdecide(build=None, info=dict(full_info, whats_new=None), dry=True)
    expect("beta healthy: the dry run before an upload plans from the version: add and submit",
           bd2["outcome"] == "act" and bkinds(bd2) == ["add", "submit"]
           and any("uploaded by this run" in ln for ln in bd2["lines"])
           and any("What to Test (en-GB): set by this run" in ln for ln in bd2["lines"]))
    expect("beta healthy: a run stopped after the add is finished by submitting, nothing added twice",
           bkinds(bdecide(build=dict(fresh, in_groups=["Externals"]))) == ["submit"])
    expect("beta healthy: a submission already waiting is never made twice (only the add is left)",
           bkinds(bdecide(build=dict(fresh, external="WAITING_FOR_BETA_REVIEW", review="WAITING_FOR_REVIEW"))) == ["add"])

    def brefused(plan, *words):
        return plan["outcome"] == "refuse" and plan["steps"] == [] and all(w in plan["why"] for w in words)

    expect("beta refuses: a named group that does not exist, adding to no group",
           brefused(bdecide(groups={"Externals": None}), "Externals", "no TestFlight group"))
    expect("beta refuses: a named group that is internal",
           brefused(bdecide(groups={"Externals": {"id": "G9", "internal": True}}), "Externals", "internal"))
    expect("beta refuses: the build is not VALID after the wait, with the re-run command",
           brefused(bdecide(build=dict(fresh, processing="PROCESSING")), "PROCESSING")
           and "testflight_for" in bdecide(build=dict(fresh, processing="PROCESSING"))["fix"])
    expect("beta refuses: still in export compliance review after the wait, with the re-run command",
           brefused(bdecide(build=dict(fresh, external="IN_EXPORT_COMPLIANCE_REVIEW")), "IN_EXPORT_COMPLIANCE_REVIEW")
           and "testflight_for" in bdecide(build=dict(fresh, external="IN_EXPORT_COMPLIANCE_REVIEW"))["fix"])
    expect("beta refuses: FAILED, INVALID, expired or missing compliance is never added to a group",
           all(brefused(bdecide(build=b_), w) for b_, w in (
               (dict(fresh, processing="FAILED"), "FAILED"), (dict(fresh, processing="INVALID"), "INVALID"),
               (dict(fresh, expired=True), "expired"), (dict(fresh, external="EXPIRED"), "expired"),
               (dict(fresh, external="MISSING_EXPORT_COMPLIANCE"), "MISSING_EXPORT_COMPLIANCE"))))
    expect("beta refuses: BETA_REJECTED, never resubmitted, pointing at Apple's email",
           brefused(bdecide(build=dict(fresh, external="BETA_REJECTED", review="REJECTED")), "BETA_REJECTED")
           and "email" in bdecide(build=dict(fresh, external="BETA_REJECTED", review="REJECTED"))["fix"])
    expect("beta refuses: a required Test Information field empty, naming it, before any write",
           brefused(bdecide(info=dict(full_info, contact=dict(full_info["contact"], contactPhone=False))),
                    "review contact phone")
           and brefused(bdecide(info=dict(full_info, whats_new=False)), "What to Test")
           and brefused(bdecide(info=dict(full_info, locales={"en-GB": {"id": "BL1", "description": desc,
                                                                         "feedbackEmail": False}})), "feedback email"))
    expect("beta refuses: a real run with no build 412 at Apple",
           brefused(bdecide(build=None), "no build 412"))
    expect("beta refuses: a state it does not know, changing nothing",
           brefused(bdecide(build=dict(fresh, external="NOT_APPLICABLE")), "NOT_APPLICABLE"))

    # The executor, against the fake App Store Connect's TestFlight.
    def brun(fake, dry=False, names=("Externals",)):
        out = quiet()
        with contextlib.redirect_stdout(out):
            code, line = beta(fake, "com.example", "1.3.0", 412, list(names), desc, dry_run=dry,
                              wait_minutes=0, sleep=lambda s: None)
        return code, line, out.getvalue()

    def fake_beta(**kw):
        b_ = dict({"n": "412", "pre": "1.3.0", "processing": "VALID", "external": "READY_FOR_BETA_SUBMISSION",
                   "review": None, "groups": [], "whatsNew": wtt, "expired": False}, **kw.pop("build", {}))
        return FakeBeta(builds=[b_] + kw.pop("older", []), **kw)

    f = fake_beta()
    code, line, log = brun(f)
    expect("beta healthy (a) end to end: description set, added to Externals, submitted once, read back",
           code == 0 and f.writes() == ["PATCH /betaAppLocalizations/BL1", "POST /betaGroups/G1/relationships/builds",
                                        "POST /betaAppReviewSubmissions"]
           and "read back: build 412 is in Externals" in log
           and "read back: externalBuildState WAITING_FOR_BETA_REVIEW" in log
           and line == "TestFlight: Heart FC Coach 1.3.0 (build 412) added to Externals; submitted for Beta App "
                       "Review. Testers can install it once Apple approves.")
    expect("beta: no credential, feedback email or contact detail in the log (AC15)",
           "eyJ" not in log and "@" not in log and "Ann" not in log and "07700" not in log
           and "feedback email: present" in log and "review contact phone: present" in log)
    before = len(f.writes())
    code, line, log = brun(f)
    expect("beta healthy (c) end to end: a re-run writes nothing and exits 0",
           code == 0 and len(f.writes()) == before
           and "build 412 is already in Externals, WAITING_FOR_BETA_REVIEW; nothing to do" in log)
    f = fake_beta(read_only=True)
    code, line, log = brun(f, dry=True)
    expect("beta healthy (d) end to end: the dry run of (a) sends no POST, PATCH or DELETE and exits 0",
           code == 0 and f.writes() == [] and "would submit for Beta App Review" in log
           and "Dry run: nothing was changed in TestFlight." in log)
    older = [{"n": "400", "pre": "1.3.0", "processing": "VALID", "external": "IN_BETA_TESTING", "review": "APPROVED",
              "groups": ["G1"], "whatsNew": wtt, "expired": False}]
    f = fake_beta(older=older, approve_on_add=True, locs={"en-GB": {"description": desc, "feedbackEmail": "a@x.example"}})
    code, line, log = brun(f)
    expect("beta healthy (b) end to end: approved version, Apple approves on adding: no submission",
           code == 0 and f.writes() == ["POST /betaGroups/G1/relationships/builds"]
           and "1.3.0 already approved for external testing; build 412 added, no review needed" in log
           and line == "TestFlight: build 412 in Externals, IN_BETA_TESTING.")
    f = fake_beta(older=older, locs={"en-GB": {"description": desc, "feedbackEmail": "a@x.example"}})
    code, line, log = brun(f)
    expect("beta healthy (b'): approved version, but Apple still asks: one submission, and it is named",
           code == 0 and f.writes().count("POST /betaAppReviewSubmissions") == 1
           and "Apple still asks for a Beta App Review of build 412: submitted" in log)
    f = fake_beta(build={"groups": ["G1"]})
    code, line, log = brun(f)
    expect("beta healthy: a run stopped after the add is finished by the re-run, nothing added twice",
           code == 0 and "POST /betaGroups/G1/relationships/builds" not in f.writes()
           and f.writes().count("POST /betaAppReviewSubmissions") == 1)
    f = fake_beta(locs={})
    code, line, log = brun(f)
    expect("refuses end to end: no beta localisation, so no feedback email: nothing written, WHY block names it",
           code == 1 and f.writes() == [] and "WHY THIS JOB FAILED" in log and "feedback email" in log
           and "got as far as: nothing changed in TestFlight" in log
           and line == "Uploaded to TestFlight (build 412). Not available to external testers: see WHY THIS JOB FAILED.")
    f = fake_beta(groups={"Externals": True})
    code, line, log = brun(f)
    expect("refuses end to end: Externals is internal: added to no group, nothing written",
           code == 1 and f.writes() == [] and "internal" in log)
    f = fake_beta(build={"external": "BETA_REJECTED", "review": "REJECTED"})
    code, line, log = brun(f)
    expect("refuses end to end: BETA_REJECTED changes nothing", code == 1 and f.writes() == [])
    f = fake_beta(build={"processing": "PROCESSING"})
    code, line, log = brun(f)
    expect("refuses end to end: still processing after the wait names the re-run command",
           code == 1 and f.writes() == [] and "gh workflow run testflight.yml --ref main -f testflight_for=" in log)
    f = fake_beta()
    for path in ("/betaTesters", "/betaGroups/G1/relationships/betaTesters", "/betaTesterInvitations",
                 "/betaGroups/G2/relationships/builds"):
        try:
            beta_write(f, "POST", path, {"data": []}, external_ids={"G1"})
            ok = False
        except ForbiddenWrite:
            ok = True
        expect(f"beta: a write to {path} is refused before it is sent", ok and f.sent == [])
    try:
        f.call("POST", "/betaGroups/G2/relationships/builds", {"data": [{"type": "builds", "id": "B0"}]})
        ok = False
    except RuntimeError:
        ok = True
    expect("beta: the fake App Store Connect itself rejects adding a build to an internal group", ok)
    f = fake_beta()
    brun(f)
    expect("beta: every write the run sent is one this issue names, and none touched a tester",
           all(beta_allowed(*w.split(" ", 1)) for w in f.writes())
           and not any("Tester" in p or "publicLink" in p for _, p in f.sent))
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "en-GB"))
        open(os.path.join(d, "groups.txt"), "w").write("# the external group\nExternals\n")
        open(os.path.join(d, "en-GB", "beta_description.txt"), "w").write(desc + "\n")
        expect("beta healthy: the committed-style files check clean and read the group name",
               beta_problems(d) == [] and beta_groups(os.path.join(d, "groups.txt")) == ["Externals"])
        open(os.path.join(d, "groups.txt"), "w").write("someone@example.com\n")
        open(os.path.join(d, "en-GB", "beta_description.txt"), "w").write("")
        expect("beta refuses: a group line that is an email, and an empty description",
               len(beta_problems(d)) == 2)
    repo_tf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "store", "testflight")
    expect("beta healthy: the repository's store/testflight/ checks clean and names Externals",
           beta_problems(repo_tf) == [] and beta_groups(os.path.join(repo_tf, "groups.txt")) == ["Externals"])

    # AC25: the count is of expectations actually run, never a typed-in number.
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    if argv[1:] == ["--self-test"]:
        return self_test()
    if len(argv) == 4 and argv[1] == "max-build":
        return max_build(argv[2], argv[3])
    if len(argv) in (5, 6) and argv[1] == "listing":
        return listing(argv[2], argv[3], argv[4], dry_run=argv[5:] == ["--dry-run"])
    if len(argv) in (5, 6) and argv[1] == "screenshots":
        return screenshots(argv[2], argv[3], argv[4], dry_run=argv[5:] == ["--dry-run"])
    if len(argv) >= 6 and argv[1] == "release":
        return release_command(argv)
    if len(argv) >= 5 and argv[1] == "beta":
        return beta_command(argv)
    if len(argv) == 3 and argv[1] == "beta-check":
        problems = beta_problems(argv[2])
        for x in problems:
            print(f"WHY THIS JOB FAILED: {x}")
        if not problems:
            print(f"{argv[2]}: group(s) {', '.join(beta_groups(os.path.join(argv[2], 'groups.txt')))}; "
                  "beta description within Apple's limit")
        return 1 if problems else 0
    if len(argv) in (6, 7) and argv[1] == "what-to-test":
        return what_to_test(argv[2], argv[3], argv[4], argv[5], int(argv[6]) if len(argv) == 7 else 20)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
