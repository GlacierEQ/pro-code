#!/usr/bin/env python3
"""Verify GlacierEQ Helix substrate without third-party dependencies."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROLE_TO_STRAND = {
    "doctrine_strand": "doctrine",
    "runtime_strand": "runtime",
}

BASE_REQUIRED = [
    ".apex/repo-profile.json",
    ".helix/strand.json",
    ".helix/schemas/repo-profile.schema.json",
    ".helix/schemas/strand.schema.json",
    ".helix/phase-1b-contract.md",
    ".audit/drift-rules.md",
    "tools/helix_verify.py",
    ".github/workflows/helix-verify.yml",
]

ROLE_REQUIRED = {
    "doctrine_strand": [
        ".helix/inheritance-contract.md",
        ".links/repo-registry.json",
        ".mastermind/agent-loading-policy.md",
        ".audit/repo-health.md",
    ],
    "runtime_strand": [
        ".aspen/grove-sync-policy.json",
        ".pistons/worker-registry.json",
        ".mastermind/sidecar-hooks.json",
        ".audit/runtime-health.md",
    ],
}

SECRET_PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----"),
    re.compile(r"\bghp_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bm0-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"(?im)^\s*(?:api[_-]?key|token|secret|password)\s*=\s*['\"]?[^'\"\s]+"),
]

SCAN_GLOBS = [".apex/**/*", ".helix/**/*", ".aspen/**/*", ".pistons/**/*", ".mastermind/**/*", ".links/**/*", ".audit/**/*"]


def load_json(path: Path, errors: list[str]) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        errors.append(f"missing JSON file: {path}")
        return {}
    except json.JSONDecodeError as exc:
        errors.append(f"invalid JSON in {path}: {exc}")
        return {}
    if not isinstance(data, dict):
        errors.append(f"JSON root must be object: {path}")
        return {}
    return data


def expect(condition: bool, errors: list[str], message: str) -> None:
    if not condition:
        errors.append(message)


def check_required_files(root: Path, expected_role: str, errors: list[str]) -> None:
    required = BASE_REQUIRED + ROLE_REQUIRED.get(expected_role, [])
    for rel in required:
        expect((root / rel).exists(), errors, f"missing required file: {rel}")


def check_profile(root: Path, expected_repo: str, expected_role: str, errors: list[str]) -> dict[str, Any]:
    profile = load_json(root / ".apex/repo-profile.json", errors)
    expect(profile.get("repo") == expected_repo, errors, f"repo profile mismatch: expected {expected_repo}, got {profile.get('repo')}")
    expect(profile.get("helix_role") == expected_role, errors, f"helix role mismatch: expected {expected_role}, got {profile.get('helix_role')}")
    expect(isinstance(profile.get("hidden_substrate"), dict), errors, "repo profile hidden_substrate must be an object")
    expect("no_raw_secrets" in str(profile.get("secret_policy", "")), errors, "secret_policy must include no_raw_secrets")
    expect(bool(profile.get("mission")), errors, "repo profile mission is required")
    if expected_role == "doctrine_strand":
        expect(bool(profile.get("paired_runtime_strand")), errors, "doctrine profile must declare paired_runtime_strand")
    if expected_role == "runtime_strand":
        expect(bool(profile.get("paired_doctrine_strand")), errors, "runtime profile must declare paired_doctrine_strand")
    return profile


def check_strand(root: Path, expected_repo: str, expected_role: str, errors: list[str]) -> dict[str, Any]:
    strand = load_json(root / ".helix/strand.json", errors)
    expected_strand = ROLE_TO_STRAND[expected_role]
    expect(strand.get("strand_type") == expected_strand, errors, f"strand_type mismatch: expected {expected_strand}, got {strand.get('strand_type')}")
    expect(isinstance(strand.get("authority"), dict), errors, "strand authority must be an object")
    expect(isinstance(strand.get("non_goals"), list) and bool(strand.get("non_goals")), errors, "strand non_goals must be a non-empty list")
    paired = strand.get("paired_strand")
    expect(isinstance(paired, str) and "/" in paired, errors, "strand must declare paired_strand as owner/repo")
    if expected_role == "doctrine_strand":
        expect(strand.get("authority", {}).get("runtime_execution") is False, errors, "doctrine strand must not claim runtime_execution authority")
    if expected_role == "runtime_strand":
        expect(strand.get("authority", {}).get("runtime_execution") is True, errors, "runtime strand must claim runtime_execution authority")
    return strand


def check_pair(profile: dict[str, Any], strand: dict[str, Any], expected_role: str, errors: list[str]) -> None:
    profile_pair = profile.get("paired_runtime_strand") if expected_role == "doctrine_strand" else profile.get("paired_doctrine_strand")
    expect(strand.get("paired_strand") == profile_pair, errors, f"profile/strand pair mismatch: {profile_pair} vs {strand.get('paired_strand')}")


def check_peer(root: Path, expected_repo: str, strand: dict[str, Any], peer_root: Path | None, errors: list[str]) -> None:
    if not peer_root:
        return
    peer_profile = load_json(peer_root / ".apex/repo-profile.json", errors)
    peer_strand = load_json(peer_root / ".helix/strand.json", errors)
    peer_repo = peer_profile.get("repo")
    expect(strand.get("paired_strand") == peer_repo, errors, f"local paired_strand does not match peer repo: {strand.get('paired_strand')} vs {peer_repo}")
    expect(peer_strand.get("paired_strand") == expected_repo, errors, f"peer does not point back to {expected_repo}: {peer_strand.get('paired_strand')}")


def check_json_schemas(root: Path, errors: list[str]) -> None:
    for rel in [".helix/schemas/repo-profile.schema.json", ".helix/schemas/strand.schema.json"]:
        schema = load_json(root / rel, errors)
        expect(schema.get("$schema") is not None, errors, f"schema missing $schema: {rel}")
        expect(isinstance(schema.get("required"), list), errors, f"schema missing required array: {rel}")


def check_secret_drift(root: Path, errors: list[str]) -> None:
    files: set[Path] = set()
    for pattern in SCAN_GLOBS:
        files.update(path for path in root.glob(pattern) if path.is_file())
    for path in sorted(files):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for regex in SECRET_PATTERNS:
            if regex.search(text):
                errors.append(f"possible raw secret in {path.relative_to(root)} matching {regex.pattern}")
                break


def write_report(path: Path, expected_repo: str, expected_role: str, errors: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "repo": expected_repo,
        "expected_role": expected_role,
        "status": "pass" if not errors else "fail",
        "error_count": len(errors),
        "errors": errors,
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Helix substrate identity, drift, and pair integrity.")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--expected-repo", required=True)
    parser.add_argument("--expected-role", choices=sorted(ROLE_TO_STRAND), required=True)
    parser.add_argument("--peer-root", default=None, help="Optional checked-out paired repo root for reciprocal verification.")
    parser.add_argument("--report", default=".audit/helix-verification-report.json")
    args = parser.parse_args()

    root = Path(args.repo_root).resolve()
    peer_root = Path(args.peer_root).resolve() if args.peer_root else None
    errors: list[str] = []

    check_required_files(root, args.expected_role, errors)
    profile = check_profile(root, args.expected_repo, args.expected_role, errors)
    strand = check_strand(root, args.expected_repo, args.expected_role, errors)
    check_pair(profile, strand, args.expected_role, errors)
    check_peer(root, args.expected_repo, strand, peer_root, errors)
    check_json_schemas(root, errors)
    check_secret_drift(root, errors)
    write_report(root / args.report, args.expected_repo, args.expected_role, errors)

    if errors:
        print("Helix verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Helix verification passed for {args.expected_repo} ({args.expected_role}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
