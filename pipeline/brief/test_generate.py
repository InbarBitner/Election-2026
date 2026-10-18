"""The brief leads with the seat projection, and says when that hides a tie in the polls."""

from __future__ import annotations

import unittest

from .generate import lead_fact, render_from_template


def party(name: str, average: float, seats: int) -> dict:
    return {"name": name, "average": average, "projectedSeats": seats}


def facts(parties: list[dict]) -> dict:
    return {
        "date": "2026-10-18",
        "asOf": "2026-10-15",
        "windowDays": 14,
        "pollCount": 175,
        "leaders": [{"party": p["name"], "average": p["average"], "seats": p["projectedSeats"]} for p in parties],
        "lead": lead_fact(parties),
        "swings": [],
        "onTheBubble": [],
        "blocs": [],
        "events": [],
    }


class LeadTests(unittest.TestCase):
    def test_the_headline_follows_the_seat_projection(self):
        headline, _ = render_from_template(facts([party("ישר!", 21.7, 24), party("הליכוד", 21.7, 23)]))
        self.assertEqual(headline, "בראש התחזית: ישר! עם 24 מנדטים, הליכוד עם 23")

    def test_a_seat_gap_from_the_remainders_is_explained(self):
        _, body = render_from_template(facts([party("ישר!", 21.7, 24), party("הליכוד", 21.7, 23)]))
        self.assertIn("צמודות", body)
        self.assertIn("הסכמי העודפים", body)

    def test_no_explanation_when_the_polls_agree(self):
        _, body = render_from_template(facts([party("א", 25.0, 27), party("ב", 21.0, 23)]))
        self.assertNotIn("צמודות", body)

    def test_equal_seats_are_reported_as_level(self):
        headline, _ = render_from_template(facts([party("א", 22.0, 24), party("ב", 21.8, 24)]))
        self.assertIn("שוות", headline)


if __name__ == "__main__":
    unittest.main()
