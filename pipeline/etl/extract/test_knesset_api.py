"""Tests for the Knesset connector's parsing, pinned to observed responses.

The fixtures here are copied from real rows returned by the live service (see
`.github/workflows/probe-knesset.yml`), because every bug this module has had
came from field names that were plausible but wrong. Tests written against
invented fixtures would have passed against the broken code too.
"""

from __future__ import annotations

import unittest
from datetime import date
from unittest import mock

from . import knesset_api
from .http import FetchError

# Verbatim rows from the service.
PERSON_TO_POSITION = {
    "PersonToPositionID": 30177,
    "PersonID": 30749,
    "PositionID": 54,
    "KnessetNum": 25,
    "StartDate": "2022-11-15T00:00:00",
    "FinishDate": None,
    "FactionID": 1095,
    "FactionName": "התאחדות הספרדים שומרי תורה תנועתו של מרן הרב עובדיה יוסף זצ\"ל",
    "IsCurrent": True,
}
PERSON = {
    "PersonID": 405,
    "LastName": "אלון",
    "FirstName": "בנימין",
    "GenderID": 251,
    "IsCurrent": False,
}
VOTE_HEADER = {
    "vote_id": 8,
    "knesset_num": 16,
    "sess_item_dscr": "הודעת ראש הממשלה על פעילות הממשלה",
    "vote_item_dscr": "הצעת סיכום",
    "vote_date": "2003-10-20T00:00:00",
    "total_for": 13,
    "total_against": 54,
}
VOTE_RESULT = {
    "vote_id": 8,
    "kmmbr_id": "000000405",
    "kmmbr_name": "בנימין אלון",
    "vote_result": 1,
    "knesset_num": 16,
    "faction_name": "האיחוד הלאומי-ישראל ביתנו",
}
BILL_LINK = {"BillInitiatorID": 1, "BillID": 29803, "PersonID": 405, "IsInitiator": True}
BILL = {
    "BillID": 29803,
    "KnessetNum": 16,
    "Name": "חוק שכר חברי הכנסת, התש\"ט-1949",
    "SubTypeDesc": "ועדה",
    "StatusID": 118,
    "PublicationDate": "1949-06-07T00:00:00",
    "SummaryLaw": None,
}


class VoteMemberIdTest(unittest.TestCase):
    """The join between the two services rests entirely on this padding."""

    def test_pads_person_id_to_nine_characters(self):
        # PersonID 405 is kmmbr_id "000000405" — confirmed against both
        # services for בנימין אלון.
        self.assertEqual(knesset_api.vote_member_id(405), "000000405")
        self.assertEqual(knesset_api.vote_member_id("405"), "000000405")

    def test_leaves_an_already_padded_id_alone(self):
        self.assertEqual(knesset_api.vote_member_id("000000405"), "000000405")


class PaginationTest(unittest.TestCase):
    """The service caps responses at 100 rows without saying so."""

    def test_pages_until_a_short_page_arrives(self):
        pages = [
            [{"n": i} for i in range(100)],
            [{"n": i} for i in range(100, 193)],
        ]
        calls = []

        def fake_page(entity, *, base, top, skip, filter_expr, order_by=None):
            calls.append((top, skip))
            return pages.pop(0) if pages else []

        with mock.patch.object(knesset_api, "_odata_page", side_effect=fake_page):
            rows = knesset_api._odata("KNS_PersonToPosition", top=500)

        self.assertEqual(len(rows), 193)
        self.assertEqual(calls, [(100, 0), (100, 100)])

    def test_a_single_short_page_makes_no_second_request(self):
        with mock.patch.object(
            knesset_api, "_odata_page", return_value=[{"n": 1}]
        ) as page:
            rows = knesset_api._odata("KNS_Person", top=500)
        self.assertEqual(len(rows), 1)
        page.assert_called_once()

    def test_never_returns_more_than_requested(self):
        with mock.patch.object(
            knesset_api,
            "_odata_page",
            return_value=[{"n": i} for i in range(100)],
        ):
            rows = knesset_api._odata("KNS_Person", top=40)
        self.assertEqual(len(rows), 40)


