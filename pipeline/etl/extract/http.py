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


@lru_cache(maxsize=64)
def _robots(origin: str) -> urllib.robotparser.RobotFileParser | None:
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(f"{origin}/robots.txt")
    try:
        parser.read()
    except Exception as exc:  # noqa: BLE001 — a missing robots.txt is not fatal
        log.warning("could not read robots.txt for %s: %s", origin, exc)
        return None
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
            response.raise_for_status()
            return response
        except Exception as exc:  # noqa: BLE001 — retried below
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(2**attempt)

    raise FetchError(f"נכשלה שליפה מ-{url}: {last_error}")


def fetch_json(url: str, *, params: dict | None = None) -> dict:
    return fetch(url, params=params).json()
