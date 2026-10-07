"""Normalising party names.

Every pollster writes party names differently — with or without quotes, with
the leader's name attached, in Hebrew or transliterated. Without a mapping step
the same party appears as several series and the moving average is meaningless,
so this is where most of the real-world messiness of the pipeline lives.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PARTIES_FILE = REPO_ROOT / "data" / "seed" / "parties.json"

# Hand-maintained aliases, keyed by party id. Extend this as new spellings show
# up in the sources rather than adding special cases to the scrapers.
ALIASES: dict[str, list[str]] = {
    "likud": ["ליכוד", "הליכוד בהנהגת נתניהו", "likud"],
    # ביחד היא רשימה משותפת של בנט 2026 ויש עתיד (אפריל 2026). בתי סקרים עשויים
    # עדיין לפרסם תחת אחד השמות הישנים, ולכן כולם ממופים לרשימה המשותפת.
    "yachad": [
        "ביחד",
        "ביחד בראשות בנט",
        "בנט",
        "בנט 2026",
        "מפלגת בנט",
        "יש עתיד",
        "לפיד",
        "bennett",
        "yesh atid",
        "beyachad",
        "together", "beyachad natzliach",
    ],
    "yashar": ["ישר", "ישר!", "ישר בראשות איזנקוט", "איזנקוט", "yashar", "eisenkot"],
    "amcha-israel": ["עמך ישראל", "עמך", "וינטר", "עופר וינטר", "amcha israel", "winter",
        "amcha yisrael", "winter party",
    ],
    "kachol-lavan": [
        "כחול לבן",
        "כחול-לבן",
        "גנץ",
        # "המחנה הממלכתי" היה השם הקודם של אותה רשימה, לפני פרישת איזנקוט.
        "המחנה הממלכתי",
        "מחנה ממלכתי",
        "blue and white",
        "national unity",
        "blue & white", "blue white", "gantz",
        # The English article's column header is the bare word.
        "unity",
    ],
    "religious-zionism": [
        "הציונות הדתית",
        "ציונות דתית",
        "הציונות הדתית בראשות סמוטריץ",
        "religious zionism",
    ],
    "otzma": ["עוצמה יהודית", "עוצמה יהודית בראשות בן גביר", "otzma yehudit"],
    "shas": ["שס", "ש ס", "shas"],
    "yahadut-hatorah": ["יהדות התורה", "אגודת ישראל", "דגל התורה", "utj"],
    "yisrael-beitenu": ["ישראל ביתנו", "ישראל ביתנו בראשות ליברמן", "yisrael beitenu",
        "yisrael beiteinu", "liberman", "ליברמן",
    ],
    "democrats": ["הדמוקרטים", "העבודה", "מרצ", "העבודה מרצ", "the democrats",
        "dems", "labor", "meretz", "golan", "גולן",
    ],
    # חד"ש, תע"ל ובל"ד רצות ברשימה אחת מאוגוסט 2026. סקרים שפורסמו קודם לכן
    # מפרידים ביניהן, ולכן כל השמות הישנים ממופים לרשימה המשותפת.
    "joint-list": [
        "הרשימה המשותפת",
        "המשותפת",
        "חדש תעל",
        "חדש-תעל",
        "חדש",
        "תעל",
        "בלד",
        "טיבי",
        "אחמד טיבי",
        "עודה",
        "איימן עודה",
        "גבארין",
        "hadash taal",
        "hadash",
        "taal",
        "balad",
        "joint list",
        "the joint list",
    ],
    "raam": ["רעם", "רע ם", "הרשימה הערבית המאוחדת", "raam"],
    # המילואימניקים והכלכלית (הנדל וזליכה) מספטמבר 2026. "הבית הציוני" הוא
    # השותפות הקודמת של הנדל עם טרופר, שהתפרקה ב-6 בספטמבר; סקרים מלפני כן
    # עדיין מופיעים תחת השם הזה. טרופר עצמו עבר לישר!, ולכן שמו אינו alias כאן.
    "zionist-home": [
        "המילואימניקים והכלכלית",
        "המילואימניקים",
        "הכלכלית",
        "הכלכלית החדשה",
        "המפלגה הכלכלית החדשה",
        "זליכה",
        "ירון זליכה",
        "הבית הציוני",
        "הבית הציוני המילואימניקים",
        "הנדל",
        "יועז הנדל",
        "reserv nep",
        "reservists nep",
        "new economic party",
        "zelekha",
        "zelicha",
        "zionist home",
        "zionist home the reservists",
        "reservists",
        "reserv",
        "hendel",
    ],
}

# Names that appear in poll tables but are NOT separate lists in this election.
# Mapping them to the list they actually run on is the difference between a
# poll that validates and one rejected for not summing to 120.
ALIASES["religious-zionism"] += [
    # זהות חתמה על בלוק טכני עם הציונות הדתית ב-1 בספטמבר 2026 וקיבלה את
    # מקומות 2, 8, 10 ו-11 ברשימה; היא אינה רשימה נפרדת.
    "זהות",
    "פייגלין",
    "משה פייגלין",
    "zehut",
    "rzp zehut",
    "rzp - zehut",
    "rzp",
]
# נעם (אבי מעוז) הגישה רשימה נפרדת ב-9 בספטמבר 2026, ולכן אינה ממופה לציונות
# הדתית. עמודת "נעם" בסקר תדווח כמפלגה לא ממופה, עד שתתווסף לה רשומה משלה.



def _strip_marks(value: str) -> str:
    """Drop niqqud, geresh/gershayim and punctuation so ״ש״ס״ == ״שס״."""
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[\"'`׳״.,\-–—()\[\]]+", "", without_marks)


def canonical_key(value: str) -> str:
    return re.sub(r"\s+", " ", _strip_marks(value)).strip().lower()


# Columns that hold real seats but name no party: the residual bucket a poll
# uses for the lists too small to print. They must keep counting towards the
# 120, or every row carrying one is rejected as short — but they are not
# missing aliases, and listing them as such invites someone to invent a party
# to satisfy the report.
RESIDUAL_NAMES = frozenset(
    {"other parties", "others", "other", "אחרות", "מפלגות אחרות", "אחרים"}
)


def is_residual(name: str) -> bool:
    """Whether a column is a known catch-all rather than an unknown party."""
    return canonical_key(name) in RESIDUAL_NAMES


@lru_cache(maxsize=1)
def _lookup() -> dict[str, str]:
    """Map every known spelling to a party id."""
    table: dict[str, str] = {}

    def add(name: str, party_id: str) -> None:
        key = canonical_key(name)
        if key:
            table.setdefault(key, party_id)

    if PARTIES_FILE.exists():
        data = json.loads(PARTIES_FILE.read_text(encoding="utf-8"))
        for party in data["parties"]:
            add(party["id"], party["id"])
            add(party["slug"], party["id"])
            add(party["name"], party["id"])
            add(party["shortName"], party["id"])
            # "הליכוד בראשות נתניהו" and similar leader-suffixed forms.
            add(f"{party['name']} בראשות {party['leader']}", party["id"])

    for party_id, aliases in ALIASES.items():
        for alias in aliases:
            add(alias, party_id)

    return table


def resolve_party(name: str) -> str | None:
    """Return the party id for a raw name, or None when it is unknown.

    Returning None rather than guessing is deliberate: an unmapped party is
    reported by the ETL run so a human can add the alias, instead of silently
    creating a phantom party in the averages.
    """
    if not name:
        return None
    key = canonical_key(name)
    lookup = _lookup()
    if key in lookup:
        return lookup[key]

    # Fall back to a containment match, which catches forms like
    # "הליכוד בראשות בנימין נתניהו" without inviting arbitrary fuzzy matching.
    candidates = [pid for alias, pid in lookup.items() if alias and alias in key]
    unique = set(candidates)
    return candidates[0] if len(unique) == 1 else None
