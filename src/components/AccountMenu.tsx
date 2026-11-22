import type { Session } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { signOut } from '../lib/auth';
import { profileOf, providerName, type Profile } from '../lib/authInfo';
import { supabase } from '../lib/supabase';
import type { SyncStatus } from '../lib/useSyncedList';
import { GoogleLogo } from './GoogleLogo';
import { Icon } from './Icon';
import './auth.css';

interface Props {
  session: Session | null;
  /** false while the saved session is still being checked */
  ready: boolean;
  /** how the account's lists are syncing */
  syncStatus: SyncStatus;
  onSignIn: () => void;
}

const SYNC_LABEL: Record<SyncStatus, string> = {
  local: 'Saved on this device',
  loading: 'Loading your groceries…',
  saving: 'Saving…',
  synced: 'Saved to your account',
  error: 'Sync problem, retrying',
};

function Avatar({ profile, size }: { profile: Profile; size: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (profile.avatarUrl && !broken) {
    return (
      <img
        className="acct-avatar"
        src={profile.avatarUrl}
        alt=""
        style={style}
        // Google's photo links can refuse requests that carry a referrer.
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="acct-avatar acct-avatar-letter" style={style} aria-hidden>
      {profile.initial}
    </span>
  );
}

/**
 * The account corner of the top bar: a "Sign in" button when signed out; signed in, an avatar
 * (with a sync dot) that opens a panel with who's signed in, how, whether the groceries are
 * saved, and Sign out.
 */
export function AccountMenu({ session, ready, syncStatus, onSignIn }: Props) {
  if (!supabase) {
    return (
      <span className="acct-off" title="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to turn on sign-in">
        <Icon name="cloud" size={16} />
        <span className="acct-off-text">Saved on this device</span>
      </span>
    );
  }
  if (session) return <SignedIn session={session} syncStatus={syncStatus} />;
  if (!ready) return <span className="acct-pending" role="status" aria-label="Checking sign-in" />;
  return (
    <button
      className="btn btn-secondary btn-sm acct-signin"
      onClick={onSignIn}
      title="Sign in with Google to keep your groceries on every device"
    >
      <Icon name="user" size={16} /> Sign in
    </button>
  );
}

function SignedIn({ session, syncStatus }: { session: Session; syncStatus: SyncStatus }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const profile = profileOf(session.user);
  const label = profile.name ?? profile.email ?? 'Your account';

  // Close on a click outside or Escape (which hands focus back to the avatar).
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function leave() {
    setLeaving(true);
    setError(null);
    try {
      await signOut(); // unmounts this menu once the session ends
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t sign out. Please try again.');
      setLeaving(false);
    }
  }

  return (
    <div className="acct" ref={root}>
      <button
        ref={trigger}
        className="acct-trigger"
        aria-expanded={open}
        aria-controls={open ? 'acct-panel' : undefined}
        aria-label={`Account: ${label}. ${SYNC_LABEL[syncStatus]}`}
        title={`${label} · ${SYNC_LABEL[syncStatus]}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar profile={profile} size={36} />
        {syncStatus !== 'local' && <span className={`acct-dot acct-dot-${syncStatus}`} aria-hidden />}
      </button>

      {open && (
        <div className="acct-panel" id="acct-panel" role="dialog" aria-label="Your account">
          <div className="acct-head">
            <Avatar profile={profile} size={48} />
            <div className="acct-who">
              {profile.name && <strong>{profile.name}</strong>}
              {profile.email && <span>{profile.email}</span>}
            </div>
          </div>

          <dl className="acct-facts">
            <div>
              <dt>Signs in with</dt>
              <dd>
                {profile.providers.length === 0
                  ? '—'
                  : profile.providers.map((p) => (
                      <span key={p} className="acct-provider">
                        {p === 'google' ? <GoogleLogo size={14} /> : <Icon name="user" size={14} />}
                        {providerName(p)}
                      </span>
                    ))}
              </dd>
            </div>
            <div>
              <dt>Groceries</dt>
              <dd>
                <span className={`acct-sync acct-sync-${syncStatus}`}>{SYNC_LABEL[syncStatus]}</span>
              </dd>
            </div>
          </dl>

          <p className="acct-hint">
            {profile.providers.includes('google')
              ? 'Sign in with this Google account on any phone or computer to pick up where you left off.'
              : 'Sign in with this email on any phone or computer to pick up where you left off. A Google account with the same email signs in here too.'}
          </p>

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-secondary btn-block" onClick={leave} disabled={leaving}>
            <Icon name="logout" size={16} /> {leaving ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
