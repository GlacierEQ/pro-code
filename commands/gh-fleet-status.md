---
description: Check health status across multiple GitHub repos (commits, PRs, issues, CI).
---

# GitHub Fleet Status

Multi-repo health check with one command.

## Usage

```
gh-fleet-status [REPOS...] [--check commits|prs|issues|ci|all]
```

## Examples

```bash
# Check recent commits across flagships
gh-fleet-status Pro-xAI Pro-Colossus apex-alpha apex-omega --check commits

# Check all health metrics for Pro repos
gh-fleet-status Pro-* --check all

# Check open PRs across memory repos
gh-fleet-status Pro-Memory apex-holographic-memory --check prs

# Quick CI status
gh-fleet-status Pro-xAI mastermind colossus-gateway --check ci
```

## Implementation

```bash
#!/bin/bash
# gh-fleet-status.sh — Multi-repo health check
set -euo pipefail

REPOS=()
CHECK="all"

while [[ $# -gt 0 ]]; do
  case $1 in
    --check) CHECK="$2"; shift 2 ;;
    *) REPOS+=("$1"); shift ;;
  esac
done

export GITHUB_TOKEN="${GITHUB_TOKEN:-$(grep oauth_token ~/.config/gh/hosts.yml | head -1 | awk '{print $2}')}"

for repo in "${REPOS[@]}"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📦 $repo"
  
  if [[ "$CHECK" == "commits" || "$CHECK" == "all" ]]; then
    echo "  Recent commits:"
    gh api repos/GlacierEQ/$repo/commits --paginate -q '.[:5] | .[] | "    \(.commit.author.date[:10]) \(.commit.message | split("\n")[0])"' 2>/dev/null || echo "    (no commits)"
  fi
  
  if [[ "$CHECK" == "prs" || "$CHECK" == "all" ]]; then
    echo "  Open PRs:"
    gh api repos/GlacierEQ/$repo/pulls?state=open -q '.[:5] | .[] | "    #\(.number) \(.title)"' 2>/dev/null || echo "    (none)"
  fi
  
  if [[ "$CHECK" == "issues" || "$CHECK" == "all" ]]; then
    echo "  Open issues:"
    gh api repos/GlacierEQ/$repo/issues?state=open -q '.[:5] | .[] | "    #\(.number) \(.title)"' 2>/dev/null || echo "    (none)"
  fi
  
  if [[ "$CHECK" == "ci" || "$CHECK" == "all" ]]; then
    echo "  CI workflow:"
    CI=$(gh api repos/GlacierEQ/$repo/contents/.github/workflows/ci.yml --jq '.sha' 2>/dev/null)
    if [ -n "$CI" ]; then
      echo "    ✅ ci.yml exists"
    else
      echo "    ❌ no ci.yml"
    fi
  fi
done
```

## Evidence

- Repeated 5+ times in trajectory: `for repo in ... gh api repos/GlacierEQ/$repo/commits`
- Used for: recent commits, open PRs, open issues, CI status
- Each invocation saves ~100 tokens vs manual for-loop construction
