import type { GroceryItem, ShoppingItem } from '../types';

/**
 * The rules behind a list that's saved to the signed-in user's account (the pantry and the
 * shopping list; see useSyncedList.ts).
 *
 * This browser keeps a copy of each signed-in user's list in localStorage, so the list shows at
 * once on the next visit (a cold API takes ~25 s to answer) and survives a tab closed before the
 * save went out. `dirty`: it has changes the server hasn't confirmed.
 */
export interface CachedList<T> {
  items: T[];
  dirty: boolean;
}

/** localStorage key of a user's copy of the list stored signed out under `listKey`. */
export const cacheKey = (listKey: string, userId: string) => `${listKey}:${userId}`;

export function loadCache<T>(key: string): CachedList<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedList<T>>;
    return Array.isArray(parsed.items) ? { items: parsed.items, dirty: parsed.dirty === true } : null;
  } catch {
    return null;
  }
}

export function saveCache<T>(key: string, cache: CachedList<T>) {
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    /* storage unavailable: the server copy still works */
  }
}

/** Wait before retrying a failed save or load: 2 s, 5 s, 15 s, then every 30 s. */
export function retryDelay(attempt: number): number {
  return [2000, 5000, 15000][attempt] ?? 30000;
}

export interface ListRules<T> {
  /** the rows the server accepts; the rest aren't saved */
  savable: (items: T[]) => T[];
  /** what the server stores, ignoring client-only fields such as ids: equal keys need no save */
  contentKey: (items: T[]) => string;
}

/** The server rejects non-positive amounts; an emptied amount field just isn't saved. */
const positive = <T extends { amount: number }>(items: T[]) => items.filter((i) => i.amount > 0);

export const pantryRules: ListRules<GroceryItem> = {
  savable: positive,
  contentKey: (items) => JSON.stringify(positive(items).map(({ name, amount, unit }) => [name, amount, unit])),
};

export const shoppingRules: ListRules<ShoppingItem> = {
  savable: positive,
  contentKey: (items) =>
    JSON.stringify(positive(items).map((i) => [i.name, i.amount, i.unit, i.checked, i.for])),
};

export interface Reconciled<T> {
  items: T[];
  /** the list differs from the server's and must be saved */
  push: boolean;
  /** the signed-out list was carried into the account (so this browser can let go of it) */
  carried: boolean;
}

/**
 * Decide which list wins once the server's arrives.
 * - Changes this browser made that never reached the server (a dirty cache, or edits while the
 *   server list was loading) win: this device changed the list last. That's the same
 *   last-write-wins rule every save already follows.
 * - Otherwise the server's list wins, except that a first sign-in with an empty server list
 *   carries over the list made while signed out.
 */
export function reconcile<T>(
  server: T[],
  cache: CachedList<T> | null,
  signedOutList: T[],
  rules: ListRules<T>,
): Reconciled<T> {
  if (cache?.dirty) {
    return { items: cache.items, push: rules.contentKey(cache.items) !== rules.contentKey(server), carried: false };
  }
  const carried = rules.savable(signedOutList);
  if (rules.savable(server).length === 0 && carried.length > 0) return { items: carried, push: true, carried: true };
  return { items: server, push: false, carried: false };
}
