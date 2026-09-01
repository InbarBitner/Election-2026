"""The daily election brief.

Two stages, deliberately separated:

1. **Fact detection** is deterministic Python over the warehouse — poll swings,
   parties crossing the electoral threshold, bloc totals, and events the ETL
   picked up from news feeds. This stage decides *what is true today*.
2. **Phrasing** turns those facts into Hebrew prose. Claude does the writing
   when an API key is available; a template does it otherwise.

The model is never a source of facts. It receives the detected facts and is
instructed to use nothing else, and the facts it was given are stored on the
row alongside the text, so any claim in a brief can be checked against them.

The poll averages come from the same TypeScript implementation the website
uses (web/scripts/poll-stats.ts), rather than a second implementation here, so
the brief and the charts can never disagree.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from ..db import from_db_datetime, get_engine, table
from ..etl.load.loader import save_brief

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
STATS_SCRIPT = REPO_ROOT / "web" / "scripts" / "poll-stats.ts"

MODEL = "claude-opus-5"
MAX_TOKENS = 2000

# A party has to move by at least this many seats for the day to call it news.
SWING_THRESHOLD = 1.5
# Distance from the threshold, in seats, that counts as "on the bubble".
BUBBLE_MARGIN = 1.0

BLOC_NAMES = {
    "right": "הגוש הימני",
    "center": "מרכז",
    "center-left": "מרכז-שמאל",
    "haredi": "המפלגות החרדיות",
    "arab": "המפלגות הערביות",
}

EVENT_KIND_NAMES = {
    "merger": "איחוד רשימות",
    "split": "פיצול",
    "coalition": "מהלך קואליציוני",
    "poll_swing": "שינוי בסקרים",
    "quote": "התבטאות",
    "threshold": "אחוז החסימה",
}


class BriefError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Stage 1 — facts
# ---------------------------------------------------------------------------


def poll_stats(window_days: int = 14, trend_days: int = 1) -> dict:
    """Run the site's own aggregation script and parse its JSON output."""
    if not STATS_SCRIPT.exists():
        raise BriefError(f"לא נמצא הסקריפט {STATS_SCRIPT}")
    result = subprocess.run(
        [
            "node",
            str(STATS_SCRIPT),
            "--window",
            str(window_days),
            "--trend-days",
            str(trend_days),
        ],
        cwd=STATS_SCRIPT.parent.parent,
        capture_output=True,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise BriefError(f"poll-stats נכשל: {result.stderr.strip()[:400]}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise BriefError(f"פלט לא תקין מ-poll-stats: {exc}") from exc


def recent_events(connection, target: date, lookback_days: int) -> list[dict]:
    events = table("Event")
    since = datetime(
        target.year, target.month, target.day, tzinfo=timezone.utc
    ) - timedelta(days=lookback_days)
    rows = connection.execute(
        select(events).order_by(events.c.date.desc()).limit(50)
    ).mappings()
    out = []
    for row in rows:
        when = from_db_datetime(row["date"])
        if when is None or when < since:
            continue
        out.append(
            {
                "kind": row["kind"],
                "kindName": EVENT_KIND_NAMES.get(row["kind"], row["kind"]),
                "date": when.date().isoformat(),
                "headline": row["headline"],
                "sourceName": row["sourceName"],
                "sourceUrl": row["sourceUrl"],
            }
        )
    return out


def collect_facts(connection, target: date, window_days: int, lookback_days: int) -> dict:
    """Everything the brief is allowed to talk about, and nothing else."""
    stats = poll_stats(window_days=window_days, trend_days=1)
    weekly = {p["id"]: p["change"] for p in poll_stats(window_days=window_days, trend_days=7)["parties"]}

    parties = sorted(stats["parties"], key=lambda p: -p["average"])

    swings = [
        {
            "party": p["name"],
            "change": p["change"],
            "weeklyChange": weekly.get(p["id"], 0),
            "average": p["average"],
            "direction": "עלייה" if p["change"] > 0 else "ירידה",
        }
        for p in parties
        if abs(p["change"]) >= SWING_THRESHOLD
    ]

    # Parties sitting within a seat of the threshold are the single most
    # consequential thing in an Israeli poll, so they get their own section.
    threshold_seats = 0.0325 * 120
    on_the_bubble = [
        {
            "party": p["name"],
            "average": p["average"],
            "passedThreshold": p["passedThreshold"],
            "change": p["change"],
        }
        for p in parties
        if abs(p["average"] - threshold_seats) <= BUBBLE_MARGIN
        or (not p["passedThreshold"] and p["average"] > 1)
    ]

    blocs = [
        {"bloc": BLOC_NAMES.get(key, key), "seats": seats}
        for key, seats in sorted(stats["blocs"].items(), key=lambda kv: -kv[1])
    ]

    return {
        "date": target.isoformat(),
        "asOf": stats["asOf"],
        "windowDays": stats["windowDays"],
        "pollCount": stats["pollCount"],
        "leaders": [
            {"party": p["name"], "average": p["average"], "seats": p["projectedSeats"]}
            for p in parties[:5]
        ],
        "swings": swings,
        "onTheBubble": on_the_bubble,
        "blocs": blocs,
        "events": recent_events(connection, target, lookback_days),
    }


# ---------------------------------------------------------------------------
# Stage 2 — phrasing
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """אתה עורך חדשות המנסח סקירה יומית קצרה על מערכת הבחירות בישראל.

כללים מחייבים:
- השתמש אך ורק בעובדות שסופקו לך ב-JSON. אל תוסיף מידע, הקשר היסטורי, ניתוח פוליטי או תחזיות שאינם נובעים ישירות מהנתונים.
- אל תמציא ציטוטים, שמות, מספרים או אירועים. אם אין מספיק נתונים ליום מסוים — כתוב זאת במפורש.
- שמור על ניטרליות מוחלטת. תאר מה הנתונים מראים, בלי להביע עמדה לטובת מפלגה או גוש.
- ציין תמיד שמדובר בממוצע סקרים ולא בתחזית תוצאות.
- כתוב בעברית תקנית, 150-250 מילים.

פורמט הפלט — JSON בלבד, ללא טקסט נוסף:
{"headline": "כותרת קצרה, עד 12 מילים", "body": "גוף הסקירה ב-Markdown"}"""


def render_with_claude(facts: dict) -> tuple[str, str]:
    """Ask Claude to phrase the facts. Raises on any failure so the caller falls back."""
    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover
        raise BriefError("חבילת anthropic אינה מותקנת") from exc

    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise BriefError("לא הוגדר ANTHROPIC_API_KEY")

    client = anthropic.Anthropic()
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "נסח את הסקירה היומית מהעובדות הבאות:\n\n"
                        + json.dumps(facts, ensure_ascii=False, indent=2)
                    ),
                }
            ],
        )
    except anthropic.APIError as exc:
        raise BriefError(f"קריאת Claude API נכשלה: {exc}") from exc

    if response.stop_reason == "refusal":
        raise BriefError("הבקשה נדחתה על ידי המודל")

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise BriefError("התקבלה תשובה ריקה")

    # The model was asked for JSON; a stray code fence is the usual deviation.
    cleaned = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        payload = json.loads(cleaned)
        return str(payload["headline"]).strip(), str(payload["body"]).strip()
    except (json.JSONDecodeError, KeyError) as exc:
        raise BriefError(f"תשובת המודל אינה JSON תקין: {exc}") from exc


