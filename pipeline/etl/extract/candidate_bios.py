"""A short overview of each candidate, from their Hebrew Wikipedia article.

The overview is the article's opening paragraph — who the person is, and the
military and civilian roles they are known for — with a link back to it. It is
taken from Wikipedia and never written from memory: these are real people, and
an invented line about one is worse than no line.

Finding the right article is the risk. A candidate's name is looked up as an
article title (and with the usual "(פוליטיקאי)" qualifier), and an article is
accepted only if it is plainly about this candidate:

- it is not a disambiguation page, and
- it names the candidate's party (or the party that nominated them inside a
  joint list), or the candidate is linked to a Knesset member record and the
  article says they served in the Knesset.

A namesake — the footballer who shares a name with a list's 30th place — fails
both and is left out. Anything not found stays empty; the site says so.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import quote

from .http import ClientError, fetch

ARTICLE_URL = "https://he.wikipedia.org/wiki/{title}"
SOURCE_NAME = "ויקיפדיה"
QUALIFIERS = ("", " (פוליטיקאי)", " (פוליטיקאית)")
MAX_CHARS = 600
MIN_PARAGRAPH = 60

# Party names as an article is likely to write them. The site's display names
# are not always how an encyclopedia refers to a party or its components.
PARTY_ALIASES: dict[str, tuple[str, ...]] = {
    "likud": ("הליכוד", "ליכוד"),
    "yashar": ("ישר!", "ישר עם איזנקוט"),
    "yachad": ("ביחד", "בנט 2026"),
    "democrats": ("הדמוקרטים", "העבודה", "מרצ"),
    "joint-list": ("הרשימה המשותפת", 'חד"ש', 'בל"ד', 'תע"ל', "חד״ש", "בל״ד", "תע״ל"),
    "raam": ('רע"ם', "רע״ם", "הרשימה הערבית המאוחדת"),
    "shas": ('ש"ס', "ש״ס"),
    "yahadut-hatorah": ("יהדות התורה", "אגודת ישראל", "דגל התורה"),
    "otzma": ("עוצמה יהודית",),
    "religious-zionism": ("הציונות הדתית", "זהות", "האיחוד הלאומי"),
    "yisrael-beitenu": ("ישראל ביתנו",),
    "kachol-lavan": ("כחול לבן", "המחנה הממלכתי"),
    "zionist-home": ("המילואימניקים", "הכלכלית"),
    "amcha-israel": ("עמך ישראל",),
}
KNESSET_WORDS = ("חבר הכנסת", "חברת הכנסת", "חבר כנסת", "חברת כנסת")


@dataclass(frozen=True)
class Overview:
    text: str
    url: str


class _LeadParser(HTMLParser):
    """Collects the paragraphs that sit directly in the article body.

    Infoboxes, navigation boxes and hatnotes are tables or divs of their own,
    so a paragraph inside one of them is not part of the body text and is
    skipped — that is where a naive "first <p>" goes wrong.
    """

    SKIP = {"sup", "style", "script"}
    VOID = {"br", "img", "hr", "meta", "link", "input", "wbr", "source", "area", "col"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.body_depth: int | None = None
        self.body_closed = False
        self.in_lead_p = False
        self.skip_depth = 0
        self.current: list[str] = []
        self.paragraphs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            return
        classes = (dict(attrs).get("class") or "").split()
        self.stack.append(tag)
        if self.body_closed:
            return
        if self.body_depth is None and tag == "div" and "mw-parser-output" in classes:
            self.body_depth = len(self.stack)
        elif (
            tag == "p"
            and self.body_depth is not None
            # Directly in the body, or in the <section> wrappers newer article
            # HTML puts around each heading's content — but not in an infobox
            # table or a navigation div.
            and all(t == "section" for t in self.stack[self.body_depth : -1])
        ):
            self.in_lead_p = True
            self.current = []
        elif self.in_lead_p and tag in self.SKIP:
            self.skip_depth += 1

    def handle_endtag(self, tag):
        if tag in self.VOID or not self.stack or tag not in self.stack:
            return
        # Tolerate unbalanced markup by unwinding to the matching tag.
        while self.stack:
            top = self.stack.pop()
            if self.in_lead_p and top in self.SKIP and self.skip_depth:
                self.skip_depth -= 1
            if top == "p" and self.in_lead_p:
                self.in_lead_p = False
                self.paragraphs.append("".join(self.current))
            if top == tag:
                break
        if self.body_depth is not None and len(self.stack) < self.body_depth:
            self.body_closed = True

    def handle_data(self, data):
        if self.in_lead_p and not self.skip_depth:
            self.current.append(data)


def lead_paragraph(page_html: str) -> str:
    """The article's first real paragraph, cleaned and trimmed at a sentence."""
    parser = _LeadParser()
    parser.feed(page_html)
    for raw in parser.paragraphs:
        text = re.sub(r"\[\d+\]", "", html.unescape(raw))
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= MIN_PARAGRAPH:
            return _trim(text)
    return ""


