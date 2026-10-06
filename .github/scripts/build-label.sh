#!/usr/bin/env bash
#
# Compute the build tag and the on-screen build label — #52.
#
# ONE script, called by BOTH the `apk` job (which bakes the label into the
# bundle) and the `release` job (which names the release). That is the whole
# point: the string on the phone and the tag on the releases page are computed
# by the same lines, so they cannot drift apart. Two copies of this formula in
# two jobs would be a defect waiting for someone to edit one of them.
#
# Writes TAG and BUILD_LABEL to stdout as `KEY=value` lines, for appending to
# $GITHUB_ENV or $GITHUB_OUTPUT.
#
# Inputs, all from the Actions environment:
#   GITHUB_EVENT_NAME   push | pull_request | workflow_dispatch
#   GITHUB_REF_TYPE     tag, when a tag was pushed
#   GITHUB_REF_NAME     the tag or branch name
#   GITHUB_RUN_NUMBER   the run number, which is also the versionCode (D2, #47)
#   PR_NUMBER           the pull request number, when there is one
#   DISTRIBUTION        #146: `demo` for the demo workflow's build; anything
#                       else (app, beta, unset) leaves this script as it was

set -euo pipefail

# The version is app.json's `expo.version` — #108 ruling 42: this is v1, and
# the marketing version is semantic (1.0.0) on both stores and the releases
# page. It replaces the build commit's date (#62), which existed because a
# hand-kept version nobody bumped was worse than none. The difference now: the
# version is a decision Rob makes per release, and the number that must only
# ever go up is the build number (the run number, `-build.N` below, versionCode
# and CFBundleVersion), which is still derived and cannot go stale.
#
# Read from the file next to this script, not the working directory, so a run
# from anywhere reads the same app.json. A version that is not MAJOR.MINOR.PATCH
# fails here, in seconds, rather than as a store rejection.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["expo"]["version"])' "$ROOT/app.json" 2>/dev/null || true)"
if ! printf '%s' "$VERSION" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  echo "app.json expo.version is '${VERSION}', not MAJOR.MINOR.PATCH (#108 ruling 42)" >&2
  exit 1
fi

EVENT="${GITHUB_EVENT_NAME:-}"
REF_TYPE="${GITHUB_REF_TYPE:-}"
REF_NAME="${GITHUB_REF_NAME:-}"
RUN="${GITHUB_RUN_NUMBER:-}"

if [ "${DISTRIBUTION:-}" = "demo" ]; then
  # #146: the demo is published under the fixed tag `demo`, refreshed in
  # place, so a version-shaped `v...-build.N` would name a release page that
  # does not exist. The label starts with the tag it is published under, so it
  # still pastes into the releases page, then says which build: N is this
  # run's number, the same counter as every other build of this workflow.
  TAG="demo"
  LABEL="demo (${VERSION}, build ${RUN:-?})"
elif [ "$EVENT" = "push" ] && [ "$REF_TYPE" = "tag" ]; then
  # A tag push publishes under that exact tag. The release job refuses to
  # publish if it disagrees with app.json, so it is checked here too rather
  # than discovered eight minutes later after a Gradle build.
  # With 1.0.0 that tag is exactly `v1.0.0`.
  TAG="$REF_NAME"
  if [ "$TAG" != "v$VERSION" ]; then
    echo "tag $TAG does not match app.json's version: expected v$VERSION" >&2
    exit 1
  fi
  LABEL="$TAG"
else
  # One immutable prerelease per green build of main.
  TAG="v${VERSION}-build.${RUN}"
  if [ "$EVENT" = "pull_request" ]; then
    # A PR build is real, installable, and is NOT published as a release. The
    # label says so, because a label that names a release page you cannot find
    # is worse than one that admits what it is.
    #
    # ASCII only. Hermes stores a non-ASCII string as UTF-16, which is legal
    # and invisible on screen but changes how the artifact can be inspected.
    # A diagnostic string should be the easiest thing in the build to grep.
    LABEL="${TAG} (pr ${PR_NUMBER:-?})"
  else
    LABEL="$TAG"
  fi
fi

echo "VERSION=$VERSION"
echo "TAG=$TAG"
echo "BUILD_LABEL=$LABEL"
