import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Modal } from './Modal';

interface Props {
  onClose: () => void;
}

export function SignInDialog({ onClose }: Props) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setState('sending');
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
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

  return (
    <Modal labelledBy="signin-title" onClose={onClose} size="sm">
      <header className="dialog-intro">
        <div className="dialog-icon" aria-hidden>
          🔐
        </div>
        <h2 id="signin-title">{state === 'sent' ? 'Check your inbox' : 'Sign in to Pantry Chef'}</h2>
        <p className="muted">
          {state === 'sent'
            ? `We sent a sign-in link to ${email}. Open it on this device to continue.`
            : 'Save your pantry across devices and unlock AI features. No password needed — we’ll email you a link.'}
        </p>
      </header>

      {state === 'sent' ? (
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={() => setState('idle')}>
            Use another email
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form className="stack" onSubmit={sendLink}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-lg" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending link…' : 'Email me a sign-in link'}
          </button>
        </form>
      )}
    </Modal>
  );
}
