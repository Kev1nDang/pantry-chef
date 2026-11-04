"""The rule-based grocery parser (pasted lists, text PDFs and OCR'd receipts; no LLM)."""

import pytest

from app.services.grocery_text import canonical_name, parse_grocery_text

KNOWN = ["banana", "chicken breast", "egg", "milk", "onion", "rice", "tomato", "canned tomato"]


def items(text: str, known=KNOWN, fuzzy: bool = True) -> list[tuple[str, float, str]]:
    return [(i.name, i.amount, i.unit) for i in parse_grocery_text(text, known, fuzzy)]


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("2 lb chicken breast", ("chicken breast", 908, "g")),
        ("chicken breast 2lb", ("chicken breast", 908, "g")),
        ("milk 2L", ("milk", 2, "l")),
        ("1 dozen eggs", ("egg", 12, "pcs")),
        ("a dozen eggs", ("egg", 12, "pcs")),
        ("half a dozen eggs", ("egg", 6, "pcs")),
        ("eggs x12", ("egg", 12, "pcs")),
        ("12x eggs", ("egg", 12, "pcs")),
        ("eggs (12)", ("egg", 12, "pcs")),
        ("1 1/2 cups rice", ("rice", 1.5, "cup")),
        ("1½ cups rice", ("rice", 1.5, "cup")),
        ("½ cup rice", ("rice", 0.5, "cup")),
        ("3 tomatoes", ("tomato", 3, "pcs")),
        ("two onions", ("onion", 2, "pcs")),
        ("500g rice", ("rice", 500, "g")),
        ("1,5 kg rice", ("rice", 1.5, "kg")),
        ("1000 g rice", ("rice", 1000, "g")),
        ("16 oz rice", ("rice", 448, "g")),
        ("milk 1 gallon", ("milk", 3.79, "l")),
        ("2 fl. oz milk", ("milk", 60, "ml")),
        ("2 tbsp olive oil", ("olive oil", 2, "tbsp")),
        ("1 tsp salt", ("salt", 1, "tsp")),
        ("2 cans of chickpeas", ("chickpea", 2, "pcs")),
        ("2 x 400g canned tomatoes", ("canned tomato", 800, "g")),
        ("a bag of rice", ("rice", 1, "pcs")),
        ("onions", ("onion", 1, "pcs")),
        ("- 2 onions", ("onion", 2, "pcs")),
        ("[x] milk", ("milk", 1, "pcs")),
        ("1. milk", ("milk", 1, "pcs")),
        ("2% milk", ("milk", 1, "pcs")),
        ("Large Free Range Eggs", ("egg", 1, "pcs")),
        ("garlic", ("garlic", 1, "pcs")),
        ("2 large eggs", ("egg", 2, "pcs")),
    ],
)
def test_typed_lines(line, expected):
    assert items(line) == [expected]


def test_a_typed_list():
    text = "2 lb chicken breast\n1 dozen eggs\nmilk 2L\n\n- onions, garlic; 3 tomatoes"
    assert items(text) == [
        ("chicken breast", 908, "g"),
        ("egg", 12, "pcs"),
        ("milk", 2, "l"),
        ("onion", 1, "pcs"),
        ("garlic", 1, "pcs"),
        ("tomato", 3, "pcs"),
    ]


def test_a_receipt():
    receipt = """
        FRESH MART #1234
        123 Main St, Springfield
        Tel (555) 123-4567
        11/04/2026  2:01 PM
        4011 ORG BNNA          1.29 F
        BANANAS 1.2 KG         0.79
        TOMATOES
          2.31 lb @ $0.59 /lb  1.36
        2 @ 1.50
        MILK 2% 1 GAL          3.49 F
        PAPER TOWELS 6PK       8.99
        CHKN BRST BNLS         7.12
        SUBTOTAL              22.04
        TAX                    0.81
        TOTAL                 22.85
        VISA ****1234         22.85
        THANK YOU FOR SHOPPING
    """
    assert items(receipt) == [
        ("banana", 1, "pcs"),
        ("banana", 1.2, "kg"),
        ("tomato", 1048.74, "g"),
        ("milk", 3.79, "l"),
        ("chicken breast", 1, "pcs"),
    ]


def test_receipt_text_as_read_from_a_photo():
    # OCR output of real receipts (CORD dataset): prices without cents or with thousands groups.
    text = """
        901016  -TICKET CP
        60.000  60.000
        TAX  5.455
        - EDC CIMB NIAGA NO: XX7730  60.000
        J.STB PROMO  17500
        JASMINE TEA (L)  24.000
        ------  TERMINATED  ************************  +
        CHANGE  72,000
    """
    assert items(text, known=[]) == [("ticket cp", 1, "pcs"), ("jasmine tea", 1, "pcs")]


def test_an_amount_line_above_its_item():
    assert items("2 @ 1.50\nAVOCADO  3.00") == [("avocado", 2, "pcs")]


def test_duplicates_are_merged():
    assert items("2 eggs\neggs x6\n1 kg rice\n500 g rice") == [
        ("egg", 8, "pcs"),
        ("rice", 1, "kg"),
        ("rice", 500, "g"),
    ]


def test_prices_totals_and_non_food_are_skipped():
    assert items("TOTAL 12.00\nTax 0.50\nDish soap 2.99\nChange 3.00\n$4.99\n12.99") == []


def test_unknown_names_are_kept_as_written():
    assert items("1 jar of tahini", known=[]) == [("tahini", 1, "pcs")]


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("bananas", "banana"),
        ("potatoes", "potato"),
        ("peaches", "peach"),
        ("green beans", "green bean"),
        ("chicken breasts", "chicken breast"),
        ("berries", "berries"),
        ("cookies", "cookies"),
        ("hummus", "hummus"),
        ("asparagus", "asparagus"),
        ("molasses", "molasses"),
        ("oats", "oats"),
        ("peas", "peas"),
        ("rice", "rice"),
    ],
)
def test_unknown_names_are_made_singular(name, expected):
    assert canonical_name(name, known=[]) == expected


def test_ocr_slips_snap_to_known_ingredients():
    assert canonical_name("tomatoe", KNOWN) == "tomato"
    assert canonical_name("chicken brest", KNOWN) == "chicken breast"
    # ...but only near-identical spellings, and not when fuzzy matching is off.
    assert canonical_name("pasta", ["paste"]) == "pasta"
    assert canonical_name("tomatoe", KNOWN, fuzzy=False) == "tomatoe"


def test_empty_and_junk_input():
    assert items("") == []
    assert items("\n\n  \n") == []
    assert items("****\n----\n12345678") == []
