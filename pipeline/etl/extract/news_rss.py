"""News feeds — the raw material for the daily brief's event detection.

Only RSS/Atom feeds are read, never article pages: feeds are published for
machine consumption, which keeps this connector on the right side of both
robots.txt and the sites' terms.

The classifier below is deliberately conservative. It only flags an item as a
political event when the headline matches an explicit pattern (a merger, a
split, a coalition move), and it never invents a quote: `text` is always the
publisher's own headline, linked back to the original article.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date, datetime, timezone
from pathlib import Path

import feedparser

from .http import USER_AGENT

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]
FEEDS_FILE = REPO_ROOT / "data" / "sources" / "news_feeds.json"

# Headline patterns that mark a structural change in the race. Order matters:
# the first match wins.
EVENT_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("merger", re.compile(r"(מתאחד|איחוד|רשימה משותפת|ריצה משותפת|התאחדו)")),
    ("split", re.compile(r"(פורש|פרישה|מתפצל|פיצול|עוזב את המפלגה)")),
    ("coalition", re.compile(r"(פירוק הממשלה|הצבעת אי-אמון|התפטר|פיזור הכנסת|הדחה)")),
    ("threshold", re.compile(r"(אחוז החסימה|מתחת לאחוז החסימה)")),
]


def _feeds() -> list[dict]:
    if not FEEDS_FILE.exists():
        return []
    config = json.loads(FEEDS_FILE.read_text(encoding="utf-8"))
    return [f for f in config.get("feeds", []) if f.get("enabled", False)]


def _entry_date(entry) -> date:
    parsed = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if parsed:
        return datetime(*parsed[:6], tzinfo=timezone.utc).date()
    return datetime.now(timezone.utc).date()


def classify(headline: str) -> str | None:
    for kind, pattern in EVENT_PATTERNS:
        if pattern.search(headline):
            return kind
    return None


def extract(since: date | None = None) -> dict:
    """Return events detected in the configured feeds."""
    feeds = _feeds()
    if not feeds:
        return {
            "events": [],
            "error": None,
            "note": (
                "לא הוגדרו פידי חדשות פעילים. ראה data/sources/news_feeds.example.json."
            ),
        }

    events: list[dict] = []
    errors: list[str] = []
    for feed in feeds:
        try:
            parsed = feedparser.parse(feed["url"], agent=USER_AGENT)
            if parsed.bozo and not parsed.entries:
                raise RuntimeError(parsed.bozo_exception)
            for entry in parsed.entries:
                headline = (getattr(entry, "title", "") or "").strip()
                link = (getattr(entry, "link", "") or "").strip()
                if not headline or not link:
                    continue
                published = _entry_date(entry)
                if since and published < since:
                    continue
                kind = classify(headline)
                if kind is None:
                    continue
                events.append(
                    {
                        "id": "ev_" + hashlib.sha1(link.encode("utf-8")).hexdigest()[:16],
                        "kind": kind,
                        "date": published,
                        "headline": headline,
                        # The publisher's own summary, never a generated one.
                        "description": (getattr(entry, "summary", "") or "").strip()[:500],
                        "sourceUrl": link,
                        "sourceName": feed.get("name", "פיד חדשות"),
                        "provenance": "etl",
                    }
                )
        except Exception as exc:  # noqa: BLE001 — one bad feed must not stop the run
            log.exception("news feed %s failed", feed.get("name"))
            errors.append(f"{feed.get('name')}: {exc}")

    return {"events": events, "error": "; ".join(errors) if errors else None}
