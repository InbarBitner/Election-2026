"""Knesset open data — members, votes and bills.

Written against responses actually observed from the service, not against
assumed field names. `.github/workflows/probe-knesset.yml` is the tool that
established the shapes below and can be re-run whenever the feed changes.

Two separate OData services are involved, and they do not agree with each
other:

* `ParliamentInfo.svc` holds people, positions and bills, keyed by `PersonID`.
* `Votes.svc` holds the votes, keyed by `kmmbr_id` — the same number as
  `PersonID`, but as a string left-padded with zeros to nine characters
  ("000000405" is PersonID 405). `Votes.svc` also carries an unrelated
  `mk_individual_id`, which is NOT the PersonID and is not used here.

Two more traps the probe uncovered, both of which produced silently empty
results before:

* Names are not on `KNS_PersonToPosition`; they are on `KNS_Person`.
* Only PositionID 54 ("חבר/ת סיעה") carries `FactionName`. PositionID 43/61
  ("חבר/ת הכנסת") leave it null, so the roster is built from 54.

Anything unparseable is skipped with a warning rather than aborting the run,
but skipping is *counted* — see `_Skipped`. A source that drops every row it
fetched raises, because "zero rows, no error" is the failure mode that hid all
of the above.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime

from .http import FetchError, fetch_json

log = logging.getLogger(__name__)

PARLIAMENT_BASE = "https://knesset.gov.il/Odata/ParliamentInfo.svc"
VOTES_BASE = "https://knesset.gov.il/Odata/Votes.svc"
SOURCE_NAME = "נתוני הכנסת הפתוחים"

MEMBER_URL = "https://main.knesset.gov.il/mk/Pages/MKPersonalDetails.aspx?MKID={id}"
BILL_URL = "https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid={id}"
VOTE_URL = "https://online.knesset.gov.il/Vote/{id}"

# KNS_Position row 54. The roster is built from faction membership because it
# is the only position row that names the faction.
POSITION_FACTION_MEMBER = 54

# Votes.svc/vote_result_type, read from the service rather than guessed. Kept
# as a fallback for the ids the live table does not describe.
VOTE_POSITIONS = {1: "for", 2: "against", 3: "abstain"}

# OData $filter has no IN operator, so ids are batched into `or` chains. Keep
# the chunk small enough that the query string stays well inside URL limits.
ID_CHUNK = 40
# Bills kept per member. A long-serving member has hundreds; the X-ray shows
# the most recent, so the rest would only lengthen every run.
BILLS_PER_MEMBER = 50

# The service caps every response at 100 rows and does not say so: $top=300 on
# a 193-row query still returns 100. Measured, not assumed.
PAGE_SIZE = 100


class _Skipped:
    """Counts rows dropped during parsing, so silence can be distinguished.

    A connector that filters out every row it received looks identical to one
    whose source returned nothing — that ambiguity is what let four separate
    field-name errors survive in this module. Counting the drops makes the
    difference visible, and `check()` turns "fetched rows, kept none" into an
    error instead of an empty list.
    """

    def __init__(self, what: str) -> None:
        self.what = what
        self.fetched = 0
        self.reasons: dict[str, int] = {}

    def drop(self, reason: str) -> None:
        self.reasons[reason] = self.reasons.get(reason, 0) + 1

    def check(self, kept: int) -> None:
        dropped = sum(self.reasons.values())
        if dropped:
            log.warning(
                "%s: נשמרו %d מתוך %d שורות; נדחו %s",
                self.what,
                kept,
                self.fetched,
                ", ".join(f"{reason}={count}" for reason, count in self.reasons.items()),
            )
        if self.fetched and not kept:
            raise FetchError(
                f"{self.what}: התקבלו {self.fetched} שורות ואף אחת לא נשמרה "
                f"({', '.join(f'{r}={c}' for r, c in self.reasons.items())}). "
                "סימן מובהק לשם שדה שהשתנה."
            )


def _odata_page(
    entity: str,
    *,
    base: str,
    top: int,
    skip: int,
    filter_expr: str | None,
    order_by: str | None = None,
) -> list[dict]:
    params = {"$format": "json", "$top": str(top)}
    if skip:
        params["$skip"] = str(skip)
    if filter_expr:
        params["$filter"] = filter_expr
    if order_by:
        params["$orderby"] = order_by
    payload = fetch_json(f"{base}/{entity}", params=params)
    # OData v3 nests under "d"/"results"; v4 uses "value".
    if isinstance(payload.get("d"), dict):
        return payload["d"].get("results", [])
    return payload.get("value", payload.get("d", []) or [])


def _odata(
    entity: str,
    *,
    base: str = PARLIAMENT_BASE,
    top: int = 200,
    filter_expr: str | None = None,
    order_by: str | None = None,
) -> list[dict]:
    """Fetch up to `top` rows, following the service's page cap.

    The service returns at most PAGE_SIZE rows however large $top is, and says
    nothing about the rows it withheld. Asking for 500 members of the 25th
    Knesset returned exactly 100 — a plausible-looking roster missing a fifth
    of its members. Paging until a short page arrives is what makes `top` mean
    what it says.
    """
    rows: list[dict] = []
    while len(rows) < top:
        page = _odata_page(
            entity,
            base=base,
            top=min(PAGE_SIZE, top - len(rows)),
            skip=len(rows),
            filter_expr=filter_expr,
            order_by=order_by,
        )
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
    return rows[:top]


def _chunks(items: list, size: int = ID_CHUNK):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _parse_date(value) -> date | None:
    if not value:
        return None
    text = str(value)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        log.warning("unparseable date from Knesset feed: %r", text)
        return None


def vote_member_id(person_id: str | int) -> str:
    """Translate a ParliamentInfo PersonID into the Votes.svc member key."""
    return str(person_id).strip().zfill(9)


def fetch_members(knesset_number: int = 25) -> list[dict]:
    """Members of one Knesset, with their faction.

    Two queries: the faction-membership rows (which carry FactionName but no
    name), then the people those rows point at (which carry the name).
    """
    rows = _odata(
        "KNS_PersonToPosition",
        filter_expr=(
            f"KnessetNum eq {knesset_number} "
            f"and PositionID eq {POSITION_FACTION_MEMBER}"
        ),
        top=500,
    )

    skipped = _Skipped(f"ח\"כי הכנסת ה-{knesset_number}")
    skipped.fetched = len(rows)

    factions: dict[int, str] = {}
    for row in rows:
        person_id = row.get("PersonID")
        if not person_id:
            skipped.drop("ללא PersonID")
            continue
        # A member who switched faction mid-term has more than one row; the
        # currently-held one wins, otherwise the first seen.
        if person_id not in factions or row.get("IsCurrent"):
            factions[person_id] = (row.get("FactionName") or "").strip()

    names = _fetch_person_names(list(factions))

    members = []
    for person_id, faction in factions.items():
        name = names.get(person_id, "")
        if not name:
            skipped.drop("לא נמצא שם ב-KNS_Person")
            continue
        members.append(
            {
                "knessetMemberId": str(person_id),
                "name": name,
                "factionName": faction,
                "sourceUrl": MEMBER_URL.format(id=person_id),
                "sourceName": SOURCE_NAME,
            }
        )

    skipped.check(len(members))
    return members


def _fetch_person_names(person_ids: list[int]) -> dict[int, str]:
    """PersonID → "First Last", batched because $filter has no IN."""
    names: dict[int, str] = {}
    for chunk in _chunks(person_ids):
        expr = " or ".join(f"PersonID eq {pid}" for pid in chunk)
        for row in _odata("KNS_Person", filter_expr=expr, top=len(chunk)):
            first = (row.get("FirstName") or "").strip()
            last = (row.get("LastName") or "").strip()
            full = f"{first} {last}".strip()
            if full:
                names[row["PersonID"]] = full
    return names


def latest_vote_knesset() -> int | None:
    """The most recent Knesset the vote service actually publishes.

    Votes.svc is frozen: its newest vote is 34525, from 13 July 2021, in the
    24th Knesset. Nothing from the 25th is there. Reading the ceiling from the
    service means the connector can say so instead of quietly returning an
    empty vote history, and starts working on its own the day the Knesset
    resumes publishing.
    """
    rows = _odata_page(
        "View_vote_rslts_hdr_Approved",
        base=VOTES_BASE,
        top=1,
        skip=0,
        filter_expr=None,
        order_by="vote_id desc",
    )
    for row in rows:
        if row.get("knesset_num"):
            return int(row["knesset_num"])
    return None


def _vote_headers(knesset_number: int, limit: int = 1200) -> dict[int, dict]:
    """Vote metadata for one Knesset, fetched once and joined locally.

    The per-member results table carries only `vote_id`; the date and subject
    live here. Fetching the headers once and joining in memory keeps this to a
    single request instead of one per member.
    """
    headers: dict[int, dict] = {}
    for row in _odata(
        "View_vote_rslts_hdr_Approved",
        base=VOTES_BASE,
        filter_expr=f"knesset_num eq {knesset_number}",
        top=limit,
    ):
        vote_id = row.get("vote_id")
        if vote_id is not None:
            headers[vote_id] = row
    return headers


def _vote_result_names() -> dict[int, str]:
    """result_type_id → our position vocabulary, read from the service."""
    mapping = dict(VOTE_POSITIONS)
    try:
        rows = _odata("vote_result_type", base=VOTES_BASE, top=50)
    except FetchError as exc:
        log.warning("could not read vote_result_type, using the built-in map: %s", exc)
        return mapping
    by_name = {"בעד": "for", "נגד": "against", "נמנע": "abstain"}
    for row in rows:
        result_id = row.get("result_type_id")
        position = by_name.get((row.get("result_type_name") or "").strip())
        if result_id is not None and position:
            mapping[result_id] = position
    return mapping


def fetch_votes(
    person_id: str,
    limit: int = 60,
    *,
    knesset_number: int = 25,
    headers: dict[int, dict] | None = None,
    results: dict[int, str] | None = None,
) -> list[dict]:
    """Recent votes for one member, in the shape the loader expects."""
    if headers is None:
        headers = _vote_headers(knesset_number)
    if results is None:
        results = _vote_result_names()

    rows = _odata(
        "vote_rslts_kmmbr_shadow",
        base=VOTES_BASE,
        filter_expr=(
            f"kmmbr_id eq '{vote_member_id(person_id)}' "
            f"and knesset_num eq {knesset_number}"
        ),
        top=limit,
    )

    skipped = _Skipped(f"הצבעות של {person_id}")
    skipped.fetched = len(rows)

    votes = []
    for row in rows:
        vote_id = row.get("vote_id")
        header = headers.get(vote_id) if vote_id is not None else None
        if header is None:
            skipped.drop("אין כותרת הצבעה תואמת")
            continue
        voted_at = _parse_date(header.get("vote_date"))
        title = (header.get("sess_item_dscr") or header.get("vote_item_dscr") or "").strip()
        if not voted_at or not title:
            skipped.drop("כותרת או תאריך חסרים")
            continue
        position = results.get(row.get("vote_result"))
        if position is None:
            # An id the results table does not describe (cancelled votes and
            # the like) is not an absence — dropping it is more honest than
            # recording a position that was never taken.
            skipped.drop("סוג תוצאה לא מוכר")
            continue
        votes.append(
            {
                "id": f"vote_{person_id}_{vote_id}",
                "billTitle": title,
                "topic": (header.get("vote_item_dscr") or "כללי").strip(),
                "date": voted_at,
                "position": position,
                "sourceUrl": VOTE_URL.format(id=vote_id),
                "sourceName": SOURCE_NAME,
            }
        )

    skipped.check(len(votes))
    return votes


def _bill_details(bill_ids: list[int], statuses: dict[int, str]) -> dict[int, dict]:
    """BillID → title, type, status text and publication date."""
    details: dict[int, dict] = {}
    for chunk in _chunks(bill_ids):
        expr = " or ".join(f"BillID eq {bid}" for bid in chunk)
        for row in _odata("KNS_Bill", filter_expr=expr, top=len(chunk)):
            details[row["BillID"]] = row
    for row in details.values():
        row["_statusText"] = statuses.get(row.get("StatusID"), "")
    return details


def _bill_statuses() -> dict[int, str]:
    """StatusID → its Hebrew description. KNS_Bill carries only the id."""
    try:
        rows = _odata("KNS_Status", top=500)
    except FetchError as exc:
        log.warning("could not read KNS_Status: %s", exc)
        return {}
    return {
        row["StatusID"]: (row.get("Desc") or "").strip()
        for row in rows
        if row.get("StatusID") is not None
    }


def fetch_bills(
    person_id: str,
    limit: int = BILLS_PER_MEMBER,
    *,
    statuses: dict[int, str] | None = None,
) -> list[dict]:
    """The member's most recent bills, initiated or co-signed.

    KNS_BillInitiator is only a link table — ids and nothing else — so the
    titles come from a second query against KNS_Bill.

    The links are taken newest first. Without an order the service returns
    whatever comes first in its own storage, so the cap kept an arbitrary
    slice: one member's 40 bills were all from the day the 25th Knesset
    opened, another's stopped in 2021. The link table carries no date, so
    the query orders by BillID, and the final cut is by the bill's date.
    """
    if statuses is None:
        statuses = _bill_statuses()

    links = _odata(
        "KNS_BillInitiator",
        filter_expr=f"PersonID eq {person_id}",
        order_by="BillID desc",
        # BillID is mostly but not strictly chronological (a 1997 bill turns
        # up among one member's highest ids), so take twice the cap by id and
        # keep the newest by the bill's own date below.
        top=limit * 2,
    )

    skipped = _Skipped(f"הצעות חוק של {person_id}")
    skipped.fetched = len(links)

    bill_ids = [link["BillID"] for link in links if link.get("BillID")]
    details = _bill_details(bill_ids, statuses) if bill_ids else {}

    bills = []
    for link in links:
        bill_id = link.get("BillID")
        bill = details.get(bill_id) if bill_id else None
        if bill is None:
            skipped.drop("אין רשומת הצעת חוק תואמת")
            continue
        title = (bill.get("Name") or "").strip()
        # PublicationDate only. LastUpdatedDate is not a date of the bill: for
        # every older bill it is 2021-06-29, the day the Knesset migrated its
        # records, and using it put 2012 bills in 2021.
        proposed_at = _parse_date(bill.get("PublicationDate"))
        knesset_num = bill.get("KnessetNum")
        if not title or not (proposed_at or knesset_num):
            skipped.drop("כותרת חסרה, או לא תאריך ולא מספר כנסת")
            continue
        bills.append(
            {
                "id": f"bill_{person_id}_{bill_id}",
                "title": title,
                "topic": (bill.get("SubTypeDesc") or "חקיקה").strip(),
                "status": bill.get("_statusText") or "לא ידוע",
                "date": proposed_at,
                "knessetNum": knesset_num,
                "year": _title_year(title),
                "isLeadSponsor": bool(link.get("IsInitiator")),
                "summary": (bill.get("SummaryLaw") or "").strip(),
                "sourceUrl": BILL_URL.format(id=bill_id),
                "sourceName": SOURCE_NAME,
            }
        )

    skipped.check(len(bills))
    bills.sort(key=_bill_recency, reverse=True)
    return bills[:limit]


def _title_year(title: str) -> int | None:
    """The Gregorian year a bill's title ends with ("התשע"ב-2012"), if any."""
    years = re.findall(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)", title)
    return int(years[-1]) if years else None


