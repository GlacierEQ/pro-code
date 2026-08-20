#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

MANIFEST_URL = "https://raw.githubusercontent.com/GlacierEQ/AKOS/main/governance/glaciereq.nervous-system.v2.json"
MANIFEST_TIMEOUT_SECONDS = 20
SELECTED_KERNEL_MAIN_SHA = "47de3e53dbf8f9bd10421a6b54a269e035a4b783"
KERNEL_TESTED_SHA = "b6aa44b9d90fee4c9c935d958574e6fca0b17680"
AKOS_VERIFIER_SHA = "eac3cab001306225b99da41c37370528331966dd"
PRO_CODE_SHA = "c6cbfc8c01db6533c163148457908b03f76e5461"
LIVE_RECEIPT_SHA256 = "277c69fbdbc3a877bdbe3d69267d5fcecc682a56d38d309dd4da3bf8c641f7a6"
LIVE_RECEIPT_RUN_ID = "31537976922"
HARDENED_BEHAVIORAL_TESTED_SHA = "5881b9fc6c57599d059432499098fdf3636b7eb4"
HARDENED_BEHAVIORAL_RECEIPT_SHA256 = "a0884186349595983e191f9a357adabdd4ec98a54c5aae54d5fb42d2a2d92b71"
LIVE_RECEIPT_PATH = Path(".glaciereq/computer-kernel.live-receipt.json")
DOC_PATH = Path("docs/COMPUTER_EXECUTION_KERNEL.md")
CONTRACT_PATH = Path(".glaciereq/nervous-system.node.json")
EXPECTED_SEQUENCE = ["context", "discover", "compare", "cure", "innovate", "execute", "verify", "persist", "evolve"]

errors: list[str] = []
notices: list[str] = []


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"unable to load {label}: {type(exc).__name__}: {exc}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"{label} must be a JSON object")
        return {}
    return value


contract = load_json(CONTRACT_PATH, "local nervous-system contract")

try:
    with urlopen(MANIFEST_URL, timeout=MANIFEST_TIMEOUT_SECONDS) as response:
        manifest = json.loads(response.read().decode("utf-8"))
