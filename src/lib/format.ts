import type { Unit } from '../types';

const UNIT_NAMES: Record<Unit, [singular: string, plural: string]> = {
  pcs: ['piece', 'pieces'],
  g: ['gram', 'grams'],
  kg: ['kilogram', 'kilograms'],
  ml: ['milliliter', 'milliliters'],
  l: ['liter', 'liters'],
  tsp: ['teaspoon', 'teaspoons'],
  tbsp: ['tablespoon', 'tablespoons'],
  cup: ['cup', 'cups'],
};

/** Spelled-out unit name; singular only for exactly 1. Without an amount, the plural (for pickers). */
export function unitLabel(unit: Unit, amount?: number): string {
  const [singular, plural] = UNIT_NAMES[unit];
  return amount === 1 ? singular : plural;
}

export function formatAmount(amount: number, unit: Unit): string {
  const n = Number.isInteger(amount) ? amount : Number(amount.toFixed(2));
  return unit === 'pcs' ? `${n}` : `${n} ${unitLabel(unit, n)}`;
}
