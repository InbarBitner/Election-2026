"""ETL orchestrator: extract → transform → load, one source at a time.

Design rules:

* A failing source degrades the run to "partial"; it never aborts the others.
  A poll site changing its markup should not cost us the day's Knesset data.
* Every run is recorded in EtlRun with per-source counts and errors, so a
  silent failure is visible rather than merely absent.
* `--dry-run` performs the full extract and transform and reports what *would*
  be written, without opening a write transaction.
"""

from __future__ import annotations

import argparse
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from .db import get_engine, table
from .etl.extract import (
    knesset_api,
    manual_polls,
    news_rss,
    polls_scraper,
    wikipedia_polls,
)
from .etl.load import loader
from .etl.transform.normalize import clean_polls, poll_id

log = logging.getLogger(__name__)


def _source_stats() -> dict:
    return {"fetched": 0, "loaded": 0, "rejected": 0, "error": None, "note": None}


def silent_sources(stats: dict) -> list[str]:
    """Sources that returned nothing, raised nothing, and gave no reason.

    A source that fetches zero rows without an error is the most dangerous
    outcome there is: the run goes green and the warehouse quietly stops being
    updated. It is not the same as a source that is deliberately switched off —
    those set `note` to say so — nor as one that failed loudly. Anything left
    over is a source that believes it succeeded while returning nothing, and it
    is reported rather than trusted.
    """
    return [
        name
        for name, source in stats.items()
        if source["fetched"] == 0
        and not source["error"]
        and not source["note"]
        and not source.get("unmapped")
    ]


def _candidates_by_knesset_id(connection) -> dict[str, str]:
    candidates = table("Candidate")
    rows = connection.execute(
        select(candidates.c.id, candidates.c.knessetMemberId).where(
            candidates.c.knessetMemberId.isnot(None)
        )
    )
    return {row.knessetMemberId: row.id for row in rows}


def _isolate(name: str, extract, empty: dict) -> dict:
    """Call a source's extract, converting a broken contract into an error.

    Every extractor documents "never raises — reports errors instead", and the
    whole-pipeline design rests on it: a single source failing must not stop
    the others. But a docstring is a promise, not a mechanism. When the Knesset
    OData service answered a query with a non-JSON body, the resulting
    JSONDecodeError was not a FetchError, slipped past the extractor's own
    `except FetchError`, and ended the run — so the polls, the vectors and the
    daily brief were all lost to one unrelated source being briefly down.

    The contract is now enforced where it is relied upon rather than trusted
    at each call site. An extractor that breaks it degrades that one source,
    exactly as a reported error would, and the traceback is logged so the bug
    is still visible rather than smoothed over.
    """
    try:
        return extract()
    except Exception as exc:  # noqa: BLE001 — the point is to contain anything
        log.exception("מקור %s קרס במקום לדווח על שגיאה", name)
        return {**empty, "error": f"{type(exc).__name__}: {exc}"}


