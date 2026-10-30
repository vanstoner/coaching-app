#!/usr/bin/env python3
"""Google Play Developer API: the closed track on approval (#232, Part 1).

The Play twin of asc_api.py. Rob's approvals are the merge and the
`google-play` environment (D1); this script then puts the signed bundle the
release already carries on the closed track, with en-GB release notes.

    play_api.py check PACKAGE [--summary FILE]
        P1-P6, read-only. Authenticates, opens an edit, reads the app's
        default language, lists every track with its releases (name, status,
        version codes) and the uploaded bundles, then DELETES the edit without
        committing it. Prints those values and nothing else: never the key,
        the service account's email, a contact detail or a tester. The client
        refuses every other write before it is sent. Exits 1, with WHY THIS JOB
        FAILED, when Rob has a console step first (no bundle, a draft app, a
        default language other than en-GB, no closed track).

    play_api.py release PACKAGE VERSION BUILD AAB NOTES_FILE --track NAME
               [--production on|off] [--summary FILE] [--dry-run]
        Criteria 1, 3-5, 9, 11-14. One edit: reuse the bundle if Play already
        holds version code BUILD with this file's SHA-256 (or upload it), put
        "<VERSION> (build BUILD)" on the track as `completed` with the notes,
        commit once, then read the track back in a fresh edit and compare.
        Nothing to do if the track already holds BUILD, completed, with the
        same notes. A refusal before the commit deletes the edit, so Play
        Console is unchanged. --production on adds a SECOND edit, after the
        closed track is committed, so a production refusal leaves the closed
        release standing (criterion 12). --dry-run reads everything, prints
        the plan and writes nothing (the client refuses it).

    play_api.py notes-check FILE [--require]
        Criterion 5: plain text for a coach, 1 to 500 characters, no issue
        numbers, Markdown, TestFlight or test-season wording, no @ address.
        Without --require an over-long file is a warning (the App Store's text
        today); with it (a version-bump PR, and the release run), a failure.

    play_api.py sdk-check PACKAGE_LOCK
        P7: no analytics or crash-reporting SDK is a dependency, so the Data
        safety form's "no data collected" stays true.

    play_api.py key-check
        PLAY_SERVICE_ACCOUNT_JSON is a service-account key: names what is
        wrong, never a value.

    play_api.py --self-test

Credentials: PLAY_SERVICE_ACCOUNT_JSON, the JSON key Google Cloud gives. The
OAuth token comes from an RS256 JWT signed with `openssl`, as asc_api.py does
for Apple, so nothing is installed (no google-auth, no pip). The key is
written to a private temp file only for the signature and removed at once.
The token is never printed.

Google's API, as documented (developers.google.com/android-publisher):
  POST   /applications/{pkg}/edits                          open an edit
  GET    /applications/{pkg}/edits/{e}/details              defaultLanguage
  GET    /applications/{pkg}/edits/{e}/tracks               tracks and releases
  GET    /applications/{pkg}/edits/{e}/bundles              uploaded bundles
  POST   /upload/.../applications/{pkg}/edits/{e}/bundles   upload a bundle
  PUT    /applications/{pkg}/edits/{e}/tracks/{track}       set a track's release
  POST   /applications/{pkg}/edits/{e}:commit               commit (never with
                                                            changesNotSentForReview)
  DELETE /applications/{pkg}/edits/{e}                      discard OUR edit
Never: listings, images, details, testers, countryAvailability, a halted or
partial rollout, a track's other releases, or any edit but our own (#232
criterion 13). guard() refuses anything else before it is sent.
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

API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"
TOKEN_URI = "https://oauth2.googleapis.com/token"
LOCALE = "en-GB"
NOTES_LIMIT = 500
CONSOLE = "Play Console › Heart of the Game: Coach"
PROJECT = "heart-of-the-game-ci"
# Google's own track ids. Every other track is a closed track named in the console.
INTERNAL, OPEN, DEFAULT_CLOSED, PRODUCTION = "internal", "beta", "alpha", "production"
ROLLED_OUT = {"completed", "inProgress", "halted"}
UNFINISHED = {"draft", "inProgress", "halted"}

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
TOKEN_SHAPE = re.compile(r"(ya29\.[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)")


def scrub(text, limit=300):
    """Google's reply, cut short, with any email or token removed (criterion 15)."""
    return EMAIL.sub("<address>", TOKEN_SHAPE.sub("<token>", str(text)))[:limit]


# ---------------------------------------------------------------------------
# The key and the token
# ---------------------------------------------------------------------------

def key_problems(raw):
    """Every way PLAY_SERVICE_ACCOUNT_JSON is not a usable key. Never quotes a value."""
    if not raw or not raw.strip():
        return ["PLAY_SERVICE_ACCOUNT_JSON is not set in the google-play environment"]
    try:
        sa = json.loads(raw)
    except ValueError:
        return ["PLAY_SERVICE_ACCOUNT_JSON is not JSON: paste the whole key file Google Cloud downloaded"]
    if not isinstance(sa, dict):
        return ["PLAY_SERVICE_ACCOUNT_JSON is not a JSON object"]
    found = []
    if sa.get("type") != "service_account":
        found.append("PLAY_SERVICE_ACCOUNT_JSON's type is not service_account (is it an OAuth client file?)")
    if not EMAIL.fullmatch(str(sa.get("client_email", ""))):
        found.append("PLAY_SERVICE_ACCOUNT_JSON has no client_email")
    key = str(sa.get("private_key", ""))
    if "-----BEGIN PRIVATE KEY-----" not in key or "-----END PRIVATE KEY-----" not in key:
        found.append("PLAY_SERVICE_ACCOUNT_JSON's private_key is not a whole PEM key")
    uri = sa.get("token_uri", TOKEN_URI)
    if not str(uri).startswith("https://"):
        found.append("PLAY_SERVICE_ACCOUNT_JSON's token_uri is not https")
    return found


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def openssl_sign(key_pem, data):
    """RS256: openssl's PKCS#1 v1.5 signature is already the JWT's raw bytes."""
    fd, path = tempfile.mkstemp(suffix=".pem", dir=os.environ.get("RUNNER_TEMP"))
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(key_pem)
        return subprocess.run(["openssl", "dgst", "-sha256", "-sign", path], input=data,
                              capture_output=True, check=True).stdout
    except subprocess.CalledProcessError:
        raise Refused("authenticate", "openssl could not sign with the service account's private_key",
                      "create a new JSON key for the service account and replace PLAY_SERVICE_ACCOUNT_JSON") from None
    finally:
        os.remove(path)


def assertion(sa, now, sign=openssl_sign):
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = b64url(json.dumps({"iss": sa["client_email"], "scope": SCOPE,
                                "aud": sa.get("token_uri", TOKEN_URI),
                                "iat": now, "exp": now + 3600}).encode())
    signing_input = f"{header}.{claims}".encode()
    return f"{header}.{claims}.{b64url(sign(sa['private_key'], signing_input))}"


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------