HEBREW_MONTHS = [
    "בינואר", "בפברואר", "במרץ", "באפריל", "במאי", "ביוני",
    "ביולי", "באוגוסט", "בספטמבר", "באוקטובר", "בנובמבר", "בדצמבר",
]


def _he_date(iso: str) -> str:
    """2026-08-31 -> 31 באוגוסט 2026, so the prose reads as prose."""
    try:
        parsed = date.fromisoformat(iso)
    except (TypeError, ValueError):
        return str(iso)
    return f"{parsed.day} {HEBREW_MONTHS[parsed.month - 1]} {parsed.year}"


def render_from_template(facts: dict) -> tuple[str, str]:
    """Deterministic phrasing. Always available, never wrong about the numbers."""
    leaders = facts["leaders"]
    swings = facts["swings"]
    events = facts["events"]

    if swings:
        biggest = max(swings, key=lambda s: abs(s["change"]))
        headline = (
            f"{biggest['party']} ב{biggest['direction']} של "
            f"{abs(biggest['change']):.1f} מנדטים בממוצע הסקרים"
        )
    elif events:
        headline = events[0]["headline"]
    elif leaders:
        headline = f"{leaders[0]['party']} מוביל עם {leaders[0]['average']:.1f} מנדטים בממוצע"
    else:
        headline = "אין נתוני סקרים חדשים להיום"

    lines: list[str] = []
    lines.append(
        f"סקירה ליום {_he_date(facts['date'])}. הנתונים מבוססים על ממוצע נע של "
        f"{facts['windowDays']} ימים מתוך {facts['pollCount']} סקרים, "
        f"נכון ל-{_he_date(facts['asOf'])}. **ממוצע סקרים אינו תחזית תוצאות.**"
    )

    if leaders:
        lines.append("\n### בראש הטבלה\n")
        for leader in leaders:
            lines.append(
                f"- **{leader['party']}** — {leader['average']:.1f} מנדטים בממוצע "
                f"({leader['seats']} מנדטים בתחזית ההקצאה)."
            )

    if swings:
        lines.append("\n### תזוזות בולטות\n")
        for swing in swings:
            lines.append(
                f"- **{swing['party']}** — {swing['direction']} של "
                f"{abs(swing['change']):.1f} מנדטים מאז אתמול "
                f"({swing['weeklyChange']:+.1f} בשבוע האחרון), "
                f"ועומדת על {swing['average']:.1f}."
            )
    else:
        lines.append("\nלא נרשמה תזוזה חריגה בממוצע הסקרים ביחס לאתמול.")

    bubble = facts["onTheBubble"]
    if bubble:
        lines.append("\n### על גבול אחוז החסימה\n")
        for party in bubble:
            status = "מעל " if party["passedThreshold"] else "מתחת ל"
            lines.append(
                f"- **{party['party']}** — {party['average']:.1f} מנדטים, "
                f"{status}אחוז החסימה ({party['change']:+.1f} מאז אתמול)."
            )

    if facts["blocs"]:
        lines.append("\n### חלוקה לגושים\n")
        lines.append(
            ", ".join(f"{bloc['bloc']}: {bloc['seats']}" for bloc in facts["blocs"]) + "."
        )

    if events:
        lines.append("\n### אירועי היום\n")
        for event in events:
            lines.append(
                f"- {event['kindName']}: {event['headline']} "
                f"([{event['sourceName']}]({event['sourceUrl']}))"
            )

    return headline, "\n".join(lines)


