"""Load the official candidate lists into the warehouse.

    python3 -m pipeline.load_candidates --party likud --dry-run
    python3 -m pipeline.load_candidates --party likud
    python3 -m pipeline.load_candidates            # every list in the config

Lists come from data/sources/candidate_lists.json. A list that fails to parse
cleanly (a missing position, an empty name) is not loaded at all: a list
with one wrong or missing entry is worse than no list. Loading brings that
party's candidates in line with the list, updating them in place so the
Knesset records attached to them survive, and leaves every other party alone.

Only the first MAX_POSITION places are loaded. No list has come near winning
35 seats in recent elections, so places further down are not realistic and
only lengthen the page. The whole list is still parsed and validated first,
so a broken PDF is caught even when the damage is below the cut.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from sqlalchemy import delete, select

from .db import get_engine, table
from .etl.extract import candidate_lists
from .etl.load import loader

log = logging.getLogger(__name__)

SOURCES = Path(__file__).resolve().parent.parent / "data" / "sources"
CONFIG = SOURCES / "candidate_lists.json"
NAMES = SOURCES / "candidate_names.json"
# Hand-reviewed: which candidates are serving or former MKs. Without a link the
# Knesset ETL loads nothing for a candidate, which is the safe default.
LINKS = SOURCES / "candidate_knesset_links.json"
MAX_POSITION = 35


def display_name(official: str, overrides: dict[str, str]) -> tuple[str, bool]:
    """The name given-first, and whether that order is actually known.

    The committee prints family name first. Two words swap safely; a longer
    name is reordered only from an entry in candidate_names.json, because
    nothing in the text says where a compound family name ends. Without one
    the committee's order is kept and reported, never guessed.
    """
    if official in overrides:
        return overrides[official], True
    words = official.split()
    if len(words) == 2:
        return f"{words[1]} {words[0]}", True
    return official, len(words) < 2


def _rows(
    party_id: str,
    entries,
    source_url: str,
    source_name: str,
    overrides: dict[str, str],
    links: dict[str, dict],
) -> list[dict]:
    return [
        {
            "id": f"cand_{party_id}_{entry.position}",
            "partyId": party_id,
            "name": display_name(entry.name, overrides)[0],
            "listPosition": entry.position,
            "bio": f"מטעם מפלגת {entry.nominated_by}" if entry.nominated_by else "",
            "knessetMemberId": links.get(entry.name, {}).get("knessetMemberId"),
            "sourceUrl": source_url,
            "sourceName": source_name,
            "provenance": "etl",
        }
        for entry in entries
    ]


def _sync_candidates(connection, party_id: str, rows: list[dict]) -> int:
    """Make the party's stored candidates match `rows`, returning how many went.

    Candidates are updated in place, not deleted and reinserted. Bills and
    votes cascade from Candidate, so a delete-and-reload wiped every Knesset
    record the ETL had attached, and the X-ray stayed empty until the next ETL
    run. Only a candidate who is no longer on the list is deleted.

    A candidate whose Knesset link changed loses the records fetched under the
    old link. Those belong to someone else, and the next ETL run fetches the
    right ones.
    """
    candidates = table("Candidate")
    existing = {
        row.id: row.knessetMemberId
        for row in connection.execute(
            select(candidates.c.id, candidates.c.knessetMemberId).where(
                candidates.c.partyId == party_id
            )
        )
    }
    wanted = {row["id"] for row in rows}

    relinked = [
        row["id"]
        for row in rows
        if row["id"] in existing and existing[row["id"]] != row["knessetMemberId"]
    ]
    for table_name in ("Bill", "VoteRecord"):
        records = table(table_name)
        if relinked:
            connection.execute(delete(records).where(records.c.candidateId.in_(relinked)))

    gone = sorted(set(existing) - wanted)
    if gone:
        connection.execute(delete(candidates).where(candidates.c.id.in_(gone)))
    loader.load_candidates(connection, rows)
    return len(gone)


def main() -> int:
    parser = argparse.ArgumentParser(description="טעינת רשימות המועמדים הרשמיות")
    parser.add_argument("--party", action="append", help="מזהה מפלגה; ברירת מחדל: כל הרשימות בקונפיגורציה")
    parser.add_argument("--dry-run", action="store_true", help="הצג בלבד, ללא כתיבה")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    overrides = json.loads(NAMES.read_text(encoding="utf-8"))["names"]
    links = json.loads(LINKS.read_text(encoding="utf-8"))["links"]
    wanted = args.party or list(config["lists"])
    failed = 0

    for party_id in wanted:
        source = config["lists"].get(party_id)
        if source is None:
            log.error("%s: אין רשימה בקונפיגורציה", party_id)
            failed += 1
            continue

        result = candidate_lists.extract(source)
        entries = result["entries"]
        if result["error"]:
            log.error("%s: הרשימה לא נטענה — %s", party_id, result["error"])
            failed += 1
            continue

        total = len(entries)
        entries = [e for e in entries if e.position <= MAX_POSITION]
        unattributed = [
            e.position for e in entries if source.get("components") and e.nominated_by is None
        ]
        log.info("%s: %d מועמדים ברשימה, נטענים %d הראשונים", party_id, total, len(entries))
        if unattributed:
            log.info("  ללא שיוך למפלגה מגישה (מעבר עמוד בקובץ): %s", unattributed)
        unordered = [e for e in entries if not display_name(e.name, overrides)[1]]
        if unordered:
            log.warning(
                "  %d שמות מוצגים בסדר של ועדת הבחירות (שם משפחה קודם) — הוסיפו אותם ל-%s:",
                len(unordered),
                NAMES.name,
            )
            for entry in unordered:
                log.warning("    %3d. %s", entry.position, entry.name)
        if args.dry_run:
            for entry in entries[:10]:
                log.info(
                    "  %3d. %s %s",
                    entry.position,
                    display_name(entry.name, overrides)[0],
                    f"({entry.nominated_by})" if entry.nominated_by else "",
                )
            continue

        party_links = links.get(party_id, {})
        stale = sorted(set(party_links) - {e.name for e in entries})
        if stale:
            # A link whose name is no longer on the list (a respelt name, a
            # withdrawn candidate) would otherwise be dropped without a word.
            log.warning("  קישורים לכנסת שלא נמצא להם מועמד: %s", stale)
        rows = _rows(party_id, entries, source["url"], config["sourceName"], overrides, party_links)
        log.info("  מקושרים לנתוני הכנסת: %d", sum(1 for r in rows if r["knessetMemberId"]))
        with get_engine().begin() as connection:
            removed = _sync_candidates(connection, party_id, rows)
        log.info("  נטענו %d מועמדים", len(rows))
        if removed:
            log.info("  הוסרו %d מועמדים שאינם עוד ברשימה", removed)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
