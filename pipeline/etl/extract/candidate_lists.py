"""Official candidate lists, read from the Central Elections Committee's pages.

The committee publishes each approved list as a page on gov.il. The copies
used here are the PDF prints of those pages that the Israel Democracy
Institute hosts, one file per list (see data/sources/candidate_lists.json).

The PDFs are a browser print of a three-column grid, which makes the text
layer awkward in two ways the parser has to undo:

* pypdf's layout mode returns each line in visual order, so Hebrew comes out
  reversed and so do the digits of every number ("01." for "10."). Reversing
  each segment restores the logical text, and each run of digits is reversed
  back afterwards.
* A long name wraps onto the next line within its own column, and a list
  entry carries a "מטעם מפלגת ..." line naming the party that nominated the
  candidate. Columns are told apart by horizontal position, so a wrapped line
  is attached to the entry above it in the same column.

Names are kept exactly as the committee prints them, family name first. A
name like "גמליאל דמרי גילה" cannot be split into family and given names
without knowing the person, and guessing would put a wrong name on a real
candidate.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

from .http import FetchError, fetch

# Positions run to 120 at most in practice; the cap keeps dates such as
# "08.09.2026" and footer numbers from being read as entries.
MAX_POSITION = 200


@dataclass
class ListEntry:
    position: int
    name: str
    nominated_by: str | None


def _logical(segment: str) -> str:
    text = segment[::-1].translate(str.maketrans("()", ")("))
    return re.sub(r"\d+", lambda m: m.group(0)[::-1], text).strip()


# gov.il chrome that the print layers over the grid: a floating "עוזר ה-AI
# הממשלתי" badge (reversed to "IA" like everything else) and the page footer.
# Either can land in the same column as a name and be read as part of it.
_FOOTER = re.compile(r"\s*מידע שימושי.*$")


def _clean_name(text: str) -> str:
    text = _FOOTER.sub("", text)
    if "IA" in text:
        text = text.replace("ה-IA", " ")
        text = " ".join(w for w in text.split() if w not in ("עוזר", "הממשלתי"))
    return " ".join(text.split())


def _squash(text: str) -> str:
    """Drop whitespace, so letter-spaced prints ("בי ח ד") still match."""
    return re.sub(r"\s+", "", text)


def _cells(line: str) -> list[tuple[int, int]]:
    """Start and end offsets of each cell in one visual line.

    Up to four spaces still count as one cell, because some prints space the
    number off its dot ("1  . בנט נפתלי"). Columns are usually much further
    apart, but not always (the Shas list leaves four spaces), so a cell is
    also split after an entry number: in visual order an entry ends with its
    reversed ".N", and anything after that belongs to the next column.
    """
    cells = []
    for match in re.finditer(r"\S+(?: {1,4}\S+)*", line):
        start = match.start()
        for number in re.finditer(r"\.\d{1,3}(?= {2,})", match.group(0)):
            cut = match.start() + number.end()
            cells.append((start, cut))
            start = cut + len(line[cut:]) - len(line[cut:].lstrip(" "))
        cells.append((start, match.end()))
    return cells


def parse_pdf(data: bytes, components: list[dict]) -> list[ListEntry]:
    """Entries of one list, in order, from the bytes of its PDF.

    `components` are the parties that jointly submitted the list, each as
    {"name": ..., "match": ...}. An entry's nominating party is recorded only
    when its "מטעם" text names exactly one of them; otherwise it is left empty
    rather than guessed, which happens when a page break separates a name from
    its "מטעם" line.
    """
    from pypdf import PdfReader  # imported here so the rest of the pipeline doesn't need it

    reader = PdfReader(io.BytesIO(data))
    names: dict[int, list[str]] = {}
    nominated: dict[int, list[str]] = {}

    for page in reader.pages:
        lines = page.extract_text(extraction_mode="layout").split("\n")
        width = max((len(line) for line in lines), default=1) or 1
        current: dict[int, int] = {}
        for line in lines:
            for start, end in _cells(line):
                segment = _logical(line[start:end])
                column = int(3 * ((start + end) / 2) / width)
                entry = re.match(r"^(\d{1,3})\s*\.\s*(.+)$", segment)
                if entry and int(entry.group(1)) <= MAX_POSITION:
                    position = int(entry.group(1))
                    names[position] = [entry.group(2)]
                    nominated[position] = []
                    current[column] = position
                    continue
                if column not in current:
                    continue
                position = current[column]
                if segment.startswith("מטעם") or nominated[position]:
                    nominated[position].append(segment)
                else:
                    names[position].append(segment)

    entries = []
    for position in sorted(names):
        text = _squash(" ".join(nominated[position]))
        hits = [c["name"] for c in components if _squash(c["match"]) in text]
        entries.append(
            ListEntry(
                position=position,
                name=_clean_name(" ".join(names[position])),
                nominated_by=hits[0] if len(hits) == 1 else None,
            )
        )
    return entries


def validate(entries: list[ListEntry]) -> list[str]:
    """Problems that mean the parse cannot be trusted, if any."""
    if not entries:
        return ["לא נמצאו מועמדים בקובץ"]
    positions = [e.position for e in entries]
    expected = list(range(1, max(positions) + 1))
    problems = []
    missing = sorted(set(expected) - set(positions))
    if missing:
        problems.append(f"מקומות חסרים ברשימה: {missing[:10]}")
    empty = [e.position for e in entries if not e.name]
    if empty:
        problems.append(f"מקומות ללא שם: {empty[:10]}")
    # A name is Hebrew or Arabic letters with the odd geresh, hyphen or
    # bracketed alias. Latin letters or digits mean page chrome got in.
    foreign = [e.position for e in entries if re.search(r"[A-Za-z0-9]", e.name)]
    if foreign:
        problems.append(f"שמות עם תווים זרים (כנראה טקסט מהעמוד): {foreign[:10]}")
    return problems


def extract(source: dict) -> dict:
    """Fetch and parse one list. Never raises — reports errors instead."""
    try:
        response = fetch(source["url"], accept="application/pdf")
    except FetchError as exc:
        return {"entries": [], "error": str(exc)}
    entries = parse_pdf(response.content, source.get("components", []))
    problems = validate(entries)
    return {"entries": entries, "error": "; ".join(problems) or None}
