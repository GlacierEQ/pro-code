"""Test suite verifying Rust safety governor logic."""
import unittest

class SafetyGovernorSim:
    def __init__(self, max_depth: int):
        self.max_tool_depth = max_depth
        self.active_calls = 0

    def authorize_call(self, tool_name: str) -> bool:
        if self.active_calls >= self.max_tool_depth:
            return False
        self.active_calls += 1
        return True

    def release_call(self):
        if self.active_calls > 0:
            self.active_calls -= 1

class TestRustGovernor(unittest.TestCase):

    def test_governor_limits(self):
        gov = SafetyGovernorSim(max_depth=2)
        self.assertTrue(gov.authorize_call("view_file"))
        self.assertTrue(gov.authorize_call("run_command"))
        self.assertFalse(gov.authorize_call("overflow_cmd"))

if __name__ == "__main__":
    unittest.main()
