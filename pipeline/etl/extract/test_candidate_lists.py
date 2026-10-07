import unittest

from pipeline.etl.extract import candidate_lists as cl
from pipeline.load_candidates import display_name


class LogicalTextTest(unittest.TestCase):
    def test_reverses_hebrew_and_restores_digits(self):
        # Visual order as pypdf's layout mode returns it.
        self.assertEqual(cl._logical("ףולכמ רהוז .12"), "12. זוהר מכלוף")

    def test_mirrors_brackets(self):
        self.assertEqual(cl._logical("(שחנפ) הנינפ ונמת"), "תמנו פנינה (פנחש)")


class CellsTest(unittest.TestCase):
    def test_columns_far_apart(self):
        line = "ןוני יאלוזא .2                    ףולכמ הירא יערד .1"
        cells = [cl._logical(line[a:b]) for a, b in cl._cells(line)]
        self.assertEqual(cells, ["2. אזולאי ינון", "1. דרעי אריה מכלוף"])

    def test_columns_only_four_spaces_apart_are_split_after_the_number(self):
        line = "ןוני יאלוזא .2    ףולכמ הירא יערד .1"
        cells = [cl._logical(line[a:b]) for a, b in cl._cells(line)]
        self.assertEqual(cells, ["2. אזולאי ינון", "1. דרעי אריה מכלוף"])

    def test_number_spaced_off_its_dot_stays_with_the_name(self):
        line = "ילתפנ טנב .  1"
        cells = [cl._logical(line[a:b]) for a, b in cl._cells(line)]
        self.assertEqual(cells, ["1  . בנט נפתלי"])


class CleanNameTest(unittest.TestCase):
    def test_strips_the_ai_badge(self):
        self.assertEqual(cl._clean_name("רפאל ערן אביחי עוזר ה-IA הממשלתי"), "רפאל ערן אביחי")

    def test_strips_a_badge_overlapping_a_name(self):
        self.assertEqual(cl._clean_name("דראושה עוזר באסםה-IA הממשלתי"), "דראושה באסם")

    def test_strips_the_page_footer(self):
        self.assertEqual(cl._clean_name("גדלקין אלכסנדר מידע שימושי לכל השירותים"), "גדלקין אלכסנדר")

    def test_keeps_ozer_as_a_real_name(self):
        self.assertEqual(cl._clean_name("כהן עוזר"), "כהן עוזר")


class ValidateTest(unittest.TestCase):
    def test_gap_in_positions_is_a_problem(self):
        entries = [cl.ListEntry(1, "א ב", None), cl.ListEntry(3, "ג ד", None)]
        self.assertTrue(cl.validate(entries))

    def test_latin_letters_in_a_name_are_a_problem(self):
        entries = [cl.ListEntry(1, "לוי דור IA", None)]
        self.assertTrue(cl.validate(entries))


class DisplayNameTest(unittest.TestCase):
    def test_two_words_swap(self):
        self.assertEqual(display_name("נתניהו בנימין", {}), ("בנימין נתניהו", True))

    def test_longer_names_need_an_override(self):
        self.assertEqual(display_name("לסקי שוץ גבריאלה", {}), ("לסקי שוץ גבריאלה", False))
        overrides = {"לסקי שוץ גבריאלה": "גבריאלה לסקי שוץ"}
        self.assertEqual(display_name("לסקי שוץ גבריאלה", overrides), ("גבריאלה לסקי שוץ", True))


if __name__ == "__main__":
    unittest.main()