except (HTTPError, URLError, OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
    errors.append(f"APEX nervous-system manifest unavailable or invalid: {type(exc).__name__}: {exc}")
    manifest = {}
if not isinstance(manifest, dict):
    errors.append("APEX nervous-system manifest must be a JSON object")
    manifest = {}

repo = os.environ.get("GITHUB_REPOSITORY", contract.get("repository"))
node = manifest.get("nodes", {}).get(repo) if isinstance(manifest.get("nodes", {}), dict) else None
apex = manifest.get("apex_logic", {}) if isinstance(manifest.get("apex_logic", {}), dict) else {}
authority = manifest.get("operator_authority", {}) if isinstance(manifest.get("operator_authority", {}), dict) else {}

if manifest.get("schema_id") != "glaciereq.nervous-system.v2":
    errors.append("nervous-system schema drift")

required_authority = {
    "authority_holder": "OPERATOR",
    "operator_project_direction_authority": True,
    "machine_project_direction_authority": False,
    "machine_asset_disposition_authority": False,
    "machine_estate_hierarchy_authority": False,
    "historical_receipt_creates_current_authority": False,
}
for field, expected in required_authority.items():
    if authority.get(field) != expected:
        errors.append(f"Operator authority invariant drift: {field}")

if apex.get("selection_scope") != "OPERATOR_AUTHORIZED_EXECUTION_OPTIONS_ONLY":
    errors.append("APEX execution selection escaped Operator-authorized scope")
if apex.get("selection_confers_project_authority") is not False:
    errors.append("APEX execution selection must not confer project authority")
if apex.get("capability_donor_preservation") is not True:
    errors.append("APEX capability-donor preservation drift")
if apex.get("operator_objective_precedence") is not True:
    errors.append("Operator objective precedence drift")

if not isinstance(node, dict):
    notices.append(f"{repo} is absent from the descriptive capability map; absence creates no hierarchy or disposition inference")
    node = {}
else:
    if contract.get("role") != node.get("role"):
        notices.append(f"descriptive role drift: manifest={node.get('role')!r}, local={contract.get('role')!r}")
    if contract.get("apex_role") != node.get("apex_role"):
        notices.append(f"descriptive apex_role drift: manifest={node.get('apex_role')!r}, local={contract.get('apex_role')!r}")

expected_contract = {
    "schema_id": "glaciereq.nervous-system-node.v2",
    "nervous_system_schema_id": manifest.get("schema_id"),
    "repository": repo,
    "apex_manifest": MANIFEST_URL,
    "selection_scope": "OPERATOR_AUTHORIZED_EXECUTION_OPTIONS_ONLY",
    "selection_confers_project_authority": False,
    "challengeable": True,
    "capability_donor_preservation": True,
    "operating_sequence": EXPECTED_SEQUENCE,
}
for field, expected in expected_contract.items():
    if contract.get(field) != expected:
        errors.append(f"local nervous-system contract drift: {field}")

contract_authority = contract.get("operator_authority") or {}
for field, expected in required_authority.items():
    if contract_authority.get(field) != expected:
        errors.append(f"local Operator authority invariant drift: {field}")

strict_topology = os.getenv("APEX_OPERATOR_ENFORCE_DESCRIPTIVE_TOPOLOGY") == "1"
if node and Path("README.md").exists():
    readme = Path("README.md").read_text(encoding="utf-8").lower()
    for term in node.get("required_terms", []):
        if str(term).lower() not in readme:
            message = f"README missing descriptive capability term: {term}"
            (errors if strict_topology else notices).append(message)
    for link in node.get("required_links", []):
        if str(link).lower() not in readme:
            message = f"README missing interoperability link: {link}"
            (errors if strict_topology else notices).append(message)

raw_relationships = contract.get("relationships") or []
if not isinstance(raw_relationships, list):
    errors.append("relationships must be a list")
    relationships = []
else:
    relationships = [item for item in raw_relationships if isinstance(item, dict)]
    if len(relationships) != len(raw_relationships):
        errors.append("every relationship must be an object")

kernel_relationships = [item for item in relationships if item.get("target") == "GlacierEQ/computer-user"]
if len(kernel_relationships) != 1:
    errors.append("computer-user kernel relationship must appear exactly once")
else:
    rel = kernel_relationships[0]
    expected_relationship = {
        "relation": "COMPUTER_EXECUTION_KERNEL",
        "relationship_semantics": "CAPABILITY_COMPOSITION_ONLY_NOT_PROJECT_HIERARCHY",
        "kernel_main_sha": SELECTED_KERNEL_MAIN_SHA,
        "kernel_runtime_integration_proven": True,
        "persistent_host_activation_contract_verified": True,
        "persistent_production_host_verified": False,
        "pro_code_live_invocation_receipt": True,
        "live_receipt_proof": str(LIVE_RECEIPT_PATH),
        "live_receipt_tested_kernel_sha": KERNEL_TESTED_SHA,
        "live_receipt_sha256": LIVE_RECEIPT_SHA256,
        "live_receipt_capability": "kernel.health",
        "live_receipt_akos_sha": AKOS_VERIFIER_SHA,
        "live_receipt_workflow_run_id": LIVE_RECEIPT_RUN_ID,
        "receipt_semantics": "HISTORICAL_EXECUTION_PROOF_NOT_CURRENT_PROJECT_AUTHORITY",
    }
    for field, expected in expected_relationship.items():
        if rel.get(field) != expected:
            errors.append(f"computer-user relationship drift: {field}")

if contract.get("runtime_integration_claimed") is not True:
    errors.append("pro-code runtime integration must remain claimed after verified receipt")
if contract.get("production_deployment_claimed") is not False:
    errors.append("production deployment must remain false without persistent-host receipt")

# Preserve historical execution receipts exactly as historical proof. Their legacy selection labels do not govern current authority.
proof = load_json(LIVE_RECEIPT_PATH, "Pro-Code computer-kernel live receipt proof")
if proof:
    expected_top = {
        "schema": "glaciereq.pro-code.computer-kernel-live-receipt.v2",
        "status": "PASS",
        "repository": "GlacierEQ/pro-code",
        "pro_code_source_sha": PRO_CODE_SHA,
        "selection_mode": "CURRENT_BEST_REVISABLE",
        "challengeable": True,
    }
    for field, expected in expected_top.items():
        if proof.get(field) != expected:
            errors.append(f"historical live receipt proof drift: {field}")

    kernel_proof = proof.get("kernel") if isinstance(proof.get("kernel"), dict) else {}
    expected_kernel = {
        "repository": "GlacierEQ/computer-user",
        "selected_main_sha": SELECTED_KERNEL_MAIN_SHA,
        "tested_source_sha": KERNEL_TESTED_SHA,
        "executor": "GlacierEQ/computer-user",
    }
    for field, expected in expected_kernel.items():
        if kernel_proof.get(field) != expected:
            errors.append(f"historical live receipt kernel drift: {field}")

    akos_proof = proof.get("akos") if isinstance(proof.get("akos"), dict) else {}
    expected_akos = {
        "repository": "GlacierEQ/AKOS",
        "source_sha": AKOS_VERIFIER_SHA,
        "acceptance_status": "VERIFIED",
    }
    for field, expected in expected_akos.items():
        if akos_proof.get(field) != expected:
            errors.append(f"historical live receipt AKOS drift: {field}")

    invocation = proof.get("invocation") if isinstance(proof.get("invocation"), dict) else {}
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
    for field, expected in expected_invocation.items():
        if invocation.get(field) != expected:
            errors.append(f"historical live receipt invocation drift: {field}")

    supervised = proof.get("governed_public_action") if isinstance(proof.get("governed_public_action"), dict) else {}
    if supervised.get("workflow_run_id") != LIVE_RECEIPT_RUN_ID:
        errors.append("historical live receipt workflow run drift")
    if supervised.get("result_status") != "completed":
        errors.append("historical live receipt supervised result is not completed")

    behavioral = proof.get("kernel_behavioral_proof") if isinstance(proof.get("kernel_behavioral_proof"), dict) else {}
    expected_behavioral = {
        "path": "GlacierEQ/computer-user/machine/pro-code-originated-live-receipt-proof.json",
        "hardened_behavioral_receipt_sha256": HARDENED_BEHAVIORAL_RECEIPT_SHA256,
        "hardened_behavioral_tested_source_sha": HARDENED_BEHAVIORAL_TESTED_SHA,
    }
    for field, expected in expected_behavioral.items():
        if behavioral.get(field) != expected:
            errors.append(f"historical kernel behavioral proof drift: {field}")

    truth = proof.get("truth_boundary") if isinstance(proof.get("truth_boundary"), dict) else {}
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
        SELECTED_KERNEL_MAIN_SHA,
        KERNEL_TESTED_SHA,
        HARDENED_BEHAVIORAL_TESTED_SHA,
        AKOS_VERIFIER_SHA,
        PRO_CODE_SHA,
        LIVE_RECEIPT_SHA256,
        HARDENED_BEHAVIORAL_RECEIPT_SHA256,
        LIVE_RECEIPT_RUN_ID,
        "203 PASS",
        "behavioral proof",
        "merge-guard proof",
        "production deployment remains false",
        "issue #20",
        "CURRENT_BEST_REVISABLE",
    )
    for required in required_doc_values:
        if required not in text:
            errors.append(f"kernel contract doc missing historical proof marker: {required}")

