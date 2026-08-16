from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCTRINE = ROOT / "OPERATOR_FIDELITY_AND_MAXIMUM_COHERENT_ADVANCE.md"
AUTHORITY = ROOT / "OPERATOR_AUTHORITY_AND_PROOF_PROTOCOL.md"


class OperatorFidelityContractTests(unittest.TestCase):
    def test_brains_direction_is_upward(self) -> None:
        text = DOCTRINE.read_text(encoding="utf-8")
        for marker in (
            "INSTRUCTION DISPLACEMENT",
            "MAXIMUM_COHERENT_VERIFIED_GAIN",
            "Function before administrative neatness",
            "Rigor points upward",
            "Look up",
        ):
            self.assertIn(marker.lower(), text.lower())

    def test_minimum_scope_is_not_default(self) -> None:
        text = DOCTRINE.read_text(encoding="utf-8").lower()
        self.assertIn("do not default to smallest useful next step", text)
        self.assertIn("smallness has no intrinsic score", text)

    def test_corrections_change_design_objective(self) -> None:
        text = DOCTRINE.read_text(encoding="utf-8")
        self.assertIn(
            "CORRECTION -> FIND FAILED ASSUMPTION -> CHANGE DESIGN OBJECTIVE",
            text,
        )

    def test_brains_and_brawn_cannot_be_collapsed(self) -> None:
        text = DOCTRINE.read_text(encoding="utf-8")
        self.assertIn("GlacierEQ/pro-code", text)
        self.assertIn("GlacierEQ/Pro_Code", text)
        self.assertIn("intentionally distinct", text)

    def test_operator_authority_protocol_remains_present(self) -> None:
        text = AUTHORITY.read_text(encoding="utf-8").lower()
        self.assertIn("casey del carpio barton is the elite human operator", text)
        self.assertIn("unresolved_gap", text)
        self.assertIn("subordinate instruments", text)
        self.assertIn("they do not outrank casey", text)


if __name__ == "__main__":
    unittest.main()
