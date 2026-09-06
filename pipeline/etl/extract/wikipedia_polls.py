"""Published seat polls, read from Wikipedia's polling table.

Israel has no public poll API. Polls appear in news articles, and the one
place that collects them in a structured, openly-licensed form with a real
API is Wikipedia's per-election polling page. So Wikipedia is the *collection*
mechanism here, not the authority: every row cites the publication it came
from, and `source_url` points at that publication wherever the citation can be
resolved.

The page is not one clean table. A probe of the live page
(`.github/workflows/probe-polls.yml`) found 58 tables, most of which are not
seat polls at all — preferred-prime-minister questions, coalition scenarios,
hypothetical parties that never ran, and historical tables from earlier in the
cycle. Columns seen there include "Would like", "Cross-bloc w. Arabs",
"Netanyahu" and "Bennett + Cohen". A parser that read those as party seat
counts would produce numbers that look entirely reasonable and are nonsense.

So acceptance is strict and the failure direction is deliberate: a table or row
that does not clearly look like a seat poll is skipped and counted, never
guessed at. Missing a poll is recoverable; inventing one is not.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from urllib.parse import quote

from ..transform.normalize import RawPoll
from .http import FetchError, fetch

log = logging.getLogger(__name__)

PAGE_TITLE = "Opinion polling for the 2026 Israeli legislative election"
PAGE_URL = "https://en.wikipedia.org/wiki/" + PAGE_TITLE.replace(" ", "_")

# The page is read through the REST endpoint rather than the action API.
# Wikipedia's robots.txt disallows /w/ for all crawlers, and /w/api.php sits
# under it; the shared HTTP client honours robots.txt, so the action API is
# simply off limits here. Carving out a per-host exception to that rule is not
# a decision this module should make quietly. /api/rest_v1/ is a different
# path and returns the same rendered HTML.
REST_URL = "https://en.wikipedia.org/api/rest_v1/page/html/{title}"

# A seat-poll table is identified by its header, not its position on the page.
REQUIRED_HEADERS = ("fieldwork date", "polling firm", "publisher", "sample size")

# Columns that are structural rather than parties.
NON_PARTY_HEADERS = {
    "fieldwork date", "polling firm", "publisher", "sample size", "lead",
    "others", "other", "government", "opposition", "undecided", "don't know",
    "no answer", "absent", "n/a", "sample", "date", "pollster",
}

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


@dataclass
class ParseReport:
    """What was taken and what was passed over, so silence is never ambiguous."""

    tables_seen: int = 0
    tables_used: int = 0
    rows_seen: int = 0
    polls: list[RawPoll] = field(default_factory=list)
    skipped: dict[str, int] = field(default_factory=dict)

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1

    def summary(self) -> str:
        parts = ", ".join(f"{k}={v}" for k, v in sorted(self.skipped.items()))
        return (
            f"{self.tables_used}/{self.tables_seen} טבלאות, "
            f"{len(self.polls)}/{self.rows_seen} שורות"
            + (f" · דולגו: {parts}" if parts else "")
        )


def _strip_tags(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    for entity, char in (
        ("&#160;", " "), ("&nbsp;", " "), ("&amp;", "&"),
        ("&#91;", "["), ("&#93;", "]"), ("&quot;", '"'), ("&#39;", "'"),
    ):
        text = text.replace(entity, char)
    # Footnote markers like "[23]" are Wikipedia's, not part of the value.
    text = re.sub(r"\[\s*[a-z0-9]{1,3}\s*\]", " ", text)
    return " ".join(text.split())


def _parse_date_range(value: str, today: date) -> tuple[date, date] | None:
    """Parse "3–4 Sep", "24 Aug", "29 Aug – 1 Sep" into a start/end pair.

    The table omits the year, so it is inferred: a date that would fall in the
    future belongs to the previous year. Without that rule, every poll from
    late in the previous year would be read as an impossible future date.
    """
    text = value.replace("–", "-").replace("—", "-")
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None

    parts = [p.strip() for p in text.split("-") if p.strip()]
    if not parts:
        return None

    def one(token: str, fallback_month: int | None) -> tuple[int, int] | None:
        m = re.match(r"^(\d{1,2})\s*([A-Za-z]{3,})?", token)
        if not m:
            return None
        day = int(m.group(1))
        name = (m.group(2) or "")[:3].lower()
        month = MONTHS.get(name, fallback_month)
        return (day, month) if month else None

    end = one(parts[-1], None)
    if end is None:
        return None
    start = one(parts[0], end[1]) if len(parts) > 1 else end
    if start is None:
        return None

    def build(day: int, month: int) -> date | None:
        for year in (today.year, today.year - 1):
            try:
                candidate = date(year, month, day)
            except ValueError:
                continue
            if candidate <= today + timedelta(days=1):
                return candidate
        return None

    start_date = build(*start)
    end_date = build(*end)
    if start_date is None or end_date is None or end_date < start_date:
        return None
    return start_date, end_date


def _parse_seats(cell: str) -> float | None:
    """Seats from a cell, or 0 for a party shown below the threshold.

    A party under the threshold is printed as a vote share in brackets —
    "(0.7%)" — where a seat count would otherwise be. Reading that as 0.7
    seats would be wrong in a way nothing downstream could catch, so the
    bracketed form is recognised explicitly and means zero seats.
    """
    text = cell.strip()
    if not text or text in {"—", "–", "-", "?"}:
        return None
    if re.fullmatch(r"\(\s*\d+(?:\.\d+)?\s*%\s*\)", text):
        return 0.0
    m = re.fullmatch(r"(\d{1,3})(?:\.\d+)?", text)
    return float(m.group(1)) if m else None


def _margin_of_error(sample_size: int) -> float:
    """The 95% maximum margin for a simple random sample of this size.

    Derived, not published: the table gives sample sizes but no margins. It is
    the textbook 1.96·√(0.25/n), which is what a reader assumes when they see
    "±3.1%" — and it is labelled as derived in the README rather than being
    passed off as the pollster's own figure.
    """
    return round(1.96 * (0.25 / sample_size) ** 0.5 * 100, 1)


def _fetch_page_html() -> str:
    url = REST_URL.format(title=quote(PAGE_TITLE.replace(" ", "_"), safe=""))
    response = fetch(url, accept="text/html")
    if not response.text or "<table" not in response.text:
        raise FetchError("התשובה מוויקיפדיה אינה מכילה טבלאות")
    return response.text


def _citation_urls(html: str) -> dict[str, str]:
    """cite_note id -> the external URL of that reference, where it has one."""
    urls: dict[str, str] = {}
    for match in re.finditer(r'<li id="(cite_note[^"]+)"(.*?)</li>', html, flags=re.S):
        external = re.search(r'href="(https?://[^"]+)"', match.group(2))
        if external:
            urls[match.group(1)] = external.group(1)
    return urls


def _rows(table_html: str) -> list[str]:
    return re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, flags=re.S)


def _cells(row_html: str) -> list[str]:
    return re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row_html, flags=re.S)


def parse_tables(html: str, today: date | None = None) -> ParseReport:
    """Every seat poll the page contains, with a count of what was skipped."""
    today = today or date.today()
    report = ParseReport()
    citations = _citation_urls(html)

    for table in re.findall(r"<table[^>]*>.*?</table>", html, flags=re.S):
        report.tables_seen += 1
        rows = _rows(table)
        if not rows:
            continue

        headers = [_strip_tags(c).lower() for c in _cells(rows[0])]
        if not all(any(h.startswith(req) for h in headers) for req in REQUIRED_HEADERS):
            # Preferred-PM, coalition-scenario and hypothetical-party tables all
            # land here, which is the point.
            continue
        report.tables_used += 1

        index = {h: i for i, h in enumerate(headers)}
        date_at = next(i for h, i in index.items() if h.startswith("fieldwork date"))
        firm_at = next(i for h, i in index.items() if h.startswith("polling firm"))
        pub_at = next(i for h, i in index.items() if h.startswith("publisher"))
        size_at = next(i for h, i in index.items() if h.startswith("sample size"))
        party_at = {
            i: _strip_tags(c)
            for i, c in enumerate(_cells(rows[0]))
            if headers[i] not in NON_PARTY_HEADERS and _strip_tags(c)
        }

        for row_html in rows[1:]:
            raw_cells = _cells(row_html)
            # Event rows ("8 Sep | Deadline for submission") and spacer rows
            # have far fewer cells than the header.
            if len(raw_cells) < len(headers) - 2:
                continue
            report.rows_seen += 1
            cells = [_strip_tags(c) for c in raw_cells]

            span = _parse_date_range(cells[date_at], today)
            if span is None:
                report.skip("תאריך לא נקרא")
                continue

            pollster = cells[firm_at]
            sponsor = cells[pub_at]
            if not pollster or not sponsor:
                report.skip("חסר בית סקרים או מזמין")
                continue

            size_text = re.sub(r"[,\s]", "", cells[size_at])
            if not size_text.isdigit():
                report.skip("גודל מדגם לא נקרא")
                continue
            sample_size = int(size_text)

            seats: dict[str, float] = {}
            for i, party_name in party_at.items():
                if i >= len(cells):
                    continue
                value = _parse_seats(cells[i])
                if value is not None:
                    seats[party_name] = value
            if not seats:
                report.skip("אין מנדטים בשורה")
                continue

            # The publisher's own article is the source; the encyclopedia's
            # summary of it is the fallback when the citation has no link.
            note = re.search(r'href="#(cite_note[^"]+)"', raw_cells[pub_at])
            source_url = citations.get(note.group(1)) if note else None

            report.polls.append(
                RawPoll(
                    pollster=pollster,
                    sponsor=sponsor,
                    field_date_start=span[0],
                    field_date_end=span[1],
                    sample_size=sample_size,
                    margin_of_error=_margin_of_error(sample_size),
                    source_url=source_url or PAGE_URL,
                    source_name=sponsor if source_url else "ויקיפדיה",
                    seats=seats,
                )
            )

    return report


def extract(since: date | None = None, today: date | None = None) -> dict:
    """Entry point for run_etl. Never raises — reports instead."""
    today = today or date.today()
    try:
        html = _fetch_page_html()
    except FetchError as exc:
        return {"polls": [], "note": None, "error": str(exc)}

    report = parse_tables(html, today=today)
    polls = report.polls
    if since:
        polls = [p for p in polls if p.field_date_end >= since]

    log.info("ויקיפדיה: %s", report.summary())
    note = None
    if report.tables_used and not report.polls:
        note = (
            f"זוהו {report.tables_used} טבלאות סקרים אך לא נקראה מהן אף שורה "
            f"({report.summary()}). ככל הנראה מבנה הטבלה השתנה."
        )
    return {"polls": polls, "note": note, "error": None}
