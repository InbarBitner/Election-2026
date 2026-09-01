"""Knesset open data — members, votes and bills.

Source: the Knesset's public OData service (`knesset.gov.il/Odata/ParliamentInfo.svc`)
and the CKAN datasets published on data.gov.il. Both are open government data;
no key is required.

The connector is written defensively because the OData feed is not versioned
and occasionally renames fields: anything it cannot parse is skipped with a
warning rather than aborting the run. Records without a usable source link are
dropped outright, per the project rule.
"""

from __future__ import annotations

import logging
from datetime import date, datetime

from .http import FetchError, fetch_json

log = logging.getLogger(__name__)

ODATA_BASE = "https://knesset.gov.il/Odata/ParliamentInfo.svc"
SOURCE_NAME = "נתוני הכנסת הפתוחים"

# The Knesset numbers its own entities; these are the ones the app links to.
MEMBER_URL = "https://main.knesset.gov.il/mk/Pages/MKPersonalDetails.aspx?MKID={id}"
BILL_URL = "https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid={id}"
VOTE_URL = "https://online.knesset.gov.il/Vote/{id}"

VOTE_POSITIONS = {1: "for", 2: "against", 3: "abstain", 4: "absent"}
BILL_STATUS = {
    "הונחה על שולחן הכנסת": "proposed",
    "עברה בקריאה טרומית": "preliminary",
    "עברה בקריאה ראשונה": "first-reading",
    "התקבלה": "passed",
    "נדחתה": "rejected",
}


def _odata(entity: str, *, top: int = 200, filter_expr: str | None = None) -> list[dict]:
    params = {"$format": "json", "$top": str(top)}
    if filter_expr:
        params["$filter"] = filter_expr
    payload = fetch_json(f"{ODATA_BASE}/{entity}", params=params)
    # OData v3 nests under "d"/"results"; v4 uses "value".
    if isinstance(payload.get("d"), dict):
        return payload["d"].get("results", [])
    return payload.get("value", payload.get("d", []) or [])


def _parse_date(value) -> date | None:
    if not value:
        return None
    text = str(value)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        log.warning("unparseable date from Knesset feed: %r", text)
        return None


def fetch_members(knesset_number: int = 25) -> list[dict]:
    """Current members, to attach real records to seeded candidates."""
    rows = _odata(
        "KNS_PersonToPosition",
        filter_expr=f"KnessetNum eq {knesset_number}",
        top=500,
    )
    members = []
    for row in rows:
        person_id = row.get("PersonID")
        if not person_id:
            continue
        members.append(
            {
                "knessetMemberId": str(person_id),
                "name": (row.get("Name") or "").strip(),
                "factionName": (row.get("FactionName") or "").strip(),
                "sourceUrl": MEMBER_URL.format(id=person_id),
                "sourceName": SOURCE_NAME,
            }
        )
    return [m for m in members if m["name"]]


def fetch_votes(person_id: str, limit: int = 60) -> list[dict]:
    """Recent votes for one member, in the shape the loader expects."""
    rows = _odata(
        "KNS_PersonVotesView",
        filter_expr=f"PersonID eq {person_id}",
        top=limit,
    )
    votes = []
    for row in rows:
        vote_id = row.get("VoteID") or row.get("SessionID")
        voted_at = _parse_date(row.get("VoteDate") or row.get("StartDate"))
        title = (row.get("SessionName") or row.get("VoteName") or "").strip()
        if not vote_id or not voted_at or not title:
            continue
        votes.append(
            {
                "id": f"vote_{person_id}_{vote_id}",
                "billTitle": title,
                "topic": (row.get("TypeDesc") or "כללי").strip(),
                "date": voted_at,
                "position": VOTE_POSITIONS.get(row.get("ResultTypeID"), "absent"),
                "sourceUrl": VOTE_URL.format(id=vote_id),
                "sourceName": SOURCE_NAME,
            }
        )
    return votes


def fetch_bills(person_id: str, limit: int = 40) -> list[dict]:
    rows = _odata(
        "KNS_BillInitiator",
        filter_expr=f"PersonID eq {person_id}",
        top=limit,
    )
    bills = []
    for row in rows:
        bill_id = row.get("BillID")
        title = (row.get("Name") or "").strip()
        proposed_at = _parse_date(row.get("LastUpdatedDate") or row.get("PublicationDate"))
        if not bill_id or not title or not proposed_at:
            continue
        bills.append(
            {
                "id": f"bill_{person_id}_{bill_id}",
                "title": title,
                "topic": (row.get("SubTypeDesc") or "חקיקה").strip(),
                "status": BILL_STATUS.get((row.get("StatusDesc") or "").strip(), "proposed"),
                "date": proposed_at,
                "isLeadSponsor": bool(row.get("IsInitiator")),
                "summary": (row.get("SummaryLaw") or "").strip(),
                "sourceUrl": BILL_URL.format(id=bill_id),
                "sourceName": SOURCE_NAME,
            }
        )
    return bills


def extract(knesset_number: int = 25) -> dict:
    """Entry point used by run_etl. Never raises — reports errors instead."""
    try:
        members = fetch_members(knesset_number)
    except FetchError as exc:
        return {"members": [], "votes": [], "bills": [], "error": str(exc)}

    votes: list[dict] = []
    bills: list[dict] = []
    errors: list[str] = []
    for member in members:
        person_id = member["knessetMemberId"]
        for fetcher, sink in ((fetch_votes, votes), (fetch_bills, bills)):
            try:
                for record in fetcher(person_id):
                    record["knessetMemberId"] = person_id
                    sink.append(record)
            except FetchError as exc:
                errors.append(f"{person_id}: {exc}")

    return {
        "members": members,
        "votes": votes,
        "bills": bills,
        "error": "; ".join(errors[:5]) if errors else None,
    }
