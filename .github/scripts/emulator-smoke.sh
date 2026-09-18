#!/usr/bin/env bash
#
# Emulator smoke test — issue #43.
#
# Runs inside reactivecircus/android-emulator-runner, with an emulator already
# booted. Installs the debug APK the build job produced, launches it, and makes
# three assertions in the order the Product Owner ruled on 2026-09-18:
#
#   1. the app launches and does not crash  (process alive, logcat clean)
#   2. the screen is not blank              (not uniformly one colour)
#   3. the expected text is on screen       (OCR finds it)
#
# The screenshot is captured and kept either way. A screenshot of a crash is
# the most useful artifact this job can produce when it fails.
#
# Shell discipline, learned from commits 4f21782 and 1b76348 and from QA's
# Obs-4: this file is run as `bash emulator-smoke.sh`, a fresh shell, so it
# sets its own options. `-e` is deliberately NOT set — every command that can
# fail is checked explicitly and its output is captured to a file, so a
# diagnostic always reaches the log. Nothing is piped into `head` or `grep`,
# because a pipeline that exits 141 on SIGPIPE has already cost this project
# three CI runs.

set -u

PKG="${SMOKE_PACKAGE:?SMOKE_PACKAGE is not set}"
APK="${SMOKE_APK:?SMOKE_APK is not set}"
EXPECT="${SMOKE_EXPECT:?SMOKE_EXPECT is not set}"
OUT="${SMOKE_OUT:-smoke-evidence}"
METRO_PORT="${SMOKE_METRO_PORT:-8081}"
SETTLE_SECONDS="${SMOKE_SETTLE_SECONDS:-10}"
ATTEMPTS="${SMOKE_ATTEMPTS:-18}"
ATTEMPT_GAP="${SMOKE_ATTEMPT_GAP:-5}"
ADB="${SMOKE_ADB:-adb}"
ASSERT="$(dirname "$0")/smoke_assert.py"

mkdir -p "$OUT"
fail=0
note() { echo "ASSERTION FAILED: $*"; fail=1; }
say() { echo "[smoke] $*"; }

METRO_PID=""
cleanup() {
  if [ -n "$METRO_PID" ]; then
    kill "$METRO_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- The emulator is up and settled ----------------------------------------

say "adb: $("$ADB" version 2>&1 | sed -n 1p)"
"$ADB" wait-for-device
for _ in $(seq 1 60); do
  booted="$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n ')"
  [ "$booted" = "1" ] && break
  sleep 2
done
if [ "${booted:-}" != "1" ]; then
  echo "emulator never reported sys.boot_completed=1"
  exit 1
fi
DEVICE_RELEASE="$("$ADB" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r\n')"
DEVICE_SDK="$("$ADB" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r\n')"
say "device: Android ${DEVICE_RELEASE:-?} (API ${DEVICE_SDK:-?})"
"$ADB" shell wm dismiss-keyguard > /dev/null 2>&1 || true
"$ADB" shell wm size > "$OUT/wm-size.txt" 2>&1 || true
cat "$OUT/wm-size.txt"

# --- Metro -----------------------------------------------------------------
#
# `assembleDebug` does not embed the JS bundle — React Native's default
# `debuggableVariants` is ["debug"], so the app fetches it from Metro at
# launch. This is a property of the artifact the build job already publishes,
# not something introduced here. Without Metro the app renders React Native's
# red "Unable to load script" box, which assertion 3 would (correctly) fail on.

say "starting Metro on port $METRO_PORT"
CI=1 npx expo start --port "$METRO_PORT" > "$OUT/metro.log" 2>&1 &
METRO_PID=$!
metro_up=0
for _ in $(seq 1 90); do
  if ! kill -0 "$METRO_PID" 2>/dev/null; then
    break
  fi
  if curl -s --max-time 3 -o /dev/null "http://127.0.0.1:$METRO_PORT/status"; then
    metro_up=1
    break
  fi
  sleep 2
done
if [ "$metro_up" != "1" ]; then
  echo "Metro never answered on port $METRO_PORT — last 40 lines of its log:"
  tail -n 40 "$OUT/metro.log"
  exit 1
fi
say "Metro is answering on port $METRO_PORT"
"$ADB" reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT" > /dev/null 2>&1 \
  || say "adb reverse failed; the app will reach Metro via 10.0.2.2 instead"

# --- Install ---------------------------------------------------------------

if [ ! -f "$APK" ]; then
  echo "no APK at $APK"
  exit 1
fi
say "installing $APK ($(stat -c%s "$APK") bytes)"
if ! "$ADB" install -r -g "$APK" > "$OUT/install.txt" 2>&1; then
  echo "adb install failed:"
  cat "$OUT/install.txt"
  exit 1
fi
cat "$OUT/install.txt"
# React Native's debug dev-support draws its overlay through SYSTEM_ALERT_WINDOW.
# Granting it up front stops the app bouncing the user to Settings, which would
# otherwise be what the screenshot shows.
"$ADB" shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow > /dev/null 2>&1 || true

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

say "polling for a frame that satisfies the assertions: up to $ATTEMPTS attempts, ${ATTEMPT_GAP}s apart"
settled=0
for attempt in $(seq 1 "$ATTEMPTS"); do
  if ! capture_frame; then
    sleep "$ATTEMPT_GAP"
    continue
  fi
  python3 "$ASSERT" "$FRAME" --expect "$EXPECT" --workdir "$OUT" --quiet
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
# Not a gate — assertion 3 already fails on the red box — but by far the most
# useful single line when it does.
if grep -q -E "Unable to load script|Could not connect to development server" \
    "$OUT/logcat.txt" 2>/dev/null; then
  echo "HINT: logcat says the JS bundle did not load; the screen will be React"
  echo "      Native's red box. Check $OUT/metro.log."
fi
echo "::endgroup::"

# --- Assertions 2 and 3: not blank, and the expected text is on screen ------

echo "::group::Assertions 2 and 3 — the screen is not blank, and shows '$EXPECT'"
python3 "$ASSERT" "$FRAME" --expect "$EXPECT" --workdir "$OUT" \
  --png-out "$OUT/screenshot.png"
rc=$?
if [ "$rc" = "2" ]; then
  note "the captured frame could not be read at all"
elif [ "$rc" != "0" ]; then
  fail=1
fi
echo "::endgroup::"

if [ "$fail" != "0" ]; then
  echo "::group::last 200 lines of logcat"
  tail -n 200 "$OUT/logcat.txt"
  echo "::endgroup::"
  echo "::group::last 60 lines of the Metro log"
  tail -n 60 "$OUT/metro.log"
  echo "::endgroup::"
fi

say "evidence in $OUT: $(ls "$OUT" | tr '\n' ' ')"
exit $fail
