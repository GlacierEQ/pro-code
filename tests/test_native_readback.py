"""Independent provider readback, crash continuation and consent-bound tests."""
import tempfile
import unittest
from pathlib import Path

from tools.github_ops.landing_journal import LandingJournal, LandingStateError
from tools.github_ops.native_readback import GitHubReadback, NativeReadbackUnavailable

REPO = "GlacierEQ/example"
HEAD = "a" * 40
MERGE = "b" * 40
BASE = "/repos/" + REPO
PR_PATH = BASE + "/pulls/12"
COMPARE = BASE + "/compare/" + MERGE + "...main"
INTENT = {
    "operation": "merge_pr", "repository": REPO, "target": "pull/12",
    "expected_head_sha": HEAD,
    "expected": {"head_sha": HEAD, "merged": True, "state": "closed"},
}
PR = {
    "state": "closed", "merged_at": "2026-10-29T12:00:00Z",
    "merge_commit_sha": MERGE,
    "head": {"sha": HEAD},
    "base": {"ref": "main", "repo": {"full_name": REPO}},
}


class FakeGet:
    def __init__(self):
        self.paths = []
        self.results = {PR_PATH: PR, COMPARE: {"status": "ahead"}}

    def __call__(self, path):
        self.paths.append(path)
        return self.results[path]


class NativeReadbackTest(unittest.TestCase):
    def setUp(self):
        self.remote = FakeGet()
        self.reader = GitHubReadback(get_json=self.remote)
        self.dir = tempfile.TemporaryDirectory()
        self.journal = LandingJournal(Path(self.dir.name) / "landing.db")
        self.journal.plan("p", "s", INTENT)

    def tearDown(self):
        self.dir.cleanup()

    def test_exact_merge_and_main_ancestry(self):
        snapshot = self.reader.snapshot(INTENT)
        self.assertEqual(snapshot["observed"]["merge_commit_sha"], MERGE)
        self.assertEqual(self.remote.paths, [PR_PATH, COMPARE])
        self.journal.arm("p", "s")
        self.journal.attempt("p", "s", "native-call-1")
        state = self.journal.reconcile_native("p", "s", reader=self.reader)
        self.assertEqual(state["state"], "VERIFIED")

    def test_unknown_provider_status_never_becomes_failed_or_retried(self):
        self.journal.arm("p", "s")
        self.journal.attempt("p", "s", "native-call-1")
        del self.remote.results[PR_PATH]
        result = self.journal.reconcile_native("p", "s", reader=self.reader)
        self.assertEqual(result["state"], "ATTEMPTED")
        self.assertEqual(result["observation"], "NATIVE_READBACK_UNAVAILABLE")
        with self.assertRaisesRegex(LandingStateError, "no retry"):
            self.journal.attempt("p", "s", "second-call")

    def test_no_duplicate_when_merge_already_landed_during_lost_session(self):
        self.journal.arm("p", "s")
        result = self.journal.reconcile_native("p", "s", reader=self.reader)
        self.assertEqual(result["state"], "ALREADY_SATISFIED")
        self.assertEqual(result["invocation_id"], None)

    def test_declined_card_never_fetches_or_retries(self):
        self.journal.declined("p", "s")
        result = self.journal.reconcile_native("p", "s", reader=self.reader)
        self.assertEqual(result["state"], "DECLINED")
        self.assertEqual(self.remote.paths, [])

    def test_forged_provider_merge_without_ancestry_is_not_verified(self):
        self.remote.results[COMPARE] = {"status": "diverged"}
        result = self.journal.reconcile_native("p", "s", reader=self.reader)
        self.assertEqual(result["state"], "PLANNED")
        self.assertEqual(result["observation"], "NATIVE_READBACK_UNAVAILABLE")

    def test_wrong_head_sha_and_target_branch_not_accepted(self):
        self.remote.results[PR_PATH] = {**PR, "head": {"sha": "c" * 40}}
        with self.assertRaisesRegex(NativeReadbackUnavailable, "PR head changed"):
            self.reader.snapshot(INTENT)
        self.remote.results[PR_PATH] = {**PR, "base": {"ref": "release", "repo": {"full_name": REPO}}}
        with self.assertRaisesRegex(NativeReadbackUnavailable, "different repository or branch"):
            self.reader.snapshot(INTENT)

    def test_unmerged_close_and_protected_open_states(self):
        close = {**INTENT, "operation": "close_pr", "expected": {"head_sha": HEAD, "merged": False, "state": "closed"}}
        self.remote.results[PR_PATH] = {**PR, "merged_at": None, "merge_commit_sha": None}
        snap = self.reader.snapshot(close)
        self.assertEqual(snap["observed"]["merged"], False)
        self.assertEqual(self.remote.paths, [PR_PATH])
        self.remote.results[PR_PATH] = {**PR, "state": "open", "merged_at": None}
        with self.assertRaisesRegex(NativeReadbackUnavailable, "closure not proven"):
            self.reader.snapshot(close)

    def test_reject_invalid_target_and_unsupported_operations_without_api_request(self):
        for target in ["pull/0", "pull/-1", "../pulls/12", "pull/12?foo=bar"]:
            with self.assertRaises(NativeReadbackUnavailable):
                self.reader.snapshot({**INTENT, "target": target})
        with self.assertRaises(NativeReadbackUnavailable):
            self.reader.snapshot({**INTENT, "repository": "not-a-repo"})
        with self.assertRaises(NativeReadbackUnavailable):
            self.reader.snapshot({**INTENT, "operation": "create_pr"})
        self.assertEqual(self.remote.paths, [])

    def test_false_or_malformed_remote_objects_do_not_complete(self):
        for value in [None, {}, {"state": "closed"}, {**PR, "merge_commit_sha": "bad"}]:
            self.remote.results[PR_PATH] = value
            self.assertEqual(
                self.journal.reconcile_native("p", "s", reader=self.reader)["state"], "PLANNED"
            )


if __name__ == "__main__":
    unittest.main()
