"""
Grocery lists and receipt text -> pantry items, with rules instead of an LLM.

Handles what people type and what shops print, one item per line (or comma-separated):

    2 lb chicken breast      chicken breast 2lb       milk 2L          1 dozen eggs
    eggs x12                 1 1/2 cups rice          ½ cup sugar      3 tomatoes
    - onions                 2 x 400g canned tomato   BANANAS 1.2 KG   0.79
    ORG BNNA  1.29 F         2.31 lb @ $0.59 /lb  1.36   (a weight line under its item)

Prices, totals, tax, payment and store lines are skipped, and units are converted the same way
everywhere in the app (1 lb = 454 g, 1 dozen = 12 pcs, ...). Names are mapped onto the recipe
ingredient names when they're the same food, so recipe matching works.

Typed lists come out right. Receipts with heavy abbreviations ("BNLS SKLS CHKN BRST") only partly
do; that is what the review step in the app is for.
"""

import difflib
import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.schemas import ParsedItem
from app.services.matching import normalize_name
from app.services.units import Unit

MAX_ITEMS = 100
MAX_NAME_LENGTH = 100
# Close spellings (OCR slips like "tomatoe") snap to a known ingredient at this similarity.
FUZZY_CUTOFF = 0.85


# --- Units ------------------------------------------------------------------------------------

_UNITS: dict[str, tuple[Unit, float]] = {}


def _units(unit: Unit, factor: float, *words: str) -> None:
    for w in words:
        _UNITS[w] = (unit, factor)


_units("g", 1, "g", "gr", "gm", "gms", "gram", "grams")
_units("kg", 1, "kg", "kgs", "kilo", "kilos", "kilogram", "kilograms")
_units("ml", 1, "ml", "mls", "milliliter", "milliliters", "millilitre", "millilitres")
_units("l", 1, "l", "lt", "ltr", "ltrs", "liter", "liters", "litre", "litres")
_units("tsp", 1, "tsp", "tsps", "teaspoon", "teaspoons")
_units("tbsp", 1, "tbsp", "tbsps", "tbs", "tablespoon", "tablespoons")
_units("cup", 1, "cup", "cups")
_units("g", 454, "lb", "lbs", "pound", "pounds")
_units("g", 28, "oz", "ounce", "ounces")
_units("ml", 30, "fl oz", "floz", "fluid ounce", "fluid ounces")
_units("ml", 473, "pint", "pints", "pt")
_units("ml", 946, "quart", "quarts", "qt")
_units("l", 3.785, "gallon", "gallons", "gal")
_units("pcs", 12, "dozen", "doz", "dz")
_units("pcs", 1, "pc", "pcs", "piece", "pieces", "ea", "each", "ct", "count", "x")
# Containers count as pieces: "2 cans of chickpeas" is 2 pcs of chickpeas.
_units(
    "pcs",
    1,
    *"can cans tin tins pack packs packet packets pkg pkgs bag bags bottle bottles jar jars box "
    "boxes carton cartons bunch bunches head heads clove cloves loaf loaves bar bars block blocks "
    "stick sticks tub tubs container containers".split(),
)

_UNIT_RE = "|".join(
    re.escape(w).replace(r"\ ", r"\.?\s*") for w in sorted(_UNITS, key=len, reverse=True)
)
_UNIT = rf"(?P<unit>{_UNIT_RE})\.?(?![a-z])"

_FRACTIONS = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125}
_VULGAR = "".join(_FRACTIONS)
_NUM = rf"\d+(?:[.,]\d+)?\s*[{_VULGAR}]|\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?|[{_VULGAR}]"
_WORD_NUMBERS = {
    "a": 1,
    "an": 1,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "half a": 0.5,
    "half": 0.5,
}
_WORD_NUM = "|".join(re.escape(w) + r"(?=\s)" for w in sorted(_WORD_NUMBERS, key=len, reverse=True))

