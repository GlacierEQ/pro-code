#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

MANIFEST_URL = "https://raw.githubusercontent.com/GlacierEQ/AKOS/main/governance/glaciereq.nervous-system.v1.json"
MANIFEST_TIMEOUT_SECONDS = 20
KERNEL_MAIN_SHA = "47de3e53dbf8f9bd10421a6b54a269e035a4b783"
KERNEL_TESTED_SHA = "b6aa44b9d90fee4c9c935d958574e6fca0b17680"
AKOS_SHA = "eac3cab001306225b99da41c37370528331966dd"
PRO_CODE_SHA = "c6cbfc8c01db6533c163148457908b03f76e5461"
LIVE_RECEIPT_SHA256 = "277c69fbdbc3a877bdbe3d69267d5fcecc682a56d38d309dd4da3bf8c641f7a6"
LIVE_RECEIPT_RUN_ID = "31537976922"
HARDENED_BEHAVIORAL_TESTED_SHA = "5881b9fc6c57599d059432499098fdf3636b7eb4"
HARDENED_BEHAVIORAL_RECEIPT_SHA256 = "a0884186349595983e191f9a357adabdd4ec98a54c5aae54d5fb42d2a2d92b71"
LIVE_RECEIPT_PATH = Path(".glaciereq/computer-kernel.live-receipt.json")
DOC_PATH = Path("docs/COMPUTER_EXECUTION_KERNEL.md")
CONTRACT_PATH = Path(".glaciereq/nervous-system.node.json")

errors: list[str] = []

try:
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as exc:
    print(f"::error::unable to load local nervous-system contract: {type(exc).__name__}: {exc}")
    sys.exit(1)
if not isinstance(contract, dict):
    print("::error::local nervous-system contract must be a JSON object")
    sys.exit(1)

try:
    with urlopen(MANIFEST_URL, timeout=MANIFEST_TIMEOUT_SECONDS) as response:
        manifest = json.loads(response.read().decode("utf-8"))
