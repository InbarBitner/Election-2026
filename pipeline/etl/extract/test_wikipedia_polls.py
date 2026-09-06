"""Tests for the Wikipedia poll parser.

The fixtures reproduce markup and values observed on the live page (see
`.github/workflows/probe-polls.yml`): the real column layout, the real
"(0.7%)" below-threshold form, and the real non-poll tables that share the
page. Fixtures invented from imagination would pass against a parser that
misreads the actual page, which is the failure this project has already had
once.
"""

from __future__ import annotations

import unittest
from datetime import date

from . import wikipedia_polls as wp

TODAY = date(2026, 9, 6)


def _table(rows: list[list[str]], cls: str = "wikitable") -> str:
    out = [f'<table class="{cls}">']
    for i, row in enumerate(rows):
        tag = "th" if i == 0 else "td"
        out.append("<tr>" + "".join(f"<{tag}>{c}</{tag}>" for c in row) + "</tr>")
    out.append("</table>")
    return "".join(out)


# Column layout and values from the 3–4 Sep Lazar and 3 Sep Filber rows.
SEAT_HEADER = [
    "Fieldwork date", "Polling firm", "Publisher", "Sample size",
    "Likud", "Together", "RZP", "Otzma", "Blue &amp; White", "Shas", "UTJ",
    "Yisrael Beiteinu", "Ra'am", "Joint List", "Dems", "Yashar",
    "Zionist Home", "Amcha Yisrael",
]
LAZAR_ROW = [
    "3– 4 Sep", "Lazar",
    'Maariv<sup><a href="#cite_note-maariv-23">&#91;23&#93;</a></sup>',
    "600", "20", "15", "5", "8", "(0.7%)", "7", "7", "9", "5", "7", "10", "23",
    "(2.1%)", "(1.1%)",
]
FILBER_ROW = [
    "3 Sep", "Filber",
    'Channel 14<sup><a href="#cite_note-c14-24">&#91;24&#93;</a></sup>',
    "865", "31", "9", "7", "7", "(1.2%)", "10", "8", "6", "5", "7", "8", "22",
    "(1.3%)", "(0.1%)",
]
REFERENCES = (
    '<ol class="references">'
    '<li id="cite_note-maariv-23"><a rel="nofollow" class="external text"'
    ' href="https://www.maariv.co.il/elections/poll-1234">סקר מעריב</a></li>'
    '<li id="cite_note-c14-24">Channel 14 broadcast, no link</li>'
    "</ol>"
)

# A preferred-prime-minister table: same page, must never be read as seats.
PM_TABLE = _table([
    ["Fieldwork date", "Polling firm", "Netanyahu", "Bennett", "Would like",
     "Would dislike", "Don't know", "Two Lists", "Three Lists"],
    ["1 Sep", "Midgam", "42", "31", "18", "40", "9", "2", "1"],
])
# An event row inside a seat table.
EVENT_ROW = ["8 Sep", "Deadline for submission of candidate lists"]


class DateRangeTest(unittest.TestCase):
    def test_single_day(self):
        self.assertEqual(
            wp._parse_date_range("3 Sep", TODAY), (date(2026, 9, 3), date(2026, 9, 3))
        )

    def test_range_sharing_a_month(self):
        # "3– 4 Sep" — the spacing is the page's, not a typo here.
        self.assertEqual(
            wp._parse_date_range("3– 4 Sep", TODAY), (date(2026, 9, 3), date(2026, 9, 4))
        )

    def test_range_crossing_months(self):
        self.assertEqual(
            wp._parse_date_range("29 Aug – 1 Sep", TODAY),
            (date(2026, 8, 29), date(2026, 9, 1)),
        )

    def test_a_month_ahead_of_today_belongs_to_last_year(self):
        # The table omits the year; December read as this year would be in the
        # future, so it must be the previous December.
        self.assertEqual(
            wp._parse_date_range("14 Dec", TODAY),
            (date(2025, 12, 14), date(2025, 12, 14)),
        )

    def test_unparseable(self):
        self.assertIsNone(wp._parse_date_range("Deadline for submission", TODAY))
        self.assertIsNone(wp._parse_date_range("", TODAY))


