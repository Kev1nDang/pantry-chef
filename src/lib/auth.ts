import type { Session } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { authErrorMessage, profileOf, storedUserId, withoutAuthError } from './authInfo';
import { AUTH_STORAGE_KEY, SUPABASE_KEY, SUPABASE_URL, authRedirect, supabase } from './supabase';

/** Where sign-in redirects return. It must be listed under Supabase → Authentication → URL Configuration. */
const returnUrl = () => window.location.origin;

let providers: Promise<Record<string, boolean> | null> | null = null;

/**
 * The sign-in methods turned on in the Supabase project (its public settings), fetched once.
 * `null` when they couldn't be read; the next call tries again.
 */
export function enabledProviders(): Promise<Record<string, boolean> | null> {
  if (!supabase) return Promise.resolve(null);
  providers ??= fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((settings: { external?: Record<string, boolean> }) => settings.external ?? null)
    .catch(() => {
      providers = null;
      return null;
    });
  return providers;
}

/**
 * Leave for Google's sign-in page. It creates the account on the first visit and signs in to the
 * same account after that; Supabase links it to an existing account with the same email.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error('Sign-in isn’t configured.');
  const enabled = await enabledProviders();
  if (enabled && !enabled.google) {
    throw new Error(authErrorMessage({ message: 'provider is not enabled' }));
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: returnUrl(),
      // Show Google's account chooser every time, so a shared or multi-account browser can pick.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw new Error(authErrorMessage(error));
}

/** Email a magic link that signs in (creating the account on first use). */
export async function sendEmailLink(email: string): Promise<void> {
  if (!supabase) throw new Error('Sign-in isn’t configured.');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: returnUrl() },
  });
  if (error) throw new Error(authErrorMessage(error));
}

/**
 * Sign out on this device only. (supabase-js's default signs out every device the account uses.)
 * The account's lists stay saved on the server for the next sign-in.
 */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new Error(authErrorMessage(error));
}

function readStoredUserId(): string | null {
  if (!AUTH_STORAGE_KEY) return null;
  try {
    return storedUserId(localStorage.getItem(AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

export interface AuthState {
  /** the confirmed session; its access token is current (it's replaced on every refresh) */
  session: Session | null;
  /**
   * The signed-in user's id. Known on the first render from the session saved last visit, before
   * supabase-js has confirmed it, so a returning user's lists show at once.
   */
  userId: string | null;
  /** false until supabase-js has read (and if needed refreshed) the saved session */
  ready: boolean;
}

/** Who's signed in. Without Supabase configured it's always signed out and ready. */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(() => ({
    session: null,
    userId: readStoredUserId(),
    ready: !supabase,
  }));

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const apply = (session: Session | null) => {
      if (active) setState({ session, userId: session?.user.id ?? null, ready: true });
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    // Also fires on token refresh, so `session.access_token` stays current.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * Toasts for a sign-in redirect: a welcome once Google (or a magic link) brings the visitor back
 * signed in, or what went wrong. A failed redirect's error is also cleared from the address bar.
 */
export function useAuthNotices(session: Session | null, show: (message: string) => void) {
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current || !supabase || !authRedirect) return;
    if (authRedirect.kind === 'error') {
      shown.current = true;
      show(authRedirect.message);
      // Wait for supabase-js to finish with the URL before tidying it.
      supabase.auth.initialize().finally(() => {
        const clean = withoutAuthError(window.location.href);
        if (clean) window.history.replaceState(window.history.state, '', clean);
      });
    } else if (session) {
      shown.current = true;
      const { name, email } = profileOf(session.user);
      show(`Signed in as ${name ?? email ?? 'you'}. Your groceries are saved to your account.`);
    }
  }, [session, show]);
}