_LEADING = re.compile(
    rf"^(?P<num>{_NUM}|{_WORD_NUM})\s*(?:{_UNIT}\s*)?(?:of\s+)?(?P<name>.*[a-z].*)$"
)
_TRAILING = re.compile(
    rf"^(?P<name>.*?[a-z].*?)[\s,:(\-]*(?:x\s*)?(?P<num>{_NUM})\s*(?:{_UNIT})?\s*\)?$"
)
_AMOUNT_ONLY = re.compile(rf"^(?P<num>{_NUM})\s*(?:{_UNIT})?$")


def _number(text: str) -> float:
    s = text.strip().lower()
    if s in _WORD_NUMBERS:
        return float(_WORD_NUMBERS[s])
    total = 0.0
    for char, value in _FRACTIONS.items():
        if char in s:
            total += value
            s = s.replace(char, " ")
    for part in s.split():
        if "/" in part:
            top, bottom = part.split("/", 1)
            total += int(top) / int(bottom) if int(bottom) else 0
        else:
            total += float(part.replace(",", "."))
    return total


# --- Line clean-up ----------------------------------------------------------------------------

_BULLET = re.compile(r"^\s*(?:[-*•·▪◦–—>]+|\[\s*[xX✓ ]?\s*\]|☐|☑|\d{1,2}[.)](?=\s))\s*")
_PRICE = re.compile(r"[$€£]\s*-?\d+(?:[.,]\d{1,2})?")
_UNIT_PRICE = re.compile(r"@\s*[$€£]?\s*\d+(?:[.,]\d+)?\s*(?:/\s*[a-z]+)?|\bper\s+[a-z]+\b")
# A price at the end of a receipt line, maybe with a tax flag ("1.29 F"): cents ("1.29"),
# thousands groups ("24.000", "72,000") or a long whole number ("17500"). Not "2.31 lb".
_TRAILING_PRICE = re.compile(
    rf"(?:^|\s+)-?(?:\d{{1,3}}(?:[.,]\d{{3}})+|\d+[.,]\d{{2}}|\d{{4,}})"
    rf"(?!\s*(?:{_UNIT_RE})(?![a-z]))(?:\s*[a-z]{{1,2}})?$"
)
_PERCENT = re.compile(r"\b\d+(?:[.,]\d+)?\s*%")
_DATE_TIME = re.compile(
    r"\b\d{1,4}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?(?![a-z])"
)
# PLU/UPC codes on receipts ("4011 BANANAS") - but not "1000 g flour".
_CODE = re.compile(rf"^\d{{4,}}\s+(?!(?:{_UNIT_RE})(?![a-z]))|\s+\d{{6,}}$")

# Lines that are about the purchase, not a grocery.
_SKIP = re.compile(
    r"\b(?:sub-?total|total|tax|vat|gst|hst|balance|change|cash|tender(?:ed)?|payment|paid|card|"
    r"visa|mastercard|amex|debit|credit|auth(?:orization)?|approval|approved|terminal|cashier|"
    r"receipt|invoice|order|thank|thanks|welcome|store|manager|tel|phone|fax|www|http|https|"
    r"\.com|savings?|saved|discount|coupon|promo|loyalty|member|rewards?|points|refund|return|"
    r"deposit|crv|bag fee|items? sold|qty|quantity|price|amount|street|st|ave|avenue|blvd|road|"
    r"suite|ste)\b"
    r"|#\s*\d|\bno\s*[:.#]\s*\w",  # store, register, table and transaction numbers
    re.IGNORECASE,
)

# Household and personal-care items that turn up on grocery receipts.
_NOT_FOOD = re.compile(
    r"\b(?:paper towels?|toilet|tissues?|napkins?|detergent|soap|shampoo|conditioner|toothpaste|"
    r"toothbrush|deodorant|razors?|batteries|battery|bleach|sponges?|diapers?|wipes|trash bags?|"
    r"garbage bags?|foil|plastic wrap|light ?bulbs?|cat litter|dog food|cat food)\b",
    re.IGNORECASE,
)

