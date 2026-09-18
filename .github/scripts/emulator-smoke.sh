#!/usr/bin/env bash
#
# Emulator smoke test — issues #43 and #46.
#
# Runs inside reactivecircus/android-emulator-runner, with an emulator already
# booted. Installs the release APK the build job produced, launches it, and
# makes three assertions in the order the Product Owner ruled on 2026-09-18:
#
#   1. the app launches and does not crash  (process alive, logcat clean)
#   2. the screen is not blank              (not uniformly one colour)
#   3. the expected text is on screen       (OCR finds it)
#
# ---------------------------------------------------------------------------
# What changed for #46, and why it is the whole point
# ---------------------------------------------------------------------------
#
# The first version of this script started a Metro dev server and served the
# JS bundle to the app over `adb reverse`. That was necessary, because the
# artifact under test was a *debug* APK: React Native 0.86.3's gradle plugin
# creates no bundle task at all for the `debug` variant, so a debug APK has no
# JS inside it and fetches it at launch. The job therefore proved the app code
# rendered; it did not prove the artifact did. That gap is issue #46.
#
# This version deliberately runs **no dev server at all**, and goes further:
# it tears down any adb reverse tunnel before launching, so there is nothing
# the app could reach even if one had been left behind. Three assertions then
# do their work against an app that has nothing but itself.
#
# A fourth gate backs them up. Under a missing bundle React Native logs
# "Unable to load script" / "Could not connect to development server" and
# draws its red box. That used to be printed as a HINT. With no dev server
# anywhere in the picture it is no longer a hint, it is the failure mode this
# job exists to catch, so it now **fails the job**. Assertion 3 would catch the
# red box anyway; this makes the diagnosis unambiguous rather than inferred
# from an OCR miss.
#
# The complementary assertion lives in the build job, which fails unless
# `assets/index.android.bundle` is actually inside the APK. Together: the
# bundle is in the file, and the file renders with nothing else running.
#
# ---------------------------------------------------------------------------
# What this proves and what it does not
# ---------------------------------------------------------------------------
#
# PROVES: this exact APK, installed on a clean Android 14 x86_64 emulator with
# no dev server, no network peer and no tunnel, launches, survives ~40 seconds,
# draws a non-trivial screen, and that screen reads as the expected text.
#
# DOES NOT PROVE: behaviour on real hardware, on an ARM ABI, on other API
# levels, after backgrounding, under low memory, or for longer than the settle
# window. It is a smoke test, not a device matrix.
#
# ---------------------------------------------------------------------------
# Shell discipline
# ---------------------------------------------------------------------------
#
# Learned from commits 4f21782 and 1b76348 and from QA's Obs-4: this file is
# run as `bash emulator-smoke.sh`, a fresh shell, so it sets its own options.
# `-e` is deliberately NOT set — every command that can fail is checked
# explicitly and its output is captured to a file, so a diagnostic always
# reaches the log. Nothing is piped into `head` or `grep`, because a pipeline
# that exits 141 on SIGPIPE has already cost this project three CI runs.
#
# QA Note 2 on PR #45: every early exit now goes through `bail`, which captures
# a frame and a logcat dump first. Before this, an infrastructure failure — a
# missing APK, a failed install — exited with no screenshot and no logcat, so
# "the screenshot is captured either way" held for assertion failures only.

set -u

PKG="${SMOKE_PACKAGE:?SMOKE_PACKAGE is not set}"
APK="${SMOKE_APK:?SMOKE_APK is not set}"
EXPECT="${SMOKE_EXPECT:?SMOKE_EXPECT is not set}"

# SMOKE_EXPECT is a `|`-separated list, and EVERY entry must appear on screen.
# One entry proves the app drew its title; a second proves the feature under
# test actually rendered. Built into an array once, used everywhere below.
EXPECT_ARGS=()
IFS='|' read -r -a _expects <<< "$EXPECT"
for _e in "${_expects[@]}"; do
  EXPECT_ARGS+=(--expect "$_e")
done
OUT="${SMOKE_OUT:-smoke-evidence}"
SETTLE_SECONDS="${SMOKE_SETTLE_SECONDS:-10}"
ATTEMPTS="${SMOKE_ATTEMPTS:-18}"
ATTEMPT_GAP="${SMOKE_ATTEMPT_GAP:-5}"
ADB="${SMOKE_ADB:-adb}"
ASSERT="$(dirname "$0")/smoke_assert.py"

mkdir -p "$OUT"
fail=0
note() { echo "ASSERTION FAILED: $*"; fail=1; }
say() { echo "[smoke] $*"; }

CAPTURE_MODE=raw
FRAME="$OUT/frame.bin"

capture_frame() {
  if [ "$CAPTURE_MODE" = "raw" ]; then
    "$ADB" exec-out screencap > "$FRAME" 2> "$OUT/screencap.err"
  else
    "$ADB" exec-out screencap -p > "$FRAME" 2> "$OUT/screencap.err"
  fi
  if [ ! -s "$FRAME" ]; then
    say "screencap produced no bytes; stderr was:"
    cat "$OUT/screencap.err"
    return 1
  fi
  return 0
}

