import { useCallback, useEffect, useRef, useState } from 'react';
import type { GroceryItem } from '../types';
import { getPantry, messageOf, savePantry } from './api';

const STORAGE_KEY = 'pantry-chef:groceries';
const SAVE_DELAY_MS = 600;

export type SyncStatus = 'local' | 'loading' | 'synced' | 'saving' | 'error';

function loadLocal(): GroceryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GroceryItem[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(items: GroceryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable — keep working in memory */
  }
}

/** The server rejects non-positive amounts; an emptied amount field just isn't saved. */
const savable = (items: GroceryItem[]) => items.filter((g) => g.amount > 0);

interface PantryState {
  /** whose list this is: a user id (synced to the API) or null (this browser's localStorage) */
  owner: string | null;
  items: GroceryItem[];
}

/**
 * The grocery list. Signed out, it lives in localStorage. Signed in, it's loaded from
 * `GET /api/pantry` and every change is saved with a debounced `PUT /api/pantry`.
 * On a user's first sign-in (empty server pantry) the local list is carried over.
 */
export function usePantry(userId: string | null, token: string | null) {
  const [state, setState] = useState<PantryState>(() => ({ owner: null, items: loadLocal() }));
  const [status, setStatus] = useState<SyncStatus>('local');
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(token);
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Switch between the local list and the signed-in user's server list. Adjusting state during
  // render (rather than in an effect) avoids a flash of the wrong list.
  const [prevUserId, setPrevUserId] = useState<string | null>(null);
  if (userId !== prevUserId) {
    setPrevUserId(userId);
    if (userId) {
      setStatus('loading');
    } else {
      setState({ owner: null, items: loadLocal() });
      setStatus('local');
      setError(null);
    }
  }

  // Load the signed-in user's pantry from the API.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const t = tokenRef.current!;
        let items = await getPantry(t);
        const local = savable(loadLocal());
        if (items.length === 0 && local.length > 0) items = await savePantry(t, local);
        if (cancelled) return;
        lastSaved.current = JSON.stringify(savable(items).map(({ name, amount, unit }) => [name, amount, unit]));
        setState({ owner: userId, items });
        setStatus('synced');
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(`Couldn't load your saved pantry: ${messageOf(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Persist every change to wherever the list belongs.
  useEffect(() => {
    if (state.owner === null) {
      saveLocal(state.items);
      return;
    }
    if (state.owner !== userId) return; // signing out; the effect above swaps the list
    const items = savable(state.items);
    const key = JSON.stringify(items.map(({ name, amount, unit }) => [name, amount, unit]));
    if (key === lastSaved.current) return;

    const timer = setTimeout(async () => {
      setStatus('saving');
      try {
        await savePantry(tokenRef.current!, items);
        lastSaved.current = key;
        setStatus('synced');
        setError(null);
      } catch (err) {
        setStatus('error');
        setError(`Couldn't save your pantry: ${messageOf(err)}`);
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, userId]);

  const setGroceries = useCallback((update: (prev: GroceryItem[]) => GroceryItem[]) => {
    setState((s) => ({ ...s, items: update(s.items) }));
  }, []);

  return { groceries: state.items, setGroceries, status, error };
}