# Receipt abbreviations -> words. Only clear-cut ones: a wrong guess is worse than none.
_ABBREVIATIONS = {
    "bnna": "banana",
    "bnnas": "bananas",
    "bana": "banana",
    "chkn": "chicken",
    "chick": "chicken",
    "brst": "breast",
    "brsts": "breasts",
    "grnd": "ground",
    "bf": "beef",
    "tom": "tomato",
    "toms": "tomatoes",
    "tmto": "tomato",
    "pot": "potato",
    "pots": "potatoes",
    "onin": "onion",
    "grn": "green",
    "mlk": "milk",
    "chs": "cheese",
    "chdr": "cheddar",
    "ched": "cheddar",
    "mozz": "mozzarella",
    "bttr": "butter",
    "brd": "bread",
    "ygrt": "yogurt",
    "yog": "yogurt",
    "avoc": "avocado",
    "avo": "avocado",
    "strwb": "strawberries",
    "strwbry": "strawberries",
    "appl": "apple",
    "carr": "carrot",
    "crrt": "carrots",
    "broc": "broccoli",
    "mshrm": "mushrooms",
    "grlc": "garlic",
    "spnch": "spinach",
    "lett": "lettuce",
    "cuke": "cucumber",
    "oj": "orange juice",
    "pb": "peanut butter",
    "evoo": "olive oil",
    "veg": "vegetable",
}

# Descriptive words that don't change which food it is.
_DROP_WORDS = set(
    "organic org fresh large lg lrg medium med small sm jumbo extra xl whole ripe boneless "
    "skinless bnls sknls free range value family size bulk premium natural virgin raw loose "
    "ylw yel wht".split()
)


@dataclass
class _Line:
    name: str
    amount: float
    unit: Unit
    explicit: bool  # the amount was written on the line (not the 1 pcs default)


def _clean_line(line: str) -> str:
    s = line.strip().lower()
    s = _BULLET.sub("", s)
    s = _DATE_TIME.sub(" ", s)
    s = _UNIT_PRICE.sub(" ", s)
    s = _PRICE.sub(" ", s)
    s = _PERCENT.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    while (stripped := _TRAILING_PRICE.sub("", s)) != s:  # "60.000  60.000": unit and line price
        s = stripped
    s = _CODE.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip(" .:-*")


def clean_name(name: str) -> str:
    words = []
    for w in re.sub(r"\([^)]*\)", " ", name.lower()).split():
        w = w.strip('.,:;!?*#"')
        w = _ABBREVIATIONS.get(w, w)
        if w and w not in _DROP_WORDS:
            words.append(w)
    cleaned = re.sub(r"[^a-z0-9&'\- ]+", "", " ".join(words))
    return re.sub(r"\s+", " ", cleaned).strip(" -'&")[:MAX_NAME_LENGTH]


def canonical_name(name: str, known: Sequence[str], fuzzy: bool = True) -> str:
    """
    Map a name onto a known recipe ingredient when they're the same food: the same words modulo
    plurals ("Tomatoes" -> "tomato"), or with `fuzzy`, a near-identical spelling ("tomatoe").
    """
    cleaned = clean_name(name) or re.sub(r"\s+", " ", name.strip().lower())[:MAX_NAME_LENGTH]
    target = normalize_name(cleaned)
    by_normal = {normalize_name(k): k for k in known}
    if target in by_normal:
        return by_normal[target]
    if fuzzy and by_normal:
        close = difflib.get_close_matches(target, list(by_normal), n=1, cutoff=FUZZY_CUTOFF)
        if close:
            return by_normal[close[0]]
    return singular(cleaned)


# Plural-looking words that aren't plurals of something else.
_KEEP_PLURAL = {"greens", "oats", "grits", "brussels", "molasses", "hummus", "couscous", "swiss"}


def singular(name: str) -> str:
    """
    The singular of a name's last word, like the recipe ingredient names ("bananas" -> "banana",
    "tomatoes" -> "tomato", "peaches" -> "peach"). Only the safe cases: "-ies" words ("berries",
    "cookies") and words that just end in s ("hummus", "asparagus") are left alone.
    """
    head, _, word = name.rpartition(" ")
    if len(word) <= 3 or word in _KEEP_PLURAL or word.endswith(("ss", "us", "is", "ies")):
        return name
    if word.endswith(("oes", "ches", "shes", "xes")):
        word = word[:-2]
    elif word.endswith("s"):
        word = word[:-1]
    return f"{head} {word}" if head else word


