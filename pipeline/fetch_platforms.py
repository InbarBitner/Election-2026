"""Fetch the party platforms listed in data/sources/platforms.json to plain text.

    python3 -m pipeline.fetch_platforms                 # every party
    python3 -m pipeline.fetch_platforms --party yashar  # one party

Writes data/platforms/<party>.txt and data/platforms/manifest.json. The texts
are the parties' copyright and stay out of git; the manifest records, per
page, where the text came from, when it was fetched and how much Hebrew it
held, so a thin or failed page is visible rather than silently missing.

This feeds research for now, not the warehouse: nothing here writes to the
database.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from .etl.extract import platforms

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG = REPO_ROOT / "data" / "sources" / "platforms.json"
OUT_DIR = REPO_ROOT / "data" / "platforms"


def fetch_party(pages: list[str]) -> list[platforms.Page]:
    fetched = [platforms.fetch_page(url) for url in pages]
    return platforms.drop_repeated_lines(fetched)


def render(party_id: str, pages: list[platforms.Page]) -> str:
    sections = [f"# {party_id}"]
    for page in pages:
        if page.text:
            sections.append(f"## {page.url}\n\n{page.text}")
    return "\n\n".join(sections) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="שליפת מצעי המפלגות לטקסט")
    parser.add_argument("--party", action="append", help="מזהה מפלגה; ברירת מחדל: כל המפלגות בקונפיגורציה")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    config = json.loads(CONFIG.read_text(encoding="utf-8"))["parties"]
    wanted = args.party or list(config)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    manifest_path = OUT_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    for party_id in wanted:
        source = config.get(party_id)
        if source is None:
            log.error("%s: אין מפלגה כזו בקונפיגורציה", party_id)
            continue
        if not source["pages"]:
            log.info("%s: אין מצע לשליפה — %s", party_id, source.get("note", ""))
            manifest[party_id] = {"pages": [], "words": 0, "note": source.get("note")}
            continue

        pages = fetch_party(source["pages"])
        words = sum(platforms.hebrew_words(page.text) for page in pages)
        (OUT_DIR / f"{party_id}.txt").write_text(render(party_id, pages), encoding="utf-8")
        manifest[party_id] = {
            "fetchedAt": fetched_at,
            "words": words,
            "note": source.get("note"),
            "pages": [
                {"url": page.url, "words": platforms.hebrew_words(page.text), "error": page.error}
                for page in pages
            ],
        }
        failed = [page for page in pages if page.error]
        thin = [page for page in pages if not page.error and platforms.hebrew_words(page.text) < 30]
        log.info("%s: %d עמודים, %d מילים", party_id, len(pages), words)
        for page in failed:
            log.warning("  נכשל: %s — %s", page.url, page.error)
        if thin:
            log.warning("  %d עמודים כמעט בלי טקסט (פחות מ-30 מילים)", len(thin))

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
