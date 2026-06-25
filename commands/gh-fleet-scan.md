---
description: Scan GlacierEQ GitHub fleet with flexible filters. Outputs repo name, description, language, and status.
---

# GitHub Fleet Scanner

Scan the GlacierEQ GitHub organization with parameterized filters.

## Usage

```
gh-fleet-scan [FILTER] [--limit N] [--format json|table]
```

## Filters

| Filter | Description |
|--------|-------------|
| `all` | All repos (default) |
| `pro` | Pro-* flagship repos only |
| `colossus` | xAI Colossus infrastructure repos |
| `aeon` | AEON-777 repos |
| `legal` | Legal warfare, evidence, forensics repos |
| `memory` | Memory system repos |
| `mcp` | MCP connector repos |
| `forks` | Forked repos only |
| `backups` | Z-BACKUP repos |
| `python` | Python repos only |
| `typescript` | TypeScript repos only |
| `public` | Public repos only |
| `private` | Private repos only |
| `stale` | Repos not updated in 30+ days |
| `recent` | Repos updated in last 7 days |

## Examples

```bash
# All repos with summary
gh-fleet-scan all

# Pro flagships
gh-fleet-scan pro

# Legal repos with details
gh-fleet-scan legal --format table

# Find stale repos for cleanup
gh-fleet-scan stale --limit 20

# Count by language
gh-fleet-scan python --format json | jq length
```

## Implementation

```bash
#!/bin/bash
# gh-fleet-scan.sh — GlacierEQ fleet scanner
set -euo pipefail

FILTER="${1:-all}"
LIMIT="${LIMIT:-500}"
FORMAT="${FORMAT:-table}"

# Ensure auth
export GITHUB_TOKEN="${GITHUB_TOKEN:-$(grep oauth_token ~/.config/gh/hosts.yml | head -1 | awk '{print $2}')}"

JQ_FILTER='.[] | "\(.name)\t\(.primaryLanguage?.name // "—")\t\(.updatedAt[:10])\t\(.isPrivate)"'
case "$FILTER" in
  all)        ;;
  pro)        JQ_FILTER='.[] | select(.name | startswith("Pro-")) | "\(.name)\t\(.primaryLanguage?.name // "—")\t\(.updatedAt[:10])"' ;;
  colossus)   JQ_FILTER='.[] | select(.name | test("(colossus|xai-colossus)")) | "\(.name)\t\(.primaryLanguage?.name // "—")\t\(.updatedAt[:10])"' ;;
  aeon)       JQ_FILTER='.[] | select(.name | test("(aeon|AEON)")) | "\(.name)\t\(.primaryLanguage?.name // "—")\t\(.updatedAt[:10])"' ;;
  legal)      JQ_FILTER='.[] | select(.name | test("(legal|evidence|forensic|1fdv|docket|CYBERTACK)")) | "\(.name)\t\(.primaryLanguage?.name // "—")\t\(.updatedAt[:10])"' ;;
  memory)     JQ_FILTER='.[] | select(.name | test("(memory|grove|holographic|supermemory)")) | "\(.name)\t\(.primaryLanguage?.name // "—")\t\(.updatedAt[:10])"' ;;
  mcp)        JQ_FILTER='.[] | select(.name | test("(mcp|gateway|connector)")) | "\(.name)\t\(.primaryLanguage?.name // "—")\t\(.updatedAt[:10])"' ;;
  forks)      JQ_FILTER='.[] | select(.isFork == true) | "\(.name)\t\(.description // "—")\t\(.updatedAt[:10])"' ;;
  backups)    JQ_FILTER='.[] | select(.name | test("(BACKUP|backup)")) | "\(.name)\t\(.description // "—")\t\(.updatedAt[:10])"' ;;
  python)     JQ_FILTER='.[] | select(.primaryLanguage?.name == "Python") | "\(.name)\t\(.updatedAt[:10])\t\(.isPrivate)"' ;;
  typescript) JQ_FILTER='.[] | select(.primaryLanguage?.name == "TypeScript") | "\(.name)\t\(.updatedAt[:10])\t\(.isPrivate)"' ;;
  public)     JQ_FILTER='.[] | select(.isPrivate == false) | "\(.name)\t\(.primaryLanguage?.name // "—")\t\(.updatedAt[:10])"' ;;
  private)    JQ_FILTER='.[] | select(.isPrivate == true) | "\(.name)\t\(.primaryLanguage?.name // "—")\t\(.updatedAt[:10])"' ;;
  stale)      JQ_FILTER='.[] | select(.updatedAt < (now - 2592000 | todate)) | "\(.name)\t\(.updatedAt[:10])\t\(.primaryLanguage?.name // "—")"' ;;
  recent)     JQ_FILTER='.[] | select(.updatedAt > (now - 604800 | todate)) | "\(.name)\t\(.updatedAt[:10])\t\(.primaryLanguage?.name // "—")"' ;;
  *)          echo "Unknown filter: $FILTER" >&2; exit 1 ;;
esac

gh repo list GlacierEQ --limit "$LIMIT" --json name,primaryLanguage,updatedAt,isPrivate,description | jq -r "$JQ_FILTER"
```

## Evidence

- Repeated 7+ times in trajectory with different jq filters
- Each invocation saves ~50 tokens vs manual construction
- Patterns: `gh repo list GlacierEQ --limit 500 --json ... | jq '.[] | select(...)'`
