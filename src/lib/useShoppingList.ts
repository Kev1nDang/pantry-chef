import { useCallback } from 'react';
import type { NewShoppingItem, ShoppingItem } from '../types';
import { getShoppingList, saveShoppingList } from './api';
import { shoppingRules } from './listSync';
import { useSyncedList, type SyncedListConfig } from './useSyncedList';

export type { NewShoppingItem, ShoppingItem } from '../types';

const SHOPPING: SyncedListConfig<ShoppingItem> = {
  storageKey: 'pantry-chef:shopping',
  rules: shoppingRules,
  load: getShoppingList,
  save: saveShoppingList,
  label: 'shopping list',
};

/** The shopping list: in this browser while signed out, saved to the account while signed in. */
export function useShoppingList(userId: string | null, token: string | null) {
  const { items, setItems, status, error } = useSyncedList(SHOPPING, userId, token);

  /** Add items for a recipe; an item already on the list (same name and unit) is merged, not repeated. */
  const add = useCallback(
    (added: NewShoppingItem[], recipe?: string) => {
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
          return [...list, { ...item, id: crypto.randomUUID(), checked: false, for: recipe ? [recipe] : [] }];
        }, prev),
      );
    },
    [setItems],
  );

  return { items, setItems, add, status, error };
}
