import { useEffect, useState, type FormEvent } from 'react';
import { enabledProviders, sendEmailLink, signInWithGoogle } from '../lib/auth';
import { isEmbeddedBrowser } from '../lib/authInfo';
import { GoogleLogo } from './GoogleLogo';
import { Modal } from './Modal';
import './auth.css';

interface Props {
  onClose: () => void;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Sign-in didn’t work. Please try again.');

/**
 * Sign in or create an account: Google first, an emailed magic link as the fallback. Both create
 * the account on first use, and both reach the same account when the email matches.
 */
export function SignInDialog({ onClose }: Props) {
  const [email, setEmail] = useState('');
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [opening, setOpening] = useState(false);
  /** whether Google sign-in is turned on in Supabase; null until known (assume yes) */
  const [googleOn, setGoogleOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [embedded] = useState(() => isEmbeddedBrowser(navigator.userAgent));

  useEffect(() => {
    let live = true;
    enabledProviders().then((p) => {
      if (live && p) setGoogleOn(Boolean(p.google));
    });
    return () => {
      live = false;
    };
  }, []);

  // Coming back from Google with the Back button can restore this page as it was left.
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => e.persisted && setOpening(false);
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  async function continueWithGoogle() {
    setError(null);
    setOpening(true);
    try {
      await signInWithGoogle(); // the browser is now on its way to Google
    } catch (err) {
      setError(errorText(err));
      setOpening(false);
    }
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setEmailState('sending');
    setError(null);
    try {
      await sendEmailLink(email.trim());
      setEmailState('sent');
    } catch (err) {
      setError(errorText(err));
      setEmailState('idle');
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      /* clipboard blocked: the address bar still works */
    }
  }

  if (emailState === 'sent') {
    return (
      <Modal labelledBy="signin-title" onClose={onClose} size="sm">
        <header className="dialog-intro">
          <div className="dialog-icon" aria-hidden>
            📬
          </div>
          <h2 id="signin-title">Check your inbox</h2>
          <p className="muted">
            We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this device to sign in here. It
            works once, for an hour.
          </p>
        </header>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={() => setEmailState('idle')}>
            Back
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal labelledBy="signin-title" onClose={onClose} size="sm">
      <header className="dialog-intro">
        <div className="dialog-icon" aria-hidden>
          🥕
        </div>
        <h2 id="signin-title">Sign in to Pantry Chef</h2>
        <p className="muted">
          Your pantry and shopping list are saved to your account, so they’re there on every device. New here?
          Signing in creates your free account.
        </p>
      </header>

      <div className="stack">
        {googleOn !== false && (
          <>
            <button
              type="button"
              className="btn btn-lg btn-block google-btn"
              onClick={continueWithGoogle}
              disabled={opening}
            >
              <GoogleLogo />
              {opening ? 'Opening Google…' : 'Continue with Google'}
            </button>
            {embedded && (
              <div className="banner signin-embedded">
                Google doesn’t allow signing in inside this app’s built-in browser. Open this page in Safari or
                Chrome (look for “Open in browser” in the menu), or use your email below.
                <button type="button" className="btn btn-secondary signin-copy" onClick={copyLink}>
                  {copied ? 'Link copied' : 'Copy link'}
                </button>
              </div>
            )}
            <div className="divider">or use your email</div>
          </>
        )}
        {googleOn === false && import.meta.env.DEV && (
          <p className="banner">
            Google sign-in is off for this Supabase project. Turn it on under Authentication → Sign In / Providers →
            Google (see the README).
          </p>
        )}

        <form className="stack" onSubmit={sendLink}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
            />
          </label>
          <button
            type="submit"
            className={`btn btn-lg btn-block ${googleOn === false ? 'btn-primary' : 'btn-secondary'}`}
            disabled={emailState === 'sending'}
          >
            {emailState === 'sending' ? 'Sending link…' : 'Email me a sign-in link'}
          </button>
        </form>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <p className="signin-fineprint">
          We use your name, email and profile photo only to show who’s signed in.
        </p>
      </div>
    </Modal>
  );
}
