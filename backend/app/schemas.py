"""Request/response shapes. Mirrors src/types.ts on the frontend."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Unit = Literal["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "pcs"]


class RecipeIngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    amount: float
    unit: Unit
    optional: bool = False


class RecipeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    emoji: str
    minutes: int
    servings: int
    tags: list[str]
    ingredients: list[RecipeIngredientOut]
    steps: list[str]


class GroceryItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0)
    unit: Unit


class GroceryItemOut(GroceryItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
