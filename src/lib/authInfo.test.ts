import type { User } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  authErrorMessage,
  isEmbeddedBrowser,
  profileOf,
  readAuthRedirect,
  storedUserId,
  withoutAuthError,
} from './authInfo';

describe('readAuthRedirect', () => {
  it('sees a successful sign-in', () => {
    expect(readAuthRedirect({ hash: '#access_token=abc&refresh_token=r&expires_in=3600', search: '' })).toEqual({
      kind: 'signed-in',
    });
  });

  it('reads a cancelled Google sign-in from the hash or the query string', () => {
    const cancelled = { kind: 'error', code: 'access_denied', message: expect.stringMatching(/cancelled/) };
    expect(readAuthRedirect({ hash: '#error=access_denied&error_description=User+denied', search: '' })).toEqual(
      cancelled,
    );
    expect(readAuthRedirect({ hash: '', search: '?error=access_denied' })).toEqual(cancelled);
  });

  it('explains an expired magic link', () => {
    const r = readAuthRedirect({
      hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      search: '',
    });
    expect(r).toMatchObject({ kind: 'error', code: 'otp_expired' });
    expect(r && r.kind === 'error' && r.message).toMatch(/expired/);
  });

  it('ignores ordinary URLs', () => {
    expect(readAuthRedirect({ hash: '', search: '' })).toBeNull();
    expect(readAuthRedirect({ hash: '#recipes', search: '?tab=1' })).toBeNull();
  });
});

describe('withoutAuthError', () => {
  it('strips error parameters and keeps the rest', () => {
    expect(withoutAuthError('https://app.test/?error=access_denied&error_description=x#')).toBe('https://app.test/');
    expect(withoutAuthError('https://app.test/?keep=1#error=access_denied')).toBe('https://app.test/?keep=1');
  });

  it('leaves clean URLs alone', () => {
    expect(withoutAuthError('https://app.test/?keep=1#section')).toBeNull();
  });
});

describe('authErrorMessage', () => {
  it('turns Supabase errors into next steps', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })).toMatch(
      /continue with Google/,
    );
    expect(authErrorMessage({ message: 'Unsupported provider: provider is not enabled' })).toMatch(/isn’t set up/);
    expect(authErrorMessage({ message: 'Failed to fetch', status: 0 })).toMatch(/connection/);
  });

  it('passes other messages through', () => {
    expect(authErrorMessage({ message: 'Something odd' })).toBe('Something odd');
    expect(authErrorMessage({})).toMatch(/try again/);
  });
});

describe('isEmbeddedBrowser', () => {
  it('spots in-app browsers that Google blocks', () => {
    expect(
      isEmbeddedBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0',
      ),
    ).toBe(true);
    expect(
      isEmbeddedBrowser(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36',
      ),
    ).toBe(true);
  });

  it('trusts real browsers', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    ]) {
      expect(isEmbeddedBrowser(ua)).toBe(false);
    }
  });
});

const user = (fields: Partial<User>): User =>
  ({ id: 'u1', aud: 'authenticated', created_at: '', app_metadata: {}, user_metadata: {}, ...fields }) as User;

describe('profileOf', () => {
  it('uses the Google name, photo and linked providers', () => {
    const p = profileOf(
      user({
        email: 'sam@example.com',
        user_metadata: { full_name: 'Sam Lee', avatar_url: 'https://lh3.googleusercontent.com/a/x' },
        app_metadata: { provider: 'email', providers: ['email', 'google'] },
      }),
    );
    expect(p).toEqual({
      name: 'Sam Lee',
      email: 'sam@example.com',
      avatarUrl: 'https://lh3.googleusercontent.com/a/x',
      initial: 'S',
      providers: ['email', 'google'],
    });
  });

  it('falls back to the email, and refuses non-https photos', () => {
    const p = profileOf(
      user({ email: 'kim@example.com', user_metadata: { picture: 'http://x/y.png' }, app_metadata: { provider: 'email' } }),
    );
    expect(p).toMatchObject({ name: null, avatarUrl: null, initial: 'K', providers: ['email'] });
  });
});

describe('storedUserId', () => {
  it('reads the user id from a saved session', () => {
    expect(storedUserId(JSON.stringify({ access_token: 'a', user: { id: 'abc' } }))).toBe('abc');
  });

  it('copes with nothing saved or junk', () => {
    expect(storedUserId(null)).toBeNull();
    expect(storedUserId('not json')).toBeNull();
    expect(storedUserId('null')).toBeNull();
    expect(storedUserId(JSON.stringify({ user: null }))).toBeNull();
  });
});
