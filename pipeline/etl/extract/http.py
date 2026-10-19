"""Shared HTTP behaviour for every extractor.

Scraping public sites politely is a requirement, not a nicety: the client
identifies itself, honours robots.txt, rate-limits itself, and retries with
backoff instead of hammering a source that is briefly down.
"""

from __future__ import annotations

import logging
import time
import urllib.robotparser
from functools import lru_cache
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)

USER_AGENT = (
    "Election2026Bot/0.1 (+https://github.com/InbarBitner/Election-2026; "
    "poll and open-data aggregation)"
)
REQUEST_TIMEOUT = 20
# Minimum delay between two requests to the same host.
MIN_INTERVAL_SECONDS = 1.5
MAX_RETRIES = 3

_last_request_at: dict[str, float] = {}


class FetchError(RuntimeError):
    """Raised when a source cannot be fetched. Never fatal to the whole run."""


class ClientError(FetchError):
    """A 4xx answer. Asking again will not change it, so it is not retried."""

    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


@lru_cache(maxsize=64)
def _robots(origin: str) -> urllib.robotparser.RobotFileParser | None:
    """Fetch and parse a host's robots.txt.

    The fetch is done here rather than by `RobotFileParser.read()`, which
    issues the request with urllib's default User-Agent. Wikimedia — and it is
    not alone — answers 403 to an unidentified agent, and `read()` treats 403
    as "this host forbids everything" without raising. The result was that
    every URL on Wikipedia reported as disallowed, including ordinary article
    pages that robots.txt plainly permits, and nothing surfaced the reason.

    So the file is requested with the same identifying User-Agent as every
    other call, and only the parsing is left to the standard library.

    The Accept header carries a fallback for the same reason: idi.org.il
    answers a bare "text/plain" with 406, which would otherwise read as a ban
    on the whole host although its robots.txt permits what we fetch.

    Status codes follow RFC 9309 §2.3.1: any 4xx means the file is
    unavailable, so nothing is restricted; a 5xx means the server could not
    say, so everything is. A 403 used to block the host, and it hid the
    Democrats' platform: their PDFs sit in an S3 bucket, which answers 403 for
    any key that does not exist — robots.txt included — while the party's own
    site links every file for download.
    """
    url = f"{origin}/robots.txt"
    try:
        response = requests.get(
            url,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": USER_AGENT, "Accept": "text/plain, */*;q=0.1"},
        )
    except Exception as exc:  # noqa: BLE001 — an unreachable robots.txt is not fatal
        log.warning("could not read robots.txt for %s: %s", origin, exc)
        return None

    if 400 <= response.status_code < 500:
        # No readable robots.txt: nothing is stated, so nothing is restricted.
        return None
    if response.status_code >= 500:
        log.warning(
            "robots.txt for %s returned %s — treating the host as off limits",
            origin,
            response.status_code,
        )
        parser = urllib.robotparser.RobotFileParser()
        parser.disallow_all = True
        return parser

    parser = urllib.robotparser.RobotFileParser()
    parser.parse(response.text.splitlines())
    return parser


def is_allowed(url: str) -> bool:
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    parser = _robots(origin)
    if parser is None:
        # No robots.txt means no stated restriction.
        return True
    return parser.can_fetch(USER_AGENT, url)


def _throttle(host: str) -> None:
    last = _last_request_at.get(host)
    if last is not None:
        wait = MIN_INTERVAL_SECONDS - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
    _last_request_at[host] = time.monotonic()


def fetch(url: str, *, params: dict | None = None, accept: str = "application/json"):
    """GET a URL politely. Raises FetchError rather than leaking requests errors."""
    if not is_allowed(url):
        raise FetchError(f"robots.txt אוסר על שליפת {url}")

    host = urlparse(url).netloc
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        _throttle(host)
        try:
            response = requests.get(
                url,
                params=params,
                timeout=REQUEST_TIMEOUT,
                headers={"User-Agent": USER_AGENT, "Accept": accept},
            )
            if response.status_code >= 500:
                raise FetchError(f"{url} החזיר {response.status_code}")
            # 429 asks us to slow down, so it is retried after the backoff;
            # any other 4xx is an answer, not a hiccup — a missing page stays
            # missing, and retrying it only costs the source three requests.
            if 400 <= response.status_code < 500 and response.status_code != 429:
                raise ClientError(f"{url} החזיר {response.status_code}", response.status_code)
            response.raise_for_status()
            return response
        except ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — retried below
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(2**attempt)

    raise FetchError(f"נכשלה שליפה מ-{url}: {last_error}")


def fetch_json(url: str, *, params: dict | None = None) -> dict:
    """Fetch and parse JSON, reporting a non-JSON body as a fetch failure.

    `fetch` is careful — it retries, and turns an HTTP error into FetchError —
    but `.json()` used to sit outside that care, so a 200 response carrying
    something else raised `requests.exceptions.JSONDecodeError` instead. That
    is not a FetchError, so it escaped every `except FetchError` between here
    and the top and ended the whole run. A service answering an OData query
    with an HTML maintenance page is an ordinary Tuesday, not an exceptional
    event, and it must look like any other unreachable source.

    The message carries the content type and the first bytes of the body,
    because "Expecting value: line 1 column 1 (char 0)" says only that the
    reply was not JSON — never that it was a login page, a rate-limit notice,
    or an outage notice, which is the thing worth knowing.
    """
    response = fetch(url, params=params)
    try:
        return response.json()
    except ValueError as exc:
        content_type = response.headers.get("Content-Type", "לא צוין")
        preview = " ".join(response.text[:200].split())
        raise FetchError(
            f"{url} החזיר תשובה שאינה JSON (Content-Type: {content_type}): "
            f"{preview or '[גוף ריק]'}"
        ) from exc