# QA Note 2. An infrastructure failure is exactly when the evidence is most
# wanted and, before this, exactly when none was produced. Everything here is
# best-effort — the device may be unreachable, which is often the reason we
# are in `bail` at all — so nothing in it can change the exit code.
bail() {
  echo "SMOKE FAILED (infrastructure): $*"
  say "capturing whatever evidence the device will still give up"
  if capture_frame; then
    python3 "$ASSERT" "$FRAME" "${EXPECT_ARGS[@]}" --workdir "$OUT" \
      --png-out "$OUT/screenshot.png" || true
  else
    say "no frame could be captured"
  fi
  "$ADB" logcat -d -v time > "$OUT/logcat.txt" 2>&1 || true
  say "evidence in $OUT: $(ls "$OUT" | tr '\n' ' ')"
  exit 1
}

# --- The emulator is up and settled ----------------------------------------

say "adb: $("$ADB" version 2>&1 | sed -n 1p)"
"$ADB" wait-for-device
for _ in $(seq 1 60); do
  booted="$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n ')"
  [ "$booted" = "1" ] && break
  sleep 2
done
if [ "${booted:-}" != "1" ]; then
  bail "emulator never reported sys.boot_completed=1"
fi
DEVICE_RELEASE="$("$ADB" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r\n')"
DEVICE_SDK="$("$ADB" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r\n')"
say "device: Android ${DEVICE_RELEASE:-?} (API ${DEVICE_SDK:-?})"
"$ADB" shell wm dismiss-keyguard > /dev/null 2>&1 || true
"$ADB" shell wm size > "$OUT/wm-size.txt" 2>&1 || true
cat "$OUT/wm-size.txt"

# --- No dev server, and no route to one ------------------------------------
#
# This is the #46 assertion, expressed as a setup step. Nothing starts Metro.
# Any port forward the runner image or a previous step may have left in place
# is torn down, and the state is printed, so the log positively shows the app
# had nowhere to fetch a bundle from.

say "removing every adb reverse tunnel: the app must have no dev server to reach"
"$ADB" reverse --remove-all > /dev/null 2>&1 || true
"$ADB" reverse --list > "$OUT/reverse-tunnels.txt" 2>&1 || true
# `adb reverse --list` with nothing forwarded prints a single empty line, not
# zero bytes, so `[ -s ]` read "no tunnels" as "tunnels present" and failed the
# job on the healthy case. Test for non-whitespace content instead. A real
# tunnel line, or an adb error written to the same file, still fails the gate:
# if the tunnel state cannot be read, standalone is not proven.
tunnels="$(tr -d '[:space:]' < "$OUT/reverse-tunnels.txt")"
if [ -n "$tunnels" ]; then
  note "adb reverse tunnels still present — this run would not prove standalone:"
  cat "$OUT/reverse-tunnels.txt"
else
  echo "adb reverse --list reports nothing: no tunnel from the device to this runner"
fi

# --- Install ---------------------------------------------------------------

if [ ! -f "$APK" ]; then
  bail "no APK at $APK"
fi
say "installing $APK ($(stat -c%s "$APK") bytes)"
if ! "$ADB" install -r -g "$APK" > "$OUT/install.txt" 2>&1; then
  echo "adb install output:"
  cat "$OUT/install.txt"
  bail "adb install failed"
fi
cat "$OUT/install.txt"

# The permission list the release APK actually holds, read off the device.
# The build job gates on this; here it is evidence, and it is the list as the
# *installed* package reports it rather than as the file declares it.
"$ADB" shell dumpsys package "$PKG" > "$OUT/dumpsys-package.txt" 2>&1 || true
echo "requested permissions, as the installed package reports them:"
sed -n '/requested permissions:/,/^  [a-zA-Z]/p' "$OUT/dumpsys-package.txt" \
  | sed -n '1,12p'

# --- Launch ----------------------------------------------------------------

"$ADB" logcat -c > /dev/null 2>&1 || true
"$ADB" shell cmd package resolve-activity --brief "$PKG" > "$OUT/resolve.txt" 2>&1 || true
COMPONENT="$(sed -n "s#^\($PKG/[A-Za-z0-9_.]*\)\s*\$#\1#p" "$OUT/resolve.txt" | sed -n 1p)"
if [ -z "${COMPONENT:-}" ]; then
  say "could not resolve the launcher activity, falling back to monkey"
  "$ADB" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 \
    > "$OUT/launch.txt" 2>&1 || true
else
  say "launching $COMPONENT"
  "$ADB" shell am start -W -n "$COMPONENT" > "$OUT/launch.txt" 2>&1 || true
fi
cat "$OUT/launch.txt"

say "letting the app settle for ${SETTLE_SECONDS}s before the first frame"
sleep "$SETTLE_SECONDS"

# --- Capture ---------------------------------------------------------------
#
# The raw framebuffer is preferred: decoding it is a struct unpack, where
# un-filtering a 1080x1920 PNG in pure Python is not. If the device's raw
# layout is not one this understands, the script says so and the capture
# switches to `screencap -p` for the rest of the run.