class Refused(Exception):
    def __init__(self, step, why, fix):
        super().__init__(why)
        self.step, self.why, self.fix = step, why, fix


class ForbiddenWrite(RuntimeError):
    pass


class PlayError(RuntimeError):
    def __init__(self, method, path, status, body):
        self.method, self.path, self.status = method, path, status
        try:
            err = json.loads(body).get("error", {})
        except (ValueError, AttributeError):
            err = {}
        if isinstance(err, str):            # the token endpoint: {"error": "invalid_grant", ...}
            err = {"message": f"{err}: {json.loads(body).get('error_description', '')}"}
        self.message = scrub(err.get("message") or body)
        reasons = [e.get("reason", "") for e in err.get("errors", []) if isinstance(e, dict)]
        reasons += [d.get("reason", "") for d in err.get("details", []) if isinstance(d, dict)]
        self.reasons = [r for r in reasons if r]
        super().__init__(f"{method} {path}: HTTP {status} {self.message}")


EDIT_GONE = re.compile(r"edit.*(has been deleted|has expired|no longer valid|not found)|"
                       r"(modified|changed) (by another|concurrently|in the play console)", re.I)


def explain(err, step, track=None):
    """(why, fix) for a Play refusal: criterion 14's failure modes."""
    msg, low = err.message, err.message.lower()
    reasons = " ".join(err.reasons).lower()
    if "accessnotconfigured" in reasons or "service_disabled" in reasons or "has not been used in project" in low \
            or ("api" in low and "disabled" in low):
        return ("the Google Play Android Developer API is not enabled for the key's project (P2)",
                f"enable the Google Play Android Developer API in Google Cloud ({PROJECT}: "
                "APIs & Services › Library), wait a few minutes, re-run. Not retried.")
    if "invalid_grant" in low or err.status == 401:
        return ("Google refused the service account's key (revoked, deleted, or the clock is wrong)",
                "create a new JSON key for the service account in Google Cloud and replace "
                "PLAY_SERVICE_ACCOUNT_JSON in the google-play environment")
    if "draft app" in low:
        return ("the app is still a draft in Play Console: it accepts only draft releases (P3)",
                f"{CONSOLE} › Testing: roll out a release once by hand, then re-run")
    if "version code" in low and ("already been used" in low or "already used" in low):
        return (f"Play already holds a different bundle with this version code ({msg})",
                "a new build: merge again or dispatch android-apk.yml on main; a new N is a new version code")
    if "wrong key" in low or "upload certificate" in low or "upload key" in low:
        return (f"the bundle is not signed with the upload key Play has registered ({msg})",
                f"compare the release's fingerprint with {CONSOLE} › Test and release › App integrity › "
                "Upload key certificate; if Rob reset the upload key, the play-store secrets must match it (#211)")
    if "changesnotsentforreview" in low.replace(" ", ""):
        return ("Play Console holds changes not sent for review (or a rejected one), so Play will not "
                "send this commit for review automatically",
                f"Rob: {CONSOLE} › Publishing overview › Send changes for review, then re-run. "
                "This run never sets changesNotSentForReview itself.")
    if track == PRODUCTION and err.status in (400, 403):
        return (f"production refused ({msg}): production access is not granted yet, or the key lacks "
                "Release to production",
                "apply for production access in Play Console once 12 testers have stayed 14 days; "
                "until then set PLAY_PRODUCTION: 'off'. The closed track release stands.")
    if err.status == 404 and (step == "open an edit" or (err.method == "POST" and err.path.endswith("/edits"))):
        return ("no Play app has this package, or the service account cannot see it (P3)",
                f"check the package in {CONSOLE}, and that the service account is invited in "
                "Users and permissions with access to this app")
    if err.status == 404 or ("track" in low and "not found" in low):
        return (f"not found: {msg}", "run the check mode and set PLAY_TRACK to a track it lists")
    if err.status == 403:
        need = {"upload the bundle": "Release to testing tracks", "set the track": "Release to testing tracks",
                "commit": "Release to testing tracks"}.get(step, "View app information (read-only)")
        return (f"the service account lacks a permission for '{step}': {need} ({msg})",
                f"Play Console › Users and permissions › the service account › grant {need} for this app")
    return (f"Google Play refused: HTTP {err.status} {msg}", "read Google's reply above; re-run once fixed")


def why_block(step, why, got_to, fix):
    print("==============================================================")
    print("WHY THIS JOB FAILED")
    print(f"  step:          {step}")
    print(f"  reason:        {why}")
    print(f"  got as far as: {got_to}")
    print(f"  fix:           {fix}")
    print("  The GitHub release and its assets are untouched; the iOS jobs are unaffected.")
    print("==============================================================")


# ---------------------------------------------------------------------------
# The client
# ---------------------------------------------------------------------------