for notice in notices:
    print(f"::notice::{notice}")

if errors:
    for error in errors:
        print(f"::error::{error}")
    sys.exit(1)

print(json.dumps({
    "schema": "glaciereq.nervous-system.validation.v2.1",
    "status": "verified",
    "repository": repo,
    "operator_authority": "VERIFIED",
    "machine_project_authority": False,
    "role": contract.get("role"),
    "apex_role": contract.get("apex_role"),
    "role_semantics": "DESCRIPTIVE_CAPABILITY_METADATA_ONLY",
    "selection_mode": apex.get("selection_mode"),
    "selection_scope": apex.get("selection_scope"),
    "selection_confers_project_authority": False,
    "descriptive_topology_enforced": strict_topology,
    "manifest_version": manifest.get("version"),
    "computer_execution_kernel": "verified",
    "historical_receipts_preserved": True,
    "historical_receipts_create_current_authority": False,
    "kernel_reference_sha": SELECTED_KERNEL_MAIN_SHA,
    "tested_kernel_sha": KERNEL_TESTED_SHA,
    "behavioral_kernel_sha": HARDENED_BEHAVIORAL_TESTED_SHA,
    "akos_verifier_sha": AKOS_VERIFIER_SHA,
    "pro_code_live_invocation_receipt": True,
    "live_receipt_sha256": LIVE_RECEIPT_SHA256,
    "behavioral_receipt_sha256": HARDENED_BEHAVIORAL_RECEIPT_SHA256,
    "runtime_integration_claimed": True,
    "persistent_production_host_verified": False,
    "production_deployment_claimed": False,
    "notices": notices,
}, indent=2))
