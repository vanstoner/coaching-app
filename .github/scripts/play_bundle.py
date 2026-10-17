#!/usr/bin/env python3
"""The Google Play bundle: check it, sign it with Rob's upload key — #211.

A build of main makes an Android App Bundle (.aab) beside the APK. Play
accepts only a bundle signed with the developer's *upload key*; Play then
re-signs what it installs with its own app signing key (Play App Signing).
The APK on the releases page stays debug-signed and sideloadable.

    play_bundle.py check AAB_MANIFEST_XML APK AAB PACKAGE VERSION_NAME VERSION_CODE
        The bundle is Heart FC Coach at this version and run, backed up, and
        carries exactly the JS bundle of the APK that passed the emulator test
        (#211 A2-A4, E4). AAB_MANIFEST_XML is `bundletool dump manifest`.
    play_bundle.py rehearse AAB
        Signs a copy with a throwaway key made here and verifies it, and proves
        the debug-signed bundle itself is refused (B6's dry run). Never touches
        a real key.
    play_bundle.py secrets
        Which upload-key secrets are set: prints `absent`, `present`, or
        `partial: NAMES` (exit 1). Never prints a value.
    play_bundle.py sign AAB OUT
        Decodes the keystore from the secrets into a private temp file, signs
        a copy of AAB as OUT, verifies it, prints the SHA-256 fingerprint, and
        deletes the keystore whatever happens.
    play_bundle.py assets RELEASE_JSON
        Every asset on the release is one this project publishes (#211 D14).
    play_bundle.py --self-test

Passwords reach jarsigner and keytool through environment variables
(`-storepass:env`), never on a command line, so they cannot appear in a log.
"""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ANDROID = "{http://schemas.android.com/apk/res/android}"
SECRETS = ("PLAY_UPLOAD_KEYSTORE_BASE64", "PLAY_UPLOAD_KEYSTORE_PASSWORD", "PLAY_UPLOAD_KEY_ALIAS")
APK_JS = "assets/index.android.bundle"
AAB_JS = "base/assets/index.android.bundle"
# What a release of this project may carry (#211 D14). The simulator zip is
# ios.yml's (#107). Anything else, a keystore above all, is refused.
ALLOWED_ASSETS = (
    r"coaching-app_[^/]+\.apk",
    r"coaching-app_[^/]+\.apk\.sha256",
    r"coaching-app_[^/]+\.aab",
    r"coaching-app_[^/]+\.aab\.sha256",
    r"coaching-(app|beta)-ios-simulator_[^/]+\.zip",
)
SIGNATURE_FILE = re.compile(r"^META-INF/([^/]+\.(SF|RSA|DSA|EC)|MANIFEST\.MF)$", re.I)
DEBUG_OWNER = "CN=Android Debug"


# ---------------------------------------------------------------------------
# Pure
# ---------------------------------------------------------------------------

