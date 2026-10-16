"""Request/response shapes. Mirrors src/types.ts on the frontend (camelCase on the wire)."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Unit = Literal["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "pcs"]
IngredientStatus = Literal["enough", "partial", "missing", "unknown"]


class ApiModel(BaseModel):
    """Serializes as camelCase (FastAPI responds by alias) and accepts either case on input."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class RecipeIngredientOut(ApiModel):
    name: str
    amount: float
    unit: Unit
    optional: bool = False


class RecipeOut(ApiModel):
    id: str
    title: str
    emoji: str
    minutes: int
    servings: int
    tags: list[str]
    ingredients: list[RecipeIngredientOut]
    steps: list[str]
    ai_generated: bool = False


class GroceryItemIn(ApiModel):
    name: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0)
    unit: Unit


class GroceryItemOut(GroceryItemIn):
    id: uuid.UUID


# --- Matching -------------------------------------------------------------------------------


class MatchGrocery(GroceryItemIn):
    """A grocery sent for matching. `id` is the client's own id, echoed back in `have`."""

    id: str | None = None


class MatchRequest(ApiModel):
    pantry: list[MatchGrocery] = Field(max_length=500)
    # Only recipes carrying every one of these tags (e.g. ["vegan"]).
    tags: list[str] = []


class IngredientCheckOut(ApiModel):
    ingredient: RecipeIngredientOut
    status: IngredientStatus
    have: MatchGrocery | None = None


class RecipeMatchOut(ApiModel):
    recipe: RecipeOut
    score: float
    checks: list[IngredientCheckOut]
    missing_count: int
    ready: bool


# --- AI -------------------------------------------------------------------------------------


class ParseRequest(ApiModel):
    text: str = Field(min_length=1, max_length=5000)


class ParsedItem(ApiModel):
    name: str
    amount: float
    unit: Unit


class ParseResponse(ApiModel):
    items: list[ParsedItem]


class ParseFileResponse(ParseResponse):
    file_name: str
    kind: Literal["pdf", "text"]
    pages: int
    # "text": read from the file's text; "scan": a PDF with no text layer, read by Claude.
    method: Literal["text", "scan"]
    # The extracted text was longer than the parser accepts and was cut off.
    truncated: bool


# --- Account --------------------------------------------------------------------------------


class MeOut(ApiModel):
    id: uuid.UUID
    email: str | None = None
    provider: str | None = None


class GenerateRequest(ApiModel):
    # The client's current groceries. Omit to use the pantry saved on the server.
    pantry: list[MatchGrocery] | None = Field(default=None, max_length=200)
    dietary: list[str] = Field(default=[], max_length=10)
    max_minutes: int | None = Field(default=None, gt=0, le=600)
    servings: int | None = Field(default=None, gt=0, le=20)
