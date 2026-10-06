#!/usr/bin/env bash
#
# Export a device archive for App Store Connect — #108 A1, A7.
#
#   ios-export.sh export ARCHIVE OUT_DIR   # sign and write the .ipa; uploads nothing
#   ios-export.sh upload ARCHIVE OUT_DIR   # sign and upload to App Store Connect
#
# Both sign with Apple's automatic signing and the App Store Connect API key
# (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID, APPLE_TEAM_ID): a cloud-managed
# distribution certificate, so no certificate or profile is held anywhere.
# The key needs the Admin role for that (developer.apple.com/forums/thread/698117).
#
# `upload` is xcodebuild's own upload (destination "upload"), so nothing
# outside Xcode is needed. Xcode is told NOT to manage the version or build
# number: CI set both (A5, A6) and the checks before this read them.

set -uo pipefail

MODE="${1:-}"
ARCHIVE="${2:-}"
OUT="${3:-}"
if [ "$MODE" != export ] && [ "$MODE" != upload ] || [ -z "$ARCHIVE" ] || [ -z "$OUT" ]; then
  echo "usage: ios-export.sh export|upload ARCHIVE OUT_DIR" >&2
  exit 2
fi

why() {
  echo "=============================================================="
  echo "WHY THIS JOB FAILED"
  echo "=============================================================="
  printf '%s\n' "$@"
  echo "=============================================================="
  exit 1
}

redact() {
  local s
  s="$(cat)"
  for v in "${ASC_KEY_ID:-}" "${ASC_ISSUER_ID:-}" "${APPLE_TEAM_ID:-}"; do
    [ -n "$v" ] && s="${s//"$v"/***}"
  done
  printf '%s\n' "$s"
}

for v in ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID APPLE_TEAM_ID; do
  [ -n "${!v:-}" ] || why "$v is not set (a secret is missing from the app-store environment)"
done
[ -d "$ARCHIVE" ] || why "no archive at $ARCHIVE"

mkdir -p "$OUT"
OPTIONS="$OUT/ExportOptions.plist"
cat > "$OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${MODE}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>${APPLE_TEAM_ID}</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

if ! xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportPath "$OUT" \
    -exportOptionsPlist "$OPTIONS" \
    -allowProvisioningUpdates \
    -authenticationKeyPath "$ASC_KEY_PATH" \
    -authenticationKeyID "$ASC_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
    > /tmp/export.log 2>&1; then
  echo "::group::last 120 lines of xcodebuild -exportArchive"; tail -n 120 /tmp/export.log | redact; echo "::endgroup::"
  hint=""
  grep -q "Cloud signing permission error" /tmp/export.log \
    && hint="Apple refused cloud signing: the API key needs the Admin role (#149 D1)."
  grep -qiE "already been used|bundle version.*(used|exists)|must contain a higher" /tmp/export.log \
    && hint="Apple already has this build number; start a new run, not a re-run of an uploaded one (#108 A5)."
  grep -qiE "authentication|401|unauthori[sz]ed|invalid.*key" /tmp/export.log \
    && hint="${hint:-Apple did not accept the API key: check ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 belong together.}"
  why "xcodebuild -exportArchive ($MODE) failed." \
      "$(grep -E '(error:|EXPORT FAILED|UPLOAD FAILED)' /tmp/export.log | sed -n '1,20p' | redact)" \
      ${hint:+"$hint"}
fi

if [ "$MODE" = export ]; then
  shopt -s nullglob
  ipas=("$OUT"/*.ipa)
  [ "${#ipas[@]}" -eq 1 ] || why "expected exactly one .ipa in $OUT, found ${#ipas[@]}"
  echo "exported: ${ipas[0]} ($(du -h "${ipas[0]}" | cut -f1)); nothing was uploaded"
else
  grep -E 'Upload succeeded|EXPORT SUCCEEDED|Uploaded' /tmp/export.log | redact || true
  echo "uploaded to App Store Connect; Apple processes the build before TestFlight shows it"
fi
