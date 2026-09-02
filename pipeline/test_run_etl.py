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
