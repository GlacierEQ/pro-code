#!/usr/bin/env python3
"""Pro-Code dispatch boundary for the governed computer execution kernel."""
from __future__ import annotations

from typing import Any, Mapping, Protocol

INVOCATION_SCHEMA = "glaciereq.computer-kernel.invocation.v1"
CALLER = "GlacierEQ/pro-code"


class KernelClient(Protocol):
    def invoke_and_verify(
        self,
        envelope: Mapping[str, Any],
        *,
        wait_timeout: float = 30.0,
        poll_interval: float = 0.1,
    ) -> Mapping[str, Any]: ...


def build_invocation(
    *,
    trace_id: str,
    capability: str,
    idempotency_key: str,
    payload: Mapping[str, Any] | None = None,
    approved: bool = False,
    exact_target: bool = True,
) -> dict[str, Any]:
    """Build a caller-bound envelope; AKOS still owns acceptance/verification."""
    trace = trace_id.strip()
    capability_name = capability.strip()
    idem = idempotency_key.strip()
    if not trace:
        raise ValueError("trace_id is required")
    if not capability_name or "." not in capability_name:
        raise ValueError("capability must be connector.operation")
    connector, operation = capability_name.split(".", 1)
    if (
        not connector
        or not operation
        or connector != connector.strip()
        or operation != operation.strip()
    ):
        raise ValueError("capability must contain nonempty connector and operation components")
    if not idem:
        raise ValueError("idempotency_key is required")
    if payload is not None and not isinstance(payload, Mapping):
        raise TypeError("payload must be a mapping")
    if type(approved) is not bool:
        raise TypeError("approved must be a boolean")
    if type(exact_target) is not bool:
        raise TypeError("exact_target must be a boolean")
    return {
        "schema": INVOCATION_SCHEMA,
        "caller": CALLER,
        "trace_id": trace,
        "capability": capability_name,
        "payload": dict(payload or {}),
        "authority": {
            "approved": approved,
            "exact_target": exact_target,
        },
        "idempotency_key": idem,
    }


def dispatch(
    client: KernelClient,
    *,
    trace_id: str,
    capability: str,
    idempotency_key: str,
    payload: Mapping[str, Any] | None = None,
    approved: bool = False,
    exact_target: bool = True,
    wait_timeout: float = 30.0,
    poll_interval: float = 0.1,
) -> dict[str, Any]:
    """Submit through the supplied AKOS acceptance client and return verified metadata."""
    envelope = build_invocation(
        trace_id=trace_id,
        capability=capability,
        idempotency_key=idempotency_key,
        payload=payload,
        approved=approved,
        exact_target=exact_target,
    )
    acceptance = dict(
        client.invoke_and_verify(
            envelope,
            wait_timeout=wait_timeout,
            poll_interval=poll_interval,
        )
    )
    if acceptance.get("status") != "VERIFIED":
        raise RuntimeError(f"kernel acceptance was not VERIFIED: {acceptance!r}")
    if acceptance.get("caller") != CALLER:
        raise RuntimeError("kernel acceptance caller identity mismatch")
    if acceptance.get("trace_id") != envelope["trace_id"]:
        raise RuntimeError("kernel acceptance trace identity mismatch")
    return {
        "schema": "glaciereq.pro-code.computer-kernel-dispatch.v1",
        "status": "VERIFIED",
        "caller": CALLER,
        "trace_id": envelope["trace_id"],
        "capability": envelope["capability"],
        "acceptance": acceptance,
    }
