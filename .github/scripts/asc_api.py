#!/usr/bin/env python3
"""App Store Connect API, the two calls TestFlight uploads need — #160.

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

    asc_api.py --self-test

Credentials from the environment, as the workflow already holds them:
ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (the .p8 asc-key.sh wrote). The token
is an ES256 JWT signed with `openssl`, so nothing is installed; it lives 15
minutes and is never printed (AC5).
"""

import base64
import hashlib
import json
import os
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


class Asc:
    def __init__(self):
        missing = [v for v in ("ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH") if not os.environ.get(v)]
        if missing:
            raise SystemExit(f"WHY THIS JOB FAILED: not set: {' '.join(missing)}")
        self.jwt = token(os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"], os.environ["ASC_KEY_PATH"])

    def call(self, method, path, body=None):
        url = path if path.startswith("http") else API + path
        req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                     headers={"Authorization": f"Bearer {self.jwt}",
                                              "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
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


def listing(bundle_id, version, folder, dry_run=False):
    asc = Asc()
    app = asc.app_id(bundle_id)
    infos = asc.call("GET", f"/apps/{app}/appInfos")["data"]
    editable = [i for i in infos if i["attributes"].get("appStoreState", i["attributes"].get("state"))
                not in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION")] or infos
    info_id = editable[0]["id"]
    q = urllib.parse.urlencode({"filter[versionString]": version, "filter[platform]": "IOS"})
    versions = asc.call("GET", f"/apps/{app}/appStoreVersions?{q}")["data"]
    if not versions:
        raise SystemExit(f"WHY THIS JOB FAILED: App Store Connect has no iOS version {version}; "
                         "its version page must read exactly this (#108).")
    version_id = versions[0]["id"]

    def locs():
        info = [x for x in asc.call("GET", f"/appInfos/{info_id}/appInfoLocalizations")["data"]
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
    if info_attrs:
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
    versions = asc.call("GET", f"/apps/{app}/appStoreVersions?{q}")["data"]
    if not versions:
        raise SystemExit(f"WHY THIS JOB FAILED: App Store Connect has no iOS version {version}")
    locs = [x for x in asc.call("GET", f"/appStoreVersions/{versions[0]['id']}/appStoreVersionLocalizations")["data"]
            if x["attributes"]["locale"] == LOCALE]
    if not locs:
        raise SystemExit(f"WHY THIS JOB FAILED: version {version} has no {LOCALE} page")
    return locs[0]["id"]


def screenshots(bundle_id, version, folder, dry_run=False):
    plan = screenshot_plan(folder)
    if not plan:
        raise SystemExit(f"WHY THIS JOB FAILED: no iphone/ or ipad/ screenshots in {folder}")
    asc = Asc()
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
# Self-test: healthy cases first
# ---------------------------------------------------------------------------

def self_test():
    failed = 0

    def expect(name, ok):
        nonlocal failed
        print(f"  {'ok' if ok else 'x '} {name}")
        failed += not ok

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

    print(f"{13 - failed} expectation(s) passed, {failed} failed.")
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
    if len(argv) in (6, 7) and argv[1] == "what-to-test":
        return what_to_test(argv[2], argv[3], argv[4], argv[5], int(argv[6]) if len(argv) == 7 else 20)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
