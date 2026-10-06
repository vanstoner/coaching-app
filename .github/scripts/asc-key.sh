#!/usr/bin/env bash
#
# Write the App Store Connect API key to a file Xcode can read — #108 A4.
#
#   ASC_KEY_P8=... asc-key.sh OUT_FILE     # repair, write, validate
#   asc-key.sh --self-test                 # healthy key first, then broken ones
#
# The first signed dry run (run 37490079637) failed with
# "Invalid authentication key credential specified
# (CryptoKit.CryptoKitASN1Error.invalidPEMDocument)": the secret held the key,
# BEGIN and END lines included, but not in a shape Xcode parses. Pasting a
# .p8 into a web form commonly joins its lines, adds Windows line endings or
# indentation, or turns newlines into a literal "\n". Every one of those is
# repaired here by rebuilding the PEM from its base64 body, so nobody has to
# paste the key again. A key with missing characters cannot be repaired and
# fails, saying what it found.
#
# The key's value is never printed: only its shape (line count, line endings,
# body length) and whether it parsed.

set -uo pipefail

why() {
  echo "=============================================================="
  echo "WHY THIS JOB FAILED"
  echo "=============================================================="
  printf '%s\n' "$@"
  echo "=============================================================="
  exit 1
}

# normalise IN OUT -> prints the shape it found; non-zero if unrepairable.
normalise() {
  local raw shape lines body b64
  raw="$(cat "$1")"
  shape=""
  case "$raw" in *$'\r'*) shape="Windows line endings; " ;; esac
  raw="${raw//$'\r'/}"
  case "$raw" in *'\n'*) shape="${shape}literal \\n for line breaks; "; raw="${raw//\\n/$'\n'}" ;; esac
  case "$raw" in
    *"-----BEGIN PRIVATE KEY-----"*"-----END PRIVATE KEY-----"*) ;;
    *) echo "no '-----BEGIN PRIVATE KEY-----' ... '-----END PRIVATE KEY-----' pair"; return 1 ;;
  esac
  lines=$(printf '%s\n' "$raw" | grep -c . || true)
  [ "$lines" -lt 3 ] && shape="${shape}all on one line; "
  body="${raw#*-----BEGIN PRIVATE KEY-----}"
  body="${body%%-----END PRIVATE KEY-----*}"
  b64="$(printf '%s' "$body" | tr -d ' \t\n')"
  case "$b64" in
    *[!A-Za-z0-9+/=]*) echo "the key body has characters that are not base64"; return 1 ;;
  esac
  {
    echo "-----BEGIN PRIVATE KEY-----"
    printf '%s' "$b64" | fold -w 64
    echo
    echo "-----END PRIVATE KEY-----"
  } > "$2"
  echo "key shape: ${shape:-as expected; }${lines} non-empty lines, body ${#b64} base64 characters"
}

# valid FILE -> zero if it is a private key openssl can read.
valid() { openssl pkey -in "$1" -noout > /dev/null 2>&1; }

self_test() {
  local d failed=0
  d="$(mktemp -d)"
  openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null \
    | openssl pkcs8 -topk8 -nocrypt -out "$d/good.p8" 2>/dev/null \
    || { echo "  x  could not generate a test key"; return 1; }
  tr '\n' ' ' < "$d/good.p8" > "$d/oneline.p8"
  sed 's/$/\r/' "$d/good.p8" > "$d/crlf.p8"
  sed 's/^/  /' "$d/good.p8" > "$d/indented.p8"
  awk '{printf "%s\\n", $0}' "$d/good.p8" > "$d/literal_n.p8"
  sed '2d' "$d/good.p8" > "$d/truncated.p8"
  grep -v 'PRIVATE KEY' "$d/good.p8" > "$d/no_markers.p8"
  # (name, should end as a valid key)
  for c in good:1 oneline:1 crlf:1 indented:1 literal_n:1 truncated:0 no_markers:0; do
    name="${c%%:*}"; want="${c##*:}"; got=0
    if normalise "$d/$name.p8" "$d/out.p8" > /dev/null && valid "$d/out.p8"; then got=1; fi
    if [ "$got" = "$want" ]; then echo "  ok $name -> $([ "$got" = 1 ] && echo valid || echo refused)"
    else echo "  x  $name -> $([ "$got" = 1 ] && echo valid || echo refused), expected the opposite"; failed=$((failed + 1)); fi
  done
  rm -rf "$d"
  echo "$((7 - failed)) expectation(s) passed, $failed failed."
  [ "$failed" = 0 ]
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

OUT="${1:-}"
[ -n "$OUT" ] || { echo "usage: ASC_KEY_P8=... asc-key.sh OUT_FILE | --self-test" >&2; exit 2; }
[ -n "${ASC_KEY_P8:-}" ] || why "ASC_KEY_P8 is not set (missing from the app-store environment)"

umask 077
tmp="$(mktemp)"
printf '%s' "$ASC_KEY_P8" > "$tmp"
if ! shape="$(normalise "$tmp" "$OUT")"; then
  rm -f "$tmp" "$OUT"
  why "ASC_KEY_P8 cannot be read as a key: $shape." \
      "Paste the whole .p8 file again, exactly as downloaded (#149 E2)."
fi
rm -f "$tmp"
echo "$shape"
if ! valid "$OUT"; then
  rm -f "$OUT"
  why "ASC_KEY_P8 has the right markers but is not a valid private key ($shape)." \
      "Some of it is missing or changed. Paste the whole .p8 file again, exactly as downloaded (#149 E2)."
fi
echo "the API key parses as a private key"
