#!/usr/bin/env bash
#
# Archive the iOS app for a DEVICE (not the simulator) — #108 A1, A7.
#
#   ios-archive.sh unsigned ARCHIVE     # any ref, no secrets: proves the build
#   ios-archive.sh signed   ARCHIVE     # testflight.yml, in the app-store
#                                       # environment, with the API key
#
# Run from the repo root after `expo prebuild --platform ios` and
# `pod install`. Writes SCHEME, APP (the .app inside the archive) and, for a
# signed run, SIGNING_PATH to $GITHUB_ENV when it is set.
#
# Signed mode uses Apple's automatic signing with the App Store Connect API
# key (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID, APPLE_TEAM_ID in the
# environment). No certificate or provisioning profile is held anywhere: the
# export step signs with Apple's cloud-managed distribution certificate,
# which needs the key's Admin role (developer.apple.com/forums/thread/698117).
#
# NOT YET PROVEN, so handled rather than assumed: whether an automatically
# signed ARCHIVE works on a CI Mac whose team has no registered devices
# (development signing can want one). If it fails, this falls back to an
# unsigned archive, which the export re-signs for distribution, and says
# which path it took (SIGNING_PATH). The first real run decides; the PR that
# follows removes the losing path.

set -uo pipefail

MODE="${1:-}"
ARCHIVE="${2:-}"
if [ "$MODE" != unsigned ] && [ "$MODE" != signed ] || [ -z "$ARCHIVE" ]; then
  echo "usage: ios-archive.sh unsigned|signed ARCHIVE_PATH" >&2
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

# Secret values never reach the log (A4). Actions masks registered secrets
# already; this also strips them from the xcodebuild lines we print.
redact() {
  local s
  s="$(cat)"
  for v in "${ASC_KEY_ID:-}" "${ASC_ISSUER_ID:-}" "${APPLE_TEAM_ID:-}"; do
    [ -n "$v" ] && s="${s//"$v"/***}"
  done
  printf '%s\n' "$s"
}

first_errors() {
  grep -E '(error:|\*\* ARCHIVE FAILED|\*\* BUILD FAILED)' "$1" | sed -n '1,25p' | redact || true
}

shopt -s nullglob
workspaces=(ios/*.xcworkspace)
[ "${#workspaces[@]}" -eq 1 ] \
  || why "expected exactly one .xcworkspace in ios/ after pod install, found ${#workspaces[@]}: ${workspaces[*]:-none}"
WORKSPACE="${workspaces[0]}"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"
echo "workspace=$WORKSPACE scheme=$SCHEME mode=$MODE"

COMMON=(
  -workspace "$WORKSPACE"
  -scheme "$SCHEME"
  -configuration Release
  -sdk iphoneos
  -destination 'generic/platform=iOS'
  -archivePath "$ARCHIVE"
  -derivedDataPath build-device
)

archive_unsigned() {
  xcodebuild "${COMMON[@]}" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO archive > "$1" 2>&1
}

PATH_TAKEN=""
if [ "$MODE" = unsigned ]; then
  if ! archive_unsigned /tmp/archive.log; then
    echo "::group::last 200 lines of xcodebuild"; tail -n 200 /tmp/archive.log; echo "::endgroup::"
    why "xcodebuild could not archive the app for a device (signing off). First errors:" "$(first_errors /tmp/archive.log)"
  fi
else
  for v in ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID APPLE_TEAM_ID; do
    [ -n "${!v:-}" ] || why "$v is not set (a secret is missing from the app-store environment)"
  done
  AUTH=(
    -allowProvisioningUpdates
    -authenticationKeyPath "$ASC_KEY_PATH"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
  )
  if xcodebuild "${COMMON[@]}" "${AUTH[@]}" \
      DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic \
      archive > /tmp/archive-signed.log 2>&1; then
    PATH_TAKEN="automatic-archive"
  else
    echo "::group::automatic signing at archive time failed; first errors"
    first_errors /tmp/archive-signed.log
    echo "::endgroup::"
    echo "falling back: an unsigned archive, signed for distribution by the export step"
    rm -rf "$ARCHIVE"
    if ! archive_unsigned /tmp/archive.log; then
      echo "::group::last 200 lines of xcodebuild (unsigned fallback)"; tail -n 200 /tmp/archive.log | redact; echo "::endgroup::"
      why "xcodebuild could not archive the app, signed or unsigned." \
          "Signed, first errors:" "$(first_errors /tmp/archive-signed.log)" \
          "Unsigned, first errors:" "$(first_errors /tmp/archive.log)"
    fi
    PATH_TAKEN="unsigned-archive"
  fi
  echo "signing path: $PATH_TAKEN"
fi

APP="$ARCHIVE/Products/Applications/$SCHEME.app"
[ -d "$APP" ] || why "no .app at $APP after archiving. Found: $(ls "$ARCHIVE/Products/Applications" 2>/dev/null || echo nothing)"
echo "app: $APP ($(du -sh "$APP" | cut -f1))"

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "SCHEME=$SCHEME"
    echo "APP=$APP"
    # An `if`, not `[ ] && echo`: as the last command, a false test made the
    # whole script exit 1 after a good unsigned archive (run 37486638326).
    if [ -n "$PATH_TAKEN" ]; then echo "SIGNING_PATH=$PATH_TAKEN"; fi
  } >> "$GITHUB_ENV"
fi
exit 0
