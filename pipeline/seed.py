"""Populate the warehouse with a working demo dataset.

The seed exists so the application is usable before a single scraper is turned
on. It goes through the *same* transform and load path as the real extractors —
`clean_polls` and the `load_*` functions — so running it also exercises the
pipeline rather than bypassing it.

What is real and what is not:

* Party names, leaders, blocs and platform summaries are public facts and each
  row links to a source.
* Polls are SYNTHETIC. They are generated from the trajectory in
  data/seed/poll_anchors.json with per-pollster house effects and deterministic
  noise, and are labelled with obviously fictional pollster names.
* Candidates are NOT seeded by default (`--candidates-per-party` defaults to
  0). The official lists are filed with the Central Elections Committee shortly
  before the election; until they are public the site shows no candidates
  rather than invented ones, and the party pages say why. Passing a number
  regenerates the fictional placeholders for development — they are named
  "(מועמד/ת לדוגמה)" and carry invented votes, bills, quotes and connections,
  because attributing invented statements or voting records to real
  politicians would be indefensible even in demo data.

Every seeded row carries provenance="seed", which is what the UI's demo-data
banner keys off.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import random
from datetime import date, datetime, timedelta
from pathlib import Path

from .db import get_engine
from .etl.load import loader
from .etl.transform.normalize import RawPoll, clean_polls

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = REPO_ROOT / "data" / "seed"

# Fixed so the demo dataset is byte-identical on every machine and every run.
RANDOM_SEED = 20261027

SEED_SOURCE_NAME = "נתוני הדגמה"
SEED_SOURCE_URL = "https://github.com/InbarBitner/Election-2026#נתוני-הדגמה"

# Fictional candidates. Marked in the name itself so no reader can mistake a
# placeholder for a real person.
GIVEN_NAMES = [
    "אורי", "נועה", "איתי", "שירה", "יונתן", "מאיה", "עומר", "תמר",
    "אלון", "הדס", "רון", "ליאת", "גיא", "אביגיל", "נדב", "רותם",
    "אמיר", "סיון", "יובל", "דנה", "עידו", "כרמל", "אסף", "מיכל",
]
FAMILY_NAMES = [
    "כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אברהם", "פרידמן", "שפירא",
    "אזולאי", "גבאי", "דהן", "סגל", "רוזן", "ברק", "חדד", "נחום",
    "אשכנזי", "טולדנו", "בן חיים", "שרון", "אלמוג", "ניר", "רגב", "עמר",
]

# (topic, bill title, direction). `direction` says which pole of the topic's
# axis the bill sits on: +1 means a party at the positive pole would support it,
# -1 the opposite. Without it every party would vote the same way on everything
# and the X-ray demo would show a flat, meaningless voting record.
VOTE_TOPICS = [
    ("ביטחון", "חוק להסדרת סמכויות כוחות הביטחון", 1),
    ("ביטחון", "חוק יישום הסדר מדיני — הוראת שעה", -1),
    ("כלכלה", "חוק ההסדרים — פרק הדיור", -1),
    ("כלכלה", "חוק להפחתת נטל המס על יחידים ועסקים", 1),
    ("דת ומדינה", "חוק שירות ביטחון (הסדרת מעמד לומדי תורה)", 1),
    ("דת ומדינה", "חוק נישואין וגירושין אזרחיים", -1),
    ("משפט", "תיקון חוק יסוד: השפיטה", 1),
    ("משפט", "חוק ועדת חקירה ממלכתית", -1),
    ("חברה", "חוק שוויון הזדמנויות בעבודה — תיקון", -1),
    ("חינוך", "חוק חינוך חובה — הרחבת גיל", -1),
]

BILL_TOPICS = [
    ("כלכלה", "הצעת חוק להוזלת מוצרי יסוד", "הרחבת פיקוח על מחירי מוצרים בסיסיים."),
    ("בריאות", "הצעת חוק זמני המתנה לתורים", "קביעת זמן המתנה מרבי לתורים רפואיים."),
    ("ביטחון", "הצעת חוק סיוע לתושבי הצפון", "הרחבת סל הסיוע ליישובי קו העימות."),
    ("סביבה", "הצעת חוק אנרגיה מתחדשת", "יעדי ייצור חשמל מאנרגיה מתחדשת עד 2035."),
    ("משפט", "הצעת חוק זכות העיון במידע ציבורי", "קיצור לוחות הזמנים למענה לבקשות מידע."),
]
BILL_STATUSES = ["proposed", "preliminary", "first-reading", "passed", "rejected"]

CONNECTION_KINDS = [
    ("committee", "ועדת הכספים", "חברות בוועדה בכנסת היוצאת"),
    ("committee", "ועדת החוץ והביטחון", "חברות בוועדה בכנסת היוצאת"),
    ("former-party", "מפלגה קודמת (הדגמה)", "כיהן/ה מטעם מפלגה אחרת בעבר"),
    ("co-sponsor", "שותף/ה לחקיקה (הדגמה)", "שיתוף פעולה חוזר בהצעות חוק"),
]


def _load(name: str) -> dict:
    return json.loads((SEED_DIR / name).read_text(encoding="utf-8"))


def _id(prefix: str, *parts: str) -> str:
    return f"{prefix}_" + hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Candidates and their X-ray records
# ---------------------------------------------------------------------------


def build_candidates(parties: list[dict], rng: random.Random, per_party: int) -> list[dict]:
    candidates = []
    for party in parties:
        for position in range(1, per_party + 1):
            name = (
                f"{rng.choice(GIVEN_NAMES)} {rng.choice(FAMILY_NAMES)} "
                f"(מועמד/ת לדוגמה)"
            )
            candidates.append(
                {
                    "id": _id("cand", party["id"], str(position)),
                    "partyId": party["id"],
                    "name": name,
                    "listPosition": position,
                    "bio": (
                        f"מועמד/ת בדיוני/ת במקום ה-{position} ברשימת {party['name']}, "
                        "לצורך הדגמת פיצ'ר רנטגן מועמד. הנתונים המצורפים אינם אמיתיים."
                    ),
                    "knessetMemberId": None,
                    "sourceUrl": SEED_SOURCE_URL,
                    "sourceName": SEED_SOURCE_NAME,
                    "provenance": "seed",
                }
            )
    return candidates


def build_xray(
    candidates: list[dict],
    planks_by_party: dict[str, dict[str, float]],
    rng: random.Random,
    today: date,
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """Votes, bills, quotes and connections consistent with the party's platform.

    Consistency matters even for demo data: a candidate of a party whose
    platform opposes a bill should be shown voting against it, otherwise the
    X-ray teaches the reader something false about how the feature works.
    """
    axis_for_topic = {
        "ביטחון": "security",
        "כלכלה": "economy",
        "דת ומדינה": "religion",
        "משפט": "governance",
        "חברה": "society",
        "חינוך": "society",
        "בריאות": "economy",
        "סביבה": "economy",
    }

    votes, bills, quotes, connections = [], [], [], []

    for candidate in candidates:
        party_positions = planks_by_party.get(candidate["partyId"], {})

        for index, (topic, title, direction) in enumerate(VOTE_TOPICS):
            axis_position = party_positions.get(axis_for_topic.get(topic, "economy"), 0.0)
            # How well the bill matches where the party stands on that axis.
            alignment = axis_position * direction
            if alignment > 0.2:
                stance = "for"
            elif alignment < -0.2:
                stance = "against"
            else:
                stance = rng.choice(["for", "against", "abstain"])
            # A small share of votes break with the faction, which is exactly
            # the kind of thing the X-ray is meant to surface.
            against_faction = rng.random() < 0.08
            if against_faction and stance in ("for", "against"):
                stance = "against" if stance == "for" else "for"

            votes.append(
                {
                    "id": _id("vote", candidate["id"], str(index)),
                    "candidateId": candidate["id"],
                    "billTitle": title,
                    "topic": topic,
                    "date": today - timedelta(days=30 * (index + 1) + rng.randint(0, 20)),
                    "position": stance,
                    "againstFaction": against_faction,
                    "sourceUrl": SEED_SOURCE_URL,
                    "sourceName": SEED_SOURCE_NAME,
                }
            )

        for index in rng.sample(range(len(BILL_TOPICS)), k=3):
            topic, title, summary = BILL_TOPICS[index]
            bills.append(
                {
                    "id": _id("bill", candidate["id"], str(index)),
                    "candidateId": candidate["id"],
                    "title": title,
                    "topic": topic,
                    "status": rng.choice(BILL_STATUSES),
                    "date": today - timedelta(days=rng.randint(40, 400)),
                    "isLeadSponsor": candidate["listPosition"] <= 3 and rng.random() < 0.6,
                    "summary": summary,
                    "sourceUrl": SEED_SOURCE_URL,
                    "sourceName": SEED_SOURCE_NAME,
                }
            )

        # Statements are paraphrases of the party's own published planks,
        # attributed to a fictional person — never a real politician.
        for axis, position_value in list(party_positions.items())[:3]:
            quotes.append(
                {
                    "id": _id("quote", candidate["id"], axis),
                    "candidateId": candidate["id"],
                    "text": (
                        f"עמדתי בנושא {axis} עולה בקנה אחד עם מצע המפלגה "
                        f"({'תמיכה' if position_value >= 0 else 'התנגדות'} מובהקת)."
                    ),
                    "context": "התבטאות לדוגמה שנוצרה לצורך הדגמת הפיצ'ר",
                    "topic": axis,
                    "date": today - timedelta(days=rng.randint(5, 200)),
                    "sourceUrl": SEED_SOURCE_URL,
                    "sourceName": SEED_SOURCE_NAME,
                }
            )

        for index in rng.sample(range(len(CONNECTION_KINDS)), k=2):
            kind, target, description = CONNECTION_KINDS[index]
            connections.append(
                {
                    "id": _id("conn", candidate["id"], str(index)),
                    "candidateId": candidate["id"],
                    "kind": kind,
                    "targetName": target,
                    "description": description,
                    "sourceUrl": SEED_SOURCE_URL,
                    "sourceName": SEED_SOURCE_NAME,
                }
            )

    return votes, bills, quotes, connections


# ---------------------------------------------------------------------------
# Synthetic poll series
# ---------------------------------------------------------------------------


def build_polls(anchors_config: dict, rng: random.Random) -> list[RawPoll]:
    """Interpolate a daily trajectory and sample polls off it.

    Each pollster publishes every few days, sees the true trajectory through a
    constant house effect, and adds sampling noise scaled to its sample size —
    which is exactly the structure the moving average is designed to see
    through, so the aggregator has something real to do.
    """
    anchors = [
        (date.fromisoformat(a["date"]), a["seats"]) for a in anchors_config["anchors"]
    ]
    anchors.sort(key=lambda pair: pair[0])
    start = date.fromisoformat(anchors_config["startDate"])
    end = date.fromisoformat(anchors_config["endDate"])
    party_ids = sorted(anchors[0][1])

    def true_seats(day: date) -> dict[str, float]:
        if day <= anchors[0][0]:
            return dict(anchors[0][1])
        if day >= anchors[-1][0]:
            return dict(anchors[-1][1])
        for (d0, s0), (d1, s1) in zip(anchors, anchors[1:]):
            if d0 <= day <= d1:
                span = (d1 - d0).days or 1
                t = (day - d0).days / span
                return {p: s0[p] + (s1[p] - s0[p]) * t for p in party_ids}
        return dict(anchors[-1][1])

    polls: list[RawPoll] = []
    for pollster in anchors_config["pollsters"]:
        # Stagger the pollsters so they do not all publish on the same days.
        offset = rng.randint(0, 4)
        cadence = rng.randint(4, 8)
        day = start + timedelta(days=offset)
        while day <= end:
            truth = true_seats(day)
            house = pollster.get("houseEffect", {})
            # Larger samples are less noisy, following the same sqrt(n) logic
            # the aggregator uses to weight them.
            noise_scale = 12.0 / (pollster["sampleSize"] ** 0.5)
            raw = {}
            for party_id in party_ids:
                value = truth[party_id] + house.get(party_id, 0.0)
                value += rng.gauss(0, noise_scale)
                raw[party_id] = max(0.0, value)

            # Pollsters publish whole seats summing to 120.
            total = sum(raw.values())
            scaled = {p: v * 120.0 / total for p, v in raw.items()}
            rounded = {p: float(round(v)) for p, v in scaled.items()}
            drift = 120 - int(sum(rounded.values()))
            if drift:
                # Push the rounding remainder onto the largest party.
                biggest = max(rounded, key=lambda p: rounded[p])
                rounded[biggest] += drift

            polls.append(
                RawPoll(
                    pollster=pollster["name"],
                    sponsor=pollster["sponsor"],
                    field_date_start=day - timedelta(days=2),
                    field_date_end=day,
                    sample_size=pollster["sampleSize"],
                    margin_of_error=pollster["marginOfError"],
                    source_url=SEED_SOURCE_URL,
                    source_name=SEED_SOURCE_NAME,
                    seats=rounded,
                    provenance="seed",
                )
            )
            day += timedelta(days=cadence)

    return polls


def build_events(anchors_config: dict) -> list[dict]:
    """A few illustrative campaign events, clearly labelled as demo data."""
    return [
        {
            "id": _id("event", "seed", "1"),
            "kind": "split",
            "date": date(2026, 4, 12),
            "headline": "פיצול לדוגמה ברשימה (נתוני הדגמה)",
            "description": "אירוע בדיוני להדגמת זיהוי אירועים בסקירה היומית.",
            "sourceUrl": SEED_SOURCE_URL,
            "sourceName": SEED_SOURCE_NAME,
            "provenance": "seed",
        },
        {
            "id": _id("event", "seed", "2"),
            "kind": "merger",
            "date": date(2026, 6, 20),
            "headline": "איחוד לדוגמה בין שתי רשימות (נתוני הדגמה)",
            "description": "אירוע בדיוני להדגמת זיהוי אירועים בסקירה היומית.",
            "sourceUrl": SEED_SOURCE_URL,
            "sourceName": SEED_SOURCE_NAME,
            "provenance": "seed",
        },
        {
            "id": _id("event", "seed", "3"),
            "kind": "coalition",
            "date": date(2026, 7, 8),
            "headline": "הכרזה על מועד הבחירות — 27 באוקטובר 2026 (נתוני הדגמה)",
            "description": "אירוע בדיוני להדגמת זיהוי אירועים בסקירה היומית.",
            "sourceUrl": SEED_SOURCE_URL,
            "sourceName": SEED_SOURCE_NAME,
            "provenance": "seed",
        },
    ]


# ---------------------------------------------------------------------------


def plan_seed(
    *,
    candidates: list[dict],
    xray: tuple[list[dict], list[dict], list[dict], list[dict]],
    polls: list,
    real_polls: int,
    parties_with_real_candidates: set[str],
) -> dict:
    """Which demo rows to load, given what real data the warehouse already holds.

    Demo data fills gaps; it never sits beside real data. Synthetic polls are
    left out once any real poll exists, because the site does not filter by
    provenance and would average the two together (and show the demo banner
    again). Fictional candidates are left out for a party that has its
    official list, which would also collide with it on list position.
    """
    kept = [c for c in candidates if c["partyId"] not in parties_with_real_candidates]
    kept_ids = {c["id"] for c in kept}
    votes, bills, quotes, connections = (
        [row for row in rows if row["candidateId"] in kept_ids] for rows in xray
    )
    return {
        "candidates": kept,
        "votes": votes,
        "bills": bills,
        "quotes": quotes,
        "connections": connections,
        "polls": [] if real_polls else polls,
        "skipped_candidate_parties": {
            c["partyId"] for c in candidates if c["partyId"] in parties_with_real_candidates
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="טעינת נתוני הדגמה למסד הנתונים")
    parser.add_argument("--dry-run", action="store_true", help="הצג בלבד, ללא כתיבה")
    # Defaults to zero: the official candidate lists are filed with the
    # Central Elections Committee shortly before the election, and until they
    # are public the site shows no candidates at all rather than invented ones.
    # Pass a number to regenerate the fictional placeholders for development.
    parser.add_argument(
        "--candidates-per-party", type=int, default=0, help="כמה מועמדים לייצר לכל מפלגה"
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    rng = random.Random(RANDOM_SEED)
    parties_config = _load("parties.json")
    quiz_config = _load("quiz.json")
    anchors_config = _load("poll_anchors.json")
    surplus_config = _load("surplus_agreements.json")

    parties = parties_config["parties"]
    for party in parties:
        party["provenance"] = "seed"
    surplus_rows = loader.surplus_agreement_rows(
        surplus_config["agreements"], {p["id"] for p in parties}
    )

    planks_by_party = {
        party["id"]: {plank["axis"]: float(plank["position"]) for plank in party["planks"]}
        for party in parties
    }

    candidates = build_candidates(parties, rng, args.candidates_per_party)
    votes, bills, quotes, connections = build_xray(
        candidates, planks_by_party, rng, date(2026, 8, 31)
    )
    raw_polls = build_polls(anchors_config, rng)
    events = build_events(anchors_config)

    # The synthetic polls go through the real cleaning step, so a bug in the
    # generator surfaces as a rejection rather than as bad data in the charts.
    cleaned = clean_polls(raw_polls)
    log.info(
        "סקרים: %d נוצרו, %d עברו ניקוי, %d נדחו",
        len(raw_polls),
        len(cleaned.polls),
        len(cleaned.rejected),
    )
    for rejection in cleaned.rejected[:5]:
        log.warning("  נדחה — %s: %s", rejection.record, rejection.reason)
    if cleaned.unmapped_parties:
        log.warning("  מפלגות לא ממופות: %s", ", ".join(sorted(cleaned.unmapped_parties)))

    if args.dry_run:
        log.info(
            "dry-run: %d מפלגות, %d מועמדים, %d הצבעות, %d הצעות חוק, "
            "%d ציטוטים, %d קשרים, %d סקרים, %d אירועים",
            len(parties), len(candidates), len(votes), len(bills),
            len(quotes), len(connections), len(cleaned.polls), len(events),
        )
        return 0

    with get_engine().begin() as connection:
        # The seed is a snapshot, not an accumulation: existing demo rows are
        # removed first so that editing the generator replaces the demo dataset
        # instead of layering a second one on top of it. Rows loaded by the real
        # ETL carry provenance="etl" and are left untouched, and demo data is
        # only loaded where there is no real data to stand in for.
        real_polls, parties_with_real_candidates = loader.real_data(connection)
        plan = plan_seed(
            candidates=candidates,
            xray=(votes, bills, quotes, connections),
            polls=cleaned.polls,
            real_polls=real_polls,
            parties_with_real_candidates=parties_with_real_candidates,
        )
        loader.clear_seed_data(connection, keep_party_ids={p["id"] for p in parties})

        loader.load_parties(connection, parties)
        loader.load_candidates(connection, plan["candidates"])
        loader.load_votes(connection, plan["votes"])
        loader.load_bills(connection, plan["bills"])
        loader.load_quotes(connection, plan["quotes"])
        loader.load_connections(connection, plan["connections"])
        loader.load_polls(connection, plan["polls"])
        loader.load_events(connection, events)
        loader.load_quiz(connection, quiz_config["questions"])
        loader.load_surplus_agreements(connection, surplus_rows)

    if real_polls:
        log.info("סקרי ההדגמה לא נטענו: במסד יש %d סקרים אמיתיים", real_polls)
    if plan["skipped_candidate_parties"]:
        log.info(
            "מועמדים בדיוניים לא נטענו למפלגות עם רשימה רשמית: %s",
            ", ".join(sorted(plan["skipped_candidate_parties"])),
        )
    log.info(
        "נטענו %d מפלגות, %d מועמדים, %d סקרים, %d שאלות שאלון",
        len(parties), len(plan["candidates"]), len(plan["polls"]), len(quiz_config["questions"]),
    )
    log.info("כעת הרץ: python -m pipeline.ml.build_vectors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
