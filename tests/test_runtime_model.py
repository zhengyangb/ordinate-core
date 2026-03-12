import unittest

from ordinate_core import evaluate_cell, parse_cell


class RuntimeModelTests(unittest.TestCase):
    def test_parse_literal_number(self) -> None:
        parsed = parse_cell("123")
        self.assertEqual(parsed.kind, "literal")
        assert parsed.literal is not None
        self.assertEqual(parsed.literal.kind, "number")
        self.assertEqual(parsed.literal.value, 123)

    def test_parse_formula_with_cache(self) -> None:
        parsed = parse_cell("3 = 1 + 2")
        self.assertEqual(parsed.kind, "formula")
        assert parsed.cached is not None
        self.assertEqual(parsed.cached.kind, "number")
        self.assertEqual(parsed.cached.value, 3)

    def test_eval_cell_arithmetic(self) -> None:
        value = evaluate_cell("= (1 + 2) * 3")
        self.assertEqual(value.kind, "number")
        self.assertEqual(value.value, 9)

    def test_eval_cell_reference_without_context_is_error(self) -> None:
        value = evaluate_cell("= @[A,2025]")
        self.assertEqual(value.kind, "error")


if __name__ == "__main__":
    unittest.main()