class SeatCellTest(unittest.TestCase):
    def test_plain_seat_count(self):
        self.assertEqual(wp._parse_seats("20"), 20.0)

    def test_below_threshold_share_is_zero_seats_not_a_fraction(self):
        # The bug this guards: "(0.7%)" read as 0.7 seats.
        self.assertEqual(wp._parse_seats("(0.7%)"), 0.0)
        self.assertEqual(wp._parse_seats("(2.1%)"), 0.0)

    def test_empty_and_dashes_are_absent_not_zero(self):
        for value in ("", "—", "–", "-", "?"):
            self.assertIsNone(wp._parse_seats(value))

    def test_text_is_not_a_seat_count(self):
        self.assertIsNone(wp._parse_seats("Would like"))


class MarginOfErrorTest(unittest.TestCase):
    def test_derived_from_sample_size(self):
        self.assertEqual(wp._margin_of_error(600), 4.0)
        self.assertEqual(wp._margin_of_error(865), 3.3)


class ParseTablesTest(unittest.TestCase):
    def test_reads_a_seat_table(self):
        html = _table([SEAT_HEADER, LAZAR_ROW, FILBER_ROW]) + REFERENCES
        report = wp.parse_tables(html, today=TODAY)

        self.assertEqual(len(report.polls), 2)
        lazar = report.polls[0]
        self.assertEqual(lazar.pollster, "Lazar")
        self.assertEqual(lazar.sponsor, "Maariv")
        self.assertEqual(lazar.field_date_start, date(2026, 9, 3))
        self.assertEqual(lazar.field_date_end, date(2026, 9, 4))
        self.assertEqual(lazar.sample_size, 600)
        self.assertEqual(lazar.seats["Likud"], 20.0)
        self.assertEqual(lazar.seats["Yashar"], 23.0)
        # Below threshold: present in the poll, holding zero seats.
        self.assertEqual(lazar.seats["Blue & White"], 0.0)
        self.assertEqual(lazar.seats["Zionist Home"], 0.0)

    def test_source_points_at_the_publication_when_the_citation_has_a_link(self):
        html = _table([SEAT_HEADER, LAZAR_ROW]) + REFERENCES
        poll = wp.parse_tables(html, today=TODAY).polls[0]
        self.assertEqual(poll.source_url, "https://www.maariv.co.il/elections/poll-1234")
        self.assertEqual(poll.source_name, "Maariv")

    def test_falls_back_to_wikipedia_when_the_citation_has_no_link(self):
        html = _table([SEAT_HEADER, FILBER_ROW]) + REFERENCES
        poll = wp.parse_tables(html, today=TODAY).polls[0]
        self.assertEqual(poll.source_url, wp.PAGE_URL)
        self.assertEqual(poll.source_name, "ויקיפדיה")

    def test_ignores_a_preferred_prime_minister_table(self):
        report = wp.parse_tables(PM_TABLE, today=TODAY)
        self.assertEqual(report.tables_used, 0)
        self.assertEqual(report.polls, [])

    def test_ignores_event_rows_inside_a_seat_table(self):
        html = _table([SEAT_HEADER, EVENT_ROW, LAZAR_ROW]) + REFERENCES
        report = wp.parse_tables(html, today=TODAY)
        self.assertEqual(len(report.polls), 1)
        self.assertEqual(report.rows_seen, 1)

    def test_picks_the_seat_table_out_of_a_page_of_others(self):
        html = PM_TABLE + _table([SEAT_HEADER, LAZAR_ROW]) + PM_TABLE + REFERENCES
        report = wp.parse_tables(html, today=TODAY)
        self.assertEqual(report.tables_seen, 3)
        self.assertEqual(report.tables_used, 1)
        self.assertEqual(len(report.polls), 1)

    def test_a_row_with_an_unreadable_sample_size_is_skipped_and_counted(self):
        bad = list(LAZAR_ROW)
        bad[3] = "?"
        report = wp.parse_tables(_table([SEAT_HEADER, bad]) + REFERENCES, today=TODAY)
        self.assertEqual(report.polls, [])
        self.assertEqual(report.skipped, {"גודל מדגם לא נקרא": 1})