def https(method, url, headers, data):
    """(status, body bytes). Raises (status, body bytes) as PlayError's input via HTTPError."""
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class Play:
    """The Play client. Every request passes guard() first. read_only (the
    check mode and a dry run) allows opening an edit, reading, and deleting
    the edit it opened; nothing else is ever sent (P1, criterion 9)."""

    def __init__(self, package, read_only=True, production=False, transport=https, token=None):
        self.package, self.read_only, self.production = package, read_only, production
        self.transport = transport
        self.token = token
        self.edit = None
        self.sent = []          # (method, path) of every request actually sent

    # -- auth -------------------------------------------------------------
    def authenticate(self, raw=None, now=None, sign=openssl_sign):
        raw = os.environ.get("PLAY_SERVICE_ACCOUNT_JSON", "") if raw is None else raw
        problems = key_problems(raw)
        if problems:
            raise Refused("check the key", "; ".join(problems),
                          "GitHub › Settings › Environments › google-play › Environment secrets › "
                          "PLAY_SERVICE_ACCOUNT_JSON: paste the whole JSON key file")
        sa = json.loads(raw)
        jwt = assertion(sa, int(now if now is not None else time.time()), sign)
        body = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                       "assertion": jwt}).encode()
        status, data = self.transport("POST", sa.get("token_uri", TOKEN_URI),
                                      {"Content-Type": "application/x-www-form-urlencoded"}, body)
        if status >= 400:
            err = PlayError("POST", "token", status, data.decode(errors="replace"))
            why, fix = explain(err, "authenticate")
            raise Refused("authenticate", why, fix)
        self.token = json.loads(data)["access_token"]

    # -- the guard --------------------------------------------------------
    def guard(self, method, url, body=None):
        """Raises ForbiddenWrite unless this request is one #232 allows here."""
        base = f"{API}/{self.package}/edits"
        upload_base = f"{UPLOAD}/{self.package}/edits"
        path, _, query = url.partition("?")
        own = f"{base}/{self.edit}" if self.edit else None
        if method == "GET" and own and (path == own or path.startswith(own + "/")):
            return
        if method == "POST" and path == base and not self.edit:
            return                                                   # open our one edit
        if method == "DELETE" and own and path == own:
            return                                                   # discard our own edit
        if self.read_only:
            raise ForbiddenWrite(f"read-only: refused to send {method} {path.replace(API, '')}")
        if method == "POST" and self.edit and path == f"{upload_base}/{self.edit}/bundles":
            return
        if method == "POST" and own and path == own + ":commit":
            if "changesNotSentForReview" in query:
                raise ForbiddenWrite("refused to commit with changesNotSentForReview: that is Rob's, in the console")
            return
        m = re.fullmatch(re.escape(own or "\0") + r"/tracks/([^/]+)", path)
        if method == "PUT" and m:
            track = urllib.parse.unquote(m.group(1))
            if track == PRODUCTION and not self.production:
                raise ForbiddenWrite("refused to write the production track: PLAY_PRODUCTION is off")
            releases = (body or {}).get("releases", [])
            if (body or {}).get("track") != track or len(releases) != 1:
                raise ForbiddenWrite(f"refused a track update that is not exactly one release on {track}")
            if releases[0].get("status") != "completed" or "userFraction" in releases[0]:
                raise ForbiddenWrite("refused a release that is not completed at 100% (no draft, halt or staging)")
            return
        raise ForbiddenWrite(f"refused to send {method} {path.replace(API, '').replace(UPLOAD, '')}: "
                             "not a write #232 allows")

    def call(self, method, url, body=None, raw=None, step="read"):
        self.guard(method, url, body)
        headers = {"Authorization": f"Bearer {self.token}"}
        data = None
        if raw is not None:
            headers["Content-Type"] = "application/octet-stream"
            data = raw
        elif body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        self.sent.append((method, url.split("?")[0].replace(API, "").replace(UPLOAD, "upload:")))
        status, out = self.transport(method, url, headers, data)
        if status >= 400:
            raise PlayError(method, url.split("?")[0].replace(API, ""), status, out.decode(errors="replace"))
        return json.loads(out) if out else {}

    # -- the API ----------------------------------------------------------
    def open_edit(self):
        self.edit = self.call("POST", f"{API}/{self.package}/edits", {}, step="open an edit")["id"]
        return self.edit

    def e(self, tail=""):
        return f"{API}/{self.package}/edits/{self.edit}{tail}"

    def details(self):
        return self.call("GET", self.e("/details"))

    def tracks(self):
        return self.call("GET", self.e("/tracks")).get("tracks", [])

    def bundles(self):
        return self.call("GET", self.e("/bundles")).get("bundles", [])

    def track(self, name):
        return self.call("GET", self.e(f"/tracks/{urllib.parse.quote(name)}"))

    def upload(self, data):
        return self.call("POST", f"{UPLOAD}/{self.package}/edits/{self.edit}/bundles?uploadType=media",
                         raw=data, step="upload the bundle")

    def set_track(self, name, release):
        return self.call("PUT", self.e(f"/tracks/{urllib.parse.quote(name)}"),
                         {"track": name, "releases": [release]}, step="set the track")

    def commit(self):
        out = self.call("POST", self.e(":commit"), step="commit")
        self.edit = None
        return out

    def discard(self):
        """Delete our edit if one is open; never raises (a refusal is already being reported)."""
        if not self.edit:
            return False
        try:
            self.call("DELETE", self.e())
            return True
        except Exception as ex:  # noqa: BLE001 — the edit expires on its own
            print(f"note: the edit could not be deleted ({scrub(ex)}); Google expires it unused")
            return False
        finally:
            self.edit = None


# ---------------------------------------------------------------------------
# Pure decisions
# ---------------------------------------------------------------------------

def codes(release):
    return [int(c) for c in release.get("versionCodes", []) if str(c).isdigit()]


def notes_of(release, locale=LOCALE):
    for n in release.get("releaseNotes", []):
        if n.get("language") == locale:
            return n.get("text", "")
    return None


def is_draft_app(tracks):
    """No release has ever rolled out on any track: Play's 'draft app'."""
    return not any(r.get("status") in ROLLED_OUT for t in tracks for r in t.get("releases", []))


def closed_tracks(tracks):
    return [t["track"] for t in tracks if t.get("track") not in (INTERNAL, OPEN, PRODUCTION)
            and ":" not in t.get("track", "")]


def release_body(version, build, notes):
    return {"name": f"{version} (build {build})", "versionCodes": [str(build)], "status": "completed",
            "releaseNotes": [{"language": LOCALE, "text": notes}]}


def track_verdict(track, build, notes):
    """('done' | 'put' | refusal text) for putting BUILD on this track (criteria 11, 13)."""
    releases = track.get("releases", [])
    for r in releases:
        if build in codes(r) and r.get("status") == "completed" and notes_of(r) == notes:
            return "done"
    unfinished = [r for r in releases if r.get("status") in UNFINISHED]
    if unfinished:
        r = unfinished[0]
        return (f"{track['track']} holds a {r.get('status')} release ({r.get('name', '?')}, version codes "
                f"{codes(r)}); this run never replaces, halts or reduces a release")
    newer = [c for r in releases if r.get("status") == "completed" for c in codes(r) if c > build]
    if newer:
        return f"{track['track']} already has a newer build ({max(newer)}); build {build} would go backwards"
    return "put"


def bundle_verdict(bundles, build, sha256):
    """('reuse' | 'upload' | refusal text) for this version code (criterion 11)."""
    for b in bundles:
        if b.get("versionCode") == build:
            if b.get("sha256", "").lower() == sha256.lower():
                return "reuse"
            return (f"Play already holds a different bundle as version code {build} "
                    f"(its sha256 {b.get('sha256', '?')[:12]}…, ours {sha256[:12]}…)")
    return "upload"


NOTES_BANNED = [
    (re.compile(r"#\d+"), "an issue number"),
    (re.compile(r"\*\*|__|`|^\s*[-*+]\s|^\s*#+\s|\[[^\]]+\]\([^)]+\)", re.M), "Markdown"),
    (re.compile(r"testflight", re.I), "TestFlight wording"),
    (re.compile(r"test[ -]?season|test kit", re.I), "test-season wording"),
    (EMAIL, "an @ address"),
]


def notes_problems(text, require=True):
    """(errors, warnings) for Play's release notes (criterion 5)."""
    errors, warnings = [], []
    n = len(text.strip())
    if n == 0:
        errors.append("the release notes are empty")
    elif n > NOTES_LIMIT:
        (errors if require else warnings).append(
            f"the release notes are {n} characters; Google Play allows {NOTES_LIMIT} (D3: trim whats_new.txt)")
    for rx, what in NOTES_BANNED:
        if rx.search(text):
            errors.append(f"the release notes contain {what}")
    return errors, warnings


SDK = re.compile(r"(^|/)(@react-native-firebase|firebase|@sentry|sentry-expo|@bugsnag|@amplitude|"
                 r"mixpanel-react-native|@segment|appcenter[^/]*|@datadog|newrelic-react-native-agent|"
                 r"expo-firebase-[^/]*|expo-analytics[^/]*|expo-insights|@react-native-google-analytics[^/]*)(/|$)")


