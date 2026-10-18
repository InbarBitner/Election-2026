"""Loading cleaned records into the warehouse.

Every write in the project goes through this module, which is what makes the
`require_source` rule enforceable: there is no other path into the sourced
tables. All loads are idempotent — running the same day twice produces the same
rows, not duplicates — because ids are derived from natural keys upstream.
"""

from __future__ import annotations

import hashlib
import json

from sqlalchemy import delete, func, select

from ...db import delete_where, now_ms, table, to_db_datetime, upsert
from ..transform.normalize import CleanPoll, require_source


def _row_id(prefix: str, *parts: str) -> str:
    key = "|".join(parts)
    return f"{prefix}_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def load_parties(connection, parties: list[dict]) -> int:
    """Load parties and their platform planks.

    `parties` are dicts in the shape of data/seed/parties.json.
    """
    party_rows = []
    plank_rows = []
    for party in parties:
        require_source(party, f"מפלגה {party.get('name')}")
        party_rows.append(
            {
                "id": party["id"],
                "slug": party["slug"],
                "name": party["name"],
                "shortName": party["shortName"],
                "leader": party["leader"],
                "bloc": party["bloc"],
                "color": party["color"],
                "colorDark": party.get("colorDark", party["color"]),
                "isActive": party.get("isActive", True),
                "platformText": party.get("platformText", ""),
                "sourceUrl": party["sourceUrl"],
                "sourceName": party["sourceName"],
                "provenance": party.get("provenance", "seed"),
                "updatedAt": now_ms(),
            }
        )
        for plank in party.get("planks", []):
            plank_rows.append(
                {
                    "id": _row_id("plank", party["id"], plank["axis"]),
                    "partyId": party["id"],
                    "axis": plank["axis"],
                    "topic": plank["topic"],
                    "text": plank["text"],
                    "position": float(plank["position"]),
                    # A plank inherits the party's platform source.
                    "sourceUrl": plank.get("sourceUrl", party["sourceUrl"]),
                    "sourceName": plank.get("sourceName", party["sourceName"]),
                }
            )

    written = upsert(connection, "Party", party_rows, key=["id"])
    upsert(connection, "PlatformPlank", plank_rows, key=["id"])
    return written


def load_candidates(connection, candidates: list[dict]) -> int:
    rows = []
    for candidate in candidates:
        require_source(candidate, f"מועמד {candidate.get('name')}")
        rows.append(
            {
                "id": candidate["id"],
                "partyId": candidate["partyId"],
                "name": candidate["name"],
                "listPosition": int(candidate["listPosition"]),
                "bio": candidate.get("bio", ""),
                "knessetMemberId": candidate.get("knessetMemberId"),
                "sourceUrl": candidate["sourceUrl"],
                "sourceName": candidate["sourceName"],
                "provenance": candidate.get("provenance", "seed"),
                "updatedAt": now_ms(),
            }
        )
    return upsert(connection, "Candidate", rows, key=["id"])


def load_polls(connection, polls: list[CleanPoll]) -> int:
    poll_rows = []
    result_rows = []
    for poll in polls:
        poll_rows.append(
            {
                "id": poll.id,
                "pollster": poll.pollster,
                "sponsor": poll.sponsor,
                "fieldDateStart": to_db_datetime(poll.field_date_start),
                "fieldDateEnd": to_db_datetime(poll.field_date_end),
                "sampleSize": poll.sample_size,
                "marginOfError": poll.margin_of_error,
                "sourceUrl": poll.source_url,
                "sourceName": poll.source_name,
                "provenance": poll.provenance,
                "createdAt": now_ms(),
            }
        )
        for party_id, seats in poll.seats.items():
            result_rows.append(
                {
                    "id": _row_id("pr", poll.id, party_id),
                    "pollId": poll.id,
                    "partyId": party_id,
                    "seats": float(seats),
                }
            )

    written = upsert(connection, "Poll", poll_rows, key=["id"])
    upsert(connection, "PollResult", result_rows, key=["id"])
    return written


def _load_sourced(connection, table_name: str, rows: list[dict], label: str) -> int:
    for row in rows:
        require_source(row, label)
    return upsert(connection, table_name, rows, key=["id"])


