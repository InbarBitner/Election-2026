"""Tests for the shared HTTP client's robots.txt handling.

These exist because of a real failure: robots.txt was being fetched by
`RobotFileParser.read()`, which uses urllib's default User-Agent. Wikimedia
answers 403 to an unidentified agent, and the standard library treats a 403 on
robots.txt as "this host forbids everything" — without raising. Every URL on
Wikipedia therefore reported as disallowed, ordinary article pages included,
and the only visible symptom was a connector that could not fetch anything.
"""

from __future__ import annotations

import unittest
from unittest import mock

from . import http

# Trimmed from the real file: /w/ and /api/ are disallowed, /wiki/ is not.
WIKIPEDIA_ROBOTS = """
User-agent: MJ12bot
Disallow: /

User-agent: *
Allow: /w/api.php?action=mobileview&
Disallow: /w/
Disallow: /api/
Disallow: /trap/
Disallow: /wiki/Special:Random
"""


class _Response:
    def __init__(self, status_code: int, text: str = "") -> None:
        self.status_code = status_code
        self.text = text


class RobotsTest(unittest.TestCase):
    def setUp(self):
        http._robots.cache_clear()

    def test_robots_is_requested_with_our_identifying_user_agent(self):
        """The whole bug: an unidentified request gets 403 and blocks the host."""
        with mock.patch.object(
            http.requests, "get", return_value=_Response(200, WIKIPEDIA_ROBOTS)
        ) as get:
            http.is_allowed("https://en.wikipedia.org/wiki/Israel")

        headers = get.call_args.kwargs["headers"]
        self.assertEqual(headers["User-Agent"], http.USER_AGENT)

    def test_article_pages_are_allowed_and_api_paths_are_not(self):
        with mock.patch.object(
            http.requests, "get", return_value=_Response(200, WIKIPEDIA_ROBOTS)
        ):
            self.assertTrue(http.is_allowed("https://en.wikipedia.org/wiki/Israel"))
            self.assertFalse(http.is_allowed("https://en.wikipedia.org/w/api.php"))
            self.assertFalse(
                http.is_allowed("https://en.wikipedia.org/api/rest_v1/page/html/Israel")
            )

    def test_a_missing_robots_file_restricts_nothing(self):
        with mock.patch.object(http.requests, "get", return_value=_Response(404)):
            self.assertTrue(http.is_allowed("https://example.com/anything"))

    def test_a_forbidden_robots_file_restricts_nothing(self):
        """RFC 9309: every 4xx means "unavailable", 403 included.

        S3 answers 403 for a key that does not exist, so a bucket with no
        robots.txt looked like a bucket that forbids everything.
        """
        for status in (401, 403, 410):
            http._robots.cache_clear()
            with mock.patch.object(http.requests, "get", return_value=_Response(status)):
                self.assertTrue(http.is_allowed("https://example.com/anything"), status)

    def test_a_server_error_on_robots_blocks_the_host(self):
        """RFC 9309: a 5xx leaves the rules unknown, so assume the strictest."""
        with mock.patch.object(http.requests, "get", return_value=_Response(503)):
            self.assertFalse(http.is_allowed("https://example.com/anything"))

    def test_an_unreachable_robots_file_does_not_block_the_host(self):
        with mock.patch.object(
            http.requests, "get", side_effect=OSError("connection reset")
        ):
            self.assertTrue(http.is_allowed("https://example.com/anything"))

    def test_robots_is_fetched_once_per_host(self):
        with mock.patch.object(
            http.requests, "get", return_value=_Response(200, WIKIPEDIA_ROBOTS)
        ) as get:
            for path in ("/wiki/A", "/wiki/B", "/wiki/C"):
                http.is_allowed(f"https://en.wikipedia.org{path}")
        self.assertEqual(get.call_count, 1)


if __name__ == "__main__":
    unittest.main()


class _JsonResponse:
    """Enough of requests.Response for fetch_json, including a bad body."""

    def __init__(self, text: str, content_type: str = "application/json") -> None:
        self.status_code = 200
        self.text = text
        self.headers = {"Content-Type": content_type}

    def json(self):
        import json as _json

        return _json.loads(self.text)

    def raise_for_status(self):
        return None


class RetryTest(unittest.TestCase):
    """A 4xx is an answer, not a hiccup: asking again only costs the source requests."""

    def setUp(self):
        http._robots.cache_clear()

    def _response(self, status):
        r = mock.Mock(status_code=status)
        r.raise_for_status.side_effect = Exception(str(status))
        return r

    def test_a_missing_page_is_asked_for_once(self):
        with mock.patch.object(http, "is_allowed", return_value=True), \
             mock.patch.object(http, "_throttle"), \
             mock.patch.object(http.requests, "get", return_value=self._response(404)) as get:
            with self.assertRaises(http.ClientError) as caught:
                http.fetch("https://example.com/missing")
        self.assertEqual(get.call_count, 1)
        self.assertEqual(caught.exception.status, 404)

    def test_too_many_requests_is_retried(self):
        with mock.patch.object(http, "is_allowed", return_value=True), \
             mock.patch.object(http, "_throttle"), \
             mock.patch.object(http.time, "sleep"), \
             mock.patch.object(http.requests, "get", return_value=self._response(429)) as get:
            with self.assertRaises(http.FetchError):
                http.fetch("https://example.com/busy")
        self.assertEqual(get.call_count, http.MAX_RETRIES)


class FetchJsonTest(unittest.TestCase):
    """A 200 that is not JSON must read as an unreachable source.

    From a real outage: the Knesset OData service answered a query with an
    HTML page. `.json()` sat outside everything `fetch` protects, so the
    JSONDecodeError was not a FetchError, slipped past every `except
    FetchError` on the way up, and ended the whole nightly run — taking the
    polls, the vectors and the daily brief with it.
    """

    def test_valid_json_is_returned(self):
        with mock.patch.object(http, "fetch", return_value=_JsonResponse('{"value": [1]}')):
            self.assertEqual(http.fetch_json("https://example.com/odata"), {"value": [1]})

    def test_an_html_body_raises_fetch_error_not_a_decode_error(self):
        page = "<!DOCTYPE html><html><body>Service unavailable</body></html>"
        with mock.patch.object(
            http, "fetch", return_value=_JsonResponse(page, "text/html; charset=utf-8")
        ):
            with self.assertRaises(http.FetchError):
                http.fetch_json("https://example.com/odata")

    def test_the_error_says_what_came_back_instead(self):
        # "Expecting value: line 1 column 1" says only "not JSON". Whether it
        # was an outage notice, a login page or a rate-limit message is the
        # part that decides what to do next.
        page = "<html><body>אתר הכנסת בתחזוקה</body></html>"
        with mock.patch.object(
            http, "fetch", return_value=_JsonResponse(page, "text/html")
        ):
            with self.assertRaises(http.FetchError) as caught:
                http.fetch_json("https://example.com/odata")
        message = str(caught.exception)
        self.assertIn("text/html", message)
        self.assertIn("בתחזוקה", message)

    def test_an_empty_body_is_named_as_such(self):
        with mock.patch.object(http, "fetch", return_value=_JsonResponse("", "text/plain")):
            with self.assertRaises(http.FetchError) as caught:
                http.fetch_json("https://example.com/odata")
        self.assertIn("גוף ריק", str(caught.exception))
