"""Building the party position vectors used by the recommendation engine.

A party's position on an axis has two ingredients:

1. The explicit planks in its platform (`PlatformPlank.position`). This is the
   authoritative signal — a stated position, with a source.
2. A TF-IDF signal over the party's free platform text and its candidates'
   recorded statements. Every axis has a small vocabulary of terms associated
   with each of its poles; the party's text is scored against both vocabularies
   and the difference gives a position in -1..1.

The two are blended, with the planks dominating. The TF-IDF part exists to pick
up emphasis the plank list misses — a party whose platform mentions housing
costs in every paragraph leans further towards the interventionist pole than a
single plank suggests — and never to overrule a stated position.
"""

from __future__ import annotations

import math
from collections import Counter

from sklearn.feature_extraction.text import TfidfVectorizer

# Weight of the explicit planks in the blend. The remainder goes to TF-IDF.
PLANK_WEIGHT = 0.75

# Vocabulary per axis pole. Deliberately small and readable: these terms are an
# editorial choice and belong under review, not buried in a model file.
AXIS_TERMS: dict[str, dict[str, list[str]]] = {
    "security": {
        "positive": ["ריבונות", "התיישבות", "הרתעה", "עוצמה", "ביטחון", "מחבלים", "התנחלויות", "צבאית"],
        "negative": ["הסדר", "שתי מדינות", "פשרה", "כיבוש", "שלום", "משא ומתן", "דיפלומטי"],
    },
    "economy": {
        "positive": ["שוק חופשי", "הפרטה", "מסים", "רגולציה", "תחרות", "יזמות", "יבוא"],
        "negative": ["רווחה", "קצבאות", "שכר מינימום", "עובדים", "דיור", "פערים", "ציבורי"],
    },
    "religion": {
        "positive": ["תורה", "רבנות", "ישיבות", "שבת", "כשרות", "מסורת", "הלכה", "חרדי"],
        "negative": ["חילוני", "הפרדת דת", "גיוס שוויוני", "נישואין אזרחיים", "כפייה דתית", "חופש דת"],
    },
    "governance": {
        "positive": ["רפורמה", "התגברות", "מחוקקת", "נבחר", "יועמש", "משילות"],
        "negative": ["בגץ", "עצמאות", "ביקורת שיפוטית", "חוקה", "זכויות אדם", "ועדת חקירה"],
    },
    "society": {
        "positive": ["יהודית", "לאומית", "לאום", "מסורת", "הגירה", "צביון"],
        "negative": ["שוויון", "פלורליזם", "מיעוטים", "להטב", "גזענות", "אזרחי", "זכויות"],
    },
}


def _normalise(text: str) -> str:
    return text.replace('"', "").replace("'", "").replace("״", "").replace("׳", "")


def tfidf_positions(texts: dict[str, str]) -> dict[str, dict[str, float]]:
    """Score each party's text against the pole vocabularies of every axis.

    Returns {party_id: {axis: position in -1..1}}. Parties with no text get an
    empty mapping rather than a fabricated zero, so the caller can fall back to
    the planks alone.
    """
    party_ids = [pid for pid, text in texts.items() if text.strip()]
    if not party_ids:
        return {}

    corpus = [_normalise(texts[pid]) for pid in party_ids]
    # Character n-grams handle Hebrew's prefixed particles ("ל", "ב", "ה")
    # without needing a morphological analyser.
    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=1)
    matrix = vectorizer.fit_transform(corpus)
    vocabulary = vectorizer.vocabulary_

    def term_score(row: int, term: str) -> float:
        """Summed TF-IDF weight of a term's character n-grams in one document."""
        term = _normalise(term)
        total = 0.0
        for size in range(3, 6):
            for start in range(0, max(1, len(term) - size + 1)):
                gram = term[start : start + size]
                column = vocabulary.get(gram)
                if column is not None:
                    total += matrix[row, column]
        return total

    positions: dict[str, dict[str, float]] = {}
    for row, party_id in enumerate(party_ids):
        axis_positions: dict[str, float] = {}
        for axis, poles in AXIS_TERMS.items():
            positive = sum(term_score(row, t) for t in poles["positive"])
            negative = sum(term_score(row, t) for t in poles["negative"])
            if positive + negative == 0:
                continue
            # tanh keeps a party that simply writes a lot from saturating.
            axis_positions[axis] = math.tanh((positive - negative) / (positive + negative) * 1.5)
        positions[party_id] = axis_positions
    return positions


def build_vectors(
    planks: dict[str, dict[str, float]],
    texts: dict[str, str],
) -> tuple[dict[str, dict[str, float]], str]:
    """Blend stated planks with the TF-IDF signal.

    `planks` is {party_id: {axis: position}}, `texts` the free platform text
    plus statements. Returns the vectors and a label describing how they were
    derived, which is stored on the row so the UI can be honest about it.
    """
    try:
        tfidf = tfidf_positions(texts)
        derived_from = "platform+tfidf"
    except Exception:  # noqa: BLE001 — the planks alone are a valid fallback
        tfidf = {}
        derived_from = "platform"

    vectors: dict[str, dict[str, float]] = {}
    for party_id, axis_positions in planks.items():
        blended: dict[str, float] = {}
        party_tfidf = tfidf.get(party_id, {})
        for axis in AXIS_TERMS:
            stated = axis_positions.get(axis)
            inferred = party_tfidf.get(axis)
            if stated is None and inferred is None:
                continue
            if stated is None:
                blended[axis] = round(inferred, 4)
            elif inferred is None:
                blended[axis] = round(stated, 4)
            else:
                blended[axis] = round(
                    PLANK_WEIGHT * stated + (1 - PLANK_WEIGHT) * inferred, 4
                )
        if blended:
            vectors[party_id] = blended

    if not any(tfidf.values()):
        derived_from = "platform"
    return vectors, derived_from


def vocabulary_report(texts: dict[str, str]) -> Counter:
    """Which pole terms actually appear in the corpus — used to audit AXIS_TERMS."""
    counts: Counter = Counter()
    for text in texts.values():
        normalised = _normalise(text)
        for poles in AXIS_TERMS.values():
            for pole_terms in poles.values():
                for term in pole_terms:
                    if _normalise(term) in normalised:
                        counts[term] += 1
    return counts
