import type { GroceryItem } from '../types';

/**
 * A signed-in user's pantry as this browser last saw it, kept in localStorage so the list shows
 * at once on the next visit (a cold API takes ~25 s to answer) and survives a tab closed before
 * the save went out. `dirty`: it has changes the server hasn't confirmed.
 */
export interface CachedPantry {
  items: GroceryItem[];
  dirty: boolean;
}

const cacheKey = (userId: string) => `pantry-chef:groceries:${userId}`;

export function loadCache(userId: string): CachedPantry | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedPantry>;
    return Array.isArray(parsed.items) ? { items: parsed.items, dirty: parsed.dirty === true } : null;
  } catch {
    return null;
  }
}

export function saveCache(userId: string, cache: CachedPantry) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(cache));
  } catch {
    /* storage unavailable: the server copy still works */
  }
}

/** The server rejects non-positive amounts; an emptied amount field just isn't saved. */
export const savable = (items: GroceryItem[]) => items.filter((g) => g.amount > 0);

/** What the server stores, ignoring client-only ids: equal keys need no save. */
export const contentKey = (items: GroceryItem[]) =>
  JSON.stringify(savable(items).map(({ name, amount, unit }) => [name, amount, unit]));

/** Wait before retrying a failed save or load: 2 s, 5 s, 15 s, then every 30 s. */
export function retryDelay(attempt: number): number {
  return [2000, 5000, 15000][attempt] ?? 30000;
}

export interface Reconciled {
  items: GroceryItem[];
  /** the list differs from the server's and must be saved */
  push: boolean;
}

/**
 * Decide which list wins once the server's arrives.
 * - Changes this browser made that never reached the server (a dirty cache, or edits while the
 *   server list was loading) win: this device changed the pantry last. That's the same
 *   last-write-wins rule every save already follows.
 * - Otherwise the server's list wins, except that a first sign-in with an empty server pantry
 *   carries over the list made while signed out.
 */
export function reconcile(
  server: GroceryItem[],
  cache: CachedPantry | null,
  signedOutList: GroceryItem[],
): Reconciled {
  if (cache?.dirty) return { items: cache.items, push: contentKey(cache.items) !== contentKey(server) };
  const carried = savable(signedOutList);
  if (savable(server).length === 0 && carried.length > 0) return { items: carried, push: true };
  return { items: server, push: false };
}
