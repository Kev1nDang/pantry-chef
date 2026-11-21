import { useCallback, useEffect, useRef, useState } from 'react';
import type { GroceryItem } from '../types';
import { getPantry, messageOf, savePantry } from './api';
import { contentKey, loadCache, reconcile, retryDelay, savable, saveCache } from './pantrySync';

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

interface PantryState {
  /** whose list this is: a user id (synced to the API) or null (this browser's localStorage) */
  owner: string | null;
  items: GroceryItem[];
  /** signed in: whether the server's list has arrived; until then nothing is saved to it */
  loaded: boolean;
}

/**
 * The grocery list. Signed out, it lives in localStorage. Signed in, it's loaded from
 * `GET /api/pantry` and every change is saved with a debounced `PUT /api/pantry`.
 * On a user's first sign-in (empty server pantry) the local list is carried over.
 *
 * Signed in, this browser also keeps a copy of the user's list (pantrySync.ts): it shows at once
 * while the server answers, holds changes that haven't been saved yet, and those changes are
 * sent on the next visit if the tab closed first. Failed loads and saves retry with backoff, and
 * a pending save goes out right away when the page is hidden (phones suspend background tabs).
 */
export function usePantry(userId: string | null, token: string | null) {
  const [state, setState] = useState<PantryState>(() => ({ owner: null, items: loadLocal(), loaded: false }));
  const [status, setStatus] = useState<SyncStatus>('local');
  const [error, setError] = useState<string | null>(null);
  /** bumped to retry a failed load or save */
  const [loadTry, setLoadTry] = useState(0);
  const [saveTry, setSaveTry] = useState(0);
  const tokenRef = useRef(token);
  /** contentKey of what the server is known to hold */
  const lastSaved = useRef<string | null>(null);
  const failedSaves = useRef(0);
  /** a save request is out */
  const saving = useRef(false);
  /** the debounced save waiting to go out, so hiding the page can send it at once */
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Switch between the local list and the signed-in user's list. Adjusting state during render
  // (rather than in an effect) avoids a flash of the wrong list.
  const [prevUserId, setPrevUserId] = useState<string | null>(null);
  if (userId !== prevUserId) {
    setPrevUserId(userId);
    setLoadTry(0); // a new account starts its retries from the first step
    if (userId) {
      const cached = loadCache(userId);
      if (cached) setState({ owner: userId, items: cached.items, loaded: false });
      setStatus('loading');
    } else {
      setState({ owner: null, items: loadLocal(), loaded: false });
      setStatus('local');
      setError(null);
    }
  }

  // Load the signed-in user's pantry from the API, retrying with backoff if that fails.
  useEffect(() => {
    if (!userId) return;
    const cached = loadCache(userId);
    // A clean cached copy is what the server held when it was written.
    lastSaved.current = cached && !cached.dirty ? contentKey(cached.items) : null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const server = await getPantry(tokenRef.current!);
        if (cancelled) return;
        // Read the cache again: edits made while the request was out are in it, marked dirty.
        const { items, push } = reconcile(server, loadCache(userId), loadLocal());
        lastSaved.current = contentKey(server);
        if (!push) saveCache(userId, { items, dirty: false });
        setState({ owner: userId, items, loaded: true });
        setStatus(push ? 'saving' : 'synced'); // the save effect sends a pushed list right away
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(`Couldn't load your saved pantry: ${messageOf(err)}`);
        retry = setTimeout(() => setLoadTry((n) => n + 1), retryDelay(loadTry));
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
    // loadTry only re-runs this; its value is just the backoff step.
  }, [userId, loadTry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist every change to wherever the list belongs.
  useEffect(() => {
    if (state.owner === null) {
      saveLocal(state.items);
      return;
    }
    if (state.owner !== userId) return; // signing out; the render above swaps the list
    const owner = state.owner;
    const items = savable(state.items);
    const key = contentKey(items);
    const dirty = key !== lastSaved.current;
    saveCache(owner, { items: state.items, dirty });
    if (!state.loaded || !dirty) return; // never overwrite the server before reading it

    let sent = false;
    const save = async () => {
      // One save at a time: two replace-the-list requests running at once on the server can
      // leave both lists' rows behind. The one in flight re-runs this effect when it's done.
      if (sent || saving.current) return;
      sent = true;
      saving.current = true;
      pending.current = null;
      setStatus('saving');
      try {
        await savePantry(tokenRef.current!, items);
        lastSaved.current = key;
        failedSaves.current = 0;
        // Only clear the flag if nothing changed while the request was out.
        const latest = loadCache(owner);
        if (latest && contentKey(latest.items) === key) saveCache(owner, { items: latest.items, dirty: false });
        setStatus('synced');
        setError(null);
        saving.current = false;
        setSaveTry((n) => n + 1); // send anything changed meanwhile (a no-op when nothing did)
      } catch (err) {
        saving.current = false;
        setStatus('error');
        setError(`Couldn't save your pantry: ${messageOf(err)} Retrying…`);
        const wait = retryDelay(failedSaves.current++);
        setTimeout(() => setSaveTry((n) => n + 1), wait);
      }
    };
    pending.current = save;
    const timer = setTimeout(save, SAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (pending.current === save) pending.current = null;
    };
  }, [state, userId, saveTry]);

  // Send a waiting save now when the page is hidden, and retry at once when the network returns.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') pending.current?.();
    };
    const online = () => setSaveTry((n) => n + 1);
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', online);
    };
  }, []);

  const setGroceries = useCallback((update: (prev: GroceryItem[]) => GroceryItem[]) => {
    setState((s) => ({ ...s, items: update(s.items) }));
  }, []);

  return { groceries: state.items, setGroceries, status, error };
}
