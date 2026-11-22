"""ORM mappings. The schema itself is owned by supabase/migrations — change it there, not here."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Numeric, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    emoji: Mapped[str] = mapped_column(Text)
    minutes: Mapped[int]
    servings: Mapped[int]
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text))
    steps: Mapped[list[str]] = mapped_column(ARRAY(Text))
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        order_by="RecipeIngredient.position", lazy="selectin"
    )


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"

    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), primary_key=True)
    position: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    amount: Mapped[float] = mapped_column(Numeric(asdecimal=False))
    unit: Mapped[str] = mapped_column(Text)
    optional: Mapped[bool]


class PantryItem(Base):
    __tablename__ = "pantry_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID]
    name: Mapped[str] = mapped_column(Text)
    amount: Mapped[float] = mapped_column(Numeric(asdecimal=False))
    unit: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ShoppingItem(Base):
    __tablename__ = "shopping_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID]
    position: Mapped[int]
    name: Mapped[str] = mapped_column(Text)
    amount: Mapped[float] = mapped_column(Numeric(asdecimal=False))
    unit: Mapped[str] = mapped_column(Text)
    checked: Mapped[bool] = mapped_column(default=False)
    # text[] in Postgres; JSON on SQLite, which the tests use and which has no arrays.
    recipes: Mapped[list[str]] = mapped_column(ARRAY(Text).with_variant(JSON(), "sqlite"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
