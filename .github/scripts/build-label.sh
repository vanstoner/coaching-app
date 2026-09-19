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

set -euo pipefail

VERSION="$(python3 -c "import json; print(json.load(open('app.json'))['expo']['version'])")"
[ -n "$VERSION" ] || { echo "could not read version from app.json" >&2; exit 1; }

EVENT="${GITHUB_EVENT_NAME:-}"
REF_TYPE="${GITHUB_REF_TYPE:-}"
REF_NAME="${GITHUB_REF_NAME:-}"
RUN="${GITHUB_RUN_NUMBER:-}"

if [ "$EVENT" = "push" ] && [ "$REF_TYPE" = "tag" ]; then
  # A tag push publishes under that exact tag. The release job refuses to
  # publish if it disagrees with app.json, so it is checked here too rather
  # than discovered eight minutes later after a Gradle build.
  TAG="$REF_NAME"
  if [ "$TAG" != "v$VERSION" ]; then
    echo "tag $TAG does not match app.json version $VERSION" >&2
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

echo "TAG=$TAG"
echo "BUILD_LABEL=$LABEL"
