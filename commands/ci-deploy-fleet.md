---
description: Deploy Spiral Engine CI workflow to multiple private repos in batch.
---

# CI Deploy Fleet

Deploy self-hosted CI to multiple repos with one command.

## Usage

```
ci-deploy-fleet [REPOS...] [--lang python|typescript|go] [--dry-run] [--upgrade]
```

## Examples

```bash
# Deploy Python CI to specific repos
ci-deploy-fleet Pro-xAI colossus-gateway mastermind --lang python

# Deploy to all Pro repos
ci-deploy-fleet Pro-* --lang python

# Dry run first
ci-deploy-fleet Pro-xAI apex-alpha --dry-run

# Upgrade existing ubuntu-latest to self-hosted
ci-deploy-fleet Pro-xAI Pro-Colossus --upgrade

# Deploy to all Python repos
ci-deploy-fleet --all-python

# Deploy to all TypeScript repos
ci-deploy-fleet --all-typescript
```

## Implementation

```bash
#!/bin/bash
# ci-deploy-fleet.sh — Batch CI deployment
set -euo pipefail

REPOS=()
LANG_OVERRIDE=""
DRY_RUN=false
UPGRADE=false
ALL_PYTHON=false
ALL_TYPESCRIPT=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --lang) LANG_OVERRIDE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --upgrade) UPGRADE=true; shift ;;
    --all-python) ALL_PYTHON=true; shift ;;
    --all-typescript) ALL_TYPESCRIPT=true; shift ;;
    *) REPOS+=("$1"); shift ;;
  esac
done

export GITHUB_TOKEN="${GITHUB_TOKEN:-$(grep oauth_token ~/.config/gh/hosts.yml | head -1 | awk '{print $2}')}"

if $ALL_PYTHON; then
  REPOS=($(gh repo list GlacierEQ --limit 500 --json name,primaryLanguage -q '.[] | select(.primaryLanguage?.name == "Python") | .name'))
fi
if $ALL_TYPESCRIPT; then
  REPOS=($(gh repo list GlacierEQ --limit 500 --json name,primaryLanguage -q '.[] | select(.primaryLanguage?.name == "TypeScript") | .name'))
fi

SUCCESS=0; FAIL=0; SKIP=0

for repo in "${REPOS[@]}"; do
  # Detect language
  if [ -n "$LANG_OVERRIDE" ]; then
    LANG="$LANG_OVERRIDE"
  else
    LANG=$(gh repo list GlacierEQ --limit 1 --json name,primaryLanguage -q ".[] | select(.name == \"$repo\") | .primaryLanguage?.name // \"python\"" 2>/dev/null)
    case "$LANG" in
      Python) LANG="python" ;;
      TypeScript) LANG="typescript" ;;
      Go) LANG="go" ;;
      *) LANG="python" ;;
    esac
  fi

  # Check if CI exists
  EXISTS=$(gh api repos/GlacierEQ/$repo/contents/.github/workflows/ci.yml --jq '.sha' 2>/dev/null)
  if [ -n "$EXISTS" ] && ! $UPGRADE; then
    echo "⏭️  $repo (already has CI)"
    ((SKIP++))
    continue
  fi

  # Check default branch
  DEFAULT=$(gh api repos/GlacierEQ/$repo --jq '.defaultBranch // "main"' 2>/dev/null)

  WF="name: CI

on:
  push:
    branches: [$DEFAULT, develop]
  pull_request:
    branches: [$DEFAULT]

jobs:
  ci:
    uses: GlacierEQ/public-actions-runner-host/.github/workflows/reusable-quick-ci.yml@main
    with:
      repo_name: \${{ github.event.repository.name }}
      language: $LANG"

  if $DRY_RUN; then
    echo "  → Would deploy $LANG CI to $repo (branch: $DEFAULT)"
    ((SUCCESS++))
    continue
  fi

  ENCODED=$(echo "$WF" | python3 -c "import sys,base64; print(base64.b64encode(sys.stdin.read().encode()).decode())")

  if [ -n "$EXISTS" ]; then
    RESULT=$(gh api "repos/GlacierEQ/$repo/contents/.github/workflows/ci.yml" \
      -X PUT -f message="ci: upgrade to Spiral Engine self-hosted CI" \
      -f content="$ENCODED" -f sha="$EXISTS" -f branch="$DEFAULT" 2>&1)
  else
    RESULT=$(gh api "repos/GlacierEQ/$repo/contents/.github/workflows/ci.yml" \
      -X PUT -f message="ci: add Spiral Engine self-hosted CI" \
      -f content="$ENCODED" -f branch="$DEFAULT" 2>&1)
  fi

  if echo "$RESULT" | grep -q '"sha"'; then
    echo "✅ $repo ($LANG)"
    ((SUCCESS++))
  else
    echo "❌ $repo"
    ((FAIL++))
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployed: $SUCCESS | ⏭️ Skipped: $SKIP | ❌ Failed: $FAIL"
```

## Evidence

- Performed this session across 27 repos (26 success, 1 retry)
- Repeated pattern: `for repo in ... gh api repos/GlacierEQ/$repo/contents/.github/workflows/ci.yml`
- Saves ~500 tokens per batch deployment vs manual construction
