import type { Session } from '@supabase/supabase-js';
import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import type { SyncStatus } from '../lib/usePantry';

interface Props {
  session: Session | null;
  syncStatus: SyncStatus;
}

const SYNC_LABEL: Record<SyncStatus, string> = {
  local: '',
  loading: 'Loading pantry…',
  saving: 'Saving…',
  synced: 'Pantry synced',
  error: 'Sync problem',
};

export function AuthBar({ session, syncStatus }: Props) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!supabase) {
    return (
      <p className="auth-bar muted" title="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign-in">
        Sign-in not configured · pantry saved in this browser
      </p>
    );
  }
  const auth = supabase.auth;

  if (session) {
    return (
      <div className="auth-bar">
        <span className={`sync sync-${syncStatus}`}>{SYNC_LABEL[syncStatus]}</span>
        <span className="muted">{session.user.email}</span>
        <button className="btn btn-ghost" onClick={() => auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    setError(null);
    const { error } = await auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setState('idle');
    } else {
      setState('sent');
    }
  }

  if (state === 'sent') {
    return (
      <p className="auth-bar muted">
        Check {email} for a sign-in link.{' '}
        <button className="btn btn-ghost" onClick={() => setState('idle')}>
          Use another email
        </button>
      </p>
    );
  }

  return (
    <form className="auth-bar" onSubmit={sendLink}>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        aria-label="Email for sign-in link"
        autoComplete="email"
      />
      <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Sign in'}
      </button>
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