def load_votes(connection, votes: list[dict]) -> int:
    rows = [
        {
            "id": v["id"],
            "candidateId": v["candidateId"],
            "billTitle": v["billTitle"],
            "topic": v["topic"],
            "date": to_db_datetime(v["date"]),
            "position": v["position"],
            "againstFaction": bool(v.get("againstFaction", False)),
            "sourceUrl": v["sourceUrl"],
            "sourceName": v["sourceName"],
        }
        for v in votes
    ]
    return _load_sourced(connection, "VoteRecord", rows, "הצבעה")


def load_bills(connection, bills: list[dict]) -> int:
    rows = [
        {
            "id": b["id"],
            "candidateId": b["candidateId"],
            "title": b["title"],
            "topic": b["topic"],
            "status": b["status"],
            "date": to_db_datetime(b["date"]) if b.get("date") else None,
            "knessetNum": b.get("knessetNum"),
            "year": b.get("year"),
            "isLeadSponsor": bool(b.get("isLeadSponsor", False)),
            "summary": b.get("summary", ""),
            "sourceUrl": b["sourceUrl"],
            "sourceName": b["sourceName"],
        }
        for b in bills
    ]
    return _load_sourced(connection, "Bill", rows, "הצעת חוק")


def load_quotes(connection, quotes: list[dict]) -> int:
    rows = [
        {
            "id": q["id"],
            "candidateId": q["candidateId"],
            "text": q["text"],
            "context": q.get("context", ""),
            "topic": q["topic"],
            "date": to_db_datetime(q["date"]),
            "sourceUrl": q["sourceUrl"],
            "sourceName": q["sourceName"],
        }
        for q in quotes
    ]
    return _load_sourced(connection, "Quote", rows, "ציטוט")


def load_connections(connection, connections: list[dict]) -> int:
    rows = [
        {
            "id": c["id"],
            "candidateId": c["candidateId"],
            "kind": c["kind"],
            "targetName": c["targetName"],
            "description": c.get("description", ""),
            "sourceUrl": c["sourceUrl"],
            "sourceName": c["sourceName"],
        }
        for c in connections
    ]
    return _load_sourced(connection, "Connection", rows, "קשר פוליטי")


def load_events(connection, events: list[dict]) -> int:
    rows = [
        {
            "id": e["id"],
            "kind": e["kind"],
            "date": to_db_datetime(e["date"]),
            "headline": e["headline"],
            "description": e.get("description", ""),
            "sourceUrl": e["sourceUrl"],
            "sourceName": e["sourceName"],
            "provenance": e.get("provenance", "etl"),
        }
        for e in events
    ]
    return _load_sourced(connection, "Event", rows, "אירוע")


def load_quiz(connection, questions: list[dict]) -> int:
    rows = [
        {
            "id": q["id"],
            "order": int(q["order"]),
            "axis": q["axis"],
            "text": q["text"],
            "shortLabel": q["shortLabel"],
            "weight": float(q.get("weight", 1.0)),
            "polarity": int(q.get("polarity", 1)),
        }
        for q in questions
    ]
    # The quiz is a fixed questionnaire, not accumulated data: replacing it
    # wholesale keeps removed questions from lingering.
    connection.execute(table("QuizQuestion").delete())
    return upsert(connection, "QuizQuestion", rows, key=["id"])


def surplus_agreement_rows(agreements: list[dict], party_ids: set[str]) -> list[dict]:
    """Validate the agreements and shape them as SurplusAgreement rows.

    A list can sign with exactly one other list, so a party appearing twice, an
    agreement with itself, or an unknown party id is a data error and stops the
    load rather than being skipped.
    """
    rows, seen = [], set()
    for agreement in agreements:
        require_source(agreement, f"הסכם עודפים {agreement.get('parties')}")
        a, b = sorted(agreement["parties"])
        if a == b:
            raise ValueError(f"הסכם עודפים של מפלגה עם עצמה: {a}")
        for party_id in (a, b):
            if party_id not in party_ids:
                raise ValueError(f"הסכם עודפים עם מפלגה לא מוכרת: {party_id}")
            if party_id in seen:
                raise ValueError(f"מפלגה בשני הסכמי עודפים: {party_id}")
            seen.add(party_id)
        signed = agreement.get("signedOn")
        rows.append(
            {
                "id": f"{a}+{b}",
                "partyAId": a,
                "partyBId": b,
                "signedOn": to_db_datetime(signed) if signed else None,
                "sourceUrl": agreement["sourceUrl"],
                "sourceName": agreement["sourceName"],
            }
        )
    return rows


