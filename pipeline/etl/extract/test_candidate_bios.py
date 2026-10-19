"""Matching a Wikipedia article to a candidate, and reading its opening."""

from __future__ import annotations

import unittest

from . import candidate_bios as cb

LEAD = "פלוני אלמוני (נולד ב-1970) הוא פוליטיקאי ישראלי, חבר הכנסת מטעם הליכוד ואלוף במילואים."

PAGE = f"""
<div class="mw-content-rtl mw-parser-output"><section>
<table class="infobox"><tr><td><p>תיבת מידע עם פסקה ארוכה מספיק כדי להיראות כמו פתיח של ערך אמיתי לכל דבר</p></td></tr></table>
<p>{LEAD}<sup class="reference">[1]</sup></p>
<p>פסקה שנייה שלא צריכה להיכנס לסקירה בכלל, גם אם היא ארוכה מספיק.</p>
</section></div>
<div class="navbox"><p>תבנית ניווט בתחתית הדף עם רשימה ארוכה של שמות שאינם קשורים</p></div>
"""


class LeadParagraphTests(unittest.TestCase):
    def test_takes_the_first_body_paragraph_not_the_infobox(self):
        self.assertEqual(cb.lead_paragraph(PAGE), LEAD)

    def test_drops_footnote_markers(self):
        self.assertNotIn("[1]", cb.lead_paragraph(PAGE))

    def test_trims_a_long_paragraph_at_a_sentence(self):
        long = "משפט ראשון ארוך מספיק. " * 60
        text = cb.lead_paragraph(f'<div class="mw-parser-output"><p>{long}</p></div>')
        self.assertLessEqual(len(text), cb.MAX_CHARS)
        self.assertTrue(text.endswith("."))


class MatchTests(unittest.TestCase):
    def test_an_article_naming_the_party_is_accepted(self):
        self.assertTrue(cb.is_about_candidate("חבר מרכז הליכוד", "likud", "", False))

    def test_the_nominating_party_inside_a_joint_list_counts(self):
        self.assertTrue(cb.is_about_candidate("פעיל ותיק בתנועה ההיסטורית", "joint-list", "התנועה ההיסטורית", False))

    def test_a_namesake_from_another_world_is_rejected(self):
        self.assertFalse(cb.is_about_candidate("כדורגלן ששיחק בהפועל", "likud", "", False))

    def test_a_knesset_member_needs_a_reviewed_link_to_count(self):
        text = "כיהן כחבר הכנסת מטעם מפלגה אחרת"
        self.assertFalse(cb.is_about_candidate(text, "yashar", "", False))
        self.assertTrue(cb.is_about_candidate(text, "yashar", "", True))

    def test_disambiguation_pages_are_recognised(self):
        self.assertTrue(cb.is_disambiguation("<a>קטגוריה:דפי פירושונים</a>"))


class NamesThePersonTests(unittest.TestCase):
    def test_a_pointed_name_still_counts(self):
        self.assertTrue(cb.names_the_person("מַנְסוּר עַבַּאס (נולד ב-1974) הוא פוליטיקאי", "מנסור עבאס"))

    def test_an_article_about_a_namesake_family_is_rejected(self):
        lead = "חסידות קוצק היא חצר חסידית שנוסדה על ידי רבי מנחם מנדל מורגנשטרן"
        self.assertFalse(cb.names_the_person(lead, "משה מורגנשטרן"))

    def test_full_and_defective_spelling_match(self):
        self.assertTrue(cb.names_the_person("בועז בִּיסְמוּט (נולד ב-1964) הוא חבר הכנסת", "בעז ביסמוט"))
        self.assertTrue(cb.names_the_person("משה יהודה טור־פז (נולד ב-1972)", "משה יהודה טור-פז"))
        self.assertTrue(cb.names_the_person("יאסר מחמוד חֻג'יראת (נולד ב־1965)", "יאסר חוג'יראת"))

    def test_either_half_of_a_double_surname_counts(self):
        self.assertTrue(cb.names_the_person("פנינה (פנטה) תַּמֶנוֹ-שֶׁטֶה (נולדה ב-1981)", "פנינה תמנו"))
        self.assertTrue(cb.names_the_person("מהרטה ברוך-רון (נולדה ב-1976)", "מהרטה ברוך רון"))

    def test_the_qualifier_in_a_title_is_ignored(self):
        self.assertTrue(cb.names_the_person("שלמה קרעי הוא פוליטיקאי", "שלמה קרעי (פוליטיקאי)"))


class NameVariantTests(unittest.TestCase):
    def test_a_bracketed_nickname_is_dropped(self):
        self.assertIn("פנינה תמנו", cb.name_variants("פנינה (פנחש) תמנו"))

    def test_a_middle_name_is_dropped_either_way(self):
        variants = cb.name_variants("גאולה עליזה בלוך")
        self.assertIn("עליזה בלוך", variants)
        self.assertIn("גאולה בלוך", variants)

    def test_a_geresh_is_tried_after_g_z_ts(self):
        self.assertIn("יוסף ג'בארין", cb.name_variants("יוסף גבארין"))

    def test_the_printed_name_is_not_repeated(self):
        self.assertNotIn("שלמה קרעי", cb.name_variants("שלמה קרעי"))


if __name__ == "__main__":
    unittest.main()