def sdk_problems(lock):
    found = sorted({m.group(2) for p in lock.get("packages", {}) for m in [SDK.search(p)] if m})
    return [f"{x} is in package-lock.json: an analytics or crash SDK changes the Data safety answer" for x in found]


# ---------------------------------------------------------------------------
# check (P1-P6)
# ---------------------------------------------------------------------------

def check(play, out=print):
    """P1-P6 read-only. Returns (code, summary line)."""
    stops = []
    got_to = "nothing"
    try:
        play.open_edit()
        got_to = "an edit opened"
        out(f"P1 key: authenticated; edit opened for {play.package} (it is deleted below, never committed)")
        lang = play.details().get("defaultLanguage", "?")
        out(f"P4 default listing language: {lang}" + ("" if lang == LOCALE else f"  <- STOP: not {LOCALE}"))
        if lang != LOCALE:
            stops.append(f"the default listing language is {lang}: Rob sets it to English (United Kingdom) – {LOCALE} "
                         f"in {CONSOLE} › Grow users › Store presence › Main store listing")
        tracks = play.tracks()
        out(f"P3 tracks ({len(tracks)}):")
        for t in tracks:
            rs = t.get("releases", [])
            if not rs:
                out(f"  {t.get('track')}: no releases")
            for r in rs:
                frac = f", userFraction {r['userFraction']}" if "userFraction" in r else ""
                out(f"  {t.get('track')}: {r.get('name', '(unnamed)')}: {r.get('status')}, "
                    f"version codes {codes(r)}{frac}")
        bundles = play.bundles()
        vcs = sorted(b.get("versionCode") for b in bundles)
        out(f"P3 bundles uploaded: {len(bundles)}" + (f", version codes {vcs}" if vcs else ""))
        if not bundles:
            stops.append(f"no bundle: Rob uploads the first .aab by hand in {CONSOLE} › Testing")
        draft = is_draft_app(tracks)
        out(f"P3 draft app (no release ever rolled out): {'yes  <- STOP' if draft else 'no'}")
        if draft:
            stops.append(f"the app is a draft: Rob rolls out one release by hand in {CONSOLE} › Testing")
        closed = closed_tracks(tracks)
        out(f"P3 closed tracks: {', '.join(closed) if closed else 'none  <- STOP'}"
            + (f" (Google's default closed track is '{DEFAULT_CLOSED}')" if DEFAULT_CLOSED in closed else ""))
        if not closed:
            stops.append(f"no closed track: Rob creates one in {CONSOLE} › Testing › Closed testing")
        out("P5 permissions: read proved by this run. Release to testing tracks: proved by the first real run. "
            "Manage store presence: Part 2. Release to production: untested (no production access yet).")
        out("P6 managed publishing: the API does not report it. Rob reads it in "
            f"{CONSOLE} › Publishing overview; if it is on, a committed release waits for his click there.")
        got_to = "everything read"
    except PlayError as err:
        why, fix = explain(err, "open an edit" if got_to == "nothing" else "read")
        play.discard()
        why_block("check", why, got_to, fix)
        return 1, f"Google Play check refused: {why}"
    deleted = play.discard()
    out(f"P1 edit: {'deleted, not committed' if deleted else 'NOT deleted (it expires unused); nothing was committed'}")
    if stops:
        why_block("check", "; ".join(stops), got_to, "the console steps named above, then re-run the check")
        return 1, "Google Play check: Rob has a console step first (WHY THIS JOB FAILED)."
    return 0, "Google Play check: key, API, app and tracks read; nothing was written."


# ---------------------------------------------------------------------------
# release (criteria 1, 3, 4, 9, 11, 12, 13, 14)
# ---------------------------------------------------------------------------

def plan_edit(play, version, build, data, sha, notes, track, dry_run, out):
    """One edit, opened here. Returns ('done' | 'planned' | 'committed', track release body)."""
    play.open_edit()
    lang = play.details().get("defaultLanguage", "?")
    if lang != LOCALE:
        out(f"note: the default listing language is {lang}; the notes are still sent as {LOCALE}")
    tracks = play.tracks()
    if is_draft_app(tracks):
        raise Refused("read the tracks", "the app is a draft in Play Console: it accepts only draft releases (P3)",
                      f"{CONSOLE} › Testing: roll out a release once by hand, then re-run")
    names = [t.get("track") for t in tracks]
    target = next((t for t in tracks if t.get("track") == track), None)
    if target is None:
        raise Refused("read the tracks", f"track '{track}' not found; Play has: {', '.join(names)}",
                      "run the check mode and set PLAY_TRACK in google-play.yml to the closed track it lists")
    verdict = track_verdict(target, build, notes)
    if verdict == "done":
        play.discard()
        return "done", None
    if verdict != "put":
        raise Refused("read the tracks", verdict, f"Rob finishes or discards that release in {CONSOLE} › Testing")
    bv = bundle_verdict(play.bundles(), build, sha)
    if bv not in ("reuse", "upload"):
        raise Refused("read the bundles", bv, "a new build: a new N is a new version code")
    body = release_body(version, build, notes)
    out(f"plan: bundle version code {build}: {'reuse the one Play holds' if bv == 'reuse' else 'upload'} "
        f"({len(data)} bytes, sha256 {sha[:12]}…)")
    out(f"plan: track {track}: release '{body['name']}', version code {build}, completed, "
        f"{LOCALE} notes ({len(notes)} characters)")
    out(f"plan: commit once{' (dry run: not sent)' if dry_run else ''}")
    if dry_run:
        play.discard()
        return "planned", body
    if bv == "upload":
        try:
            got = play.upload(data)
        except PlayError as err:
            raise Refused("upload the bundle", *explain(err, "upload the bundle")) from None
        if got.get("versionCode") != build or got.get("sha256", sha).lower() != sha.lower():
            raise Refused("upload the bundle", f"Play read the upload as version code {got.get('versionCode')}, "
                          f"not {build}", "the release's .aab is not build N: re-run android-apk.yml on main")
        out(f"uploaded: version code {build}")
    try:
        play.set_track(track, body)
    except PlayError as err:
        raise Refused("set the track", *explain(err, "set the track", track)) from None
    try:
        play.commit()
    except PlayError as err:
        if EDIT_GONE.search(err.message) or err.status == 409:
            raise EditInvalid(err.message) from None
        raise Refused("commit", *explain(err, "commit", track)) from None
    return "committed", body


class EditInvalid(Exception):
    pass