class SkippedTest(unittest.TestCase):
    """The guard that turns a silent empty result into a loud failure."""

    def test_dropping_every_fetched_row_raises(self):
        skipped = knesset_api._Skipped("בדיקה")
        skipped.fetched = 3
        for _ in range(3):
            skipped.drop("שדה חסר")
        with self.assertRaises(FetchError) as caught:
            skipped.check(kept=0)
        self.assertIn("שדה חסר", str(caught.exception))

    def test_a_genuinely_empty_source_does_not_raise(self):
        # Nothing fetched and nothing kept is an empty source, not a bug.
        skipped = knesset_api._Skipped("בדיקה")
        skipped.fetched = 0
        skipped.check(kept=0)

    def test_partial_drops_do_not_raise(self):
        skipped = knesset_api._Skipped("בדיקה")
        skipped.fetched = 3
        skipped.drop("שדה חסר")
        skipped.check(kept=2)


class FetchMembersTest(unittest.TestCase):
    def test_joins_faction_rows_to_names(self):
        def fake_odata(entity, **kwargs):
            if entity == "KNS_PersonToPosition":
                return [{**PERSON_TO_POSITION, "PersonID": 405}]
            if entity == "KNS_Person":
                return [PERSON]
            raise AssertionError(f"unexpected entity {entity}")

        with mock.patch.object(knesset_api, "_odata", side_effect=fake_odata):
            members = knesset_api.fetch_members(25)

        self.assertEqual(len(members), 1)
        self.assertEqual(members[0]["name"], "בנימין אלון")
        self.assertEqual(members[0]["knessetMemberId"], "405")
        self.assertIn("שומרי תורה", members[0]["factionName"])
        self.assertTrue(members[0]["sourceUrl"].endswith("MKID=405"))

    def test_queries_the_faction_membership_position(self):
        """Position 43 leaves FactionName null, so the roster must use 54."""
        seen = {}

        def fake_odata(entity, **kwargs):
            seen[entity] = kwargs.get("filter_expr", "")
            return [] if entity == "KNS_PersonToPosition" else []

        with mock.patch.object(knesset_api, "_odata", side_effect=fake_odata):
            knesset_api.fetch_members(25)

        self.assertIn("PositionID eq 54", seen["KNS_PersonToPosition"])

    def test_names_missing_for_every_row_raises(self):
        """The exact bug this module shipped with: fetched rows, kept none."""

        def fake_odata(entity, **kwargs):
            if entity == "KNS_PersonToPosition":
                return [{**PERSON_TO_POSITION, "PersonID": 405}]
            return []  # KNS_Person returns nothing → no names

        with mock.patch.object(knesset_api, "_odata", side_effect=fake_odata):
            with self.assertRaises(FetchError):
                knesset_api.fetch_members(25)


class FetchVotesTest(unittest.TestCase):
    def test_joins_results_to_headers(self):
        with mock.patch.object(knesset_api, "_odata", return_value=[VOTE_RESULT]):
            votes = knesset_api.fetch_votes(
                "405",
                knesset_number=16,
                headers={8: VOTE_HEADER},
                results={1: "for"},
            )

        self.assertEqual(len(votes), 1)
        self.assertEqual(votes[0]["position"], "for")
        self.assertEqual(votes[0]["date"], date(2003, 10, 20))
        self.assertEqual(votes[0]["billTitle"], "הודעת ראש הממשלה על פעילות הממשלה")
        self.assertEqual(votes[0]["sourceUrl"], "https://online.knesset.gov.il/Vote/8")

    def test_filters_by_the_padded_member_id(self):
        captured = {}

        def fake_odata(entity, **kwargs):
            captured["filter"] = kwargs.get("filter_expr", "")
            return []

        with mock.patch.object(knesset_api, "_odata", side_effect=fake_odata):
            knesset_api.fetch_votes("405", knesset_number=25, headers={}, results={})

        self.assertIn("kmmbr_id eq '000000405'", captured["filter"])

    def test_an_unknown_result_type_is_dropped_not_guessed(self):
        with mock.patch.object(
            knesset_api, "_odata", return_value=[{**VOTE_RESULT, "vote_result": 99}]
        ):
            with self.assertRaises(FetchError):
                knesset_api.fetch_votes(
                    "405", knesset_number=16, headers={8: VOTE_HEADER}, results={1: "for"}
                )


