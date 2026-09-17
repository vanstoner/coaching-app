#!/usr/bin/env bash
#
# Creates all requirement issues, labels and milestones from issues.json.
# Run once, from inside the cloned repo, after `gh auth login`.
#
#   bash docs/issues/create-issues.sh
#
# Safe to inspect first: run with DRY_RUN=1 to print what it would do.

set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
ISSUES_FILE="$(dirname "$0")/issues.json"

command -v gh >/dev/null || { echo "gh CLI not found. See docs/SETUP-GITHUB.md"; exit 1; }
command -v jq >/dev/null || { echo "jq not found. Install it: brew install jq / winget install jqlang.jq"; exit 1; }
[ -f "$ISSUES_FILE" ] || { echo "Cannot find $ISSUES_FILE"; exit 1; }

gh auth status >/dev/null 2>&1 || { echo "Not authenticated. Run: gh auth login"; exit 1; }

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "Target repository: $REPO"
[ "$DRY_RUN" = "1" ] && echo "(dry run — nothing will be created)"
echo

# --- Labels -----------------------------------------------------------------
# name|colour|description  (plain array, not associative — macOS ships bash 3.2)
LABELS="
requirement|0E8A16|A numbered requirement from the product brief
tech|1D76DB|Technical or infrastructure work
mvp|B60205|In scope for the MVP milestone
future|C5DEF5|Deferred to a later iteration
engine|5319E7|Match engine and domain logic
ux|FBCA04|User interface and interaction
data|006B75|Data model and persistence
fairness|D93F0B|Fair play time and audit
gdpr|000000|Data protection constraint
infra|BFDADC|Tooling, build and CI
testing|0052CC|Tests and verification
"

echo "Creating labels..."
while IFS='|' read -r name colour desc; do
  [ -z "$name" ] && continue
  if [ "$DRY_RUN" = "1" ]; then
    echo "  would create label: $name ($colour)"
  else
    gh label create "$name" --color "$colour" --description "$desc" --force >/dev/null \
      && echo "  $name"
  fi
done <<< "$LABELS"
echo

# --- Milestones -------------------------------------------------------------
echo "Creating milestones..."
for ms in "MVP:Minimum viable app: clock, positions, minutes, substitutions, fairness ledger" \
          "Post-MVP:Match event capture and later iterations"; do
  title="${ms%%:*}"
  desc="${ms#*:}"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  would create milestone: $title"
    continue
  fi
  if gh api "repos/$REPO/milestones" --jq '.[].title' 2>/dev/null | grep -qx "$title"; then
    echo "  $title (already exists)"
  else
    gh api "repos/$REPO/milestones" -f title="$title" -f description="$desc" >/dev/null \
      && echo "  $title"
  fi
done
echo

# --- Issues -----------------------------------------------------------------
echo "Creating issues..."
count="$(jq 'length' "$ISSUES_FILE")"

for i in $(seq 0 $((count - 1))); do
  title="$(jq -r ".[$i].title" "$ISSUES_FILE")"
  body="$(jq -r ".[$i].body" "$ISSUES_FILE")"
  milestone="$(jq -r ".[$i].milestone" "$ISSUES_FILE")"
  labels="$(jq -r ".[$i].labels | join(\",\")" "$ISSUES_FILE")"

  if [ "$DRY_RUN" = "1" ]; then
    echo "  would create: $title  [$labels]  ($milestone)"
    continue
  fi

  # Skip if an issue with this exact title already exists — makes the script re-runnable.
  if gh issue list --state all --limit 200 --json title -q '.[].title' | grep -qxF "$title"; then
    echo "  skipped (exists): $title"
    continue
  fi

  url="$(printf '%s' "$body" | gh issue create \
    --title "$title" \
    --body-file - \
    --label "$labels" \
    --milestone "$milestone")"
  echo "  $title"
  echo "     $url"
done

echo
echo "Done. View them: gh issue list"