def read_back(play, track, build, body, out):
    play.open_edit()
    try:
        t = play.track(track)
    finally:
        play.discard()
    r = next((r for r in t.get("releases", []) if build in codes(r)), None)
    if not r:
        raise Refused("read back", f"version code {build} is not on {track} after the commit",
                      "re-run (it finishes what this began); if it persists, look in Play Console › Testing")
    got_notes = notes_of(r)
    out(f"read back: {track}: '{r.get('name')}', version codes {codes(r)}, {r.get('status')}, "
        f"{LOCALE} notes {len(got_notes or '')} characters")
    if r.get("status") != "completed" or got_notes != body["releaseNotes"][0]["text"] or r.get("name") != body["name"]:
        raise Refused("read back", f"{track} holds build {build} but not as sent "
                      f"(status {r.get('status')}, notes {'match' if got_notes == body['releaseNotes'][0]['text'] else 'differ'})",
                      "re-run; it rewrites a release that differs")


def release(play, version, build, aab, notes, track, production=False, dry_run=False, out=print):
    """Returns (code, summary line)."""
    build = int(build)
    errors, _ = notes_problems(notes, require=True)
    if errors:
        why_block("check the notes", "; ".join(errors), "nothing sent",
                  "edit store/app-store/en-GB/whats_new.txt (D3: one file for both stores)")
        return 1, "Not sent to Google Play: the release notes (WHY THIS JOB FAILED)."
    if track in (PRODUCTION, "", None) or track in (INTERNAL, OPEN):
        why_block("choose the track", f"'{track}' is not a closed track", "nothing sent",
                  "set PLAY_TRACK in google-play.yml to the closed track the check mode lists")
        return 1, "Not sent to Google Play: no closed track named (WHY THIS JOB FAILED)."
    with open(aab, "rb") as fh:
        data = fh.read()
    sha = hashlib.sha256(data).hexdigest()
    head = f"Heart FC Coach {version} (build {build})"
    got_to = "nothing sent"
    try:
        for attempt in (1, 2):
            try:
                state, body = plan_edit(play, version, build, data, sha, notes, track, dry_run, out)
                break
            except EditInvalid as ex:
                play.edit = None
                if attempt == 2:
                    raise Refused("commit", f"the edit was invalidated twice by a change in Play Console ({ex})",
                                  "wait until nobody is editing in Play Console, then re-run") from None
                out(f"the edit was invalidated ({ex}); retrying once with a new edit")
        if state == "done":
            out(f"{head} already on {track}; nothing to do")
            line = f"{head} already on {track}; nothing to do."
        elif state == "planned":
            line = f"Dry run: {head} would go on {track}; nothing was written."
        else:
            got_to = f"committed to {track}"
            read_back(play, track, build, body, out)
            line = (f"{head} is on the {track} closed track; Google's review then makes it available to testers.")
        if production:
            line += " " + to_production(play, version, build, data, sha, notes, dry_run, out)
        return 0, line
    except Refused as r:
        play.discard()
        why_block(r.step, r.why, got_to, r.fix)
        if got_to == "nothing sent":
            out("Play Console is unchanged: the edit was discarded, never committed.")
        return 1, f"{head}: not on {track} (WHY THIS JOB FAILED)." if got_to == "nothing sent" else \
            f"{head} is on {track}, but a later step refused (WHY THIS JOB FAILED)."
    except PlayError as err:
        play.discard()
        why, fix = explain(err, "read", track)
        why_block("read", why, got_to, fix)
        return 1, f"{head}: not on {track} (WHY THIS JOB FAILED)."
    except ForbiddenWrite as ex:
        play.discard()
        why_block("the client's guard", f"{ex} (stopped before it was sent)", got_to,
                  "a bug in play_api.py: this run must never send that; report it on #232")
        return 1, f"{head}: not on {track} (WHY THIS JOB FAILED)."


def to_production(play, version, build, data, sha, notes, dry_run, out):
    """Criterion 12: a second edit, after the closed track is committed."""
    state, body = plan_edit(play, version, build, data, sha, notes, PRODUCTION, dry_run, out)
    if state == "done":
        return "Already on production."
    if state == "planned":
        return "Production: would be sent too."
    read_back(play, PRODUCTION, build, body, out)
    return "Also sent to production; Google's review then publishes it."


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def options(args, known, flags=("--dry-run",)):
    opts = {k: None for k in (*known, *flags)}
    pos, i = [], 0
    while i < len(args):
        a = args[i]
        if a in flags:
            opts[a] = True
            i += 1
        elif a in known and i + 1 < len(args):
            opts[a] = args[i + 1]
            i += 2
        elif a.startswith("--"):
            raise SystemExit(f"unknown option {a}\n{__doc__}")
        else:
            pos.append(a)
            i += 1
    return pos, opts


def summarise(path, line):
    print(line)
    if path:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(line + "\n")


def connect(package, read_only, production=False, factory=None):
    play = (factory or Play)(package, read_only=read_only, production=production)
    try:
        play.authenticate()
    except Refused as r:
        why_block(r.step, r.why, "nothing sent", r.fix)
        return None
    return play


def main(argv, factory=None):
    args = argv[1:]
    if args == ["--self-test"]:
        return self_test()
    cmd, rest = (args[0], args[1:]) if args else ("", [])
    if cmd == "check":
        pos, o = options(rest, ("--summary",))
        if len(pos) != 1:
            print(__doc__)
            return 2
        play = connect(pos[0], read_only=True, factory=factory)
        if not play:
            summarise(o["--summary"], "Google Play check refused: the key (WHY THIS JOB FAILED).")
            return 1
        code, line = check(play)
        summarise(o["--summary"], line)
        return code
    if cmd == "release":
        pos, o = options(rest, ("--track", "--production", "--summary"))
        if len(pos) != 5 or o["--production"] not in (None, "on", "off"):
            print(__doc__)
            return 2
        package, version, build, aab, notes_file = pos
        production = o["--production"] == "on"
        dry = bool(o["--dry-run"])
        with open(notes_file, encoding="utf-8") as fh:
            notes = fh.read().strip()
        play = connect(package, read_only=dry, production=production and not dry, factory=factory)
        if not play:
            summarise(o["--summary"], f"Heart FC Coach {version} (build {build}): not sent (WHY THIS JOB FAILED).")
            return 1
        code, line = release(play, version, build, aab, notes, o["--track"] or "", production, dry)
        summarise(o["--summary"], line)
        return code
    if cmd == "notes-check" and rest:
        pos, o = options(rest, (), flags=("--require",))
        with open(pos[0], encoding="utf-8") as fh:
            text = fh.read()
        errors, warnings = notes_problems(text, require=bool(o["--require"]))
        for w in warnings:
            print(f"warning: {w} (a version-bump PR fails on this)")
        for e in errors:
            print(f"WHY THIS JOB FAILED: {e}")
        if not errors:
            print(f"{pos[0]}: {len(text.strip())} characters as Google Play release notes")
        return 1 if errors else 0
    if cmd == "sdk-check" and len(rest) == 1:
        with open(rest[0], encoding="utf-8") as fh:
            found = sdk_problems(json.load(fh))
        for f in found:
            print(f"WHY THIS JOB FAILED: {f}")
        if not found:
            print("P7: no analytics or crash-reporting SDK in package-lock.json; Data safety's "
                  "'no data collected' stays true")
        return 1 if found else 0
    if cmd == "key-check" and not rest:
        problems = key_problems(os.environ.get("PLAY_SERVICE_ACCOUNT_JSON", ""))
        for p in problems:
            print(f"WHY THIS JOB FAILED: {p}")
        if not problems:
            print("PLAY_SERVICE_ACCOUNT_JSON: a service-account key (values not printed)")
        return 1 if problems else 0
    print(__doc__)
    return 2


