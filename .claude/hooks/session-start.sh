#!/usr/bin/env bash
# SessionStart hook (#237): make a fresh cloud session able to run
# `npx vitest run`, `npx tsc --noEmit` and `python3 docs/process/validate-docs.py`
# without spending turns on setup.
#
# - Remote sessions only (CLAUDE_CODE_REMOTE=true); anywhere else it does nothing.
# - Installs with `npm ci` only when node_modules is missing or stale.
#   Stamp: node_modules/.session-start-lock.sha256 holds the sha256 of the
#   package-lock.json the tree was installed from. Stale = no stamp, a
#   different hash, or package-lock.json modified after the stamp.
# - Never fails the session: every path exits 0. A failed install prints one
#   line naming its log.
set -u

main() {
  [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || return 0

  local dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
  cd "$dir" || return 0
  [ -f package-lock.json ] || return 0

  local stamp="node_modules/.session-start-lock.sha256"
  local want
  want="$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)" || return 0

  if [ -f "$stamp" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$want" ] \
     && ! [ package-lock.json -nt "$stamp" ]; then
    return 0
  fi

  local log="${TMPDIR:-/tmp}/claude-session-start-npm.log"
  if npm ci --no-audit --no-fund >"$log" 2>&1; then
    printf '%s\n' "$want" >"$stamp" 2>/dev/null
    echo "session-start: npm ci installed dependencies from package-lock.json"
  else
    echo "session-start: npm ci FAILED; session continues without dependencies; log: $log"
  fi
  return 0
}

main "$@" || true
exit 0
