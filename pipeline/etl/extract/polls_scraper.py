"""Poll extraction.

Every poll source implements the same interface — `fetch() -> list[RawPoll]` —
so adding a pollster means adding one class here and one entry in `SOURCES`,
with no changes anywhere else in the pipeline.

Two source shapes are supported out of the box:

* `JsonPollSource` — a published JSON/CSV endpoint (the shape most poll
  aggregators expose). Configure it in data/sources/polls.json.
* `HtmlTablePollSource` — an HTML table on a news site, parsed with a CSS-ish
  row/cell selector pair.

No live source is enabled by default: which sites may be scraped, and under
what terms, is a decision for whoever operates the deployment, so the list is
read from a config file that ships empty. `python -m pipeline.run_etl` then
reports "no poll sources configured" rather than silently scraping anything.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from ..transform.normalize import RawPoll
from .http import FetchError, fetch, fetch_json

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCES_FILE = REPO_ROOT / "data" / "sources" / "polls.json"


@dataclass
class PollSourceConfig:
    name: str
    kind: str
    url: str
    source_name: str
    # Field names / selectors, interpreted per `kind`.
    mapping: dict


class PollSource:
    """Interface every poll connector implements."""

    def __init__(self, config: PollSourceConfig) -> None:
        self.config = config

    def fetch(self) -> list[RawPoll]:  # pragma: no cover - interface
        raise NotImplementedError


def _parse_date(value: str) -> date | None:
    value = (value or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _parse_seats(value) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in {"-", "—", "מתחת לאחוז החסימה"}:
        # A party listed as below the threshold really did score ~0 seats.
        return 0.0
    match = re.search(r"\d+(?:[.,]\d+)?", text)
    return float(match.group().replace(",", ".")) if match else None


class JsonPollSource(PollSource):
    """A JSON or CSV endpoint listing polls as records.

    `mapping` names the fields:
      {"records": "data", "pollster": "pollster", "date": "date",
       "sampleSize": "n", "marginOfError": "moe", "sponsor": "channel",
       "link": "url", "parties": {"הליכוד": "likud_seats", ...}}
    """

    def fetch(self) -> list[RawPoll]:
        mapping = self.config.mapping
        if self.config.url.endswith(".csv"):
            text = fetch(self.config.url, accept="text/csv").text
            records = list(csv.DictReader(io.StringIO(text)))
        else:
            payload = fetch_json(self.config.url)
            records = payload
            for key in (mapping.get("records") or "").split("."):
                if key and isinstance(records, dict):
                    records = records.get(key, [])
        if not isinstance(records, list):
            raise FetchError(f"{self.config.name}: מבנה תשובה לא צפוי")

        polls: list[RawPoll] = []
        for record in records:
            field_end = _parse_date(str(record.get(mapping["date"], "")))
            if field_end is None:
                log.warning("%s: skipping record with unparseable date", self.config.name)
                continue

            seats: dict[str, float] = {}
            for party_label, field in mapping["parties"].items():
                value = _parse_seats(record.get(field))
                if value is not None:
                    seats[party_label] = value
            if not seats:
                continue

            sample = _parse_seats(record.get(mapping.get("sampleSize", ""), 0)) or 0
            polls.append(
                RawPoll(
                    pollster=str(record.get(mapping["pollster"], self.config.name)).strip(),
                    sponsor=str(record.get(mapping.get("sponsor", ""), "")).strip()
                    or self.config.source_name,
                    field_date_start=field_end - timedelta(days=2),
                    field_date_end=field_end,
                    sample_size=int(sample),
                    margin_of_error=float(
                        _parse_seats(record.get(mapping.get("marginOfError", ""), 0)) or 0.0
                    ),
                    source_url=str(record.get(mapping.get("link", ""), "")).strip()
                    or self.config.url,
                    source_name=self.config.source_name,
                    seats=seats,
                )
            )
        return polls


class HtmlTablePollSource(PollSource):
    """A single results table on a news page.

    `mapping` gives {"tableIndex": 0, "partyColumn": 0, "seatsColumn": 1,
    "pollster": "...", "sponsor": "...", "sampleSize": 600, "marginOfError": 4.0}.
    Parsing is done with the standard library's HTML parser so the pipeline has
    no heavyweight scraping dependency.
    """

    def fetch(self) -> list[RawPoll]:
        from html.parser import HTMLParser

        class TableParser(HTMLParser):
            def __init__(self) -> None:
                super().__init__()
                self.tables: list[list[list[str]]] = []
                self._row: list[str] | None = None
                self._cell: list[str] | None = None

            def handle_starttag(self, tag, attrs):
                if tag == "table":
                    self.tables.append([])
                elif tag == "tr" and self.tables:
                    self._row = []
                elif tag in ("td", "th") and self._row is not None:
                    self._cell = []

            def handle_endtag(self, tag):
                if tag in ("td", "th") and self._cell is not None and self._row is not None:
                    self._row.append("".join(self._cell).strip())
                    self._cell = None
                elif tag == "tr" and self._row is not None and self.tables:
                    self.tables[-1].append(self._row)
                    self._row = None

            def handle_data(self, data):
                if self._cell is not None:
                    self._cell.append(data)

        mapping = self.config.mapping
        parser = TableParser()
        parser.feed(fetch(self.config.url, accept="text/html").text)
        index = int(mapping.get("tableIndex", 0))
        if index >= len(parser.tables):
            raise FetchError(f"{self.config.name}: לא נמצאה טבלה במיקום {index}")

        seats: dict[str, float] = {}
        party_col = int(mapping.get("partyColumn", 0))
        seats_col = int(mapping.get("seatsColumn", 1))
        for row in parser.tables[index]:
            if len(row) <= max(party_col, seats_col):
                continue
            value = _parse_seats(row[seats_col])
            if value is None:
                continue  # header row
            seats[row[party_col]] = value

        if not seats:
            raise FetchError(f"{self.config.name}: לא חולצו תוצאות מהטבלה")

        field_end = _parse_date(str(mapping.get("date", ""))) or date.today()
        return [
            RawPoll(
                pollster=mapping.get("pollster", self.config.name),
                sponsor=mapping.get("sponsor", self.config.source_name),
                field_date_start=field_end - timedelta(days=2),
                field_date_end=field_end,
                sample_size=int(mapping.get("sampleSize", 500)),
                margin_of_error=float(mapping.get("marginOfError", 4.0)),
                source_url=self.config.url,
                source_name=self.config.source_name,
                seats=seats,
            )
        ]


KINDS = {"json": JsonPollSource, "html-table": HtmlTablePollSource}


def load_sources() -> list[PollSource]:
    if not SOURCES_FILE.exists():
        return []
    config = json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    sources = []
    for entry in config.get("sources", []):
        if not entry.get("enabled", False):
            continue
        kind = entry["kind"]
        if kind not in KINDS:
            log.warning("unknown poll source kind %r, skipping", kind)
            continue
        sources.append(
            KINDS[kind](
                PollSourceConfig(
                    name=entry["name"],
                    kind=kind,
                    url=entry["url"],
                    source_name=entry.get("sourceName", entry["name"]),
                    mapping=entry.get("mapping", {}),
                )
            )
        )
    return sources


def extract() -> dict:
    """Entry point used by run_etl. Failure of one source never stops the rest."""
    sources = load_sources()
    if not sources:
        return {
            "polls": [],
            "error": None,
            "note": (
                "לא הוגדרו מקורות סקרים פעילים. ראה data/sources/polls.example.json "
                "והפעל מקור ב-data/sources/polls.json."
            ),
        }

    polls: list[RawPoll] = []
    errors: list[str] = []
    for source in sources:
        try:
            polls.extend(source.fetch())
        except Exception as exc:  # noqa: BLE001 — one bad source must not stop the run
            log.exception("poll source %s failed", source.config.name)
            errors.append(f"{source.config.name}: {exc}")

    return {"polls": polls, "error": "; ".join(errors) if errors else None}