# ---------------------------------------------------------------------------


def generate(target: date, window_days: int, lookback_days: int, use_llm: bool) -> dict:
    with get_engine().begin() as connection:
        facts = collect_facts(connection, target, window_days, lookback_days)

    generator = "template"
    if use_llm:
        try:
            headline, body = render_with_claude(facts)
            generator = "llm"
        except BriefError as exc:
            log.warning("נפילה חזרה לניסוח תבניתי: %s", exc)
            headline, body = render_from_template(facts)
    else:
        headline, body = render_from_template(facts)

    return {
        "date": target.isoformat(),
        "headline": headline,
        "bodyMarkdown": body,
        "generator": generator,
        "facts": facts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="יצירת הסקירה היומית")
    parser.add_argument("--date", default="today", help="YYYY-MM-DD או 'today'")
    parser.add_argument("--window", type=int, default=14, help="חלון הממוצע הנע בימים")
    parser.add_argument("--lookback", type=int, default=2, help="כמה ימים אחורה לאירועים")
    parser.add_argument(
        "--no-llm", action="store_true", help="השתמש בניסוח התבניתי בלבד"
    )
    parser.add_argument("--print", action="store_true", help="הדפס ואל תשמור")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    target = (
        datetime.now(timezone.utc).date()
        if args.date == "today"
        else date.fromisoformat(args.date)
    )

    try:
        brief = generate(target, args.window, args.lookback, use_llm=not args.no_llm)
    except BriefError as exc:
        log.error("יצירת הסקירה נכשלה: %s", exc)
        return 1

    log.info("נוצרה סקירה ל-%s (%s)", brief["date"], brief["generator"])
    if args.print:
        print(f"# {brief['headline']}\n\n{brief['bodyMarkdown']}")
        return 0

    with get_engine().begin() as connection:
        save_brief(connection, brief)
    log.info("נשמרה סקירה ל-%s", brief["date"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