def manifest_problems(xml_text, package, version_name, version_code):
    """Every way the bundle's manifest is not Heart FC Coach at this build."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        return [f"the manifest could not be read ({e})"]
    found = []
    got = {
        "package": root.get("package"),
        "versionName": root.get(f"{ANDROID}versionName"),
        "versionCode": root.get(f"{ANDROID}versionCode"),
    }
    want = {"package": package, "versionName": version_name, "versionCode": str(version_code)}
    for key, value in want.items():
        print(f"  {key}: {got[key]} (expected {value})")
        if got[key] != value:
            found.append(f"{key} is {got[key]!r}, expected {value!r}")
    app = root.find("application")
    backup = app.get(f"{ANDROID}allowBackup") if app is not None else None
    print(f"  allowBackup: {backup} (expected true)")
    if backup != "true":
        found.append(f"allowBackup is {backup!r}: Heart FC Coach is backed up by the phone (#112)")
    return found


def js_problems(apk, aab):
    """The bundle must carry the very JS the tested APK carries (E4)."""
    try:
        with zipfile.ZipFile(apk) as a:
            apk_js = a.read(APK_JS)
        with zipfile.ZipFile(aab) as b:
            aab_js = b.read(AAB_JS)
    except (KeyError, zipfile.BadZipFile, OSError) as e:
        return [f"the JS bundle could not be read from both files ({e})"]
    ha, hb = hashlib.sha256(apk_js).hexdigest(), hashlib.sha256(aab_js).hexdigest()
    print(f"  APK {APK_JS}: {len(apk_js)} bytes, sha256 {ha}")
    print(f"  AAB {AAB_JS}: {len(aab_js)} bytes, sha256 {hb}")
    return [] if ha == hb else ["the bundle's JS is not the JS of the APK that passed the emulator test"]


def secrets_state(env):
    missing = [s for s in SECRETS if not env.get(s, "").strip()]
    if not missing:
        return "present", []
    if len(missing) == len(SECRETS):
        return "absent", missing
    return "partial", missing


def asset_problems(names):
    return [f"release asset {n!r} is not one this project publishes" for n in names
            if not any(re.fullmatch(p, n) for p in ALLOWED_ASSETS)]


def unsigned_copy(src, dst):
    """SRC without its signature files, so it can be signed afresh."""
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for item in zin.infolist():
            if not SIGNATURE_FILE.match(item.filename):
                zout.writestr(item, zin.read(item.filename))


# ---------------------------------------------------------------------------
# Signing (jarsigner and keytool, from the JDK)
# ---------------------------------------------------------------------------

def run(args, env=None):
    """Runs a JDK tool; its output is returned, never echoed, so nothing it
    says about a keystore reaches the log unless we choose to print it."""
    p = subprocess.run(args, capture_output=True, text=True, env=env)
    return p.returncode, (p.stdout + p.stderr)


def sign(src, out, keystore, alias, password_env):
    """Signs a copy of SRC as OUT. Returns a list of problems (empty: signed)."""
    unsigned_copy(src, out)
    env = dict(os.environ)
    code, text = run(["jarsigner", "-keystore", keystore, "-storepass:env", password_env,
                      "-keypass:env", password_env, "-sigalg", "SHA256withRSA",
                      "-digestalg", "SHA-256", out, alias], env=env)
    if code == 0:
        return []
    low = text.lower()
    if "password" in low or "keystore was tampered" in low:
        return ["the keystore password (PLAY_UPLOAD_KEYSTORE_PASSWORD) does not open the keystore"]
    if "alias" in low or "certificate chain not found" in low:
        return ["the key alias (PLAY_UPLOAD_KEY_ALIAS) is not in the keystore"]
    if "keystore" in low:
        return ["PLAY_UPLOAD_KEYSTORE_BASE64 is not a keystore jarsigner can read"]
    return ["jarsigner could not sign the bundle (its output is withheld: it may describe the keystore)"]


def verify(aab):
    """(problems, sha256 fingerprint) of the bundle's one signer."""
    # Not -strict: an upload key is self-signed by design, which -strict
    # counts as an error. Play checks the certificate itself, by fingerprint.
    code, text = run(["jarsigner", "-verify", aab])
    if code != 0 or "jar verified" not in text:
        return ["the bundle's signature does not verify"], None
    code, text = run(["keytool", "-printcert", "-jarfile", aab])
    owners = re.findall(r"^Owner: (.*)$", text, re.M)
    prints = re.findall(r"SHA256: ([0-9A-F:]{95})", text)
    if len(owners) != 1 or len(prints) != 1:
        return [f"expected one signer, found {len(owners)}"], None
    print(f"  signer: {owners[0]}")
    print(f"  SHA-256 fingerprint: {prints[0]}")
    if DEBUG_OWNER in owners[0]:
        return ["the bundle is signed with the Android debug key, which Play refuses"], prints[0]
    return [], prints[0]


def make_keystore(path, alias, password, owner):
    env = dict(os.environ, KS_PASS=password)
    code, text = run(["keytool", "-genkeypair", "-keystore", path, "-storetype", "PKCS12",
                      "-storepass:env", "KS_PASS", "-alias", alias, "-keyalg", "RSA",
                      "-keysize", "2048", "-validity", "10000", "-dname", owner], env=env)
    if code != 0:
        raise RuntimeError(f"keytool could not make a throwaway keystore: {text}")


def sign_with_secrets(src, out):
    state, missing = secrets_state(os.environ)
    if state != "present":
        return [f"not all upload-key secrets are set (missing: {', '.join(missing)})"], None
    fd, keystore = tempfile.mkstemp(suffix=".keystore", dir=os.environ.get("RUNNER_TEMP"))
    try:
        try:
            raw = base64.b64decode("".join(os.environ["PLAY_UPLOAD_KEYSTORE_BASE64"].split()), validate=True)
        except ValueError:
            return ["PLAY_UPLOAD_KEYSTORE_BASE64 is not base64 (paste the output of the base64 step exactly)"], None
        with os.fdopen(fd, "wb") as fh:
            fh.write(raw)
        problems = sign(src, out, keystore, os.environ["PLAY_UPLOAD_KEY_ALIAS"].strip(),
                        "PLAY_UPLOAD_KEYSTORE_PASSWORD")
        if problems:
            return problems, None
        return verify(out)
    finally:
        os.remove(keystore)


