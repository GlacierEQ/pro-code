"""The dangerous boundaries of a detached connector landing lifecycle."""
import concurrent.futures
import tempfile
import unittest
from pathlib import Path
from tools.github_ops.landing_journal import LandingJournal, LandingStateError

SHA = "a" * 40
REPO = "GlacierEQ/spacex-mission-control"
TARGET = "pull/5"
INTENT = {
    "operation": "merge_pr", "repository": REPO, "target": TARGET,
    "expected_head_sha": SHA,
    "expected": {"head_sha": SHA, "merged": True, "state": "closed"},
}
SNAPSHOT = {
    "repository": REPO, "target": TARGET,
    "observed": {"head_sha": SHA, "merged": True, "state": "closed", "merge_commit_sha": "b" * 40},
}


class LandingJournalTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "state" / "journal.sqlite3"
        self.j = LandingJournal(self.path)
        self.j.plan("landing-1", "merge", INTENT)

    def tearDown(self):
        self.temp.cleanup()

    def test_plan_idempotency_but_fails_intent_drift(self):
        self.assertEqual(self.j.plan("landing-1", "merge", INTENT)["state"], "PLANNED")
        with self.assertRaises(LandingStateError):
            self.j.plan("landing-1", "merge", {**INTENT, "target": "pull/6"})

    def test_no_double_attempt_even_after_process_restart(self):
        self.j.arm("landing-1", "merge")
        self.j.attempt("landing-1", "merge", "provider-request-1")
        reopened = LandingJournal(self.path)
        with self.assertRaisesRegex(LandingStateError, "no retry"):
            reopened.attempt("landing-1", "merge", "provider-request-2")

    def test_unknown_outcome_must_reconcile_first(self):
        self.j.arm("landing-1", "merge")
        self.j.attempt("landing-1", "merge", "provider-request-1")
        self.j.uncertain("landing-1", "merge", "foreground process vanished")
        with self.assertRaises(LandingStateError):
            self.j.attempt("landing-1", "merge", "provider-request-2")
        self.assertEqual(self.j.reconcile("landing-1", "merge", SNAPSHOT)["state"], "VERIFIED")
        self.assertEqual(len(self.j.history("landing-1", "merge")), 5)

    def test_existing_server_side_success_not_claimed_as_this_attempt(self):
        result = self.j.reconcile("landing-1", "merge", SNAPSHOT)
        self.assertEqual(result["state"], "ALREADY_SATISFIED")
        with self.assertRaises(LandingStateError):
            self.j.attempt("landing-1", "merge", "provider-request-late")

    def test_deny_stays_denied_even_if_later_snapshot_matches(self):
        self.j.declined("landing-1", "merge")
        self.assertEqual(self.j.reconcile("landing-1", "merge", SNAPSHOT)["state"], "DECLINED")
        with self.assertRaises(LandingStateError):
            self.j.attempt("landing-1", "merge", "provider-request-2")

    def test_remote_target_mismatch_is_not_success(self):
        self.j.arm("landing-1", "merge")
        self.j.attempt("landing-1", "merge", "provider-request-1")
        self.assertEqual(self.j.reconcile("landing-1", "merge", {**SNAPSHOT, "target": "pull/6"})["state"], "ATTEMPTED")
        self.assertEqual(self.j.reconcile("landing-1", "merge", {**SNAPSHOT, "repository": "OTHER/repo"})["state"], "ATTEMPTED")

    def test_exact_head_sha_prevents_wrong_merge_verification(self):
        self.j.arm("landing-1", "merge")
        self.j.attempt("landing-1", "merge", "provider-request-1")
        wrong = {**SNAPSHOT, "observed": {**SNAPSHOT["observed"], "head_sha": "c" * 40}}
        self.assertEqual(self.j.reconcile("landing-1", "merge", wrong)["state"], "ATTEMPTED")

    def test_missing_evidence_does_not_count_as_confirmation(self):
        self.j.arm("landing-1", "merge")
        self.j.attempt("landing-1", "merge", "provider-request-1")
        bad = {**SNAPSHOT, "observed": {"merged": True, "state": "closed"}}
        self.assertEqual(self.j.reconcile("landing-1", "merge", bad)["state"], "ATTEMPTED")

    def test_truthy_integer_is_not_boolean_true(self):
        self.j.arm("landing-1", "merge")
        self.j.attempt("landing-1", "merge", "provider-request-1")
        bad = {**SNAPSHOT, "observed": {**SNAPSHOT["observed"], "merged": 1}}
        self.assertEqual(self.j.reconcile("landing-1", "merge", bad)["state"], "ATTEMPTED")

    def test_reject_conflicting_merge_intent(self):
        with self.assertRaises(LandingStateError):
            self.j.plan("landing-1", "bad-merge", {**INTENT, "expected": {"head_sha": SHA, "state": "open", "merged": False}})

    def test_concurrent_attempts_only_one_accepted(self):
        def attempt(n):
            try:
                self.j.attempt("landing-1", "merge", f"invocation-{n}")
                return True
            except LandingStateError:
                return False
        self.j.arm("landing-1", "merge")
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(attempt, range(20)))
        self.assertEqual(sum(results), 1)

    def test_verified_repeat_readback_is_idempotent(self):
        self.j.arm("landing-1", "merge")
        self.j.attempt("landing-1", "merge", "provider-request-1")
        self.j.reconcile("landing-1", "merge", SNAPSHOT)
        self.j.reconcile("landing-1", "merge", SNAPSHOT)
        self.assertEqual([r["event_type"] for r in self.j.history("landing-1", "merge")].count("VERIFIED"), 1)

    def test_crash_after_arming_before_connector_receipt_does_not_retry(self):
        self.j.arm("landing-1", "merge")
        restored = LandingJournal(self.path)
        with self.assertRaisesRegex(LandingStateError, "no retry"):
            restored.arm("landing-1", "merge")
        self.assertEqual(restored.reconcile("landing-1", "merge", SNAPSHOT)["state"], "ALREADY_SATISFIED")

    def test_declined_armed_step_is_terminal(self):
        self.j.arm("landing-1", "merge")
        self.j.declined("landing-1", "merge")
        self.assertEqual(self.j.status("landing-1")["steps"][0]["state"], "DECLINED")
        with self.assertRaises(LandingStateError):
            self.j.attempt("landing-1", "merge", "provider-later")

    def test_unexpected_secret_fields_rejected(self):
        with self.assertRaisesRegex(LandingStateError, "unexpected intent fields"):
            self.j.plan("landing-1", "unsafe", {**INTENT, "token": "must-not-store"})

    def test_reject_nonhex_expected_head(self):
        with self.assertRaisesRegex(LandingStateError, "hex"):
            self.j.plan("landing-1", "bad-sha", {**INTENT, "expected_head_sha": "z" * 40})

    def test_status_reader_does_not_block_new_writer(self):
        self.j.plan("landing-2", "merge", INTENT)
        with self.j._read() as reader:
            self.assertEqual(reader.execute("SELECT COUNT(*) FROM steps").fetchone()[0], 2)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                result = pool.submit(self.j.arm, "landing-2", "merge").result(timeout=3)
            self.assertEqual(result["state"], "ARMED")

    def test_cannot_reuse_native_invocation_for_another_write(self):
        self.j.arm("landing-1", "merge")
        self.j.attempt("landing-1", "merge", "provider-request-1")
        self.j.plan("landing-2", "merge", INTENT)
        self.j.arm("landing-2", "merge")
        with self.assertRaisesRegex(LandingStateError, "already belongs"):
            self.j.attempt("landing-2", "merge", "provider-request-1")
        self.assertEqual(self.j.status("landing-2")["steps"][0]["state"], "ARMED")


if __name__ == "__main__":
    unittest.main()