# ---------------------------------------------------------------------------
# Self-test: fixtures, no network. The healthy case first.
# ---------------------------------------------------------------------------

PKG = "com.vanstoner.coachingapp"


class FakePlay:
    """Play's API in memory, enough for every path here. Edits are copies;
    commit applies them. A request the guard lets through lands here."""

    def __init__(self, tracks=None, bundles=None, lang=LOCALE, errors=None, invalidate=0):
        self.tracks = tracks if tracks is not None else {
            INTERNAL: [{"name": "1.3.0 (build 238)", "versionCodes": ["238"], "status": "completed"}],
            DEFAULT_CLOSED: [], "Coaches": [], OPEN: [], PRODUCTION: []}
        self.bundles = bundles if bundles is not None else [{"versionCode": 238, "sha256": "a" * 64}]
        self.lang = lang
        self.errors = errors or {}     # (method, suffix) -> (status, body)
        self.invalidate = invalidate   # commits to refuse as "edit deleted"
        self.edits = {}
        self.n = 0
        self.log = []

    def __call__(self, method, url, headers, data):
        path = url.split("?")[0]
        self.log.append((method, path))
        for (m, suffix), (status, body) in self.errors.items():
            if m == method and path.endswith(suffix):
                return status, json.dumps(body).encode() if isinstance(body, dict) else body.encode()
        if path.endswith("/token"):
            return 200, b'{"access_token": "ya29.fake", "expires_in": 3599}'
        m = re.search(r"/edits(?:/([^/:]+))?(:commit|/details|/tracks(?:/([^/]+))?|/bundles)?$", path)
        edit, tail, tname = m.group(1), m.group(2) or "", urllib.parse.unquote(m.group(3) or "")
        if method == "POST" and edit is None:
            self.n += 1
            eid = f"edit{self.n}"
            self.edits[eid] = {"tracks": json.loads(json.dumps(self.tracks)), "bundles": list(self.bundles)}
            return 200, json.dumps({"id": eid}).encode()
        if edit not in self.edits:
            return 400, json.dumps({"error": {"code": 400, "message": "This Edit has been deleted."}}).encode()
        ed = self.edits[edit]
        if method == "DELETE" and not tail:
            del self.edits[edit]
            return 204, b""
        if method == "GET" and tail == "/details":
            return 200, json.dumps({"defaultLanguage": self.lang, "contactEmail": "rob@example.org"}).encode()
        if method == "GET" and tail == "/tracks":
            return 200, json.dumps({"tracks": [{"track": k, "releases": v} for k, v in ed["tracks"].items()]}).encode()
        if method == "GET" and tname:
            if tname not in ed["tracks"]:
                return 404, b'{"error": {"code": 404, "message": "Track not found."}}'
            return 200, json.dumps({"track": tname, "releases": ed["tracks"][tname]}).encode()
        if method == "GET" and tail == "/bundles":
            return 200, json.dumps({"bundles": ed["bundles"]}).encode()
        if method == "POST" and tail == "/bundles":
            code = int(re.search(rb"versionCode=(\d+)", data).group(1))
            ed["bundles"].append({"versionCode": code, "sha256": hashlib.sha256(data).hexdigest()})
            return 200, json.dumps(ed["bundles"][-1]).encode()
        if method == "PUT" and tname:
            if tname not in ed["tracks"]:
                return 404, b'{"error": {"code": 404, "message": "Track not found."}}'
            ed["tracks"][tname] = json.loads(data)["releases"]
            return 200, data
        if method == "POST" and tail == ":commit":
            if self.invalidate:
                self.invalidate -= 1
                del self.edits[edit]
                return 400, b'{"error": {"code": 400, "message": "This Edit has been deleted."}}'
            self.tracks, self.bundles = ed["tracks"], ed["bundles"]
            del self.edits[edit]
            return 200, json.dumps({"id": edit}).encode()
        return 500, b'{"error": {"message": "fake: unhandled"}}'

    def writes(self):
        return [(m, p) for m, p in self.log if m in ("PUT", "PATCH") or p.endswith(":commit")
                or "/upload/" in p]


