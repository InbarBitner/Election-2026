"""The seed fills gaps with demo data and never lays it over real data.

Run with:  python3 -m unittest pipeline.test_seed
"""

from __future__ import annotations

import unittest

import json
from pathlib import Path

from .etl.load.loader import surplus_agreement_rows
from .seed import plan_seed


def candidate(party: str, n: int) -> dict:
    return {"id": f"cand_{party}_{n}", "partyId": party}


def row(candidate_id: str) -> dict:
    return {"candidateId": candidate_id}


class PlanSeedTests(unittest.TestCase):
    def setUp(self):
        self.candidates = [candidate("likud", 1), candidate("shas", 1)]
        self.xray = (
            [row("cand_likud_1"), row("cand_shas_1")],
            [row("cand_likud_1")],
            [row("cand_shas_1")],
            [],
        )
        self.polls = ["poll-a", "poll-b"]

    def plan(self, real_polls=0, real_parties=frozenset()):
        return plan_seed(
            candidates=self.candidates,
            xray=self.xray,
            polls=self.polls,
            real_polls=real_polls,
            parties_with_real_candidates=set(real_parties),
        )

    def test_an_empty_warehouse_gets_the_full_demo_dataset(self):
        plan = self.plan()
        self.assertEqual(plan["polls"], self.polls)
        self.assertEqual(len(plan["candidates"]), 2)
        self.assertEqual(plan["skipped_candidate_parties"], set())

    def test_no_demo_polls_once_real_polls_exist(self):
        # Averaged together they would corrupt the aggregate and bring back
        # the demo banner.
        self.assertEqual(self.plan(real_polls=166)["polls"], [])

    def test_no_fictional_candidates_for_a_party_with_its_official_list(self):
        plan = self.plan(real_parties={"likud"})
        self.assertEqual([c["id"] for c in plan["candidates"]], ["cand_shas_1"])
        self.assertEqual(plan["skipped_candidate_parties"], {"likud"})

    def test_xray_rows_follow_their_candidate(self):
        plan = self.plan(real_parties={"likud"})
        self.assertEqual(plan["votes"], [row("cand_shas_1")])
        self.assertEqual(plan["bills"], [])
        self.assertEqual(plan["quotes"], [row("cand_shas_1")])


def agreement(a: str, b: str) -> dict:
    return {"parties": [a, b], "signedOn": "2026-10-06", "sourceUrl": "https://example.org", "sourceName": "x"}


class SurplusAgreementTests(unittest.TestCase):
    parties = {"likud", "religious-zionism", "shas", "yahadut-hatorah"}

    def test_a_pair_becomes_one_row_with_a_stable_id(self):
        [row] = surplus_agreement_rows([agreement("religious-zionism", "likud")], self.parties)
        self.assertEqual(row["id"], "likud+religious-zionism")
        self.assertEqual((row["partyAId"], row["partyBId"]), ("likud", "religious-zionism"))

    def test_a_party_cannot_sign_twice(self):
        with self.assertRaises(ValueError):
            surplus_agreement_rows(
                [agreement("likud", "shas"), agreement("likud", "religious-zionism")], self.parties
            )

    def test_an_unknown_party_stops_the_load(self):
        with self.assertRaises(ValueError):
            surplus_agreement_rows([agreement("likud", "nobody")], self.parties)

    def test_the_committed_file_is_valid(self):
        root = Path(__file__).resolve().parent.parent / "data" / "seed"
        parties = {p["id"] for p in json.loads((root / "parties.json").read_text())["parties"]}
        agreements = json.loads((root / "surplus_agreements.json").read_text())["agreements"]
        self.assertEqual(len(surplus_agreement_rows(agreements, parties)), len(agreements))


if __name__ == "__main__":
    unittest.main()
