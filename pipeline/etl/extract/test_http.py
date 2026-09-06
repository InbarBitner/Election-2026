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

    def test_a_forbidden_robots_file_still_blocks_the_host(self):
        """A 403 is not treated as permission — only as not-a-404."""
        with mock.patch.object(http.requests, "get", return_value=_Response(403)):
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