def self_test():
    failed = 0

    def expect(name, ok):
        nonlocal failed
        failed += not ok
        print(f"  {'ok' if ok else 'x '} {name}")

    sa = json.dumps({"type": "service_account", "client_email": "ci@heart-of-the-game-ci.iam.gserviceaccount.com",
                     "private_key": "-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----\n",
                     "token_uri": TOKEN_URI})
    fake_sign = lambda key, data: b"sig"  # noqa: E731
    NOTES = "New in 2.2.0:\n\n• Sub alerts that buzz\n• Fair shares at a glance"
    tmp = tempfile.mkdtemp()
    aab = os.path.join(tmp, "coaching-app_2.2.0_abc1234.aab")
    with open(aab, "wb") as fh:
        fh.write(b"PK fake bundle versionCode=310")
    SHA = hashlib.sha256(open(aab, "rb").read()).hexdigest()

    def client(fake, read_only=False, production=False):
        p = Play(PKG, read_only=read_only, production=production, transport=fake)
        p.authenticate(sa, now=1_700_000_000, sign=fake_sign)
        return p

    def run(fake, dry=False, track="Coaches", production=False, notes=NOTES):
        lines = []
        p = client(fake, read_only=dry, production=production and not dry)
        code, line = release(p, "2.2.0", 310, aab, notes, track, production, dry, out=lines.append)
        return code, line, lines, p

    print("healthy cases")
    # The key, the token, the JWT.
    expect("a healthy service-account key passes key-check", key_problems(sa) == [])
    jwt = assertion(json.loads(sa), 1_700_000_000, fake_sign)
    claims = json.loads(base64.urlsafe_b64decode(jwt.split(".")[1] + "=="))
    expect("the JWT asks for the androidpublisher scope from the token URI, for an hour",
           claims["scope"] == SCOPE and claims["aud"] == TOKEN_URI and claims["exp"] - claims["iat"] == 3600)

    # P1: check, read-only, deletes its edit, prints no contact detail.
    fake = FakePlay()
    out = []
    p = client(fake, read_only=True)
    code, line = check(p, out=out.append)
    text = "\n".join(out)
    expect("check on a healthy app: green, every value read", code == 0 and "P4 default listing language: en-GB" in text
           and "internal: 1.3.0 (build 238): completed, version codes [238]" in text
           and "P3 bundles uploaded: 1, version codes [238]" in text and "draft app (no release ever rolled out): no" in text
           and "closed tracks: alpha, Coaches" in text and "P1 edit: deleted, not committed" in text)
    expect("check writes nothing and leaves no edit open", fake.writes() == [] and fake.edits == {})
    expect("check never prints the contact email or the service account", "@" not in text)
    expect("P5 reports production as untested and P6 as not readable",
           "Release to production: untested" in text and "P6 managed publishing: the API does not report it" in text)

    # The healthy release: upload, track, commit, read back.
    fake = FakePlay()
    code, line, lines, p = run(fake)
    rel = fake.tracks["Coaches"]
    expect("release: build 310 completed on Coaches with en-GB notes, named '2.2.0 (build 310)'",
           code == 0 and rel == [release_body("2.2.0", 310, NOTES)])
    expect("release: one edit, committed once (criterion 4)",
           sum(1 for m, q in fake.log if q.endswith(":commit")) == 1 and [m for m, q in fake.log if m == "PUT"] == ["PUT"])
    expect("release: the summary is the one line criterion 1 names",
           line == "Heart FC Coach 2.2.0 (build 310) is on the Coaches closed track; "
                   "Google's review then makes it available to testers.")
    expect("release: read back and logged", any(x.startswith("read back: Coaches: '2.2.0 (build 310)'") for x in lines))
    expect("release: no edit left open", fake.edits == {})

    # Criterion 11: a re-run does nothing.
    before = len(fake.writes())
    code, line, lines, p = run(fake)
    expect("re-run: '… already on Coaches; nothing to do', green, nothing written",
           code == 0 and "already on Coaches; nothing to do" in line and len(fake.writes()) == before)

    # Criterion 11: a bundle Play already holds is reused.
    fake = FakePlay(bundles=[{"versionCode": 238, "sha256": "a" * 64}, {"versionCode": 310, "sha256": SHA}])
    code, line, lines, p = run(fake)
    expect("a bundle Play holds (same sha256) is reused, not uploaded",
           code == 0 and not any("/upload/" in q for m, q in fake.log) and any("reuse" in x for x in lines))

    # Criterion 9: dry run.
    fake = FakePlay()
    code, line, lines, p = run(fake, dry=True)
    expect("dry run: green, prints the plan, writes nothing, deletes its edit",
           code == 0 and line.startswith("Dry run:") and fake.writes() == [] and fake.edits == {}
           and any(x.startswith("plan: track Coaches: release '2.2.0 (build 310)'") for x in lines))

    # Criterion 4/14: an edit invalidated once is retried, and succeeds.
    fake = FakePlay(invalidate=1)
    code, line, lines, p = run(fake)
    expect("an edit invalidated once is retried with a new edit, and succeeds",
           code == 0 and any("retrying once" in x for x in lines) and fake.tracks["Coaches"])

    # Criterion 12: production on, healthy.
    fake = FakePlay()
    code, line, lines, p = run(fake, production=True)
    expect("PLAY_PRODUCTION on: closed track, then production in a second edit",
           code == 0 and fake.tracks[PRODUCTION] and fake.tracks["Coaches"]
           and sum(1 for m, q in fake.log if q.endswith(":commit")) == 2)

    # Notes and SDK checks, healthy.
    expect("notes: healthy plain text passes", notes_problems(NOTES) == ([], []))
    expect("notes: 500 characters exactly passes", notes_problems("a" * 500) == ([], []))
    expect("sdk-check: this project's dependencies pass",
           sdk_problems({"packages": {"node_modules/expo": {}, "node_modules/text-segmentation": {}}}) == [])

    print("the guard (P1, criteria 9 and 13)")
    p = client(FakePlay(), read_only=True)
    p.open_edit()
    own = p.edit

    def refused(fn):
        try:
            fn()
        except ForbiddenWrite:
            return True
        except Exception:  # noqa: BLE001 — sent and failed is still not refused
            pass
        return False
    expect("read-only refuses an upload", refused(lambda: p.upload(b"x")))
    expect("read-only refuses a track update", refused(lambda: p.set_track("Coaches", release_body("1", 1, "n"))))
    expect("read-only refuses a commit", refused(lambda: p.commit()))
    expect("read-only refuses a PATCH", refused(lambda: p.call("PATCH", p.e("/tracks/Coaches"), {})))
    expect("read-only refuses DELETE of another edit",
           refused(lambda: p.call("DELETE", f"{API}/{PKG}/edits/someone-elses")))
    expect("read-only refuses a listing write", refused(lambda: p.call("PUT", p.e("/listings/en-GB"), {})))
    expect("read-only refuses a second edit", refused(lambda: p.call("POST", f"{API}/{PKG}/edits", {})))
    expect("read-only allows deleting its own edit", p.discard() and p.edit is None)
    expect("the edit it deleted was the one it opened", ("DELETE", f"/{PKG}/edits/{own}") in p.sent)

    w = client(FakePlay())
    w.open_edit()
    expect("write mode refuses the production track while PLAY_PRODUCTION is off",
           refused(lambda: w.set_track(PRODUCTION, release_body("1", 1, "n"))))
    expect("write mode refuses a halted release",
           refused(lambda: w.set_track("Coaches", dict(release_body("1", 1, "n"), status="halted"))))
    expect("write mode refuses a staged rollout",
           refused(lambda: w.set_track("Coaches", dict(release_body("1", 1, "n"), status="completed", userFraction=0.2))))
    expect("write mode refuses two releases on a track",
           refused(lambda: w.call("PUT", w.e("/tracks/Coaches"), {"track": "Coaches", "releases": [{}, {}]})))
    expect("write mode refuses testers", refused(lambda: w.call("PUT", w.e("/testers/Coaches"), {})))
    expect("write mode refuses listings, images, details, countries",
           all(refused(lambda t=t: w.call("PUT", w.e(t), {})) for t in
               ("/listings/en-GB", "/listings/en-GB/phoneScreenshots", "/details", "/countryAvailability/Coaches")))
    expect("write mode refuses deleting a listing language", refused(lambda: w.call("DELETE", w.e("/listings/en-GB"))))
    expect("write mode refuses commit with changesNotSentForReview",
           refused(lambda: w.call("POST", w.e(":commit") + "?changesNotSentForReview=true")))
    w.discard()

    print("failure modes (criterion 14): each refuses with WHY THIS JOB FAILED, healthy cases above")

    def err(status, message, reason=None):
        body = {"error": {"code": status, "message": message}}
        if reason:
            body["error"]["errors"] = [{"reason": reason}]
        return status, body

    def fails(name, fake, *words, production=False, track="Coaches", notes=NOTES, dry=False):
        s = io.StringIO()
        with contextlib.redirect_stdout(s):
            code, line, lines, p = run(fake, dry=dry, track=track, production=production, notes=notes)
        printed = s.getvalue() + "\n".join(lines)
        ok = code == 1 and "WHY THIS JOB FAILED" in printed and all(w.lower() in printed.lower() for w in words)
        expect(name, ok)
        if not ok:
            print(printed)
        return fake, printed

    # key secret missing or malformed
    for raw, word in (("", "not set"), ("{not json", "not JSON"),
                      (json.dumps({"type": "authorized_user"}), "service_account"),
                      (json.dumps({"type": "service_account", "client_email": "x@y.iam.gserviceaccount.com",
                                   "private_key": "abc"}), "PEM")):
        p = Play(PKG, transport=FakePlay())
        try:
            p.authenticate(raw, sign=fake_sign)
            ok = False
        except Refused as r:
            ok = word in r.why
        expect(f"key: {word or 'empty'} is refused, naming the problem, never a value", ok)
    expect("key: invalid_grant at the token endpoint is named",
           "refused the service account's key" in explain(
               PlayError("POST", "token", 400, '{"error": "invalid_grant", "error_description": "Invalid JWT"}'),
               "authenticate")[0])

    # API not enabled (P2): named, not retried
    fake = FakePlay(errors={("POST", "/edits"): err(403, "Google Play Android Developer API has not been used in "
                                                    "project 1 before or it is disabled.", "accessNotConfigured")})
    fails("API not enabled: 'enable the Google Play Android Developer API', no retry", fake,
          "enable the Google Play Android Developer API")
    expect("API not enabled: asked once only", sum(1 for m, q in fake.log if q.endswith("/edits")) == 1)

    # app not found / no access
    fails("app not found (P3)", FakePlay(errors={("POST", "/edits"): err(404, "Package not found: x.")}),
          "no Play app has this package")
    # service account lacks a permission, named
    fails("permission: 403 on the upload names Release to testing tracks",
          FakePlay(errors={("POST", "/bundles"): err(403, "The caller does not have permission")}),
          "Release to testing tracks")
    # draft app
    fails("draft app: refused before any write", FakePlay(tracks={INTERNAL: [{"status": "draft", "versionCodes": ["238"]}],
                                                                  "Coaches": []}), "draft")
    fails("draft app: Google's own refusal is named too",
          FakePlay(errors={("PUT", "/tracks/Coaches"): err(400, "Only releases with status draft may be created on draft app.")}),
          "draft")
    # version code already used
    fails("version code used by a different bundle (our sha256 differs)",
          FakePlay(bundles=[{"versionCode": 310, "sha256": "b" * 64}]), "different bundle as version code 310")
    fails("version code used: Google's own refusal is named",
          FakePlay(errors={("POST", "/bundles"): err(403, "APK specifies a version code that has already been used.")}),
          "already holds a different bundle")
    # wrong upload key
    fails("wrong upload key", FakePlay(errors={("POST", "/bundles"): err(
        400, "The Android App Bundle was signed with the wrong key. Found: SHA1: AA, expected: SHA1: BB.")}),
        "not signed with the upload key", "App integrity")
    # track not found
    fails("track not found: lists the tracks Play has", FakePlay(), "track 'Coachez' not found", "Coaches",
          track="Coachez")
    # changesNotSentForReview
    fake = FakePlay(errors={("POST", ":commit"): err(400, "Changes cannot be sent for review automatically. "
                                                     "Please set the query parameter changesNotSentForReview to true.")})
    fails("changesNotSentForReview: Rob's, never set automatically", fake, "Send changes for review")
    expect("changesNotSentForReview: the run did not resend with it set",
           not any("changesNotSentForReview" in q for m, q in fake.log))
    # edit invalidated twice
    fails("edit invalidated twice: refused after one retry", FakePlay(invalidate=2), "invalidated twice")
    # notes over the limit, rechecked here
    fails("notes over 500 characters: refused before any Play call", FakePlay(), "501 characters", notes="a" * 501)
    fails("notes with an issue number", FakePlay(), "issue number", notes="Fixes #232")
    fails("notes with TestFlight wording", FakePlay(), "TestFlight", notes="As in TestFlight")
    # production refused: the closed release stands
    fake = FakePlay(errors={("PUT", "/tracks/production"): err(403, "Production access is not granted for this app.")})
    fails("production refused: named, and the closed track release stands", fake, "production refused",
          "the closed track release stands", production=True)
    expect("production refused: build 310 is on Coaches", fake.tracks["Coaches"] == [release_body("2.2.0", 310, NOTES)])
    # a refusal before commit leaves Play unchanged and the edit deleted
    fake = FakePlay(errors={("PUT", "/tracks/Coaches"): err(500, "Internal error")})
    fails("a refusal before the commit: Play Console unchanged, edit discarded", fake, "Play Console is unchanged")
    expect("…nothing committed and no edit left open",
           not any(q.endswith(":commit") for m, q in fake.log) and fake.edits == {} and fake.tracks["Coaches"] == [])
    # an unfinished release is never replaced
    fails("a draft or staged release on the track is never replaced",
          FakePlay(tracks={INTERNAL: [{"status": "completed", "versionCodes": ["238"]}],
                           "Coaches": [{"name": "x", "status": "inProgress", "versionCodes": ["300"], "userFraction": 0.2}]}),
          "never replaces")
    fails("a newer build on the track: never goes backwards",
          FakePlay(tracks={INTERNAL: [{"status": "completed", "versionCodes": ["238"]}],
                           "Coaches": [{"name": "x", "status": "completed", "versionCodes": ["400"]}]}),
          "go backwards")
    fails("the production track is never PLAY_TRACK", FakePlay(), "not a closed track", track=PRODUCTION)
    # check: the stop conditions
    for name, fake, word in (("no bundle", FakePlay(bundles=[]), "no bundle"),
                             ("draft app", FakePlay(tracks={INTERNAL: [], "alpha": []}), "draft"),
                             ("language", FakePlay(lang="en-US"), "en-US"),
                             ("no closed track", FakePlay(tracks={INTERNAL: [{"status": "completed",
                                                                              "versionCodes": ["238"]}]}), "no closed track")):
        s = io.StringIO()
        with contextlib.redirect_stdout(s):
            code, _ = check(client(fake, read_only=True))
        expect(f"check stops on {name}, with WHY THIS JOB FAILED, and deletes its edit",
               code == 1 and word in s.getvalue() and "WHY THIS JOB FAILED" in s.getvalue() and fake.edits == {})
    # sdk-check: an analytics SDK
    expect("sdk-check refuses an analytics SDK",
           sdk_problems({"packages": {"node_modules/@react-native-firebase/analytics": {}}}) != [])
    # notes-check: over 500 warns without --require, fails with it
    expect("notes over 500: a warning on an ordinary PR, an error on a bump",
           notes_problems("a" * 600, require=False)[0] == [] and notes_problems("a" * 600, require=False)[1]
           and notes_problems("a" * 600, require=True)[0])
    # scrub
    expect("Google's reply is scrubbed of addresses and tokens",
           "@" not in scrub("ci@x.iam.gserviceaccount.com ya29.abc") and "ya29" not in scrub("ya29.abc"))

    print(f"play_api.py self-test: {'all passed' if not failed else f'{failed} FAILED'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
