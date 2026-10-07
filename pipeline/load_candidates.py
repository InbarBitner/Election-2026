"""Load the official candidate lists into the warehouse.

    python3 -m pipeline.load_candidates --party likud --dry-run
    python3 -m pipeline.load_candidates --party likud
    python3 -m pipeline.load_candidates            # every list in the config

Lists come from data/sources/candidate_lists.json. A list that fails to parse
cleanly (a missing position, an empty name) is not loaded at all: a list
with one wrong or missing entry is worse than no list. Loading replaces that
party's previously loaded candidates and leaves every other party alone.

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

from sqlalchemy import delete

from .db import get_engine, table
from .etl.extract import candidate_lists
from .etl.load import loader

log = logging.getLogger(__name__)

SOURCES = Path(__file__).resolve().parent.parent / "data" / "sources"
CONFIG = SOURCES / "candidate_lists.json"
NAMES = SOURCES / "candidate_names.json"
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


def _rows(party_id: str, entries, source_url: str, source_name: str, overrides: dict[str, str]) -> list[dict]:
    return [
        {
            "id": f"cand_{party_id}_{entry.position}",
            "partyId": party_id,
            "name": display_name(entry.name, overrides)[0],
            "listPosition": entry.position,
            "bio": f"מטעם מפלגת {entry.nominated_by}" if entry.nominated_by else "",
            "knessetMemberId": None,
            "sourceUrl": source_url,
            "sourceName": source_name,
            "provenance": "etl",
        }
        for entry in entries
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="טעינת רשימות המועמדים הרשמיות")
    parser.add_argument("--party", action="append", help="מזהה מפלגה; ברירת מחדל: כל הרשימות בקונפיגורציה")
    parser.add_argument("--dry-run", action="store_true", help="הצג בלבד, ללא כתיבה")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    overrides = json.loads(NAMES.read_text(encoding="utf-8"))["names"]
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

        rows = _rows(party_id, entries, source["url"], config["sourceName"], overrides)
        candidates = table("Candidate")
        with get_engine().begin() as connection:
            # Replace this party's list wholesale, so a position that moved or
            # was dropped does not linger from an earlier load.
            connection.execute(delete(candidates).where(candidates.c.partyId == party_id))
            loader.load_candidates(connection, rows)
        log.info("  נטענו %d מועמדים", len(rows))

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