def _measure(match: re.Match[str]) -> tuple[float, Unit]:
    """The amount in app units for a match with `num` and an optional `unit` group."""
    amount = _number(match["num"])
    if not match["unit"]:
        return amount, "pcs"
    # Normalize the spelling to a `_UNITS` key: "fl. oz" / "fl  oz" -> "fl oz".
    word = re.sub(r"\s+", " ", match["unit"].replace(".", "")).strip()
    unit, factor = _UNITS.get(word) or _UNITS[word.replace(" ", "")]
    return amount * factor, unit


def _parse_line(line: str) -> _Line | None:
    """One cleaned line -> an item, an amount-only `_Line` (empty name), or None to skip."""
    if not line or _SKIP.search(line) or _NOT_FOOD.search(line):
        return None

    if m := _AMOUNT_ONLY.match(line):
        amount, unit = _measure(m)
        return _Line("", amount, unit, explicit=True) if amount > 0 else None

    if sum(c.isalpha() for c in line) < 2:
        return None
    # Rules and decorations ("------ TERMINATED ********"): mostly punctuation, not an item.
    visible = line.replace(" ", "")
    if sum(c.isalnum() for c in visible) < 0.6 * len(visible):
        return None

    explicit = True
    if m := _LEADING.match(line):
        amount, unit = _measure(m)
        name = m["name"]
        # "2 x 400g canned tomato", "3 cans 15 oz beans": a count of packages of a given size.
        inner = _LEADING.match(name)
        if unit == "pcs" and inner and inner["unit"]:
            size, size_unit = _measure(inner)
            if size_unit != "pcs":
                amount, unit, name = amount * size, size_unit, inner["name"]
    elif m := _TRAILING.match(line):
        amount, unit = _measure(m)
        name = m["name"]
    else:
        amount, unit, name, explicit = 1.0, "pcs", line, False

    if amount <= 0:
        return None
    return _Line(name, amount, unit, explicit)


def _split(text: str) -> list[str]:
    """
    Lines, then comma/semicolon lists within a line (but not "1,5 kg"). Store and payment lines
    are dropped whole first, so "123 Main St, Springfield" doesn't leave "Springfield" behind.
    """
    parts: list[str] = []
    for raw in text.splitlines():
        if not _SKIP.search(raw):
            parts.extend(p for p in re.split(r";|,(?!\d)", raw) if p.strip())
    return parts


def parse_grocery_text(
    text: str, known_names: Sequence[str] = (), fuzzy: bool = True
) -> list[ParsedItem]:
    """
    Turn a grocery list or receipt text into items. `known_names` are the recipe ingredient
    names; matching names are spelled the same way so the pantry matches recipes.
    """
    known = sorted(set(known_names))
    lines: list[_Line] = []
    pending: _Line | None = None  # an amount line ("2 @ 1.50") waiting for its item

    for raw in _split(text):
        parsed = _parse_line(_clean_line(raw))
        if parsed is None:
            continue
        if not parsed.name:
            # Receipts print weights and multiples on their own line, under (or above) the item.
            if lines and not lines[-1].explicit:
                lines[-1].amount, lines[-1].unit = parsed.amount, parsed.unit
                lines[-1].explicit = True
            else:
                pending = parsed
            continue
        if pending and not parsed.explicit:
            parsed.amount, parsed.unit, parsed.explicit = pending.amount, pending.unit, True
        pending = None
        lines.append(parsed)

    merged: dict[tuple[str, str], ParsedItem] = {}
    for line in lines:
        name = canonical_name(line.name, known, fuzzy)
        if not name or not any(c.isalpha() for c in name):
            continue
        key = (name, line.unit)
        if key in merged:
            merged[key].amount = round(merged[key].amount + line.amount, 2)
        else:
            merged[key] = ParsedItem(name=name, amount=round(line.amount, 2), unit=line.unit)
    return list(merged.values())[:MAX_ITEMS]