def _trim(text: str) -> str:
    if len(text) <= MAX_CHARS:
        return text
    cut = text[:MAX_CHARS]
    end = max(cut.rfind(". "), cut.rfind("."))
    return cut[: end + 1] if end > MAX_CHARS // 2 else cut.rstrip() + "…"


NIQQUD = re.compile(r"[\u0591-\u05BD\u05BF-\u05C7]")  # vowel points, but not the maqaf (U+05BE)


def _norm(word: str) -> str:
    """A spelling-insensitive form of a Hebrew word.

    Full and defective spelling differ in ו and י ("בעז"/"בועז",
    "ווליד"/"וליד"), Wikipedia points names, and a geresh or maqaf comes and
    goes ("חוג'יראת"/"חֻג'יראת", "טור-פז"/"טור־פז"). So those are all dropped.
    """
    word = NIQQUD.sub("", word).replace("\u05BE", "-")
    return re.sub(r"[וי'׳\"״]", "", word)


def names_the_person(lead: str, title: str) -> bool:
    """Whether the opening paragraph is about someone with this name.

    It must carry the surname and at least one other word of the title, as
    whole words and ignoring spelling (see `_norm`). That rejects an article
    reached through a family name but about someone else — a name variant once
    led to a page on a Hasidic court founded by a rabbi who shared the
    candidate's surname.
    """
    words = [w for w in re.sub(r"\([^)]*\)", " ", title).split() if len(w) > 1]
    if len(words) < 2:
        return False
    tokens = {_norm(t) for t in re.split(r"[^\u0590-\u05FF'\-\"״]+", lead) if t}
    # Either half of a double surname counts on its own ("תמנו-שטה",
    # "ברוך-רון"), so hyphenated words are also split into their parts.
    words_in_lead = tokens | {part for t in tokens for part in t.split("-") if part}
    surname, others = _norm(words[-1]), [_norm(w) for w in words[:-1]]
    return surname in words_in_lead and any(o in words_in_lead for o in others)


def is_disambiguation(page_html: str) -> bool:
    return "פירושונים" in page_html


def is_about_candidate(page_text: str, party_id: str, nominated_by: str, has_knesset_link: bool) -> bool:
    names = set(PARTY_ALIASES.get(party_id, ()))
    if nominated_by:
        names.add(nominated_by)
    # A preposition swallows the definite article: "בדמוקרטים", not
    # "בהדמוקרטים". So a name starting with ה also counts without it.
    names |= {name[1:] for name in names if name.startswith("ה") and len(name) > 3}
    if any(name and name in page_text for name in names):
        return True
    return has_knesset_link and any(word in page_text for word in KNESSET_WORDS)


def name_variants(name: str) -> list[str]:
    """Other ways an article may title the same person, most likely first.

    The committee prints full legal names; an encyclopedia titles people by
    the name they go by. So: without a bracketed nickname ("פנינה (פנחש) תמנו"),
    without a middle name in either direction ("גאולה עליזה בלוך" is titled
    "עליזה בלוך"), and with the geresh an Arabic name is usually written with
    ("יוסף גבארין" is "יוסף ג'בארין"). The match check still decides; these
    only widen the search.
    """
    variants: list[str] = []
    plain = re.sub(r"\s*\([^)]*\)\s*", " ", name).strip()
    words = plain.split()
    if plain != name:
        variants.append(plain)
    if len(words) >= 3:
        variants += [f"{words[0]} {words[-1]}", f"{words[-2]} {words[-1]}"]
    for i, ch in enumerate(plain):
        if ch in "גזצ" and plain[i + 1 : i + 2] not in ("'", "׳"):
            variants.append(plain[: i + 1] + "'" + plain[i + 1 :])
    seen = {name}
    return [v for v in variants if not (v in seen or seen.add(v))]


def _lookup(title: str) -> str | None:
    url = ARTICLE_URL.format(title=quote(title.replace(" ", "_"), safe="()"))
    try:
        return fetch(url, accept="text/html").text
    except ClientError as exc:
        if exc.status == 404:
            return None
        raise


def find_overview(name: str, party_id: str, nominated_by: str = "", has_knesset_link: bool = False) -> Overview | None:
    """Look the candidate up; None when no article is plainly about them.

    Raises FetchError (ClientError is one) for anything but "no such article",
    so the caller can tell an empty result from a broken connection.
    """
    # The qualifiers only for the name as printed; a variant is already a
    # guess, and a guess with a qualifier rarely finds anything new.
    titles = [name + q for q in QUALIFIERS] + name_variants(name)
    for title in titles:
        page = _lookup(title)
        if page is None or is_disambiguation(page):
            continue
        url = ARTICLE_URL.format(title=quote(title.replace(" ", "_"), safe="()"))
        text = lead_paragraph(page)
        if not text or not names_the_person(text, title):
            continue
        plain = re.sub(r"<[^>]+>", " ", page)
        if is_about_candidate(plain, party_id, nominated_by, has_knesset_link):
            return Overview(text=text, url=url)
    return None