class ExtractTest(unittest.TestCase):
    def test_a_seat_table_that_yields_nothing_produces_a_note(self):
        """Recognised the table, read no rows — the layout probably changed."""
        broken = ["1 Foo", "Lazar", "Maariv", "?"] + ["x"] * 14
        html = _table([SEAT_HEADER, broken])
        from unittest import mock

        with mock.patch.object(wp, "_fetch_page_html", return_value=html):
            result = wp.extract(today=TODAY)

        self.assertEqual(result["polls"], [])
        self.assertIsNone(result["error"])
        self.assertIn("מבנה הטבלה השתנה", result["note"])

    def test_since_filters_older_polls(self):
        html = _table([SEAT_HEADER, LAZAR_ROW, FILBER_ROW]) + REFERENCES
        from unittest import mock

        with mock.patch.object(wp, "_fetch_page_html", return_value=html):
            result = wp.extract(since=date(2026, 9, 4), today=TODAY)

        self.assertEqual(len(result["polls"]), 1)
        self.assertEqual(result["polls"][0].pollster, "Lazar")

    def test_a_fetch_failure_is_reported_not_raised(self):
        from unittest import mock

        from .http import FetchError

        with mock.patch.object(wp, "_fetch_page_html", side_effect=FetchError("נפל")):
            result = wp.extract(today=TODAY)

        self.assertEqual(result["polls"], [])
        self.assertIn("נפל", result["error"])


if __name__ == "__main__":
    unittest.main()


class AggregateColumnTest(unittest.TestCase):
    """Total columns carry real seat counts and must never be read as parties.

    A "Gov." column holding the coalition's ~50 seats pushed every row it
    appeared in to a total of 163–179, so the seat-sum check rejected 126 of
    171 otherwise-good polls. The number looked like a party's, which is why
    only the total caught it.
    """

    def test_totals_and_blocs_are_not_parties(self):
        for header in (
            "Gov.", "Gov. [a]", "Opposition", "Coalition", "Right-wing bloc",
            "Cross-bloc w. Arabs", "Total", "Lead", "Sample size",
        ):
            self.assertFalse(wp._is_party_column(header), header)

    def test_real_parties_still_are(self):
        for header in (
            "Likud", "Yashar", "Joint List", "Amcha Yisrael", "Zionist Home",
            # Residual buckets stay in: they hold seats that must count
            # towards 120, and being unmapped they are reported rather than
            # attributed to any party.
            "Other parties", "Unity",
        ):
            self.assertTrue(wp._is_party_column(header), header)

    def test_a_gov_column_does_not_inflate_the_seat_total(self):
        header = SEAT_HEADER + ["Gov."]
        row = LAZAR_ROW + ["61"]
        poll = wp.parse_tables(_table([header, row]) + REFERENCES, today=TODAY).polls[0]
        self.assertNotIn("Gov.", poll.seats)
        # The row's own seats, with the 61-seat coalition total left out.
        self.assertEqual(sum(poll.seats.values()), 116.0)


class CitationResolutionTest(unittest.TestCase):
    """Wikipedia puts other attributes before the id on reference items.

    Requiring id to come first matched 0 of 1488 references on the live page,
    so every poll cited Wikipedia rather than the publication — and because
    falling back is a legitimate outcome, nothing looked wrong.
    """

    def test_id_is_found_wherever_it_sits_among_the_attributes(self):
        refs = (
            '<ol class="references">'
            '<li class="mw-cite" id="cite_note-maariv-23" data-x="1">'
            '<span class="reference-text">'
            '<a rel="nofollow" class="external text"'
            ' href="https://www.maariv.co.il/elections/poll-1234">סקר</a>'
            "</span></li></ol>"
        )
        urls = wp._citation_urls(refs)
        self.assertEqual(
            urls["cite_note-maariv-23"],
            "https://www.maariv.co.il/elections/poll-1234",
        )

    def test_a_row_then_cites_the_publication(self):
        refs = (
            '<ol class="references"><li class="x" id="cite_note-maariv-23">'
            '<a href="https://www.maariv.co.il/elections/poll-1234">סקר</a>'
            "</li></ol>"
        )
        report = wp.parse_tables(_table([SEAT_HEADER, LAZAR_ROW]) + refs, today=TODAY)
        self.assertEqual(report.citations_resolved, 1)
        self.assertEqual(
            report.polls[0].source_url,
            "https://www.maariv.co.il/elections/poll-1234",
        )
        self.assertEqual(report.polls[0].source_name, "Maariv")

    def test_a_reference_with_no_external_link_is_not_invented(self):
        refs = '<ol><li id="cite_note-c14-24">Channel 14 broadcast</li></ol>'
        self.assertEqual(wp._citation_urls(refs), {})
