#!/usr/bin/env python3
"""Native operator entrypoint. Delegates to existing verified Node capabilities.

This file is an adapter, not a second agent runtime. It does not claim success
unless the owning executable produced an appropriately typed native receipt.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCHEMA = "glaciereq.pro-code.operator-bridge.v1"


def error_record(code: str, message: str) -> dict:
    return {"schema_version": SCHEMA, "status": "failed", "error_code": code, "error": message}


def arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run existing compiler code-fix and evidence-backed evaluation tools")
    parser.add_argument("operation", choices=("inspect", "repair", "evaluate"))
    parser.add_argument("--workspace", help="Workspace for inspect/repair; default current directory")
    parser.add_argument("--config", default="tsconfig.json")
    parser.add_argument("--file", help="Existing TypeScript/JavaScript source file to inspect or repair")
    parser.add_argument("--code", type=int, help="Existing TypeScript diagnostic code for repair")
    parser.add_argument("--occurrence", type=int, default=0, help="Zero-based diagnostic occurrence")
    parser.add_argument("--fix-index", type=int, help="Explicit compiler-provided fix index; otherwise first eligible")
    parser.add_argument("--verify-test", help="Trusted existing Node test file inside the target workspace")
    parser.add_argument("--timeout-ms", type=int, default=30000, help="Verifier timeout in milliseconds (1000..120000)")
    parser.add_argument("--out", help="Explicit JSON output filename for evaluate only")
    parser.add_argument("--process-timeout", type=int, default=None, help="Read-only inspect/evaluate process timeout in seconds (30..900); not available for mutating repairs")
    opts = parser.parse_args(argv)
    supplied = {item for item in argv if item.startswith('--')}
    if opts.process_timeout is not None and (opts.process_timeout < 30 or opts.process_timeout > 900):
        parser.error("--process-timeout must be 30..900 seconds")
    if opts.operation == "repair" and opts.process_timeout is not None:
        parser.error("--process-timeout is unsafe for mutating repair; use native --timeout-ms for the verifier")
    if opts.operation == "evaluate":
        if supplied.intersection({"--workspace", "--config", "--file", "--code",
                                  "--occurrence", "--fix-index", "--verify-test", "--timeout-ms"}):
            parser.error("evaluate does not accept source repair flags")
    else:
        if not opts.file:
            parser.error("inspect and repair require --file")
        if opts.out:
            parser.error("--out is supported for evaluate only")
        if opts.operation == "inspect":
            if supplied.intersection({"--code", "--verify-test", "--fix-index",
                                      "--occurrence", "--timeout-ms"}):
                parser.error("inspect cannot select a repair action, occurrence or verifier timeout")
        else:
            if opts.code is None or opts.code <= 0 or not opts.verify_test:
                parser.error("repair requires --code positive integer and --verify-test")
            if opts.timeout_ms < 1000 or opts.timeout_ms > 120000:
                parser.error("repair --timeout-ms must be 1000..120000")
    return opts


def command_for(opts: argparse.Namespace, node: str) -> list[str]:
    if opts.operation == "evaluate":
        command = [node, str(REPO / "scripts/harness-eval.mjs"), "--strict"]
        if opts.out:
            command += ["--out", str(Path(opts.out).expanduser().resolve())]
        return command

    workspace = str(Path(opts.workspace or ".").expanduser().resolve(strict=True))
    if not Path(workspace).is_dir():
        raise ValueError("workspace must be an existing directory")
    command = [node, str(REPO / "scripts/code-fix.mjs"),
               "--root", workspace, "--config", opts.config, "--file", opts.file]
    if opts.operation == "repair":
        command += ["--code", str(opts.code), "--occurrence", str(opts.occurrence),
                    "--repair", "--verify-test", opts.verify_test,
                    "--timeout-ms", str(opts.timeout_ms)]
        if opts.fix_index is not None:
            command += ["--fix-index", str(opts.fix_index)]
    return command


def valid_native_result(operation: str, receipt: object) -> bool:
    if not isinstance(receipt, dict):
        return False
    if operation == "inspect":
        return (receipt.get("operation") == "typescript_code_fix_inventory"
                and receipt.get("source_modified") is False
                and isinstance(receipt.get("diagnostics"), list))
    if operation == "repair":
        return (receipt.get("operation") == "verified_typescript_code_repair"
                and receipt.get("outcome") == "verified_code_repair"
                and receipt.get("source_modified") is True
                and isinstance(receipt.get("verification"), dict)
                and receipt["verification"].get("passed") is True
                and receipt["verification"].get("new_project_diagnostic_count") == 0
                and receipt["verification"].get("all_write_hashes_match") is True)
    gate = receipt.get("evidence_gate")
    return (receipt.get("evaluation_kind") == "hermetic_real_http_ablation"
            and receipt.get("result") == "local_ablation_improvement_verified"
            and isinstance(gate, dict)
            and gate.get("decision") == "accept_local_component_evidence"
            and gate.get("approval_to_deploy") is False)


def main(argv: list[str] | None = None) -> int:
    opts = arguments(sys.argv[1:] if argv is None else argv)
    node = shutil.which("node")
    if not node:
        print(json.dumps(error_record("node_unavailable", "Node executable was not found on PATH")))
        return 2
    lock_fd = None
    output_lock = None
    try:
        cmd = command_for(opts, node)
        # A user-selected evaluator output is write-once per path. The
        # exclusive sibling lock rejects concurrent or stale overwrites.
        if opts.operation == "evaluate" and opts.out:
            dest = Path(opts.out).expanduser().resolve()
            dest.parent.mkdir(parents=True, exist_ok=True)
            output_lock = Path(str(dest) + ".bridge.lock")
            lock_fd = os.open(output_lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            if dest.exists() or dest.is_symlink():
                raise FileExistsError("refusing to replace existing evaluation evidence")
        # Never impose a second hard deadline on mutating repair: killing its
        # process could interrupt source restoration between verification and
        # rollback. The owning Node engine bounds each verifier and closes its
        # own transaction; read-only inspect/evaluate retain an outer deadline.
        outer_timeout = None if opts.operation == "repair" else (opts.process_timeout or 300)
        result = subprocess.run(cmd, cwd=REPO, shell=False, encoding="utf-8",
                                errors="strict", text=True, capture_output=True,
                                timeout=outer_timeout, check=False)
    except (ValueError, OSError, subprocess.TimeoutExpired, UnicodeError) as exc:
        kind = ("command_timeout" if isinstance(exc, subprocess.TimeoutExpired)
                else "invalid_native_encoding" if isinstance(exc, UnicodeError)
                else "evidence_exists" if isinstance(exc, FileExistsError)
                else "command_unavailable")
        print(json.dumps(error_record(kind, str(exc))))
        return 2
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
            output_lock.unlink()
    try:
        receipt = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(json.dumps(error_record("invalid_native_receipt",
                                      "Owning native command did not produce valid JSON; no completion established")))
        if result.stderr:
            print(result.stderr[-1500:], file=sys.stderr)
        return 1
    # Preserve exact native receipt. Even if it failed, callers must see the
    # source-supported error and not a fabricated operator-level success.
    print(json.dumps(receipt, indent=2))
    if result.returncode != 0 or not valid_native_result(opts.operation, receipt):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
