"""Tests for name resolution and the residual bucket.

Both properties here were found on the live page rather than reasoned about:
the English article heads Gantz's column with the bare word "Unity", and it
carries an "Other parties" column that holds real seats but names no list.

Run with:  python3 -m unittest pipeline.etl.transform.test_party_mapping
"""

from __future__ import annotations

import unittest
from datetime import date

from .normalize import RawPoll, clean_polls
from .party_mapping import is_residual, resolve_party


class UnityTest(unittest.TestCase):
    def test_the_bare_word_unity_is_gantz(self):
        self.assertEqual(resolve_party("Unity"), "kachol-lavan")

    def test_the_longer_forms_still_resolve(self):
        for name in ("National Unity", "כחול לבן", "Blue and White"):
            with self.subTest(name=name):
                self.assertEqual(resolve_party(name), "kachol-lavan")


class ResidualColumnTest(unittest.TestCase):
    """A catch-all column must count towards 120 without becoming a party."""

    def _poll(self, seats):
        return RawPoll(
            pollster="Lazar",
            sponsor="Maariv",
            field_date_start=date(2026, 9, 3),
            field_date_end=date(2026, 9, 4),
            sample_size=600,
            margin_of_error=4.0,
            source_url="https://example.com/poll",
            source_name="Maariv",
            seats=seats,
        )

    def test_named(self):
        self.assertTrue(is_residual("Other parties"))
        self.assertTrue(is_residual("מפלגות אחרות"))
        self.assertFalse(is_residual("Yashar"))

    def test_its_seats_still_count_towards_the_total(self):
        # 117 named + 3 residual. Dropping the residual column outright would
        # leave 117 and reject a poll that is complete in the article.
        cleaned = clean_polls([self._poll({"הליכוד": 60, "ישר!": 57, "Other parties": 3})])
        self.assertEqual(cleaned.rejected, [])
        self.assertEqual(len(cleaned.polls), 1)

    def test_it_does_not_become_a_party_in_the_averages(self):
        cleaned = clean_polls([self._poll({"הליכוד": 60, "ישר!": 57, "Other parties": 3})])
        self.assertEqual(set(cleaned.polls[0].seats), {"likud", "yashar"})

    def test_it_is_not_reported_as_a_missing_alias(self):
        """The report is a to-do list; a residual column is nothing to do."""
        cleaned = clean_polls([self._poll({"הליכוד": 60, "ישר!": 57, "Other parties": 3})])
        self.assertEqual(cleaned.unmapped_parties, set())

    def test_a_genuinely_unknown_party_is_still_reported(self):
        cleaned = clean_polls([self._poll({"הליכוד": 60, "ישר!": 57, "Cyprus Party": 3})])
        self.assertEqual(cleaned.unmapped_parties, {"Cyprus Party"})


if __name__ == "__main__":
    unittest.main()
