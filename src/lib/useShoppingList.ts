import { useCallback, useEffect, useState } from 'react';
import type { Unit } from '../types';

const STORAGE_KEY = 'pantry-chef:shopping';

export interface ShoppingItem {
  id: string;
  name: string;
  amount: number;
  unit: Unit;
  checked: boolean;
  /** recipe titles this item was added for */
  for: string[];
}

export type NewShoppingItem = Pick<ShoppingItem, 'name' | 'amount' | 'unit'>;

function load(): ShoppingItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ShoppingItem[]) : [];
  } catch {
    return [];
  }
}

/** The shopping list. It lives in this browser only. */
export function useShoppingList() {
  const [items, setItems] = useState<ShoppingItem[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable — keep working in memory */
    }
  }, [items]);

  /** Add items for a recipe; an item already on the list (same name and unit) is merged, not repeated. */
  const add = useCallback((added: NewShoppingItem[], recipe?: string) => {
    setItems((prev) =>
      added.reduce((list, item) => {
        const existing = list.find(
          (s) => !s.checked && s.name.toLowerCase() === item.name.toLowerCase() && s.unit === item.unit,
        );
        if (existing) {
          if (recipe && existing.for.includes(recipe)) return list;
          return list.map((s) =>
            s === existing
              ? { ...s, amount: s.amount + item.amount, for: recipe ? [...s.for, recipe] : s.for }
              : s,
          );
        }
        return [
          ...list,
          { ...item, id: crypto.randomUUID(), checked: false, for: recipe ? [recipe] : [] },
        ];
      }, prev),
    );
  }, []);

  return { items, setItems, add };
}