except (HTTPError, URLError, OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
    errors.append(
        "canonical AKOS manifest unavailable or invalid: "
        f"{type(exc).__name__}: {exc}"
    )
    manifest = {}
if not isinstance(manifest, dict):
    errors.append("canonical AKOS manifest must be a JSON object")
    manifest = {}

repo = os.environ.get("GITHUB_REPOSITORY", contract.get("repository"))
node = manifest.get("nodes", {}).get(repo) if isinstance(manifest.get("nodes", {}), dict) else None

if not node:
    errors.append(f"{repo} is not registered in available canonical manifest")
else:
    if contract.get("schema_id") != manifest.get("schema_id"):
        errors.append("schema_id drift")
    if contract.get("repository") != repo:
        errors.append("repository identity drift")
    if contract.get("role") != node.get("role"):
        errors.append("role drift")
    if manifest.get("canonical_repository") and manifest.get("canonical_path"):
        expected = f"{manifest['canonical_repository']}/{manifest['canonical_path']}"
        if contract.get("canonical_manifest") != expected:
            errors.append("canonical manifest pointer drift")
    else:
        errors.append("canonical manifest identity fields missing")
    if contract.get("operating_sequence") != manifest.get("operating_sequence"):
        errors.append("operating sequence drift")
    readme = Path("README.md").read_text(encoding="utf-8").lower()
    for term in node.get("required_terms", []):
        if term.lower() not in readme:
            errors.append(f"README missing term: {term}")
    for link in node.get("required_links", []):
        if link.lower() not in readme:
            errors.append(f"README missing link: {link}")

raw_relationships = contract.get("relationships") or []
if not isinstance(raw_relationships, list):
    errors.append("relationships must be a list")
    relationships = []
else:
    relationships = []
    for index, item in enumerate(raw_relationships):
        if not isinstance(item, dict):
            errors.append(f"relationships[{index}] must be an object")
            continue
        relationships.append(item)

kernel = [item for item in relationships if item.get("target") == "GlacierEQ/computer-user"]
if len(kernel) != 1:
    errors.append("computer-user kernel relationship must appear exactly once")
else:
    rel = kernel[0]
    expected_relationship = {
        "relation": "COMPUTER_EXECUTION_KERNEL",
        "kernel_main_sha": KERNEL_MAIN_SHA,
        "kernel_runtime_integration_proven": True,
        "persistent_host_activation_contract_verified": True,
        "persistent_production_host_verified": False,
        "pro_code_live_invocation_receipt": True,
        "live_receipt_proof": str(LIVE_RECEIPT_PATH),
        "live_receipt_tested_kernel_sha": KERNEL_TESTED_SHA,
        "live_receipt_sha256": LIVE_RECEIPT_SHA256,
        "live_receipt_capability": "kernel.health",
        "live_receipt_akos_sha": AKOS_SHA,
        "live_receipt_workflow_run_id": LIVE_RECEIPT_RUN_ID,
    }
    for field, expected_value in expected_relationship.items():
        if rel.get(field) != expected_value:
            errors.append(f"computer-user relationship drift: {field}")

if contract.get("runtime_integration_claimed") is not True:
    errors.append("pro-code runtime integration must be claimed after verified receipt")
if contract.get("production_deployment_claimed") is not False:
    errors.append("production deployment must remain false without persistent-host receipt")

proof_valid = False
proof: dict = {}
if not LIVE_RECEIPT_PATH.is_file():
    errors.append("missing Pro-Code computer-kernel live receipt proof")
else:
    try:
        parsed_proof = json.loads(LIVE_RECEIPT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"unable to load live receipt proof: {type(exc).__name__}: {exc}")
    else:
        if not isinstance(parsed_proof, dict):
            errors.append("live receipt proof must be an object")
        elif not parsed_proof:
            errors.append("live receipt proof must not be empty")
        else:
            proof = parsed_proof
            proof_valid = True

if proof_valid:
    expected_top = {
        "schema": "glaciereq.pro-code.computer-kernel-live-receipt.v1",
        "status": "PASS",
        "repository": "GlacierEQ/pro-code",
        "pro_code_source_sha": PRO_CODE_SHA,
    }
    for field, expected_value in expected_top.items():
        if proof.get(field) != expected_value:
            errors.append(f"live receipt proof drift: {field}")

    kernel_proof = proof.get("kernel")
    if not isinstance(kernel_proof, dict):
        errors.append("live receipt kernel proof must be an object")
        kernel_proof = {}
    expected_kernel = {
        "repository": "GlacierEQ/computer-user",
        "canonical_main_sha": KERNEL_MAIN_SHA,
        "tested_source_sha": KERNEL_TESTED_SHA,
        "executor": "GlacierEQ/computer-user",
    }
    for field, expected_value in expected_kernel.items():
        if kernel_proof.get(field) != expected_value:
            errors.append(f"live receipt kernel drift: {field}")

    akos_proof = proof.get("akos")
    if not isinstance(akos_proof, dict):
        errors.append("live receipt AKOS proof must be an object")
        akos_proof = {}
    expected_akos = {
        "repository": "GlacierEQ/AKOS",
        "source_sha": AKOS_SHA,
        "acceptance_status": "VERIFIED",
    }
    for field, expected_value in expected_akos.items():
        if akos_proof.get(field) != expected_value:
            errors.append(f"live receipt AKOS drift: {field}")

    invocation = proof.get("invocation")
    if not isinstance(invocation, dict):
        errors.append("live receipt invocation must be an object")
        invocation = {}
    expected_invocation = {
        "caller": "GlacierEQ/pro-code",
        "capability": "kernel.health",
        "execution_result": "completed",
        "verification_result": "PASS",
        "receipt_sha256": LIVE_RECEIPT_SHA256,
        "caller_bound": True,
        "trace_bound": True,
        "capability_bound": True,
        "terminal_source_sha_bound": True,
        "receipt_hash_bound": True,
    }
    for field, expected_value in expected_invocation.items():
        if invocation.get(field) != expected_value:
            errors.append(f"live receipt invocation drift: {field}")

    governed = proof.get("governed_public_action")
    if not isinstance(governed, dict):
        errors.append("governed public action proof must be an object")
        governed = {}
    if governed.get("workflow_run_id") != LIVE_RECEIPT_RUN_ID:
        errors.append("live receipt workflow run drift")
    if governed.get("result_status") != "completed":
        errors.append("live receipt governed result is not completed")

    behavioral = proof.get("canonical_kernel_proof")
    if not isinstance(behavioral, dict):
        errors.append("canonical kernel behavioral proof must be an object")
        behavioral = {}
    expected_behavioral = {
        "path": "GlacierEQ/computer-user/machine/pro-code-originated-live-receipt-proof.json",
        "hardened_behavioral_receipt_sha256": HARDENED_BEHAVIORAL_RECEIPT_SHA256,
        "hardened_behavioral_tested_source_sha": HARDENED_BEHAVIORAL_TESTED_SHA,
    }
    for field, expected_value in expected_behavioral.items():
        if behavioral.get(field) != expected_value:
            errors.append(f"canonical kernel behavioral proof drift: {field}")

    truth = proof.get("truth_boundary")
    if not isinstance(truth, dict):
        errors.append("live receipt truth boundary must be an object")
        truth = {}
    if truth.get("runtime_integration_verified") is not True:
        errors.append("live receipt runtime integration is not verified")
    if truth.get("persistent_production_host_verified") is not False:
        errors.append("persistent production host must remain unverified")
    if truth.get("production_deployed") is not False:
        errors.append("production deployed must remain false")

if not DOC_PATH.is_file():
    errors.append("missing computer execution kernel contract doc")
else:
    text = DOC_PATH.read_text(encoding="utf-8")
    required_doc_values = (
        KERNEL_MAIN_SHA,
        KERNEL_TESTED_SHA,
        HARDENED_BEHAVIORAL_TESTED_SHA,
        AKOS_SHA,
        PRO_CODE_SHA,
        LIVE_RECEIPT_SHA256,
        HARDENED_BEHAVIORAL_RECEIPT_SHA256,
        LIVE_RECEIPT_RUN_ID,
        "203 PASS",
        "behavioral proof",
        "merge-guard proof",
        "production deployment remains false",
        "issue #20",
    )
    for required in required_doc_values:
        if required not in text:
            errors.append(f"kernel contract doc missing: {required}")

if errors:
    for error in errors:
        print(f"::error::{error}")
    sys.exit(1)

print(
    json.dumps(
        {
            "schema": "glaciereq.nervous-system.validation.v1",
            "status": "verified",
            "repository": repo,
            "role": node["role"],
            "manifest_version": manifest["version"],
            "computer_execution_kernel": "verified",
            "canonical_kernel_sha": KERNEL_MAIN_SHA,
            "tested_kernel_sha": KERNEL_TESTED_SHA,
            "behavioral_kernel_sha": HARDENED_BEHAVIORAL_TESTED_SHA,
            "canonical_akos_sha": AKOS_SHA,
            "pro_code_live_invocation_receipt": True,
            "live_receipt_sha256": LIVE_RECEIPT_SHA256,
            "behavioral_receipt_sha256": HARDENED_BEHAVIORAL_RECEIPT_SHA256,
            "runtime_integration_claimed": True,
            "persistent_production_host_verified": False,
            "production_deployment_claimed": False,
        },
        indent=2,
    )
)
