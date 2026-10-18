"""Load the parties' quiz positions into PartyVector.

    python3 -m pipeline.ml.build_vectors [--dry-run]

The positions come from data/positions/party_positions.json, built from the
hand labels by `python3 -m pipeline.ml.positions`. Each vector holds one value
per quiz question the party is covered on (-1..1, relative to the statement);
the evidence alongside it is what the quiz result cites. The matching itself
lives in web/lib/cosine.ts.
"""

from __future__ import annotations

import argparse
import json
import logging

from sqlalchemy import select

from ..db import get_engine, table
from ..etl.load.loader import load_party_vectors
from .positions import OUT as POSITIONS_FILE

log = logging.getLogger(__name__)

EVIDENCE_FIELDS = ("kind", "text", "url", "status", "speaker", "date")


def build(positions: dict[str, dict[str, dict]], party_ids: dict[str, str]):
    """Vectors and evidence keyed by Party.id, for every active party.

    `party_ids` maps slug → id. A party with no positions still gets an empty
    vector, so it is listed (at 50%, "no information") rather than missing.
    """
    vectors, evidence = {}, {}
    for slug, party_id in party_ids.items():
        stated = positions.get(slug, {})
        vectors[party_id] = {qid: p["value"] for qid, p in stated.items()}
        evidence[party_id] = {
            qid: {k: p[k] for k in EVIDENCE_FIELDS if p.get(k) is not None}
            for qid, p in stated.items()
        }
    return vectors, evidence


def main() -> int:
    parser = argparse.ArgumentParser(description="טעינת וקטורי העמדות של המפלגות")
    parser.add_argument("--dry-run", action="store_true", help="הצג בלבד, ללא כתיבה")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    positions = json.loads(POSITIONS_FILE.read_text(encoding="utf-8"))["parties"]
    parties = table("Party")
    engine = get_engine()
    with engine.begin() as connection:
        party_ids = {
            row.slug: row.id
            for row in connection.execute(
                select(parties.c.slug, parties.c.id).where(parties.c.isActive == True)  # noqa: E712
            )
        }
        if not party_ids:
            log.error("אין מפלגות במסד הנתונים. הרץ קודם python -m pipeline.seed")
            return 1
        unknown = sorted(set(positions) - set(party_ids))
        if unknown:
            log.warning("עמדות למפלגות שאינן פעילות במסד: %s", unknown)

        vectors, evidence = build(positions, party_ids)
        for slug, party_id in sorted(party_ids.items()):
            log.info("  %-20s %2d שאלות", slug, len(vectors[party_id]))

        if args.dry_run:
            log.info("dry-run — לא נכתב דבר")
            return 0
        load_party_vectors(connection, vectors, "labels", evidence)
    log.info("נשמרו %d וקטורים", len(vectors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
