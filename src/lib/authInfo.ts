import type { User } from '@supabase/supabase-js';

/**
 * Plain helpers about sign-in that don't touch the Supabase client, so they can be unit-tested.
 */

/** What a sign-in redirect (back from Google, or a magic link) left in the page's URL. */
export type AuthRedirect = { kind: 'signed-in' } | { kind: 'error'; code: string; message: string } | null;

/**
 * Read the result of a sign-in redirect from the URL. Supabase puts it in the hash with the
 * implicit flow (`#access_token=…` or `#error=…`); errors can also arrive in the query string.
 */
export function readAuthRedirect(location: { hash: string; search: string }): AuthRedirect {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const get = (name: string) => hash.get(name) ?? query.get(name);

  const error = get('error');
  const code = get('error_code');
  const description = get('error_description');
  if (error || code || description) {
    const errorCode = code || error || 'unknown';
    return { kind: 'error', code: errorCode, message: authErrorMessage({ code: errorCode, message: description }) };
  }
  return hash.get('access_token') ? { kind: 'signed-in' } : null;
}

/** The URL with any sign-in error parameters removed, or null when there are none. */
export function withoutAuthError(href: string): string | null {
  const url = new URL(href);
  const names = ['error', 'error_code', 'error_description'];
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const inHash = names.some((n) => hash.has(n));
  const inQuery = names.some((n) => url.searchParams.has(n));
  if (!inHash && !inQuery) return null;
  // Also drop a bare trailing "#", which supabase-js leaves after reading the hash.
  if (inHash || !url.hash) url.hash = '';
  for (const n of names) url.searchParams.delete(n);
  return url.toString();
}

interface ErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number;
}

/** A sign-in error in words a visitor can act on. */
export function authErrorMessage(err: ErrorLike): string {
  const code = err.code ?? '';
  const text = err.message ?? '';
  if (code === 'access_denied' || /cancel|denied/i.test(text)) {
    return 'Google sign-in was cancelled. You can try again whenever you like.';
  }
  if (code === 'otp_expired' || /expired|invalid.*link/i.test(text)) {
    return 'That sign-in link has expired or was already used. Ask for a new one.';
  }
  if (/provider is not enabled|unsupported provider/i.test(text)) {
    return 'Google sign-in isn’t set up for this app yet. Use your email for now.';
  }
  if (code === 'over_email_send_rate_limit' || err.status === 429 || /rate limit/i.test(text)) {
    return 'Too many sign-in emails were sent recently. Try again in a little while, or continue with Google.';
  }
  if (code === 'email_address_invalid' || /invalid.*email|email.*invalid/i.test(text)) {
    return 'That email address doesn’t look right.';
  }
  if (code === 'signup_disabled' || /signups? not allowed/i.test(text)) {
    return 'New accounts can’t be created right now.';
  }
  if (err.status === 0 || /failed to fetch|network/i.test(text)) {
    return 'Couldn’t reach the sign-in service. Check your connection and try again.';
  }
  return text || 'Sign-in didn’t work. Please try again.';
}

/**
 * Whether this looks like an app's built-in browser (Instagram, Facebook, TikTok, an Android
 * WebView…). Google refuses to sign in there ("disallowed_useragent"), so the sign-in dialog
 * suggests opening the page in the phone's own browser instead.
 */
export function isEmbeddedBrowser(userAgent: string): boolean {
  return /\b(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|musical_ly|BytedanceWebview|TikTok|LinkedInApp)\b|; wv\)/i.test(
    userAgent,
  );
}

export interface Profile {
  name: string | null;
  email: string | null;
  /** the Google profile photo, when there is one */
  avatarUrl: string | null;
  /** one letter for the avatar when there's no photo */
  initial: string;
  /** how this account can sign in, e.g. ['google', 'email'] */
  providers: string[];
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Who's signed in, from the Supabase user (Google fills in the name and photo). */
export function profileOf(user: User): Profile {
  const meta = user.user_metadata ?? {};
  const name = text(meta.full_name) ?? text(meta.name);
  const email = text(user.email) ?? text(meta.email);
  const photo = text(meta.avatar_url) ?? text(meta.picture);
  const listed = user.app_metadata?.providers;
  const providers = Array.isArray(listed)
    ? listed.filter((p): p is string => typeof p === 'string')
    : text(user.app_metadata?.provider)
      ? [user.app_metadata.provider as string]
      : [];
  return {
    name,
    email,
    avatarUrl: photo?.startsWith('https://') ? photo : null,
    initial: (name ?? email ?? '?').charAt(0).toUpperCase(),
    providers,
  };
}

const PROVIDER_NAMES: Record<string, string> = { google: 'Google', email: 'Email link' };

export const providerName = (provider: string) =>
  PROVIDER_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);

/**
 * The user id in the session supabase-js saved last time, read synchronously so the first render
 * already knows who's signed in. supabase-js confirms (and if needed refreshes) it a moment later.
 */
export function storedUserId(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const id = (JSON.parse(raw) as { user?: { id?: unknown } } | null)?.user?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}