def rehearse(aab):
    """B6's dry run on the real bundle: a throwaway key signs and verifies; the
    debug-signed bundle as Gradle made it is refused."""
    failed = []
    with tempfile.TemporaryDirectory() as d:
        ks = os.path.join(d, "throwaway.keystore")
        make_keystore(ks, "upload", "throwaway-pass", "CN=Throwaway upload key, O=CI rehearsal")
        os.environ["REHEARSAL_PASS"] = "throwaway-pass"
        signed = os.path.join(d, "signed.aab")
        problems = sign(aab, signed, ks, "upload", "REHEARSAL_PASS")
        problems += verify(signed)[0] if not problems else []
        print(f"  signed with a throwaway key: {'accepted' if not problems else problems}")
        if problems:
            failed.append("a throwaway-signed copy of the real bundle was refused")
        debug_problems, _ = verify(aab)
        print(f"  as Gradle made it (debug key): {debug_problems or 'ACCEPTED'}")
        if not debug_problems:
            failed.append("the debug-signed bundle was accepted; the gate would pass a bundle Play refuses")
    return failed


# ---------------------------------------------------------------------------
# Self-test: the healthy case first
# ---------------------------------------------------------------------------

def manifest(package="com.vanstoner.coachingapp", name="1.1.1", code="420", backup="true"):
    return (f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{package}" '
            f'android:versionCode="{code}" android:versionName="{name}">'
            f'<application android:allowBackup="{backup}"/></manifest>')


def fake_bundle(path, js=b"var label='build 420';"):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("BundleConfig.pb", b"\x00")
        z.writestr("base/manifest/AndroidManifest.xml", b"\x00")
        z.writestr(AAB_JS, js)


def fake_apk(path, js=b"var label='build 420';"):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("AndroidManifest.xml", b"\x00")
        z.writestr(APK_JS, js)


