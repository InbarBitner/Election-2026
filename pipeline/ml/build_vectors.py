"""Read platform data from the warehouse, build party vectors, write them back."""

from __future__ import annotations

import argparse
import logging

from sqlalchemy import select

from ..db import get_engine, table
from ..etl.load.loader import load_party_vectors
from .vectorize import build_vectors

log = logging.getLogger(__name__)


def collect_inputs(connection) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    parties = table("Party")
    planks_table = table("PlatformPlank")
    quotes = table("Quote")
    candidates = table("Candidate")

    planks: dict[str, dict[str, float]] = {}
    texts: dict[str, str] = {}

    for row in connection.execute(
        select(parties.c.id, parties.c.platformText).where(parties.c.isActive == True)  # noqa: E712
    ):
        planks[row.id] = {}
        texts[row.id] = row.platformText or ""

    for row in connection.execute(
        select(planks_table.c.partyId, planks_table.c.axis, planks_table.c.position, planks_table.c.text)
    ):
        if row.partyId not in planks:
            continue
        planks[row.partyId][row.axis] = float(row.position)
        texts[row.partyId] += " " + (row.text or "")

    # A candidate's recorded statements are part of what the party is saying.
    for row in connection.execute(
        select(candidates.c.partyId, quotes.c.text).select_from(
            quotes.join(candidates, quotes.c.candidateId == candidates.c.id)
        )
    ):
        if row.partyId in texts:
            texts[row.partyId] += " " + (row.text or "")

    return planks, texts


def main() -> int:
    parser = argparse.ArgumentParser(description="בניית וקטורי עמדות למפלגות")
    parser.add_argument("--dry-run", action="store_true", help="הצג בלבד, ללא כתיבה")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    engine = get_engine()
    with engine.begin() as connection:
        planks, texts = collect_inputs(connection)
        if not planks:
            log.error("אין מפלגות במסד הנתונים. הרץ קודם python -m pipeline.seed")
            return 1

        vectors, derived_from = build_vectors(planks, texts)
        log.info("נבנו %d וקטורים (%s)", len(vectors), derived_from)
        for party_id, vector in sorted(vectors.items()):
            log.info("  %-20s %s", party_id, {k: round(v, 2) for k, v in vector.items()})

        if args.dry_run:
            log.info("dry-run — לא נכתב דבר")
            return 0

        load_party_vectors(connection, vectors, derived_from)
    log.info("נשמרו %d וקטורים", len(vectors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
