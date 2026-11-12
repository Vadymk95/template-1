#!/usr/bin/env bash
set -eo pipefail

# The decision of .github/workflows/dependabot-auto-merge.yml, kept in a file so the workflow runs one line
# and scripts/dependabot-auto-merge.test.mjs runs this very file against a fake `gh`.
#
# Input, all through env: GH_TOKEN, REPOSITORY (owner/name), BASE_REF (the branch the pull request targets),
# PR_NUMBER, PR_NODE_ID, UPDATE_TYPE and METADATA_OUTCOME (the dependabot/fetch-metadata step's output and outcome).
#
# A patch or a minor, with readable metadata, gets a request for auto-merge (squash) through the GraphQL
# mutation. Never `gh pr merge --auto`: it merges at once when the pull request is already mergeable. The
# request is only sent when the repository allows auto-merge AND the base branch has a required status check,
# so there is always something for GitHub to wait for. Anything else gets no request, and a request this
# workflow made earlier is switched off; a request a person made is left alone.

WORKFLOW_BOT="github-actions[bot]"

# Runs `gh` with the given arguments; on failure prints GitHub's message and ends the job red. The answer is in $ANSWER.
read_gh() {
  if ! ANSWER="$(gh "$@" 2>&1)"; then
    echo "GitHub call failed (gh $1 $2): $ANSWER"
    exit 1
  fi
}

# How many required status checks one source names; ends the job red when the answer is not a number.
count_checks() {
  read_gh api "$1" --jq "$2"
  if [[ ! "$ANSWER" =~ ^[0-9]+$ ]]; then
    echo "Unexpected answer from $1: $ANSWER"
    exit 1
  fi
  COUNT="$ANSWER"
}

if [[ "$METADATA_OUTCOME" != "success" || ( "$UPDATE_TYPE" != "version-update:semver-patch" && "$UPDATE_TYPE" != "version-update:semver-minor" ) ]]; then
  echo "Not enabled: update type '${UPDATE_TYPE:-unknown}', metadata step $METADATA_OUTCOME. A human merges this one."
  read_gh api "repos/$REPOSITORY/pulls/$PR_NUMBER" --jq '.auto_merge.enabled_by.login // empty'
  if [[ "$ANSWER" == "$WORKFLOW_BOT" ]]; then
    read_gh api graphql -f query='mutation($id: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $id}) { pullRequest { number } } }' -f id="$PR_NODE_ID"
    echo "Switched off the auto-merge request an earlier run of this workflow left on."
  elif [[ -n "$ANSWER" ]]; then
    echo "Left the auto-merge request of $ANSWER in place: this workflow did not make it."
  fi
  exit 0
fi

read_gh api "repos/$REPOSITORY" --jq .allow_auto_merge
if [[ "$ANSWER" != "true" ]]; then
  echo "This repository does not allow auto-merge: turn on Settings > General > Pull Requests > Allow auto-merge. Nothing enabled."
  exit 0
fi

# Both places a required status check can live: rulesets, and classic branch protection.
count_checks "repos/$REPOSITORY/rules/branches/$BASE_REF" '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks | length] | add // 0'
RULESET_CHECKS="$COUNT"
count_checks "repos/$REPOSITORY/branches/$BASE_REF" '[(.protection.required_status_checks.contexts // [] | length), (.protection.required_status_checks.checks // [] | length)] | add'
if (( RULESET_CHECKS + COUNT == 0 )); then
  echo "The $BASE_REF branch has no required status check, so auto-merge would have nothing to wait for. Nothing enabled: add a required status check to the branch."
  exit 0
fi

if ! OUT="$(gh api graphql -f query='mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) { pullRequest { number } } }' -f id="$PR_NODE_ID" 2>&1)"; then
  echo "GitHub refused to enable auto-merge: $OUT"
  echo "A pull request that can be merged at once (for example every required check is already green) has nothing to wait for."
  echo "Comment '@dependabot rebase' to start it over, or merge it by hand."
  exit 1
fi
echo "Auto-merge (squash) enabled for update type $UPDATE_TYPE."