def _bill_recency(bill: dict) -> tuple:
    """Sort key, newest first under reverse=True: the date where there is one,
    otherwise the title's year, then the Knesset number. Used only to choose
    which bills to keep; the year is never stored as a date."""
    when = bill["date"] or (date(bill["year"], 1, 1) if bill.get("year") else date.min)
    return (when, bill.get("knessetNum") or 0, bill["id"])


def extract(knesset_number: int = 25, member_ids: list[str] | None = None) -> dict:
    """Entry point used by run_etl. Never raises — reports errors instead.

    `member_ids` are the people to fetch records for: the candidates linked to
    a Knesset member, whichever Knesset they served in. Without it the members
    of `knesset_number` are used, which misses every candidate who served
    earlier and fetches for sitting members who are not candidates at all.
    """
    if member_ids is not None:
        members = [{"knessetMemberId": str(person_id)} for person_id in member_ids]
    else:
        try:
            members = fetch_members(knesset_number)
        except FetchError as exc:
            return {"members": [], "votes": [], "bills": [], "error": str(exc)}

    errors: list[str] = []
    note: str | None = None

    # Votes and bills come from different services with different coverage, so
    # the vote side is checked before it is used. Without this the run would
    # simply produce no votes, which is exactly the "empty means broken or
    # means nothing, who knows" ambiguity this module is meant to be rid of.
    headers: dict[int, dict] = {}
    try:
        covered = latest_vote_knesset()
    except FetchError as exc:
        covered = None
        errors.append(f"בדיקת כיסוי ההצבעות: {exc}")

    if covered is not None and covered < knesset_number:
        note = (
            f"שירות ההצבעות של הכנסת מתעדכן עד הכנסת ה-{covered} בלבד, ולכן אין "
            f"היסטוריית הצבעות לכנסת ה-{knesset_number}. הצעות החוק כן נטענות. "
            "זו מגבלה של המקור, לא תקלה בצינור."
        )
        log.warning(note)
    else:
        try:
            headers = _vote_headers(knesset_number)
        except FetchError as exc:
            errors.append(f"כותרות הצבעות: {exc}")

    results = _vote_result_names()
    statuses = _bill_statuses()

    votes: list[dict] = []
    bills: list[dict] = []
    for member in members:
        person_id = member["knessetMemberId"]
        if headers:
            try:
                for record in fetch_votes(
                    person_id,
                    knesset_number=knesset_number,
                    headers=headers,
                    results=results,
                ):
                    record["knessetMemberId"] = person_id
                    votes.append(record)
            except FetchError as exc:
                errors.append(f"{person_id} הצבעות: {exc}")
        try:
            for record in fetch_bills(person_id, statuses=statuses):
                record["knessetMemberId"] = person_id
                bills.append(record)
        except FetchError as exc:
            errors.append(f"{person_id} הצעות חוק: {exc}")

    return {
        "members": members,
        "votes": votes,
        "bills": bills,
        "note": note,
        "error": "; ".join(errors[:5]) if errors else None,
    }