def self_test():
    failed = total = 0

    def check(name, cond):
        nonlocal failed, total
        total += 1
        failed += not cond
        print(f"  {'ok' if cond else 'x '} {name}")

    want = ("com.vanstoner.coachingapp", "1.1.1", 420)
    check("healthy: Heart FC Coach at this version and run", manifest_problems(manifest(), *want) == [])
    check("fails: the beta's id", bool(manifest_problems(manifest(package="com.vanstoner.coachingapp.beta"), *want)))
    check("fails: versionCode left at Expo's default", bool(manifest_problems(manifest(code="1"), *want)))
    check("fails: another version", bool(manifest_problems(manifest(name="1.1.0"), *want)))
    check("fails: not backed up", bool(manifest_problems(manifest(backup="false"), *want)))

    check("secrets: none set is absent", secrets_state({})[0] == "absent")
    check("secrets: all set is present", secrets_state({s: "x" for s in SECRETS})[0] == "present")
    check("secrets: one missing is partial, named",
          secrets_state({s: "x" for s in SECRETS[:2]}) == ("partial", [SECRETS[2]]))

    real = ["coaching-app_1.1.1_abc1234.apk", "coaching-app_1.1.1_abc1234.apk.sha256",
            "coaching-app_1.1.1_abc1234.aab", "coaching-app_1.1.1_abc1234.aab.sha256",
            "coaching-app-ios-simulator_1.1.1_abc1234.zip"]
    check("healthy: a release's real assets", asset_problems(real) == [])
    check("fails: a keystore on a release", bool(asset_problems(real + ["upload.keystore"])))
    check("fails: a .jks on a release", bool(asset_problems(real + ["coaching-app_1.1.1.jks"])))

    with tempfile.TemporaryDirectory() as d:
        apk, aab = os.path.join(d, "a.apk"), os.path.join(d, "b.aab")
        fake_apk(apk)
        fake_bundle(aab)
        check("healthy: the bundle carries the APK's JS", js_problems(apk, aab) == [])
        fake_bundle(aab, js=b"var label='local dev';")
        check("fails: different JS", bool(js_problems(apk, aab)))
        fake_bundle(aab)

        # Signing, with throwaway keys made here, exactly as Rob's steps make
        # his: PKCS12 from keytool, base64 of the file, three secrets.
        upload = os.path.join(d, "upload.keystore")
        make_keystore(upload, "upload", "right-pass", "CN=Heart FC Coach upload, O=Self-test")
        debug = os.path.join(d, "debug.keystore")
        make_keystore(debug, "androiddebugkey", "android", "CN=Android Debug, O=Android, C=US")
        os.environ["DEBUG_PASS"] = "android"
        debug_signed = os.path.join(d, "debug.aab")
        sign(aab, debug_signed, debug, "androiddebugkey", "DEBUG_PASS")

        with open(upload, "rb") as fh:
            encoded = base64.b64encode(fh.read()).decode()
        good = {"PLAY_UPLOAD_KEYSTORE_BASE64": encoded, "PLAY_UPLOAD_KEYSTORE_PASSWORD": "right-pass",
                "PLAY_UPLOAD_KEY_ALIAS": "upload"}
        saved = {k: os.environ.get(k) for k in SECRETS}
        try:
            os.environ.update(good)
            out = os.path.join(d, "play.aab")
            problems, fingerprint = sign_with_secrets(debug_signed, out)
            check("healthy: the secrets sign a debug-signed bundle afresh, and it verifies",
                  problems == [] and fingerprint is not None)
            check("healthy: the signed bundle keeps every file but the old signature",
                  {i for i in zipfile.ZipFile(aab).namelist()} <=
                  set(zipfile.ZipFile(out).namelist()))
            check("fails: the debug-signed bundle as Gradle makes it", bool(verify(debug_signed)[0]))
            check("rehearsal passes on a debug-signed bundle", rehearse(debug_signed) == [])

            os.environ["PLAY_UPLOAD_KEYSTORE_PASSWORD"] = "wrong-pass"
            problems, _ = sign_with_secrets(debug_signed, out)
            check("fails, named, never echoed: the wrong password",
                  any("PASSWORD" in p for p in problems) and not any("wrong-pass" in p for p in problems))
            os.environ.update(good)
            os.environ["PLAY_UPLOAD_KEY_ALIAS"] = "nope"
            problems, _ = sign_with_secrets(debug_signed, out)
            check("fails, named: the wrong alias", any("ALIAS" in p for p in problems))
            os.environ.update(good)
            os.environ["PLAY_UPLOAD_KEYSTORE_BASE64"] = "not base64!"
            problems, _ = sign_with_secrets(debug_signed, out)
            check("fails, named: a keystore that is not base64", any("BASE64" in p for p in problems))
            os.environ.update(good)
            del os.environ["PLAY_UPLOAD_KEY_ALIAS"]
            problems, _ = sign_with_secrets(debug_signed, out)
            check("fails, named: one secret missing", any("PLAY_UPLOAD_KEY_ALIAS" in p for p in problems))
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        leftovers = [f for f in os.listdir(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir())
                     if f.endswith(".keystore")]
        check("the decoded keystore is deleted every time", leftovers == [])

    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    args = argv[1:]
    if args == ["--self-test"]:
        return self_test()
    if args[:1] == ["check"] and len(args) == 7:
        _, xml_path, apk, aab, package, name, code = args
        with open(xml_path, encoding="utf-8") as fh:
            found = manifest_problems(fh.read(), package, name, code) + js_problems(apk, aab)
    elif args[:1] == ["rehearse"] and len(args) == 2:
        found = rehearse(args[1])
    elif args == ["secrets"]:
        state, missing = secrets_state(os.environ)
        print(state if state != "partial" else f"partial: {', '.join(missing)}")
        return 1 if state == "partial" else 0
    elif args[:1] == ["sign"] and len(args) == 3:
        found, fingerprint = sign_with_secrets(args[1], args[2])
        if fingerprint and not found:
            print(f"FINGERPRINT={fingerprint}")
    elif args[:1] == ["assets"] and len(args) == 2:
        with open(args[1], encoding="utf-8") as fh:
            names = [a.get("name", "") for a in json.load(fh).get("assets", [])]
        print("  assets: " + ", ".join(names))
        found = asset_problems(names)
    else:
        print(__doc__, file=sys.stderr)
        return 2
    for p in found:
        print(f"PROBLEM: {p}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
