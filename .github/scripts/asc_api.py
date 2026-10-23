#!/usr/bin/env python3
"""App Store Connect API: TestFlight (#160), the listing (#108) and release on approval (#226).

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
        in file-name order, replacing what each display's set held. Then read
        back: the count, and no screenshot Apple marked FAILED.

    asc_api.py release BUNDLE_ID VERSION BUILD WHATS_NEW_FILE [--listing FOLDER]
               [--phased on|off] [--wait-minutes N] [--summary FILE] [--dry-run]
        #226: waits (bounded) for Apple to process BUILD, then creates or
        reuses VERSION, attaches BUILD, sets "release automatically after
        approval" (AFTER_APPROVAL), phased release on or off, sends FOLDER's
        listing, sets What's New, checks the page is complete, and submits it
        for review (reviewSubmissions). Every step checks before it acts, so a
        re-run finishes what an earlier one started and never duplicates.
        Refuses, red, with a WHY THIS JOB FAILED block, on anything it does not
        expect. --dry-run reads everything, prints the plan and writes nothing:
        the client itself refuses POST, PATCH and DELETE.

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


def screenshots(bundle_id, version, folder, dry_run=False, asc=None):
    plan = screenshot_plan(folder)
    if not plan:
        raise SystemExit(f"WHY THIS JOB FAILED: no iphone/ or ipad/ screenshots in {folder}")
    asc = asc or Asc(read_only=dry_run)
    loc = version_localization(asc, bundle_id, version)
    sets = {s["attributes"]["screenshotDisplayType"]: s["id"]
            for s in asc.call("GET", f"/appStoreVersionLocalizations/{loc}/appScreenshotSets")["data"]}
    for display, files in plan.items():
        print(f"{display}: {len(files)} screenshot(s): {', '.join(os.path.basename(f) for f in files)}")
        if dry_run:
            continue
        set_id = sets.get(display)
        if set_id is None:
            set_id = asc.call("POST", "/appScreenshotSets", {"data": {
                "type": "appScreenshotSets", "attributes": {"screenshotDisplayType": display},
                "relationships": {"appStoreVersionLocalization": {
                    "data": {"type": "appStoreVersionLocalizations", "id": loc}}}}})["data"]["id"]
        for old in asc.call("GET", f"/appScreenshotSets/{set_id}/appScreenshots")["data"]:
            asc.call("DELETE", f"/appScreenshots/{old['id']}")
        for path in files:
            with open(path, "rb") as fh:
                data = fh.read()
            shot = asc.call("POST", "/appScreenshots", {"data": {
                "type": "appScreenshots",
                "attributes": {"fileName": os.path.basename(path), "fileSize": len(data)},
                "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})["data"]
            for op, part in chunks(data, shot["attributes"]["uploadOperations"]):
                put_part(op, part)
            asc.call("PATCH", f"/appScreenshots/{shot['id']}", {"data": {
                "type": "appScreenshots", "id": shot["id"],
                "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
        back = asc.call("GET", f"/appScreenshotSets/{set_id}/appScreenshots")["data"]
        failed = [b["attributes"].get("fileName") for b in back
                  if (b["attributes"].get("assetDeliveryState") or {}).get("state") == "FAILED"]
        if len(back) != len(files) or failed:
            raise SystemExit(f"WHY THIS JOB FAILED: {display} holds {len(back)} of {len(files)}; failed: {failed}")
        print(f"read back: {display} holds all {len(files)}")
    if dry_run:
        print("Dry run: nothing was changed.")
    return 0


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
#   GET    /v1/appScreenshotSets/{id}/appScreenshots
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


def decide(versions, target, build_number, build, whats_new, phased=False, dry_run=False):
    """The release plan, from what App Store Connect holds. Pure: no calls.

    versions: [{"id", "version", "state", "releaseType", "build", "phased"}], the
      last three read for the target only (build is its number, or None).
    build: this run's build as Apple has it, {"processing", "encryption",
      "expired"}, or None if Apple does not have it (yet).
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
            wait_minutes=30, sleep=time.sleep, clock=time.time):
    """Create or reuse `target`, attach build_number, release after approval,
    set What's New and submit. Returns (exit code, one-line summary)."""
    n = str(build_number)
    done = []

    def progress():
        if not done:
            return "nothing changed in App Store Connect"
        if "submitted" in done:
            return ", ".join(done) + "; not yet read back as Waiting for Review"
        return ", ".join(done) + ", not submitted"

    step = "read App Store Connect"
    try:
        app = asc.app_id(bundle_id)
        versions = read_versions(asc, app, target)
        print_preconditions(asc, app, versions)
        step = "wait for Apple to process the build"
        build_id, build = read_build(asc, app, target, n, 0 if dry_run else wait_minutes, sleep, clock)
        plan = decide(versions, target, n, build, whats_new, phased, dry_run)
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


def release_command(argv):
    """release BUNDLE_ID VERSION BUILD WHATS_NEW_FILE [--listing FOLDER] [--phased on|off]
       [--wait-minutes N] [--summary FILE] [--dry-run]"""
    args = argv[2:]
    if len(args) < 4:
        print(release_command.__doc__)
        return 2
    bundle_id, version, build, text_file = args[:4]
    rest = args[4:]
    opts = {"--listing": None, "--phased": "off", "--wait-minutes": "30", "--summary": None}
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
    if opts["--phased"] not in ("on", "off"):
        print("--phased is on or off")
        return 2
    with open(text_file, encoding="utf-8") as f:
        text = f.read()
    code, line = release(Asc(read_only=dry), bundle_id, version, build, text, folder=opts["--listing"],
                         phased=opts["--phased"] == "on", dry_run=dry, wait_minutes=int(opts["--wait-minutes"]))
    print(line)
    if opts["--summary"]:
        with open(opts["--summary"], "w", encoding="utf-8") as f:
            f.write(line + "\n")
    return code


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
                          "shots": dict(spec.get("shots", FULL_SHOTS))}
        return vid

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
                                      for d, c in self.locs[p[1]]["shots"].items()]}
            if p[0] == "appScreenshotSets":
                loc, d = p[1].split("~")
                return 200, {"data": [{"id": str(i)} for i in range(self.locs[loc]["shots"][d])]}
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
                                    "shots": (live or {}).get("shots", {})})
            if self.info_on_create:
                self.infos[f"I{len(self.infos)}"] = {"attrs": {"state": "PREPARE_FOR_SUBMISSION"},
                                                "loc": dict(self.infos["I0"]["loc"])}
            return 201, {"data": {"id": vid}}
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
    if len(argv) in (6, 7) and argv[1] == "what-to-test":
        return what_to_test(argv[2], argv[3], argv[4], argv[5], int(argv[6]) if len(argv) == 7 else 20)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
