"""Test suite for Pro Code surface & Double Helix integration."""
import unittest
import json
from pathlib import Path

class TestProCode(unittest.TestCase):

    def test_pro_code_package_json(self):
        pkg_path = Path(__file__).parent.parent / "package.json"
        self.assertTrue(pkg_path.exists())
        pkg_data = json.loads(pkg_path.read_text())
        self.assertEqual(pkg_data["name"], "pro-code")

if __name__ == "__main__":
    unittest.main()
