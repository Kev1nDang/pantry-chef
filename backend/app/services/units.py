from dataclasses import dataclass
from typing import Literal, get_args

Unit = Literal["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "pcs"]
UNITS: tuple[Unit, ...] = get_args(Unit)

Dimension = Literal["mass", "volume", "count"]


@dataclass(frozen=True)
class UnitInfo:
    dim: Dimension
    to_base: float


UNIT_INFO: dict[Unit, UnitInfo] = {
    "g": UnitInfo("mass", 1),
    "kg": UnitInfo("mass", 1000),
    "ml": UnitInfo("volume", 1),
    "l": UnitInfo("volume", 1000),
    "tsp": UnitInfo("volume", 5),
    "tbsp": UnitInfo("volume", 15),
    "cup": UnitInfo("volume", 240),
    "pcs": UnitInfo("count", 1),
}


def ratio(have_amount: float, have_unit: Unit, need_amount: float, need_unit: Unit) -> float | None:
    """
    have/need ratio, or None when the units can't be compared (pieces vs grams).
    Mass and volume are bridged at ~1 g/ml — rough, but close enough for most pantry staples.
    """
    a, b = UNIT_INFO[have_unit], UNIT_INFO[need_unit]
    if a.dim != b.dim and "count" in (a.dim, b.dim):
        return None
    return (have_amount * a.to_base) / (need_amount * b.to_base)