def run(dry_run: bool = False, since_days: int = 7, knesset_number: int = 25) -> int:
    run_id = f"etl_{datetime.now(timezone.utc):%Y%m%d%H%M%S}_{uuid.uuid4().hex[:6]}"
    stats: dict[str, dict] = {
        "polls": _source_stats(),
        "knesset": _source_stats(),
        "news": _source_stats(),
    }
    engine = get_engine()

    if not dry_run:
        with engine.begin() as connection:
            loader.start_run(connection, run_id)

    # --- Extract -----------------------------------------------------------
    log.info("שולף סקרים...")
    # Three sources, in ascending order of authority. Wikipedia collects the
    # published polls; configured scrapers cover anything it misses; a
    # hand-entered row is a person's correction and comes last so that
    # `clean_polls` keeps it over an automatic row with the same natural key.
    poll_notes: list[str] = []
    poll_errors: list[str] = []
    # Later sources override earlier ones for the same poll. Precedence is
    # applied here rather than left to clean_polls, which rejects a repeated
    # natural key outright and would therefore discard the correction instead
    # of the row being corrected.
    by_key: dict[str, object] = {}
    overridden = 0
    no_polls = {"polls": [], "note": None}
    for name, result in (
        (
            "ויקיפדיה",
            _isolate(
                "ויקיפדיה",
                lambda: wikipedia_polls.extract(since=date.today() - timedelta(days=180)),
                no_polls,
            ),
        ),
        ("מקורות מוגדרים", _isolate("מקורות מוגדרים", polls_scraper.extract, no_polls)),
        ("הזנה ידנית", _isolate("הזנה ידנית", manual_polls.extract, no_polls)),
    ):
        for raw in result["polls"]:
            key = poll_id(raw.pollster, raw.field_date_end, raw.sponsor)
            if key in by_key:
                overridden += 1
                log.info(
                    "  %s גובר על רשומה קודמת: %s / %s",
                    name, raw.pollster, raw.field_date_end,
                )
            by_key[key] = raw
        log.info("  %s: %d סקרים", name, len(result["polls"]))
        if result.get("note"):
            poll_notes.append(f"{name}: {result['note']}")
        if result.get("error"):
            poll_errors.append(f"{name}: {result['error']}")

    raw_polls = list(by_key.values())
    if overridden:
        poll_notes.append(f"{overridden} סקרים הוחלפו על ידי מקור בעל עדיפות גבוהה יותר")

    polls_result = {"polls": raw_polls}
    stats["polls"]["fetched"] = len(raw_polls)
    stats["polls"]["error"] = "; ".join(poll_errors) or None
    stats["polls"]["note"] = " · ".join(poll_notes) or None

    log.info("שולף נתוני כנסת...")
    knesset_result = _isolate(
        "כנסת",
        lambda: knesset_api.extract(knesset_number),
        {"members": [], "votes": [], "bills": [], "note": None},
    )
    stats["knesset"]["fetched"] = len(knesset_result["votes"]) + len(knesset_result["bills"])
    stats["knesset"]["error"] = knesset_result.get("error")
    stats["knesset"]["note"] = knesset_result.get("note")

    log.info("שולף פידי חדשות...")
    news_result = _isolate(
        "חדשות",
        lambda: news_rss.extract(since=date.today() - timedelta(days=since_days)),
        {"events": [], "note": None},
    )
    stats["news"]["fetched"] = len(news_result["events"])
    stats["news"]["error"] = news_result.get("error")
    stats["news"]["note"] = news_result.get("note")

    # --- Transform ---------------------------------------------------------
    cleaned = clean_polls(polls_result["polls"])
    stats["polls"]["rejected"] = len(cleaned.rejected)
    for rejection in cleaned.rejected:
        log.warning("סקר נדחה — %s: %s", rejection.record, rejection.reason)
    if cleaned.unmapped_parties:
        # Unmapped names are surfaced, never silently guessed at: someone has
        # to add the alias in party_mapping.ALIASES.
        log.warning(
            "שמות מפלגות שלא זוהו (הוסף ל-ALIASES): %s",
            ", ".join(sorted(cleaned.unmapped_parties)),
        )
        stats["polls"]["unmapped"] = sorted(cleaned.unmapped_parties)

    if dry_run:
        log.info("--- dry-run, לא נכתב דבר ---")
        for source, source_stats in stats.items():
            log.info("  %-8s %s", source, source_stats)
        for name in silent_sources(stats):
            log.warning(
                "  מקור %s החזיר אפס רשומות בלי שגיאה — ייתכן שהשאילתה או מבנה "
                "התשובה השתנו",
                name,
            )
        log.info("  סקרים שהיו נטענים: %d", len(cleaned.polls))
        log.info("  אירועים שהיו נטענים: %d", len(news_result["events"]))
        return 0

    # --- Load --------------------------------------------------------------
    with engine.begin() as connection:
        if cleaned.polls:
            stats["polls"]["loaded"] = loader.load_polls(connection, cleaned.polls)
            # Synthetic seed polls must not survive alongside real ones. The
            # site does not filter by provenance — it only uses it to decide
            # whether to show the demo banner — so leaving both in place would
            # average invented polls together with published ones and present
            # the result as a real figure. Removed only once real polls have
            # actually loaded, so a failed run leaves the demo data intact
            # rather than emptying the site.
            removed = loader.delete_seed_polls(connection)
            if removed:
                log.info("הוסרו %d סקרי הדגמה שהוחלפו בסקרים אמיתיים", removed)
                stats["polls"]["note"] = " · ".join(
                    filter(None, [stats["polls"]["note"], f"הוסרו {removed} סקרי הדגמה"])
                )

        # Knesset records attach to candidates already linked to a member id;
        # records for anyone else are dropped rather than creating orphans.
        by_member = _candidates_by_knesset_id(connection)
        votes = [
            {**v, "candidateId": by_member[v["knessetMemberId"]]}
            for v in knesset_result["votes"]
            if v.get("knessetMemberId") in by_member
        ]
        bills = [
            {**b, "candidateId": by_member[b["knessetMemberId"]]}
            for b in knesset_result["bills"]
            if b.get("knessetMemberId") in by_member
        ]
        if votes:
            stats["knesset"]["loaded"] += loader.load_votes(connection, votes)
        if bills:
            stats["knesset"]["loaded"] += loader.load_bills(connection, bills)
        if knesset_result["members"] and not by_member:
            stats["knesset"]["note"] = (
                f"נשלפו {len(knesset_result['members'])} ח\"כים אך אף מועמד במסד "
                "אינו מקושר ל-knessetMemberId, ולכן לא נטענו הצבעות."
            )

        if news_result["events"]:
            stats["news"]["loaded"] = loader.load_events(connection, news_result["events"])

        silent = silent_sources(stats)
        for name in silent:
            stats[name]["note"] = (
                "המקור החזיר אפס רשומות בלי שגיאה — ייתכן שהשאילתה או מבנה "
                "התשובה השתנו. יש לבדוק את המקור, לא להניח שאין נתונים."
            )

        failed = [name for name, s in stats.items() if s["error"]]
        if len(failed) == len(stats):
            status = "failed"
        elif failed or silent:
            status = "partial"
        else:
            status = "success"
        loader.finish_run(connection, run_id, status, stats)

    for source, source_stats in stats.items():
        log.info("%-8s נשלפו=%s נטענו=%s שגיאה=%s",
                 source, source_stats["fetched"], source_stats["loaded"], source_stats["error"])
    for name in silent:
        log.warning("מקור %s החזיר אפס רשומות בלי שגיאה — %s", name, stats[name]["note"])
    log.info("ריצה %s הסתיימה בסטטוס %s", run_id, status)
    return 0 if status != "failed" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="הרצת צינור ה-ETL")
    parser.add_argument("--dry-run", action="store_true", help="שלוף ונקה בלי לכתוב")
    parser.add_argument("--since-days", type=int, default=7, help="כמה ימים אחורה בפידי החדשות")
    parser.add_argument("--knesset", type=int, default=25, help="מספר הכנסת לשליפת נתונים")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    return run(dry_run=args.dry_run, since_days=args.since_days, knesset_number=args.knesset)


if __name__ == "__main__":
    raise SystemExit(main())