class FetchBillsTest(unittest.TestCase):
    def test_joins_link_rows_to_bill_titles(self):
        def fake_odata(entity, **kwargs):
            if entity == "KNS_BillInitiator":
                return [BILL_LINK]
            if entity == "KNS_Bill":
                return [BILL]
            raise AssertionError(f"unexpected entity {entity}")

        with mock.patch.object(knesset_api, "_odata", side_effect=fake_odata):
            bills = knesset_api.fetch_bills("405", statuses={118: "התקבלה"})

        self.assertEqual(len(bills), 1)
        self.assertEqual(bills[0]["title"], "חוק שכר חברי הכנסת, התש\"ט-1949")
        self.assertEqual(bills[0]["status"], "התקבלה")
        self.assertEqual(bills[0]["date"], date(1949, 6, 7))
        self.assertTrue(bills[0]["isLeadSponsor"])

    def test_takes_the_newest_bills_first(self):
        # Unordered, the cap kept an arbitrary slice of a member's bills.
        calls = {}

        def fake_odata(entity, **kwargs):
            calls[entity] = kwargs
            return [BILL_LINK] if entity == "KNS_BillInitiator" else [BILL]

        with mock.patch.object(knesset_api, "_odata", side_effect=fake_odata):
            knesset_api.fetch_bills("405", statuses={})

        self.assertEqual(calls["KNS_BillInitiator"]["order_by"], "BillID desc")
        self.assertEqual(calls["KNS_BillInitiator"]["top"], 2 * knesset_api.BILLS_PER_MEMBER)

    def test_keeps_the_newest_by_date_not_by_id(self):
        links = [{**BILL_LINK, "BillID": 2}, {**BILL_LINK, "BillID": 1}]
        bills_by_id = [
            {**BILL, "BillID": 2, "PublicationDate": "1997-07-30T00:00:00"},
            {**BILL, "BillID": 1, "PublicationDate": "2024-01-31T00:00:00"},
        ]

        def fake_odata(entity, **kwargs):
            return links if entity == "KNS_BillInitiator" else bills_by_id

        with mock.patch.object(knesset_api, "_odata", side_effect=fake_odata):
            bills = knesset_api.fetch_bills("405", limit=1, statuses={})

        self.assertEqual(bills[0]["date"], date(2024, 1, 31))

    def test_never_takes_the_migration_timestamp_as_the_bill_date(self):
        # Older bills have no PublicationDate, and their LastUpdatedDate is the
        # day the Knesset migrated its records, not anything about the bill.
        undated = {
            **BILL,
            "KnessetNum": 18,
            "Name": "הצעת חוק מטה ההסברה הלאומי, התשע\"ב-2012",
            "PublicationDate": None,
            "LastUpdatedDate": "2021-06-29T07:48:03.727",
        }

        def fake_odata(entity, **kwargs):
            return [BILL_LINK] if entity == "KNS_BillInitiator" else [undated]

        with mock.patch.object(knesset_api, "_odata", side_effect=fake_odata):
            bills = knesset_api.fetch_bills("405", statuses={})

        self.assertIsNone(bills[0]["date"])
        self.assertEqual(bills[0]["knessetNum"], 18)
        self.assertEqual(bills[0]["year"], 2012)

    def test_link_rows_with_no_matching_bill_raise(self):
        def fake_odata(entity, **kwargs):
            return [BILL_LINK] if entity == "KNS_BillInitiator" else []

        with mock.patch.object(knesset_api, "_odata", side_effect=fake_odata):
            with self.assertRaises(FetchError):
                knesset_api.fetch_bills("405", statuses={})


