"""Tests for the ETL run's health reporting.

The property under test is the one that matters most in a scheduled pipeline:
a source that quietly returns nothing must never be reported as healthy. A run
that goes green while the warehouse stops updating is worse than a run that
fails, because nobody looks at it.

Run with:  python -m pytest pipeline/test_run_etl.py
       or: python -m unittest pipeline.test_run_etl
"""

from __future__ import annotations

import unittest
from datetime import date

from .run_etl import silent_sources


def source(fetched=0, error=None, note=None, **extra):
    return {"fetched": fetched, "loaded": 0, "rejected": 0, "error": error, "note": note, **extra}


class SilentSourceTests(unittest.TestCase):
    def test_zero_rows_with_no_error_and_no_reason_is_flagged(self):
        stats = {"knesset": source(fetched=0)}
        self.assertEqual(silent_sources(stats), ["knesset"])

    def test_a_source_that_is_switched_off_is_not_flagged(self):
        # Unconfigured sources explain themselves through `note`; that is a
        # deliberate state, not a silent failure.
        stats = {"polls": source(fetched=0, note="לא הוגדרו מקורות סקרים פעילים")}
        self.assertEqual(silent_sources(stats), [])

    def test_a_source_that_failed_loudly_is_not_flagged(self):
        # It is already reported as an error; flagging it twice adds noise.
        stats = {"knesset": source(fetched=0, error="timeout")}
        self.assertEqual(silent_sources(stats), [])

    def test_a_source_that_returned_rows_is_not_flagged(self):
        stats = {"knesset": source(fetched=42)}
        self.assertEqual(silent_sources(stats), [])

    def test_rows_dropped_for_unmapped_parties_are_not_silent(self):
        # Everything was rejected at the mapping step, which is reported
        # separately and actionably.
        stats = {"polls": source(fetched=0, unmapped=["מפלגה חדשה"])}
        self.assertEqual(silent_sources(stats), [])

    def test_each_source_is_judged_on_its_own(self):
        stats = {
            "polls": source(fetched=0, note="כבוי"),
            "knesset": source(fetched=0),
            "news": source(fetched=3),
        }
        self.assertEqual(silent_sources(stats), ["knesset"])


if __name__ == "__main__":
    unittest.main()


class PollPrecedenceTest(unittest.TestCase):
    """A hand-entered poll must replace the automatic row, not be rejected.

    clean_polls rejects a repeated natural key, keeping whichever it saw
    first. Relying on source ordering alone would therefore have discarded
    every manual correction while reporting it as a duplicate — the correction
    would vanish and the wrong figure would stay on the site.
    """

    def _raw(self, seats, source):
        from pipeline.etl.transform.normalize import RawPoll

        return RawPoll(
            pollster="לזר",
            sponsor="מעריב",
            field_date_start=date(2026, 9, 3),
            field_date_end=date(2026, 9, 4),
            sample_size=600,
            margin_of_error=4.0,
            source_url=f"https://example.com/{source}",
            source_name=source,
            seats=seats,
        )

    def test_the_last_source_wins_for_the_same_natural_key(self):
        from pipeline.etl.transform.normalize import clean_polls, poll_id

        auto = self._raw({"הליכוד": 20, "ישר!": 100}, "wikipedia")
        manual = self._raw({"הליכוד": 22, "ישר!": 98}, "manual")

        by_key = {}
        for raw in (auto, manual):
            by_key[poll_id(raw.pollster, raw.field_date_end, raw.sponsor)] = raw

        self.assertEqual(len(by_key), 1)
        cleaned = clean_polls(list(by_key.values()))
        self.assertEqual(len(cleaned.polls), 1)
        self.assertEqual(cleaned.polls[0].source_name, "manual")
        self.assertEqual(cleaned.polls[0].seats["likud"], 22)
        self.assertEqual(cleaned.rejected, [])

    def test_without_deduping_first_the_correction_is_the_one_rejected(self):
        """Pins why the dedupe exists, so removing it fails loudly here."""
        from pipeline.etl.transform.normalize import clean_polls

        auto = self._raw({"הליכוד": 20, "ישר!": 100}, "wikipedia")
        manual = self._raw({"הליכוד": 22, "ישר!": 98}, "manual")

        cleaned = clean_polls([auto, manual])
        self.assertEqual(len(cleaned.polls), 1)
        self.assertEqual(cleaned.polls[0].source_name, "wikipedia")
        self.assertEqual(len(cleaned.rejected), 1)
