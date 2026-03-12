import unittest
from pathlib import Path

from ordinate_core import validate_document

_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "rfc_0004" / "invalid_unquoted_space_reference.ord"


class Rfc0004InvalidReferenceSyntaxValidate(unittest.TestCase):
    def test_unquoted_space_in_path_component_is_invalid(self) -> None:
        text = _FIXTURE.read_text(encoding="utf-8")
        result = validate_document(text)

        self.assertFalse(result.ok)
        self.assertTrue(any("invalid reference selector syntax" in e.message for e in result.errors))


if __name__ == "__main__":
    unittest.main()
