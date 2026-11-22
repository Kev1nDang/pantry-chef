import type { Session } from '@supabase/supabase-js';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { SyncStatus } from '../lib/usePantry';
import { Icon, type IconName } from './Icon';

export type View = 'pantry' | 'recipes' | 'shopping';

const NAV: { view: View; label: string; icon: IconName }[] = [
  { view: 'pantry', label: 'Pantry', icon: 'pantry' },
  { view: 'recipes', label: 'Recipes', icon: 'recipes' },
  { view: 'shopping', label: 'Shopping', icon: 'shopping' },
];

interface NavProps {
  view: View;
  onNavigate: (view: View) => void;
  counts: Record<View, number>;
}

/** The app bar: brand, the sections (on wide screens) and the account area. */
export function TopBar({ view, onNavigate, counts, account }: NavProps & { account: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => onNavigate('pantry')}>
          <span className="brand-mark" aria-hidden>
            🥕
          </span>
          <span className="brand-name">Pantry Chef</span>
        </button>

        <nav className="topnav" aria-label="Main">
          {NAV.map((item) => (
            <button
              key={item.view}
              className={`topnav-item${view === item.view ? ' active' : ''}`}
              aria-current={view === item.view ? 'page' : undefined}
              onClick={() => onNavigate(item.view)}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
              {counts[item.view] > 0 && <span className="count">{counts[item.view]}</span>}
            </button>
          ))}
        </nav>

        <div className="topbar-account">{account}</div>
      </div>
    </header>
  );
}

/** Bottom tab bar for phones. */
export function TabBar({ view, onNavigate, counts }: NavProps) {
  return (
    <nav className="tabbar" aria-label="Main">
      {NAV.map((t) => (
        <button
          key={t.view}
          className={view === t.view ? 'active' : ''}
          aria-current={view === t.view ? 'page' : undefined}
          onClick={() => onNavigate(t.view)}
        >
          <span className="tab-icon">
            <Icon name={t.icon} size={22} />
            {counts[t.view] > 0 && <span className="tab-badge">{counts[t.view]}</span>}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

const SYNC_LABEL: Record<SyncStatus, string> = {
  local: 'Saved on this device',
  loading: 'Loading pantry…',
  saving: 'Saving…',
  synced: 'Synced to your account',
  error: 'Sync problem',
};

interface AccountProps {
  session: Session | null;
  syncStatus: SyncStatus;
  onSignIn: () => void;
}

/** Sign in, or who is signed in and whether their pantry is synced. */
export function Account({ session, syncStatus, onSignIn }: AccountProps) {
  if (!supabase) {
    return (
      <span className="account-local" title="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign-in">
        <Icon name="cloud" size={16} />
        <span className="account-local-text">Saved on this device</span>
      </span>
    );
  }
  if (!session) {
    return (
      <button className="btn btn-secondary btn-sm" onClick={onSignIn}>
        <Icon name="user" size={16} /> Sign in
      </button>
    );
  }
  const email = session.user.email ?? '';
  return (
    <div className="account">
      <span className={`avatar sync-${syncStatus}`} title={`${email} · ${SYNC_LABEL[syncStatus]}`}>
        {(email || '?').charAt(0).toUpperCase()}
      </span>
      <span className="sr-only">
        Signed in as {email}. {SYNC_LABEL[syncStatus]}.
      </span>
      <button className="btn-icon" aria-label="Sign out" title="Sign out" onClick={() => supabase!.auth.signOut()}>
        <Icon name="logout" size={18} />
      </button>
    </div>
  );
}
