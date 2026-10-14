import unittest

from pipeline.etl.extract import platforms
from pipeline.etl.extract.platforms import Page


class HtmlToTextTest(unittest.TestCase):
    def test_keeps_content_and_drops_site_chrome(self):
        markup = """
            <html><head><style>p{}</style><script>var x=1</script></head><body>
            <nav><a>בית</a><a>תרומות</a></nav>
            <header>לוגו</header>
            <main><h2>ביטחון</h2><p>נקים ועדת חקירה ממלכתית.</p><p>חוק גיוס לכולם.</p></main>
            <footer>כל הזכויות שמורות</footer>
            </body></html>
        """
        self.assertEqual(
            platforms.html_to_text(markup),
            "ביטחון\nנקים ועדת חקירה ממלכתית.\nחוק גיוס לכולם.",
        )

    def test_collapses_whitespace_within_a_line(self):
        self.assertEqual(platforms.html_to_text("<p>  שכר   מינימום\t גבוה </p>"), "שכר מינימום גבוה")


class GlyphNamesTest(unittest.TestCase):
    def test_decodes_names_and_restores_reading_order(self):
        # pypdf's output for "הציונות הדתית", in visual order.
        visual = "/uni05EA/uni05D9/uni05EA/uni05D3/uni05D4 /uni05EA/uni05D5/uni05E0/uni05D5/uni05D9/uni05E6/uni05D4"
        self.assertEqual(platforms.decode_glyph_names(visual), "הציונות הדתית")

    def test_digits_keep_their_order(self):
        visual = "2026 /uni05EA/uni05D5/uni05E8/uni05D9/uni05D7/uni05D1"  # "בחירות 2026"
        self.assertEqual(platforms.decode_glyph_names(visual), "בחירות 2026")

    def test_plain_text_is_left_alone(self):
        self.assertEqual(platforms.decode_glyph_names("טקסט רגיל"), "טקסט רגיל")


class DropRepeatedLinesTest(unittest.TestCase):
    def test_removes_a_menu_that_repeats_on_every_page(self):
        pages = [
            Page("a", "תפריט\nלתרומה\nתוכנית החינוך"),
            Page("b", "תפריט\nלתרומה\nתוכנית הדיור"),
            Page("c", "תפריט\nלתרומה\nתוכנית הבריאות"),
        ]
        cleaned = platforms.drop_repeated_lines(pages)
        self.assertEqual([p.text for p in cleaned], ["תוכנית החינוך", "תוכנית הדיור", "תוכנית הבריאות"])

    def test_a_single_page_is_left_as_it_is(self):
        # With one page nothing can be told apart, so nothing is dropped.
        pages = [Page("a", "תפריט\nהמצע שלנו")]
        self.assertEqual(platforms.drop_repeated_lines(pages)[0].text, "תפריט\nהמצע שלנו")


class EncodeTest(unittest.TestCase):
    def test_hebrew_path_is_percent_encoded_and_structure_kept(self):
        url = platforms._encode("https://example.org/מצע-המפלגה/?a=1")
        self.assertTrue(url.startswith("https://example.org/%D7%9E"))
        self.assertTrue(url.endswith("/?a=1"))


if __name__ == "__main__":
    unittest.main()