def load_surplus_agreements(connection, rows: list[dict]) -> int:
    # The file is the whole picture: replacing the table keeps a cancelled
    # agreement from lingering.
    connection.execute(table("SurplusAgreement").delete())
    return upsert(connection, "SurplusAgreement", rows, key=["id"])


def load_party_vectors(
    connection,
    vectors: dict[str, dict[str, float]],
    derived_from: str,
    evidence: dict[str, dict[str, dict]] | None = None,
) -> int:
    evidence = evidence or {}
    rows = [
        {
            "partyId": party_id,
            "vectorJson": json.dumps(vector, ensure_ascii=False, sort_keys=True),
            "evidenceJson": json.dumps(evidence.get(party_id, {}), ensure_ascii=False, sort_keys=True),
            "derivedFrom": derived_from,
            "updatedAt": now_ms(),
        }
        for party_id, vector in vectors.items()
    ]
    return upsert(connection, "PartyVector", rows, key=["partyId"])


def save_brief(connection, brief: dict) -> None:
    upsert(
        connection,
        "DailyBrief",
        [
            {
                "date": brief["date"],
                "headline": brief["headline"],
                "bodyMarkdown": brief["bodyMarkdown"],
                "generator": brief["generator"],
                "factsJson": json.dumps(brief["facts"], ensure_ascii=False),
                "createdAt": now_ms(),
            }
        ],
        key=["date"],
    )


def start_run(connection, run_id: str) -> None:
    upsert(
        connection,
        "EtlRun",
        [
            {
                "id": run_id,
                "startedAt": now_ms(),
                "finishedAt": None,
                "status": "running",
                "statsJson": "{}",
            }
        ],
        key=["id"],
    )


def finish_run(connection, run_id: str, status: str, stats: dict) -> None:
    # startedAt is deliberately not written here, so the run keeps its real
    # start time and the duration stays meaningful.
    connection.execute(
        table("EtlRun")
        .update()
        .where(table("EtlRun").c.id == run_id)
        .values(
            finishedAt=now_ms(),
            status=status,
            statsJson=json.dumps(stats, ensure_ascii=False, default=str),
        )
    )


def clear_seed_data(connection, keep_party_ids: set[str]) -> None:
    """Remove rows that came from the seed, leaving real ETL data untouched.

    Parties are the exception: they are seed rows, but real data hangs off
    them, and PollResult and Candidate cascade from Party. Deleting them all
    and reloading took every real poll result and every official candidate
    with them. So a party still in the seed file is kept, and the reload
    updates it in place. Only a party that has left the file is deleted,
    along with whatever belonged to it.
    """
    for table_name in ("Poll", "Candidate", "Event"):
        delete_where(connection, table_name, provenance="seed")
    parties = table("Party")
    connection.execute(
        delete(parties).where(
            parties.c.provenance == "seed", parties.c.id.notin_(sorted(keep_party_ids))
        )
    )


def real_data(connection) -> tuple[int, set[str]]:
    """How many real (ETL) polls exist, and which parties have real candidates.

    The seed reads this so it fills only what is genuinely empty, and never
    lays demo data over real data.
    """
    polls = table("Poll")
    real_polls = connection.execute(
        select(func.count()).select_from(polls).where(polls.c.provenance == "etl")
    ).scalar_one()
    candidates = table("Candidate")
    parties = connection.execute(
        select(candidates.c.partyId).where(candidates.c.provenance == "etl").distinct()
    )
    return int(real_polls), {row.partyId for row in parties}


def delete_seed_polls(connection) -> int:
    """Drop the synthetic polls, returning how many went.

    Called once real polls have loaded. Only the polls: the seeded parties are
    genuine public facts and stay, and the seeded quiz has no real counterpart
    to replace it.
    """
    polls = table("Poll")
    existing = connection.execute(
        select(func.count()).select_from(polls).where(polls.c.provenance == "seed")
    ).scalar_one()
    if existing:
        delete_where(connection, "Poll", provenance="seed")
    return int(existing)
