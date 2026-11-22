import { useCallback, useEffect, useRef, useState } from 'react';
import { messageOf } from './api';
import { cacheKey, loadCache, reconcile, retryDelay, saveCache, type ListRules } from './listSync';

const SAVE_DELAY_MS = 600;

export type SyncStatus = 'local' | 'loading' | 'synced' | 'saving' | 'error';

/** Describes one list. Define it once at module level: the hook expects the same object each render. */
export interface SyncedListConfig<T> {
  /** localStorage key of the signed-out list; a signed-in user's copy lives at `<key>:<user id>` */
  storageKey: string;
  rules: ListRules<T>;
  load: (token: string) => Promise<T[]>;
  save: (token: string, items: T[]) => Promise<unknown>;
  /** what the list is called in error messages, e.g. "pantry" */
  label: string;
}

function loadLocal<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function saveLocal<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* storage unavailable — keep working in memory */
  }
}

interface ListState<T> {
  /** whose list this is: a user id (synced to the API) or null (this browser's signed-out list) */
  owner: string | null;
  items: T[];
  /** signed in: whether the server's list has arrived; until then nothing is saved to it */
  loaded: boolean;
}

/** What to show for `userId` before the server answers: this browser's copy, if it has one. */
function initialState<T>(config: SyncedListConfig<T>, userId: string | null): ListState<T> {
  const cached = userId ? loadCache<T>(cacheKey(config.storageKey, userId)) : null;
  if (userId && cached) return { owner: userId, items: cached.items, loaded: false };
  return { owner: null, items: loadLocal<T>(config.storageKey), loaded: false };
}

/**
 * A list that lives in localStorage while signed out and in the user's account while signed in:
 * loaded with `config.load` and saved, debounced, with `config.save` after every change. On a
 * user's first sign-in (an empty server list) the signed-out list is carried over, and this
 * browser then lets go of it, so signing out shows a fresh list rather than a stale one.
 *
 * Signed in, this browser also keeps a copy of the user's list (listSync.ts): it shows at once
 * while the server answers, holds changes that haven't been saved yet, and those changes are
 * sent on the next visit if the tab closed first. Failed loads and saves retry with backoff, and
 * a pending save goes out right away when the page is hidden (phones suspend background tabs).
 *
 * `userId` can arrive before `token` (it's read from the saved session on the first render); the
 * list waits for the token before it talks to the server.
 */
export function useSyncedList<T>(config: SyncedListConfig<T>, userId: string | null, token: string | null) {
  const { storageKey, rules, label } = config;
  const [state, setState] = useState<ListState<T>>(() => initialState(config, userId));
  const [status, setStatus] = useState<SyncStatus>(userId ? 'loading' : 'local');
  const [error, setError] = useState<string | null>(null);
  /** bumped to retry a failed load or save */
  const [loadTry, setLoadTry] = useState(0);
  const [saveTry, setSaveTry] = useState(0);
  const tokenRef = useRef(token);
  const hasToken = token !== null;
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

  // Switch between the signed-out list and the signed-in user's list. Adjusting state during
  // render (rather than in an effect) avoids a flash of the wrong list.
  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (userId !== prevUserId) {
    setPrevUserId(userId);
    setLoadTry(0); // a new account starts its retries from the first step
    setState(initialState(config, userId));
    setStatus(userId ? 'loading' : 'local');
    if (!userId) setError(null);
  }

  // Load the signed-in user's list from the API, retrying with backoff if that fails.
  useEffect(() => {
    if (!userId) return;
    const key = cacheKey(storageKey, userId);
    const cached = loadCache<T>(key);
    // A clean cached copy is what the server held when it was written. Record that before the
    // token arrives too: otherwise the save effect below sees an unknown server state, marks the
    // copy dirty, and this device would push a stale list over another device's newer one.
    lastSaved.current = cached && !cached.dirty ? rules.contentKey(cached.items) : null;
    if (!hasToken) return; // load once supabase-js has confirmed the session
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const server = await config.load(tokenRef.current!);
        if (cancelled) return;
        // Read the cache again: edits made while the request was out are in it, marked dirty.
        const { items, push, carried } = reconcile(server, loadCache<T>(key), loadLocal<T>(storageKey), rules);
        lastSaved.current = rules.contentKey(server);
        saveCache(key, { items, dirty: push });
        // The account holds the carried list now (or will once the save below lands; until then
        // the dirty copy above keeps it), so the signed-out list starts over.
        if (carried) saveLocal(storageKey, []);
        setState({ owner: userId, items, loaded: true });
        setStatus(push ? 'saving' : 'synced'); // the save effect sends a pushed list right away
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(`Couldn't load your saved ${label}: ${messageOf(err)}`);
        retry = setTimeout(() => setLoadTry((n) => n + 1), retryDelay(loadTry));
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
    // loadTry only re-runs this; its value is just the backoff step. config is module-level.
  }, [userId, hasToken, loadTry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist every change to wherever the list belongs.
  useEffect(() => {
    if (state.owner === null) {
      saveLocal(storageKey, state.items);
      return;
    }
    if (state.owner !== userId) return; // signing out; the render above swaps the list
    const owner = cacheKey(storageKey, state.owner);
    const items = rules.savable(state.items);
    const key = rules.contentKey(items);
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
        await config.save(tokenRef.current!, items);
        lastSaved.current = key;
        failedSaves.current = 0;
        // Only clear the flag if nothing changed while the request was out.
        const latest = loadCache<T>(owner);
        if (latest && rules.contentKey(latest.items) === key) saveCache(owner, { items: latest.items, dirty: false });
        setStatus('synced');
        setError(null);
        saving.current = false;
        setSaveTry((n) => n + 1); // send anything changed meanwhile (a no-op when nothing did)
      } catch (err) {
        saving.current = false;
        setStatus('error');
        setError(`Couldn't save your ${label}: ${messageOf(err)} Retrying…`);
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
  }, [state, userId, saveTry]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const setItems = useCallback((update: (prev: T[]) => T[]) => {
    setState((s) => ({ ...s, items: update(s.items) }));
  }, []);

  return { items: state.items, setItems, status, error };
}

const STATUS_RANK: SyncStatus[] = ['error', 'saving', 'loading', 'synced', 'local'];

/** One status for several lists: the most pressing one wins (an error over saving over…). */
export function overallStatus(...statuses: SyncStatus[]): SyncStatus {
  return STATUS_RANK.find((s) => statuses.includes(s)) ?? 'local';
}
