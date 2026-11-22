import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readAuthRedirect, type AuthRedirect } from './authInfo';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
// Supabase's "Connect" panel calls the public key VITE_SUPABASE_PUBLISHABLE_KEY; older docs say ANON_KEY.
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

function projectRef(url: string): string | null {
  try {
    return new URL(url).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

const ref = SUPABASE_URL && SUPABASE_KEY ? projectRef(SUPABASE_URL) : null;

/**
 * Where supabase-js keeps the session in localStorage. This is its default name, spelled out so
 * the app can read the signed-in user's id synchronously on the first render.
 */
export const AUTH_STORAGE_KEY = ref ? `sb-${ref}-auth-token` : null;

/** The result of a sign-in redirect, read before supabase-js consumes the URL. */
export const authRedirect: AuthRedirect = readAuthRedirect(window.location);

/** `null` when VITE_SUPABASE_URL / the public key aren't set: the app runs signed out. */
export const supabase: SupabaseClient | null =
  ref && AUTH_STORAGE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          storageKey: AUTH_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // Implicit rather than PKCE: with PKCE a magic link only works in the browser that
          // asked for it, and on phones mail apps often open links in a different one.
          flowType: 'implicit',
        },
      })
    : null;
