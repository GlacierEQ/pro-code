from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "scripts" / "computer_kernel_dispatch.py"
SPEC = importlib.util.spec_from_file_location("computer_kernel_dispatch", MODULE)
assert SPEC is not None and SPEC.loader is not None
dispatch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dispatch)


class FakeClient:
    def __init__(
        self,
        *,
        caller: str = "GlacierEQ/pro-code",
        status: str = "VERIFIED",
        trace_id: str | None = None,
    ):
        self.caller = caller
        self.status = status
        self.trace_id = trace_id
        self.envelope = None

    def invoke_and_verify(self, envelope, *, wait_timeout=30.0, poll_interval=0.1):
        self.envelope = dict(envelope)
        return {
            "status": self.status,
            "caller": self.caller,
            "task_id": "task-1",
            "trace_id": self.trace_id or envelope["trace_id"],
            "receipt_sha256": "a" * 64,
            "source_sha": "b" * 40,
        }


class ComputerKernelDispatchTests(unittest.TestCase):
    def test_build_invocation_binds_pro_code_caller_and_fail_closed_authority(self):
        envelope = dispatch.build_invocation(
            trace_id="trace-1",
            capability="kernel.health",
            idempotency_key="idem-1",
        )
        self.assertEqual(envelope["caller"], "GlacierEQ/pro-code")
        self.assertEqual(envelope["schema"], "glaciereq.computer-kernel.invocation.v1")
        self.assertFalse(envelope["authority"]["approved"])
        self.assertTrue(envelope["authority"]["exact_target"])

    def test_dispatch_requires_verified_acceptance_for_same_request(self):
        client = FakeClient()
        result = dispatch.dispatch(
            client,
            trace_id="trace-1",
            capability="kernel.health",
            idempotency_key="idem-1",
        )
        self.assertEqual(result["status"], "VERIFIED")
        self.assertEqual(result["caller"], "GlacierEQ/pro-code")
        self.assertEqual(result["trace_id"], "trace-1")
        self.assertEqual(client.envelope["caller"], "GlacierEQ/pro-code")

    def test_dispatch_rejects_caller_mismatch(self):
        with self.assertRaisesRegex(RuntimeError, "caller identity mismatch"):
            dispatch.dispatch(
                FakeClient(caller="GlacierEQ/AKOS"),
                trace_id="trace-1",
                capability="kernel.health",
                idempotency_key="idem-1",
            )

    def test_dispatch_rejects_trace_mismatch(self):
        with self.assertRaisesRegex(RuntimeError, "trace identity mismatch"):
            dispatch.dispatch(
                FakeClient(trace_id="stale-trace"),
                trace_id="trace-1",
                capability="kernel.health",
                idempotency_key="idem-1",
            )

    def test_dispatch_rejects_unverified_acceptance(self):
        with self.assertRaisesRegex(RuntimeError, "not VERIFIED"):
            dispatch.dispatch(
                FakeClient(status="FAILED"),
                trace_id="trace-1",
                capability="kernel.health",
                idempotency_key="idem-1",
            )

    def test_dispatch_returns_normalized_invocation_identities(self):
        client = FakeClient()
        result = dispatch.dispatch(
            client,
            trace_id="  trace-1  ",
            capability="  kernel.health  ",
            idempotency_key="  idem-1  ",
        )
        self.assertEqual(result["trace_id"], "trace-1")
        self.assertEqual(result["capability"], "kernel.health")
        self.assertEqual(client.envelope["trace_id"], "trace-1")
        self.assertEqual(client.envelope["idempotency_key"], "idem-1")

    def test_build_invocation_rejects_invalid_identity_fields(self):
        with self.assertRaisesRegex(ValueError, "trace_id"):
            dispatch.build_invocation(
                trace_id="",
                capability="kernel.health",
                idempotency_key="idem-1",
            )
        for capability in ("health", ".", "kernel.", ".health", "kernel. health"):
            with self.subTest(capability=capability):
                with self.assertRaisesRegex(ValueError, "capability"):
                    dispatch.build_invocation(
                        trace_id="trace-1",
                        capability=capability,
                        idempotency_key="idem-1",
                    )
        with self.assertRaisesRegex(ValueError, "idempotency_key"):
            dispatch.build_invocation(
                trace_id="trace-1",
                capability="kernel.health",
                idempotency_key="",
            )

    def test_build_invocation_rejects_non_boolean_authority_values(self):
        with self.assertRaisesRegex(TypeError, "approved"):
            dispatch.build_invocation(
                trace_id="trace-1",
                capability="browser.navigate",
                idempotency_key="idem-1",
                approved="false",  # type: ignore[arg-type]
            )
        with self.assertRaisesRegex(TypeError, "exact_target"):
            dispatch.build_invocation(
                trace_id="trace-1",
                capability="browser.navigate",
                idempotency_key="idem-1",
                exact_target=1,  # type: ignore[arg-type]
            )

    def test_build_invocation_rejects_non_mapping_payload(self):
        with self.assertRaisesRegex(TypeError, "payload"):
            dispatch.build_invocation(
                trace_id="trace-1",
                capability="kernel.health",
                idempotency_key="idem-1",
                payload=[("key", "value")],  # type: ignore[arg-type]
            )


if __name__ == "__main__":
    unittest.main()
