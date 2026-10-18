"""Build each party's stated position on every quiz question, with its source.

    python3 -m pipeline.ml.positions

The positions are hand labels made in research/, read against the 25 quiz
statements, from three kinds of source:

- the party's platform (platform_coverage_*.csv, notebook 03);
- its MKs' bills, for a party without a platform (bill_coverage_*.csv,
  notebook 05);
- direct statements by the party's leader (statement_coverage_*.csv), used
  only for questions neither of the others covers.
 A label says whether the source agrees with the statement
(+1), disagrees (-1) or touches it without a direction (0), and how surely:

    sure ±1, partial ±0.5, unclear 0, not covered → absent

A question a party is not covered on is left out rather than set to 0: 0 is
"takes no side", absence is "we don't know", and the matching treats the two
differently.

Question by question, a platform wins over bills and bills over statements;
each fills only what the ones before it leave uncovered.

Every position carries the passage or bill it rests on and a link to it, so
the site can show why a party is said to agree. Platform links are resolved
from the fetched texts in data/platforms/, which stay out of git; that is why
this file is built locally and committed, and CI only reads it.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from pathlib import Path

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LABELS_DIR = REPO_ROOT / "research"
PLATFORMS_DIR = REPO_ROOT / "data" / "platforms"
PLATFORM_SOURCES = REPO_ROOT / "data" / "sources" / "platforms.json"
PARTIES = REPO_ROOT / "data" / "seed" / "parties.json"
OUT = REPO_ROOT / "data" / "positions" / "party_positions.json"

CONFIDENCE_WEIGHT = {"sure": 1.0, "partial": 0.5, "unclear": 1.0}
# The label files were named before these slugs settled.
SLUG_ALIASES = {"democrats": "the-democrats", "otzma": "otzma-yehudit", "yachad": "beyachad"}
# Lower wins when a party has more than one.
SOURCE_PRIORITY = {"platform": 0, "bill": 1, "statement": 2}


def label_value(stance: str, confidence: str) -> float | None:
    """A label's position on the statement, or None when there is none."""
    if confidence not in CONFIDENCE_WEIGHT or stance in ("", None):
        return None
    return float(stance) * CONFIDENCE_WEIGHT[confidence]


def read_labels(labels_dir: Path) -> list[dict]:
    rows = []
    for kind in SOURCE_PRIORITY:
        for path in sorted(labels_dir.glob(f"{kind}_coverage_*.csv")):
            with path.open(encoding="utf-8", newline="") as f:
                for row in csv.DictReader(f):
                    row["kind"] = kind
                    row["party"] = SLUG_ALIASES.get(row["party"], row["party"])
                    rows.append(row)
    return rows


def merge(rows: list[dict]) -> dict[str, dict[str, dict]]:
    """One label per party and question: a covered platform row, else a covered bill row."""
    chosen: dict[str, dict[str, dict]] = {}
    for row in sorted(rows, key=lambda r: SOURCE_PRIORITY[r["kind"]]):
        if label_value(row.get("stance"), row.get("confidence")) is None:
            continue
        chosen.setdefault(row["party"], {}).setdefault(row["question_id"], row)
    return chosen


def platform_pages(text: str) -> list[tuple[str, set[str]]]:
    """Split a fetched platform into (url, lines) per page, as fetch_platforms wrote it."""
    pages: list[tuple[str, set[str]]] = []
    for line in text.splitlines():
        if line.startswith("## "):
            pages.append((line[3:].strip(), set()))
        elif pages:
            pages[-1][1].add(line.strip())
    return pages


def platform_url(quote: str, pages: list[tuple[str, set[str]]], fallback: str | None) -> str | None:
    for url, lines in pages:
        if quote.strip() in lines:
            return url
    return fallback


def position(row: dict, pages: list[tuple[str, set[str]]], fallback_url: str | None) -> dict:
    value = label_value(row["stance"], row["confidence"])
    out = {"value": value, "confidence": row["confidence"], "kind": row["kind"]}
    if row["kind"] == "platform":
        quote = (row.get("quote") or "").strip()
        out["text"] = quote
        out["url"] = platform_url(quote, pages, fallback_url)
    elif row["kind"] == "bill":
        out["text"] = row["title"].strip()
        out["url"] = row["sourceUrl"]
        out["status"] = row.get("status") or None
    else:
        out["text"] = row["quote"].strip()
        out["url"] = row["sourceUrl"]
        out["speaker"] = row["speaker"]
        out["date"] = row["date"]
    if row.get("labeler"):
        out["labeler"] = row["labeler"]
    return out


def build(labels_dir: Path, platforms_dir: Path, sources: dict, slugs: list[str]) -> dict:
    merged = merge(read_labels(labels_dir))
    unknown = sorted(set(merged) - set(slugs))
    if unknown:
        raise ValueError(f"מפלגות בתיוג שאינן ב-parties.json: {unknown}")

    parties = {}
    for slug in slugs:
        labels = merged.get(slug, {})
        if not labels:
            log.warning("אין עמדות עבור %s", slug)
        source_key = next((k for k, v in SLUG_ALIASES.items() if v == slug), slug)
        config_pages = sources.get(source_key, {}).get("pages") or []
        text_path = platforms_dir / f"{source_key}.txt"
        pages = platform_pages(text_path.read_text(encoding="utf-8")) if text_path.exists() else []
        fallback = config_pages[0] if config_pages else None
        parties[slug] = {
            qid: position(row, pages, fallback) for qid, row in sorted(labels.items())
        }
        missing = [qid for qid, p in parties[slug].items() if p["url"] is None]
        if missing:
            log.warning("%s: אין קישור למקור בשאלות %s", slug, missing)
    return parties


def render(parties: dict) -> str:
    doc = {
        "_comment": (
            "Generated by `python3 -m pipeline.ml.positions` from the hand labels in research/. "
            "value: +1 agrees with the quiz statement, -1 disagrees, 0 no direction; "
            "partial labels count half. A question missing from a party means no information."
        ),
        "parties": parties,
    }
    return json.dumps(doc, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    argparse.ArgumentParser(description="בניית קובץ עמדות המפלגות מהתיוג").parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    slugs = [p["slug"] for p in _parties()]
    sources = json.loads(PLATFORM_SOURCES.read_text(encoding="utf-8"))["parties"]
    parties = build(LABELS_DIR, PLATFORMS_DIR, sources, slugs)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(render(parties), encoding="utf-8")
    for slug, positions in parties.items():
        log.info("  %-20s %2d עמדות", slug, len(positions))
    log.info("נכתב %s", OUT.relative_to(REPO_ROOT))
    return 0


def _parties() -> list[dict]:
    data = json.loads(PARTIES.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else data["parties"]


if __name__ == "__main__":
    sys.exit(main())
