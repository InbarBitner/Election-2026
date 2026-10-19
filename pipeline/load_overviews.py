"""Fill each official candidate's overview from their Hebrew Wikipedia article.

    python3 -m pipeline.load_overviews --dry-run
    python3 -m pipeline.load_overviews --party likud
    python3 -m pipeline.load_overviews            # every candidate still without one
    python3 -m pipeline.load_overviews --refresh  # look everyone up again

Each lookup is one to three page requests at the shared client's pace, so the
whole list takes a while; by default a candidate who already has an overview is
skipped, which also lets an interrupted run pick up where it stopped. How an
article is matched to a candidate, and why a namesake is rejected, is in
pipeline/etl/extract/candidate_bios.py. Only official candidates (provenance
"etl") are looked up.
"""

from __future__ import annotations

import argparse
import logging
import re

from sqlalchemy import select, update

from .db import get_engine, table
from .etl.extract import candidate_bios
from .etl.extract.http import FetchError

log = logging.getLogger(__name__)


def nominated_by(bio: str) -> str:
    """The component party inside a joint list, from the bio load_candidates writes."""
    match = re.match(r"מטעם מפלגת (.+)", bio or "")
    return match.group(1).strip() if match else ""


def main() -> int:
    parser = argparse.ArgumentParser(description="סקירה כללית למועמדים מוויקיפדיה")
    parser.add_argument("--party", help="מזהה מפלגה אחת בלבד")
    parser.add_argument("--refresh", action="store_true", help="לחפש מחדש גם למי שכבר יש סקירה")
    parser.add_argument("--dry-run", action="store_true", help="הצג בלבד, ללא כתיבה")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    candidates = table("Candidate")
    query = select(
        candidates.c.id, candidates.c.name, candidates.c.partyId, candidates.c.listPosition,
        candidates.c.bio, candidates.c.knessetMemberId, candidates.c.overview,
    ).where(candidates.c.provenance == "etl").order_by(candidates.c.partyId, candidates.c.listPosition)
    if args.party:
        query = query.where(candidates.c.partyId == args.party)

    engine = get_engine()
    with engine.connect() as connection:
        rows = [r for r in connection.execute(query) if args.refresh or not r.overview]
    log.info("מועמדים לבדיקה: %d", len(rows))

    found = missing = failed = 0
    for row in rows:
        try:
            overview = candidate_bios.find_overview(
                row.name, row.partyId, nominated_by(row.bio), row.knessetMemberId is not None
            )
        except FetchError as exc:
            failed += 1
            log.warning("  %s #%d %s — שגיאה: %s", row.partyId, row.listPosition, row.name, exc)
            continue
        if overview is None:
            missing += 1
            continue
        found += 1
        log.info("  %s #%d %s ← %s", row.partyId, row.listPosition, row.name, overview.text[:70])
        if not args.dry_run:
            # One transaction per candidate, so an interrupted run keeps what it found.
            with engine.begin() as connection:
                connection.execute(
                    update(candidates)
                    .where(candidates.c.id == row.id)
                    .values(overview=overview.text, overviewSourceUrl=overview.url)
                )

    log.info("נמצאו %d, ללא ערך מתאים %d, שגיאות %d%s", found, missing, failed,
             " (dry-run — לא נכתב דבר)" if args.dry_run else "")
    return 1 if failed and not found else 0


if __name__ == "__main__":
    raise SystemExit(main())
