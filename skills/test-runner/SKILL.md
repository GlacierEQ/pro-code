---
name: test-runner
description: Run test suites across GlacierEQ repos with standardized output. Supports mastermind, colossus, and custom repos.
---

# Test Runner Skill

Standardized test execution across the APEX ecosystem.

## Quick Start

```bash
# Run mastermind tests
test-runner mastermind

# Run colossus tests
test-runner colossus

# Run all colossus subsystems
test-runner colossus-all

# Run tests for specific repo
test-runner ~/xai-colossus-cooling

# Run with verbose output
test-runner mastermind --verbose
```

## Supported Targets

| Target | Path | Test Command |
|--------|------|--------------|
| `mastermind` | `~/mastermind` | `python3 -m pytest tests/ --tb=no -q` |
| `colossus` | `~/xai-colossus-2` | `python3 tests/test_end_to_end.py && python3 tests/test_cli.py` |
| `colossus-cooling` | `~/xai-colossus-cooling` | `python3 -m pytest tests/ -q` |
| `colossus-energy` | `~/xai-colossus-energy` | `python3 -m pytest tests/ -q` |
| `colossus-security` | `~/xai-colossus-security` | `python3 -m pytest tests/ -q` |
| `colossus-nanosphere` | `~/xai-colossus-nanosphere` | `python3 -m pytest tests/ -q` |
| `colossus-all` | all colossus repos | run each sequentially |

## Implementation

```bash
#!/bin/bash
# test-runner.sh — Standardized test execution
set -euo pipefail

TARGET="${1:-mastermind}"
VERBOSE=false
[[ "${2:-}" == "--verbose" ]] && VERBOSE=true

run_tests() {
  local name="$1" path="$2" cmd="$3"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🧪 $name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  if [ ! -d "$path" ]; then
    echo "  ❌ Directory not found: $path"
    return 1
  fi
  
  cd "$path"
  if $VERBOSE; then
    eval "$cmd" 2>&1
  else
    eval "$cmd" 2>&1 | tail -5
  fi
  echo ""
}

case "$TARGET" in
  mastermind)
    run_tests "Mastermind" ~/mastermind "python3 -m pytest tests/ --tb=no -q"
    ;;
  colossus)
    run_tests "Colossus Core" ~/xai-colossus-2 "python3 tests/test_end_to_end.py 2>&1 && python3 tests/test_cli.py 2>&1"
    ;;
  colossus-all)
    run_tests "Colossus Core" ~/xai-colossus-2 "python3 tests/test_end_to_end.py 2>&1 && python3 tests/test_cli.py 2>&1"
    for sub in cooling energy security nanosphere; do
      run_tests "Colossus $sub" ~/xai-colossus-$sub "python3 -m pytest tests/ -q 2>&1"
    done
    ;;
  colossus-*)
    sub="${TARGET#colossus-}"
    run_tests "Colossus $sub" ~/xai-colossus-$sub "python3 -m pytest tests/ -q 2>&1"
    ;;
  *)
    # Treat as custom path
    if [ -d ~/"$TARGET" ]; then
      run_tests "$TARGET" ~/"$TARGET" "python3 -m pytest tests/ -q 2>&1"
    else
      echo "Unknown target: $TARGET"
      echo "Available: mastermind, colossus, colossus-all, colossus-{cooling,energy,security,nanosphere}"
      exit 1
    fi
    ;;
esac
```

## Evidence

- Mastermind pytest: 11 invocations in trajectory
- Colossus test suite: 10 invocations in trajectory
- Each invocation saves ~80 tokens vs manual cd + command construction
