"""Cleaning and validating extracted records before they reach the warehouse.

Two rules are enforced here and nowhere else:

1. Nothing is loaded without a source. A number a reader cannot trace back to a
   published poll or an official record has no business in this application.
2. Nothing is loaded that fails a sanity check — a poll whose seats do not add
   up to roughly 120 is a parsing bug, not a finding.

Rejected records are returned alongside the accepted ones with a reason, so the
ETL run report shows what was dropped rather than hiding it.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime

from .party_mapping import resolve_party

TOTAL_SEATS = 120
# Pollsters round to whole seats, so the total drifts a little either way.
SEAT_SUM_TOLERANCE = 4
MIN_SAMPLE_SIZE = 200
MAX_SAMPLE_SIZE = 20_000


@dataclass
class RawPoll:
    """A poll as it comes out of a scraper, before any cleaning."""

    pollster: str
    sponsor: str
    field_date_start: date
    field_date_end: date
    sample_size: int
    margin_of_error: float
    source_url: str
    source_name: str
    # Raw party names exactly as published, mapped to seats.
    seats: dict[str, float]
    provenance: str = "etl"


@dataclass
class CleanPoll:
    id: str
    pollster: str
    sponsor: str
    field_date_start: date
    field_date_end: date
    sample_size: int
    margin_of_error: float
    source_url: str
    source_name: str
    provenance: str
    # Party ids mapped to seats.
    seats: dict[str, float]


@dataclass
class Rejection:
    record: str
    reason: str


@dataclass
class TransformResult:
    polls: list[CleanPoll] = field(default_factory=list)
    rejected: list[Rejection] = field(default_factory=list)
    unmapped_parties: set[str] = field(default_factory=set)


def poll_id(pollster: str, field_date_end: date, sponsor: str) -> str:
    """Deterministic id from the natural key, so re-runs are idempotent."""
    key = f"{pollster.strip()}|{field_date_end.isoformat()}|{sponsor.strip()}"
    return "poll_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def _as_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()


def clean_polls(raw_polls: list[RawPoll]) -> TransformResult:
    result = TransformResult()
    seen: set[str] = set()

    for raw in raw_polls:
        label = f"{raw.pollster} / {raw.field_date_end}"

        if not raw.source_url or not raw.source_name:
            result.rejected.append(Rejection(label, "רשומה ללא מקור"))
            continue

        if not (MIN_SAMPLE_SIZE <= raw.sample_size <= MAX_SAMPLE_SIZE):
            result.rejected.append(
                Rejection(label, f"גודל מדגם לא סביר: {raw.sample_size}")
            )
            continue

        start = _as_date(raw.field_date_start)
        end = _as_date(raw.field_date_end)
        if end < start:
            result.rejected.append(Rejection(label, "תאריך סיום קודם לתאריך התחלה"))
            continue

        mapped: dict[str, float] = {}
        unmapped_in_poll: list[str] = []
        for raw_name, seats in raw.seats.items():
            party_id = resolve_party(raw_name)
            if party_id is None:
                unmapped_in_poll.append(raw_name)
                result.unmapped_parties.add(raw_name)
                continue
            # Two spellings of the same party in one poll are summed rather
            # than one overwriting the other.
            mapped[party_id] = mapped.get(party_id, 0.0) + float(seats)

        if not mapped:
            result.rejected.append(Rejection(label, "לא זוהתה אף מפלגה"))
            continue

        total = sum(mapped.values())
        # Unmapped names are counted towards the total before it is checked, so
        # that a poll is not rejected merely because one small party is missing
        # from the alias table.
        total_with_unmapped = total + sum(
            float(raw.seats[name]) for name in unmapped_in_poll
        )
        if abs(total_with_unmapped - TOTAL_SEATS) > SEAT_SUM_TOLERANCE:
            result.rejected.append(
                Rejection(label, f"סכום המנדטים חורג: {total_with_unmapped:.0f}")
            )
            continue

        pid = poll_id(raw.pollster, end, raw.sponsor)
        if pid in seen:
            result.rejected.append(Rejection(label, "כפילות באותה ריצה"))
            continue
        seen.add(pid)

        result.polls.append(
            CleanPoll(
                id=pid,
                pollster=raw.pollster.strip(),
                sponsor=raw.sponsor.strip(),
                field_date_start=start,
                field_date_end=end,
                sample_size=int(raw.sample_size),
                margin_of_error=float(raw.margin_of_error),
                source_url=raw.source_url,
                source_name=raw.source_name,
                provenance=raw.provenance,
                seats=mapped,
            )
        )

    return result


def require_source(record: dict, label: str) -> None:
    """Guard used by the loaders for every sourced table."""
    if not record.get("sourceUrl") or not record.get("sourceName"):
        raise ValueError(f"{label}: רשומה ללא מקור — לא נטענת למסד הנתונים")
