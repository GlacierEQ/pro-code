#!/bin/bash
# GlacierEQ APEX — install/repair PRIVATE CI fallback workflows.
#
# Automatic private-repository verification executes from
# GlacierEQ/public-actions-runner-host. This installer intentionally creates a
# workflow_dispatch-only recovery workflow so a private caller can never make
# GitHub-hosted Actions budget a normal CI dependency.
#
# Usage: ./setup-repo-ci.sh <repo1> [repo2] ...
#        ./setup-repo-ci.sh --all-python
#        ./setup-repo-ci.sh --dry-run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN=false
LANG_OVERRIDE=""
REPOS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    --lang) LANG_OVERRIDE="$2"; shift 2 ;;
    --all-python)
      REPOS=($(gh repo list GlacierEQ --limit 500 --json name,primaryLanguage --jq '.[] | select(.primaryLanguage?.name == "Python") | .name'))
      shift ;;
    --all-typescript)
      REPOS=($(gh repo list GlacierEQ --limit 500 --json name,primaryLanguage --jq '.[] | select(.primaryLanguage?.name == "TypeScript") | .name'))
      shift ;;
    *) REPOS+=("$1"); shift ;;
  esac
done

if [ ${#REPOS[@]} -eq 0 ]; then
  echo "Usage: $0 <repo1> [repo2] ... | --all-python | --all-typescript"
  echo "  --dry-run    Preview without pushing"
  echo "  --lang LANG  Override language detection"
  exit 1
fi

TEMPLATE='name: Legacy Private CI - Manual Recovery Only

# Automatic CI is executed from GlacierEQ/public-actions-runner-host.
# Do not add push/pull_request triggers to this private-repository fallback.
on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  legacy-manual-ci:
    uses: GlacierEQ/public-actions-runner-host/.github/workflows/reusable-quick-ci.yml@main
    with:
      repo_name: ${{ github.event.repository.name }}
      language: LANG_PLACEHOLDER'

SUCCESS=0
FAIL=0

for repo in "${REPOS[@]}"; do
  echo "------------------------------------------"
  echo "$repo"

  if [ -n "$LANG_OVERRIDE" ]; then
    LANG="$LANG_OVERRIDE"
  else
    LANG=$(gh repo list GlacierEQ --limit 500 --json name,primaryLanguage -q ".[] | select(.name == \"$repo\") | .primaryLanguage?.name // \"python\"" 2>/dev/null)
    case "$LANG" in
      Python) LANG="python" ;;
      TypeScript) LANG="typescript" ;;
      JavaScript) LANG="javascript" ;;
      *) LANG="python" ;;
    esac
  fi

  WF_CONTENT=$(printf '%s\n' "$TEMPLATE" | sed "s/LANG_PLACEHOLDER/$LANG/g")

  if [ "$DRY_RUN" = true ]; then
    echo "  would install manual-only private fallback (lang: $LANG)"
    ((SUCCESS++))
    continue
  fi

  DEFAULT=$(gh api "repos/GlacierEQ/$repo" --jq '.default_branch')
  EXISTING_SHA=$(gh api "repos/GlacierEQ/$repo/contents/.github/workflows/ci.yml?ref=$DEFAULT" --jq '.sha' 2>/dev/null || true)
  ENCODED=$(printf '%s\n' "$WF_CONTENT" | python3 -c "import sys,base64; print(base64.b64encode(sys.stdin.read().encode()).decode())")

  args=(
    -X PUT
    -f message="ci: retire automatic private runner execution"
    -f content="$ENCODED"
    -f branch="$DEFAULT"
  )
  if [ -n "$EXISTING_SHA" ]; then
    args+=(-f sha="$EXISTING_SHA")
  fi

  if gh api "repos/GlacierEQ/$repo/contents/.github/workflows/ci.yml" "${args[@]}" >/dev/null; then
    echo "  installed manual-only fallback; automatic CI must use public action face"
    ((SUCCESS++))
  else
    echo "  failed"
    ((FAIL++))
  fi
done

echo ""
echo "Success: $SUCCESS | Failed: $FAIL"
