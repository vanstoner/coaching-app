#!/usr/bin/env bash
#
# Read the `demo` release as it stands — #146 AC1/AC7.
#
#   demo_snapshot.sh FILE
#
# Writes `gh api repos/$GITHUB_REPOSITORY/releases/tags/demo` to FILE and
# prints, for check_release.py --demo-untouched:
#   FILE        the demo exists and was read
#   none        there is no demo (HTTP 404)
#   unreadable  any other failure; the caller skips the check and says so,
#               because a flaky read must never turn a published release red
#
# Read-only. Main's release job and a PR's beta job take one snapshot before
# their first write and one after their last.

set -u
FILE="${1:?usage: demo_snapshot.sh FILE}"
if gh api "repos/${GITHUB_REPOSITORY:?}/releases/tags/demo" > "$FILE" 2> "$FILE.err"; then
  echo "$FILE"
elif grep -q -e '404' -e 'Not Found' "$FILE.err" "$FILE" 2>/dev/null; then
  echo none
else
  echo "warning: could not read the demo release: $(cat "$FILE.err")" >&2
  echo unreadable
fi
