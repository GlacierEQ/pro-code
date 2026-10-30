"""Executable adversarial tests for multi-step, consented GitHub landing recovery."""

import concurrent.futures
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tools.github_ops.landing_journal import LandingStateError
from tools.github_ops.landing_sequence import LandingSequence, SCHEMA

SHA1 = "1" * 40
SHA2 = "2" * 40
REPO = "GlacierEQ/pro-code"


def intent(step, sha=SHA1):
    return {
        "operation": "merge_pr",
        "repository": REPO,
        "target": f"pull/{step}",
        "expected_head_sha": sha,
        "expected": {"head_sha": sha, "state": "closed", "merged": True},
    }


def snapshot(step, sha=SHA1, state="closed", merged=True):
    return {
        "repository": REPO,
        "target": f"pull/{step}",
        "observed": {"head_sha": sha, "state": state, "merged": merged},
    }


def sample():
    return {
        "schema": SCHEMA,
        "plan_id": "landing-4",
        "steps": [
            {"id": "first", "depends_on": [], "intent": intent(10)},
            {"id": "second", "depends_on": ["first"], "intent": intent(11, SHA2)},
            {"id": "parallel", "depends_on": [], "intent": intent(12)},
            {"id": "final", "depends_on": ["second", "parallel"], "intent": intent(13)},
        ],
    }


class LandingSequenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "nested" / "landing.db"
        self.engine = LandingSequence(self.db)

    def tearDown(self):
        self.tmp.cleanup()

    def install(self):
        return self.engine.install(sample())

    def steps(self):
        return {s["step_id"]: s for s in self.engine.status("landing-4")["steps"]}

    def test_install_unlocks_only_independent_work(self):
        self.install()
        result = self.engine.status("landing-4")
        self.assertEqual(result["next_ready"], ["first", "parallel"])
        self.assertEqual(result["counts"], {"ready": 2, "reconcile": 0, "blocked": 2, "completed": 0, "declined": 0})
        self.assertFalse(result["complete"])

    def test_direct_journal_arm_does_not_bypass_dependencies(self):
        self.install()
        with self.assertRaisesRegex(LandingStateError, "dependency first"):
            self.engine.journal.arm("landing-4", "second")
        self.assertEqual(self.steps()["second"]["state"], "PLANNED")

    def test_remote_success_unlocks_next_step(self):
        self.install()
        self.engine.reconcile_many("landing-4", {"first": snapshot(10)})
        self.assertEqual(self.steps()["first"]["state"], "ALREADY_SATISFIED")
        self.assertIn("second", self.engine.status("landing-4")["next_ready"])
        self.assertEqual(self.engine.arm("landing-4", "second")["state"], "ARMED")

    def test_unknown_attempt_must_reconcile_not_replay(self):
        self.install()
        self.engine.arm("landing-4", "first")
        self.engine.journal.attempt("landing-4", "first", "invocation-unique-1")
        self.engine.journal.uncertain("landing-4", "first", "foreground SIGTERM")
        resumed = LandingSequence(self.db)
        self.assertEqual(resumed.status("landing-4")["reconcile_first"], ["first"])
        with self.assertRaisesRegex(LandingStateError, "no retry"):
            resumed.arm("landing-4", "first")
        progress = resumed.reconcile_many("landing-4", {"first": snapshot(10)})
        self.assertEqual(progress["results"]["first"]["state"], "VERIFIED")
        self.assertIn("second", progress["progress"]["next_ready"])

    def test_crash_after_arm_no_duplicate_write(self):
        self.install()
        self.engine.arm("landing-4", "first")
        resumed = LandingSequence(self.db)
        self.assertEqual(resumed.status("landing-4")["reconcile_first"], ["first"])
        with self.assertRaises(LandingStateError):
            resumed.arm("landing-4", "first")
        self.assertEqual(resumed.reconcile_many("landing-4", {"first": snapshot(10)})["results"]["first"]["state"], "ALREADY_SATISFIED")

    def test_declined_action_blocks_only_its_dependents(self):
        self.install()
        self.engine.journal.declined("landing-4", "first")
        status = self.engine.status("landing-4")
        self.assertEqual(status["counts"]["declined"], 1)
        self.assertEqual(status["next_ready"], ["parallel"])
        self.assertEqual(self.steps()["second"]["action"], "WAIT_DEPENDENCIES")
        self.assertEqual(self.engine.reconcile_many("landing-4", {"first": snapshot(10)})["results"]["first"]["state"], "DECLINED")
        with self.assertRaisesRegex(LandingStateError, "dependency first"):
            self.engine.arm("landing-4", "second")

    def test_multi_parent_completion_needed(self):
        self.install()
        self.engine.reconcile_many("landing-4", {"first": snapshot(10), "second": snapshot(11, SHA2)})
        self.assertEqual(self.steps()["final"]["pending_dependencies"], ["parallel"])
        self.engine.reconcile_many("landing-4", {"parallel": snapshot(12)})
        self.assertIn("final", self.engine.status("landing-4")["next_ready"])

    def test_wrong_head_cannot_unlock_dependent(self):
        self.install()
        self.engine.arm("landing-4", "first")
        self.engine.journal.attempt("landing-4", "first", "invocation-1")
        response = self.engine.reconcile_many("landing-4", {"first": snapshot(10, SHA2)})
        self.assertEqual(response["results"]["first"]["observation"], "OUTCOME_NOT_OBSERVED")
        self.assertNotIn("second", response["progress"]["next_ready"])

    def test_idempotent_install_and_manifest_identity_drift_rejected(self):
        first = self.install()
        self.assertTrue(first["created"])
        self.assertFalse(self.install()["created"])
        altered = sample()
        altered["steps"][1]["intent"]["target"] = "pull/555"
        with self.assertRaisesRegex(LandingStateError, "immutable"):
            self.engine.install(altered)
        self.assertEqual(len(self.steps()), 4)

    def test_invalid_manifest_rejected_before_any_db_changes(self):
        bad = sample()
        bad["steps"][0]["depends_on"] = ["final"]
        with self.assertRaisesRegex(LandingStateError, "cycle"):
            self.engine.install(bad)
        self.assertEqual(self.engine.journal.status("landing-4")["steps"], [])
        with self.assertRaises(LandingStateError):
            self.engine.status("landing-4")

    def test_missing_and_self_dependency_rejected(self):
        for dep in ("does-not-exist", "first"):
            bad = sample()
            bad["steps"][0]["depends_on"] = [dep]
            with self.assertRaises(LandingStateError):
                self.engine.install(bad)
        self.assertEqual(self.engine.journal.status("landing-4")["steps"], [])

    def test_unknown_snapshot_step_rejected_atomically(self):
        self.install()
        with self.assertRaisesRegex(LandingStateError, "not in the sequence"):
            self.engine.reconcile_many("landing-4", {"first": snapshot(10), "unknown": snapshot(20)})
        self.assertEqual(self.steps()["first"]["state"], "PLANNED")

    def test_snapshot_nonobject_rejected_before_update(self):
        self.install()
        with self.assertRaisesRegex(LandingStateError, "JSON object"):
            self.engine.reconcile_many("landing-4", {"first": snapshot(10), "second": None})
        self.assertEqual(self.steps()["first"]["state"], "PLANNED")

    def test_no_credentials_in_plan(self):
        bad = sample()
        bad["steps"][0]["intent"]["token"] = "do-not-store"
        with self.assertRaisesRegex(LandingStateError, "unexpected intent fields"):
            self.engine.install(bad)

    def test_concurrent_arm_at_most_one_success(self):
        self.install()
        def arm(_):
            try:
                LandingSequence(self.db).arm("landing-4", "first")
                return True
            except LandingStateError:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            attempts = list(pool.map(arm, range(12)))
        self.assertEqual(sum(attempts), 1)
        self.assertEqual(self.steps()["first"]["state"], "ARMED")

    def test_recovery_status_does_not_write_events(self):
        self.install()
        count = len(self.engine.journal.history("landing-4", "first"))
        for _ in range(3):
            self.engine.status("landing-4")
        self.assertEqual(len(self.engine.journal.history("landing-4", "first")), count)

    def test_cannot_overlay_existing_plan(self):
        self.engine.journal.plan("landing-4", "unrelated", intent(19))
        with self.assertRaisesRegex(LandingStateError, "independently planned"):
            self.engine.install(sample())

    def test_cli_install_resume_and_status(self):
        manifest = Path(self.tmp.name) / "manifest.json"
        manifest.write_text(json.dumps(sample()), encoding="utf-8")
        command = [sys.executable, "-m", "tools.github_ops.landing_sequence", "--db", str(self.db)]
        root = Path(__file__).resolve().parents[1]
        proc = subprocess.run(
            command + ["install", "--file", str(manifest)],
            cwd=root, capture_output=True, text=True, check=True,
        )
        self.assertTrue(json.loads(proc.stdout)["created"])
        status = subprocess.run(
            command + ["status", "--plan", "landing-4"],
            cwd=root, capture_output=True, text=True, check=True,
        )
        self.assertEqual(json.loads(status.stdout)["next_ready"], ["first", "parallel"])

    def test_terminal_completion(self):
        self.install()
        self.engine.reconcile_many("landing-4", {
            "first": snapshot(10), "second": snapshot(11, SHA2),
            "parallel": snapshot(12), "final": snapshot(13),
        })
        state = self.engine.status("landing-4")
        self.assertTrue(state["complete"])
        self.assertEqual(state["next_ready"], [])
        self.assertEqual(state["counts"]["completed"], 4)


if __name__ == "__main__":
    unittest.main()
