export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'pcs';

export const UNITS: Unit[] = ['pcs', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup'];

export interface GroceryItem {
  id: string;
  name: string;
  amount: number;
  unit: Unit;
}

export interface RecipeIngredient {
  name: string;
  amount: number;
  unit: Unit;
  optional?: boolean;
}

export interface Recipe {
  id: string;
  title: string;
  emoji: string;
  minutes: number;
  servings: number;
  tags: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
}

export type IngredientStatus = 'enough' | 'partial' | 'missing' | 'unknown';

export interface IngredientCheck {
  ingredient: RecipeIngredient;
  status: IngredientStatus;
  have?: GroceryItem;
}

export interface RecipeMatch {
  recipe: Recipe;
  /** 0..1 — how much of the recipe your groceries cover */
  score: number;
  checks: IngredientCheck[];
  missingCount: number;
  /** every required ingredient is on hand in sufficient quantity */
  ready: boolean;
}
