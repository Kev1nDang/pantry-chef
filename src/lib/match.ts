import type { GroceryItem, IngredientCheck, Recipe, RecipeMatch, Unit } from '../types';

type Dimension = 'mass' | 'volume' | 'count';

const UNIT_INFO: Record<Unit, { dim: Dimension; toBase: number }> = {
  g: { dim: 'mass', toBase: 1 },
  kg: { dim: 'mass', toBase: 1000 },
  ml: { dim: 'volume', toBase: 1 },
  l: { dim: 'volume', toBase: 1000 },
  tsp: { dim: 'volume', toBase: 5 },
  tbsp: { dim: 'volume', toBase: 15 },
  cup: { dim: 'volume', toBase: 240 },
  pcs: { dim: 'count', toBase: 1 },
};

/** Lowercase, collapse whitespace and strip simple plurals so "Tomatoes" matches "tomato". */
export function normalizeName(name: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (n.endsWith('ies')) return n.slice(0, -3) + 'y';
  if (n.endsWith('oes')) return n.slice(0, -2);
  if (n.endsWith('s') && !n.endsWith('ss')) return n.slice(0, -1);
  return n;
}

function findGrocery(name: string, pantry: GroceryItem[]): GroceryItem | undefined {
  const target = normalizeName(name);
  return (
    pantry.find((g) => normalizeName(g.name) === target) ??
    pantry.find((g) => {
      const n = normalizeName(g.name);
      return n.length > 2 && (n.includes(target) || target.includes(n));
    })
  );
}

/**
 * have/need ratio, or null when the units can't be compared (pieces vs grams).
 * Mass and volume are bridged at ~1 g/ml — rough, but close enough for most pantry staples.
 */
function ratio(have: GroceryItem, needAmount: number, needUnit: Unit): number | null {
  const a = UNIT_INFO[have.unit];
  const b = UNIT_INFO[needUnit];
  if (a.dim !== b.dim && (a.dim === 'count' || b.dim === 'count')) return null;
  return (have.amount * a.toBase) / (needAmount * b.toBase);
}

export function matchRecipe(recipe: Recipe, pantry: GroceryItem[]): RecipeMatch {
  let points = 0;
  let total = 0;
  let missingCount = 0;

  const checks: IngredientCheck[] = recipe.ingredients.map((ingredient) => {
    const have = findGrocery(ingredient.name, pantry);
    const weight = ingredient.optional ? 0.25 : 1;
    total += weight;

    if (!have) {
      if (!ingredient.optional) missingCount++;
      return { ingredient, status: 'missing' };
    }
    const r = ratio(have, ingredient.amount, ingredient.unit);
    if (r === null) {
      points += weight * 0.75;
      return { ingredient, status: 'unknown', have };
    }
    if (r >= 1) {
      points += weight;
      return { ingredient, status: 'enough', have };
    }
    points += weight * r;
    return { ingredient, status: 'partial', have };
  });

  const ready = checks.every((c) => c.ingredient.optional || c.status === 'enough');
  return { recipe, checks, missingCount, ready, score: total ? points / total : 0 };
}

export function rankRecipes(recipes: Recipe[], pantry: GroceryItem[]): RecipeMatch[] {
  return recipes
    .map((r) => matchRecipe(r, pantry))
    .filter((m) => m.score > 0)
    .sort((a, b) => Number(b.ready) - Number(a.ready) || b.score - a.score || a.missingCount - b.missingCount);
}

export function formatAmount(amount: number, unit: Unit): string {
  const n = Number.isInteger(amount) ? amount : Number(amount.toFixed(2));
  return unit === 'pcs' ? `${n}` : `${n} ${unit}`;
}
