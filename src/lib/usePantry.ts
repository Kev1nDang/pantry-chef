import type { GroceryItem } from '../types';
import { getPantry, savePantry } from './api';
import { pantryRules } from './listSync';
import { useSyncedList, type SyncedListConfig } from './useSyncedList';

export type { SyncStatus } from './useSyncedList';

const PANTRY: SyncedListConfig<GroceryItem> = {
  storageKey: 'pantry-chef:groceries',
  rules: pantryRules,
  load: getPantry,
  save: savePantry,
  label: 'pantry',
};

/** The grocery list: in this browser while signed out, saved to the account while signed in. */
export function usePantry(userId: string | null, token: string | null) {
  const { items, setItems, status, error } = useSyncedList(PANTRY, userId, token);
  return { groceries: items, setGroceries: setItems, status, error };
}
