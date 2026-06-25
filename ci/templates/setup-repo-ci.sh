#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Batch-add CI workflow to private repos
# Usage: ./setup-repo-ci.sh <repo1> [repo2] [repo3] ...
#    or: ./setup-repo-ci.sh --all-python    (all Python repos)
#    or: ./setup-repo-ci.sh --dry-run       (preview only)
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN=false
LANG_OVERRIDE=""
REPOS=()

# Parse args
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

TEMPLATE="name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  ci:
    uses: GlacierEQ/public-actions-runner-host/.github/workflows/reusable-quick-ci.yml@main
    with:
      repo_name: \${{ github.event.repository.name }}
      language: LANG_PLACEHOLDER"

SUCCESS=0
FAIL=0

for repo in "${REPOS[@]}"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📦 $repo"

  # Detect language
  if [ -n "$LANG_OVERRIDE" ]; then
    LANG="$LANG_OVERRIDE"
  else
    LANG=$(gh repo list GlacierEQ --limit 1 --json name,primaryLanguage -q ".[] | select(.name == \"$repo\") | .primaryLanguage?.name // \"python\"" 2>/dev/null)
    case "$LANG" in
      Python) LANG="python" ;;
      TypeScript) LANG="typescript" ;;
      JavaScript) LANG="javascript" ;;
      *) LANG="python" ;;
    esac
  fi

  WF_CONTENT=$(echo "$TEMPLATE" | sed "s/LANG_PLACEHOLDER/$LANG/g")

  if [ "$DRY_RUN" = true ]; then
    echo "  → Would create .github/workflows/ci.yml (lang: $LANG)"
    ((SUCCESS++))
    continue
  fi

  # Create via GitHub API
  ENCODED=$(echo "$WF_CONTENT" | python3 -c "import sys,base64; print(base64.b64encode(sys.stdin.read().encode()).decode())")

  RESULT=$(gh api "repos/GlacierEQ/$repo/contents/.github/workflows/ci.yml" \
    -X PUT \
    -f message="ci: add self-hosted CI pipeline" \
    -f content="$ENCODED" \
    -f branch="main" 2>&1)

  if echo "$RESULT" | grep -q '"sha"'; then
    echo "  ✅ CI workflow created (lang: $LANG)"
    ((SUCCESS++))
  else
    echo "  ❌ Failed: $RESULT"
    ((FAIL++))
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Success: $SUCCESS | ❌ Failed: $FAIL"
