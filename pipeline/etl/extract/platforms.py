"""Party platforms, as plain text, from the pages listed in data/sources/platforms.json.

A platform is rarely one document. Most parties publish a landing page and a
plan per subject, so each party has a list of pages. Every page is reduced
to its readable text, and the party's pages are joined in order, each
section headed by its URL so any passage can be traced back to its source.

Three things make this harder than "strip the tags":

* Site chrome. Menus, footers and cookie banners are dropped by tag (nav,
  header, footer, aside, form). Sites that build their menus out of plain
  divs are cleaned by `drop_repeated_lines`: a line that recurs on most of a
  party's pages is template, not platform.
* Encoding. One site serves UTF-8 without declaring it, and `requests` falls
  back to Latin-1, which turns Hebrew into mojibake. Pages are decoded from
  bytes as UTF-8 first.
* PDFs whose text layer is glyph names. The Religious Zionism plans come out
  of pypdf as "/uni05EA/uni05D9..." in visual order, so the names are decoded
  and each line is reversed back into reading order. Most of those PDFs
  carry little more than a heading as text; the body is drawn, not typed,
  and would need OCR. The word count in the manifest shows how little.
"""

from __future__ import annotations

import io
import re
from collections import Counter
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import quote, urlparse

from .http import FetchError, fetch

# Elements whose text is never platform content.
_SKIP_TAGS = frozenset(
    {"script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form",
     "template", "iframe", "button", "select"}
)
# Elements that start a new line of text.
_BLOCK_TAGS = frozenset(
    {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "br", "div", "section", "article",
     "tr", "blockquote", "dd", "dt"}
)
_HEBREW_WORD = re.compile(r"[֐-׿]+")


@dataclass
class Page:
    url: str
    text: str
    error: str | None = None


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag, attrs):  # noqa: ANN001
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_startendtag(self, tag, attrs):  # noqa: ANN001
        if tag == "br":
            self._parts.append("\n")

    def handle_endtag(self, tag):  # noqa: ANN001
        if tag in _SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data):  # noqa: ANN001
        if not self._skip_depth:
            self._parts.append(data)

    def lines(self) -> list[str]:
        raw = "".join(self._parts).split("\n")
        return [line for line in (re.sub(r"\s+", " ", part).strip() for part in raw) if line]


def html_to_text(markup: str) -> str:
    parser = _TextExtractor()
    parser.feed(markup)
    return "\n".join(parser.lines())


def decode_glyph_names(text: str) -> str:
    """Turn pypdf's '/uniXXXX' glyph names into letters, lines into reading order.

    The names come in visual (left-to-right) order: both the letters of each
    word and the words of each line are reversed. So each line is reversed
    whole, and runs of digits, which were the right way round, are turned
    back. Text with no glyph names is returned unchanged.
    """
    if "/uni" not in text:
        return text
    decoded = re.sub(r"/uni([0-9A-Fa-f]{4})", lambda m: chr(int(m.group(1), 16)), text)
    lines = []
    for line in decoded.split("\n"):
        line = line[::-1]
        lines.append(re.sub(r"\d+", lambda m: m.group(0)[::-1], line))
    return "\n".join(lines)


def pdf_to_text(data: bytes) -> str:
    from pypdf import PdfReader  # imported here so the rest of the pipeline doesn't need it

    reader = PdfReader(io.BytesIO(data))
    pages = [decode_glyph_names(page.extract_text() or "") for page in reader.pages]
    lines = (re.sub(r"\s+", " ", line).strip() for page in pages for line in page.split("\n"))
    return "\n".join(line for line in lines if line)


def drop_repeated_lines(pages: list[Page], share: float = 0.5) -> list[Page]:
    """Remove lines that recur on at least `share` of a party's pages.

    Menus and footers built from plain divs survive tag-based cleaning, but
    they repeat on every page of a site while platform text does not. Needs
    at least three pages to tell the two apart, so a single-page platform is
    left as it is.
    """
    texts = [page for page in pages if page.text]
    if len(texts) < 3:
        return pages
    seen = Counter(line for page in texts for line in set(page.text.split("\n")))
    limit = max(2, int(len(texts) * share))
    template = {line for line, count in seen.items() if count >= limit}
    return [
        Page(page.url, "\n".join(l for l in page.text.split("\n") if l not in template), page.error)
        for page in pages
    ]


def _encode(url: str) -> str:
    """Percent-encode a URL's Hebrew path, leaving its structure alone."""
    return quote(url, safe=":/?=&%#,+")


def fetch_page(url: str) -> Page:
    """One page as text. Never raises; a failure is recorded on the page."""
    is_pdf = urlparse(url).path.lower().endswith(".pdf")
    try:
        response = fetch(_encode(url), accept="application/pdf" if is_pdf else "text/html")
    except FetchError as exc:
        return Page(url, "", str(exc))
    if is_pdf:
        return Page(url, pdf_to_text(response.content))
    try:
        markup = response.content.decode("utf-8")
    except UnicodeDecodeError:
        markup = response.text
    return Page(url, html_to_text(markup))


def hebrew_words(text: str) -> int:
    return len(_HEBREW_WORD.findall(text))