say "polling for a frame that satisfies the assertions: up to $ATTEMPTS attempts, ${ATTEMPT_GAP}s apart"
settled=0
for attempt in $(seq 1 "$ATTEMPTS"); do
  if ! capture_frame; then
    sleep "$ATTEMPT_GAP"
    continue
  fi
  python3 "$ASSERT" "$FRAME" "${EXPECT_ARGS[@]}" --workdir "$OUT" --quiet
  rc=$?
  if [ "$rc" = "0" ]; then
    say "attempt $attempt: the frame satisfies both frame assertions"
    settled=1
    break
  fi
  if [ "$rc" = "2" ] && [ "$CAPTURE_MODE" = "raw" ]; then
    say "attempt $attempt: raw framebuffer unreadable, switching to screencap -p"
    CAPTURE_MODE=png
    continue
  fi
  say "attempt $attempt: not there yet (exit $rc)"
  sleep "$ATTEMPT_GAP"
done
[ "$settled" = "1" ] || say "no attempt satisfied the assertions; reporting the last frame"

# Whatever the outcome, this is the frame the evidence is about.
capture_frame || true
"$ADB" logcat -d -v time > "$OUT/logcat.txt" 2>&1 || true

# --- Assertion 1: the app launched and did not crash ------------------------

echo "::group::Assertion 1 — the app launched and did not crash"
PID="$("$ADB" shell pidof "$PKG" 2>/dev/null | tr -d '\r\n ')"
if [ -n "$PID" ]; then
  echo "$PKG is running as pid $PID"
else
  note "$PKG is not running — it never started, or it died after launch"
fi
grep -n -E "FATAL EXCEPTION|AndroidRuntime: FATAL|ANR in $PKG|Force finishing activity .*$PKG|signal [0-9]+ \(SIG|>>> $PKG <<<" \
  "$OUT/logcat.txt" > "$OUT/crashes.txt" 2>/dev/null
if [ -s "$OUT/crashes.txt" ]; then
  note "logcat reports a crash or ANR:"
  sed -n '1,40p' "$OUT/crashes.txt"
else
  echo "no FATAL EXCEPTION, ANR, native signal or forced finish in logcat"
fi
echo "::endgroup::"

# --- Assertion 1b: the JS bundle came from inside the APK (#46) -------------
#
# Previously a HINT, because a dev server was running and a bundle-load failure
# meant "Metro is unhealthy". With no dev server anywhere this is the exact
# failure #46 is about, so it gates. Assertion 3 would also catch the resulting
# red box; this turns an OCR miss into a named diagnosis.

echo "::group::Assertion 1b — the app loaded its bundle from inside the APK"
grep -n -E "Unable to load script|Could not connect to development server|No script URL provided" \
  "$OUT/logcat.txt" > "$OUT/bundle-errors.txt" 2>/dev/null
if [ -s "$OUT/bundle-errors.txt" ]; then
  note "the app tried to fetch its JS bundle and failed — this APK is not standalone:"
  sed -n '1,20p' "$OUT/bundle-errors.txt"
else
  echo "logcat shows no attempt to load a script from a dev server"
fi
echo "::endgroup::"

# --- Assertions 2 and 3: not blank, and the expected text is on screen ------

echo "::group::Assertions 2 and 3 — the screen is not blank, and shows: $EXPECT"
python3 "$ASSERT" "$FRAME" "${EXPECT_ARGS[@]}" --workdir "$OUT" \
  --png-out "$OUT/screenshot.png" 2>&1 | tee "$OUT/frame-assertions.txt"
rc="${PIPESTATUS[0]}"
if [ "$rc" = "2" ]; then
  note "the captured frame could not be read at all"
elif [ "$rc" != "0" ]; then
  fail=1
fi
echo "::endgroup::"

# Diagnosability, learned the hard way on run 35374171616. The logcat dump used
# to be the LAST thing printed, so `tail` of the job log showed 200 lines of
# GMS chatter and not one line of why the job failed. Three separate log
# fetches failed to reach the assertion output. A diagnostic you cannot find is
# not a diagnostic.
#
# So: logcat first and shorter, then the assertion output repeated last. The
# final 40 lines of this job now always say what actually failed.
if [ "$fail" != "0" ]; then
  echo "::group::last 80 lines of logcat"
  tail -n 80 "$OUT/logcat.txt"
  echo "::endgroup::"

  echo "=============================================================="
  echo "WHY THIS JOB FAILED"
  echo "=============================================================="
  echo "expectations: $EXPECT"
  echo "--- frame assertions ---"
  cat "$OUT/frame-assertions.txt"
  if [ -s "$OUT/crashes.txt" ]; then
    echo "--- crashes ---"
    sed -n '1,20p' "$OUT/crashes.txt"
  fi
  if [ -s "$OUT/bundle-errors.txt" ]; then
    echo "--- bundle errors ---"
    sed -n '1,20p' "$OUT/bundle-errors.txt"
  fi
  echo "=============================================================="
fi

say "evidence in $OUT: $(ls "$OUT" | tr '\n' ' ')"
exit $fail
