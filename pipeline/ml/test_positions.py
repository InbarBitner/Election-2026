"""Tests for turning hand labels into party positions."""

from __future__ import annotations

import unittest

from . import positions


def row(party, qid, kind, stance, confidence, **extra):
    return {"party": party, "question_id": qid, "kind": kind,
            "stance": stance, "confidence": confidence, **extra}


class LabelValueTest(unittest.TestCase):
    def test_partial_counts_half(self):
        self.assertEqual(positions.label_value("-1.0", "partial"), -0.5)

    def test_unclear_is_a_position_of_zero_not_a_missing_one(self):
        self.assertEqual(positions.label_value("0.0", "unclear"), 0.0)

    def test_not_covered_has_no_value(self):
        self.assertIsNone(positions.label_value("", "not_covered"))


class MergeTest(unittest.TestCase):
    def test_platform_wins_over_bills_on_the_same_question(self):
        merged = positions.merge([
            row("p", "q01", "bill", "-1.0", "sure"),
            row("p", "q01", "platform", "1.0", "partial"),
        ])
        self.assertEqual(merged["p"]["q01"]["kind"], "platform")

    def test_bills_fill_what_the_platform_leaves_uncovered(self):
        """An uncovered platform row must not hide a bill that does take a side."""
        merged = positions.merge([
            row("p", "q01", "platform", "", "not_covered"),
            row("p", "q01", "bill", "1.0", "sure"),
        ])
        self.assertEqual(merged["p"]["q01"]["kind"], "bill")

    def test_a_question_covered_by_neither_is_absent(self):
        merged = positions.merge([row("p", "q01", "platform", "", "not_covered")])
        self.assertNotIn("p", merged)


class PlatformUrlTest(unittest.TestCase):
    TEXT = "# p\n\n## https://a.example/one\n\nשורה ראשונה\n\n## https://a.example/two\n\nשורה שנייה\n"

    def test_a_quote_links_to_the_page_it_came_from(self):
        pages = positions.platform_pages(self.TEXT)
        self.assertEqual(positions.platform_url("שורה שנייה", pages, None), "https://a.example/two")

    def test_an_unmatched_quote_falls_back_to_the_platform(self):
        pages = positions.platform_pages(self.TEXT)
        self.assertEqual(positions.platform_url("לא קיים", pages, "https://a.example/"), "https://a.example/")


if __name__ == "__main__":
    unittest.main()
