"""Hand-entered polls, which override anything read automatically.

Wikipedia is a good collection mechanism and a fallible one: a row can be
wrong, or simply not there yet the morning a poll is published. This layer
exists so a person can correct or add a poll without fighting the automation,
and so the automation can never overwrite a human's correction.

The file is a CSV in the repository, `data/sources/manual_polls.csv`, because
a poll entered by hand should go through review like any other change: it is
visible in the diff, attributable to whoever committed it, and revertible.

Precedence: a manual row wins over an automatic one for the same pollster and
end date. `run_etl` applies that by loading manual rows last.
"""

from __future__ import annotations

import csv
import logging
from datetime import date, datetime
from pathlib import Path

from ..transform.normalize import RawPoll

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]
MANUAL_FILE = REPO_ROOT / "data" / "sources" / "manual_polls.csv"

# Columns that are not party seat counts.
META_COLUMNS = {
    "pollster", "sponsor", "field_date_start", "field_date_end",
    "sample_size", "margin_of_error", "source_url", "source_name", "notes",
}


def _parse_date(value: str) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def extract(path: Path | None = None) -> dict:
    """Read the manual poll file. A missing file is normal, not an error."""
    path = path or MANUAL_FILE
    if not path.exists():
        return {"polls": [], "note": None, "error": None}

    polls: list[RawPoll] = []
    problems: list[str] = []

    with path.open(encoding="utf-8-sig", newline="") as handle:
        for line_number, row in enumerate(csv.DictReader(handle), start=2):
            # Blank lines and comment rows keep the file editable by hand.
            if not row.get("pollster") or row["pollster"].lstrip().startswith("#"):
                continue

            label = f"שורה {line_number} ({row.get('pollster')})"
            end = _parse_date(row.get("field_date_end", ""))
            start = _parse_date(row.get("field_date_start", "")) or end
            if end is None:
                problems.append(f"{label}: field_date_end חסר או לא בפורמט YYYY-MM-DD")
                continue

            try:
                sample_size = int((row.get("sample_size") or "").strip())
            except ValueError:
                problems.append(f"{label}: sample_size אינו מספר")
                continue

            try:
                margin = float((row.get("margin_of_error") or "0").strip() or 0)
            except ValueError:
                problems.append(f"{label}: margin_of_error אינו מספר")
                continue

            if not (row.get("source_url") or "").strip():
                problems.append(f"{label}: חסר source_url — רשומה ללא מקור אינה נטענת")
                continue

            seats: dict[str, float] = {}
            for column, value in row.items():
                if column is None or column.strip() in META_COLUMNS:
                    continue
                text = (value or "").strip()
                if not text:
                    continue
                try:
                    seats[column.strip()] = float(text)
                except ValueError:
                    problems.append(f"{label}: ערך לא מספרי בעמודה {column}")

            if not seats:
                problems.append(f"{label}: אין מנדטים")
                continue

            polls.append(
                RawPoll(
                    pollster=row["pollster"].strip(),
                    sponsor=(row.get("sponsor") or "").strip(),
                    field_date_start=start,
                    field_date_end=end,
                    sample_size=sample_size,
                    margin_of_error=margin,
                    source_url=row["source_url"].strip(),
                    source_name=(row.get("source_name") or "").strip() or "הזנה ידנית",
                    seats=seats,
                )
            )

    for problem in problems:
        log.warning("סקר ידני נדחה — %s", problem)

    note = None
    if problems:
        note = f"{len(problems)} שורות בקובץ הידני נדחו: " + "; ".join(problems[:3])

    return {"polls": polls, "note": note, "error": None}