class VoteCoverageTest(unittest.TestCase):
    """Votes.svc is frozen at the 24th Knesset; that must be said, not hidden."""

    def test_reads_the_ceiling_from_the_service(self):
        with mock.patch.object(
            knesset_api, "_odata_page", return_value=[{"vote_id": 34525, "knesset_num": 24}]
        ):
            self.assertEqual(knesset_api.latest_vote_knesset(), 24)

    def test_an_uncovered_knesset_produces_a_note_not_an_error(self):
        with mock.patch.object(
            knesset_api, "fetch_members", return_value=[{"knessetMemberId": "405"}]
        ), mock.patch.object(knesset_api, "latest_vote_knesset", return_value=24), \
             mock.patch.object(knesset_api, "_vote_result_names", return_value={}), \
             mock.patch.object(knesset_api, "_bill_statuses", return_value={}), \
             mock.patch.object(knesset_api, "fetch_bills", return_value=[]), \
             mock.patch.object(knesset_api, "_vote_headers") as headers, \
             mock.patch.object(knesset_api, "fetch_votes") as votes:
            result = knesset_api.extract(25)

        # Not fetched at all, rather than fetched and found empty.
        headers.assert_not_called()
        votes.assert_not_called()
        self.assertIsNone(result["error"])
        self.assertIn("הכנסת ה-24", result["note"])

    def test_given_member_ids_fetches_for_them_not_the_sitting_knesset(self):
        # A candidate who served only in an earlier Knesset must still get bills.
        with mock.patch.object(knesset_api, "fetch_members") as members, \
             mock.patch.object(knesset_api, "latest_vote_knesset", return_value=24), \
             mock.patch.object(knesset_api, "_vote_result_names", return_value={}), \
             mock.patch.object(knesset_api, "_bill_statuses", return_value={}), \
             mock.patch.object(knesset_api, "fetch_bills", return_value=[]) as bills:
            knesset_api.extract(25, member_ids=["23511", "30680"])

        members.assert_not_called()
        self.assertEqual([c.args[0] for c in bills.call_args_list], ["23511", "30680"])

    def test_a_covered_knesset_still_fetches_votes(self):
        with mock.patch.object(
            knesset_api, "fetch_members", return_value=[{"knessetMemberId": "405"}]
        ), mock.patch.object(knesset_api, "latest_vote_knesset", return_value=25), \
             mock.patch.object(knesset_api, "_vote_headers", return_value={8: VOTE_HEADER}), \
             mock.patch.object(knesset_api, "_vote_result_names", return_value={1: "for"}), \
             mock.patch.object(knesset_api, "_bill_statuses", return_value={}), \
             mock.patch.object(knesset_api, "fetch_bills", return_value=[]), \
             mock.patch.object(knesset_api, "fetch_votes", return_value=[{"id": "v1"}]):
            result = knesset_api.extract(25)

        self.assertIsNone(result["note"])
        self.assertEqual(len(result["votes"]), 1)


class ExtractTest(unittest.TestCase):
    def test_a_member_failure_does_not_abort_the_run(self):
        with mock.patch.object(
            knesset_api, "fetch_members", return_value=[{"knessetMemberId": "405"}]
        ), mock.patch.object(knesset_api, "latest_vote_knesset", return_value=25), \
             mock.patch.object(knesset_api, "_vote_headers", return_value={8: VOTE_HEADER}), \
             mock.patch.object(knesset_api, "_vote_result_names", return_value={1: "for"}), \
             mock.patch.object(knesset_api, "_bill_statuses", return_value={}), \
             mock.patch.object(knesset_api, "fetch_votes", side_effect=FetchError("נפל")), \
             mock.patch.object(knesset_api, "fetch_bills", return_value=[]):
            result = knesset_api.extract(25)

        self.assertEqual(result["votes"], [])
        self.assertIn("נפל", result["error"])
        self.assertEqual(len(result["members"]), 1)


if __name__ == "__main__":
    unittest.main()
