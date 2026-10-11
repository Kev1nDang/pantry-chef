import type { Unit } from '../types';

export function formatAmount(amount: number, unit: Unit): string {
  const n = Number.isInteger(amount) ? amount : Number(amount.toFixed(2));
  return unit === 'pcs' ? `${n}` : `${n} ${unit}`;
}
