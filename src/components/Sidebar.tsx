import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { SyncStatus } from '../lib/usePantry';
import { Icon, type IconName } from './Icon';

export type View = 'pantry' | 'recipes' | 'shopping';

interface NavItem {
  view: View;
  label: string;
  icon: IconName;
  count: number;
  hint: string;
}

interface Props {
  view: View;
  onNavigate: (view: View) => void;
  counts: Record<View, number>;
  session: Session | null;
  syncStatus: SyncStatus;
  onSignIn: () => void;
}

const SYNC_LABEL: Record<SyncStatus, string> = {
  local: 'Saved on this device',
  loading: 'Loading pantry…',
  saving: 'Saving…',
  synced: 'Synced to your account',
  error: 'Sync problem',
};

export function Sidebar({ view, onNavigate, counts, session, syncStatus, onSignIn }: Props) {
  const nav: NavItem[] = [
    { view: 'pantry', label: 'Pantry', icon: 'pantry', count: counts.pantry, hint: 'What you have' },
    { view: 'recipes', label: 'Recipes', icon: 'recipes', count: counts.recipes, hint: 'What to cook' },
    { view: 'shopping', label: 'Shopping list', icon: 'shopping', count: counts.shopping, hint: 'What to buy' },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          🥕
        </span>
        <span className="brand-name">Pantry Chef</span>
      </div>

      <nav className="nav" aria-label="Main">
        {nav.map((item, i) => (
          <button
            key={item.view}
            className={`nav-item ${view === item.view ? 'active' : ''}`}
            aria-current={view === item.view ? 'page' : undefined}
            onClick={() => onNavigate(item.view)}
          >
            <Icon name={item.icon} size={20} />
            <span className="nav-text">
              <span className="nav-label">{item.label}</span>
              <span className="nav-hint">
                Step {i + 1} · {item.hint}
              </span>
            </span>
            {item.count > 0 && <span className="nav-count">{item.count}</span>}
          </button>
        ))}
      </nav>

      <div className="account">
        {!supabase ? (
          <p className="account-note" title="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign-in">
            <Icon name="cloud" size={16} /> Sign-in not configured. Your pantry is saved in this browser.
          </p>
        ) : session ? (
          <div className="account-card">
            <span className="avatar" aria-hidden>
              {(session.user.email ?? '?').charAt(0).toUpperCase()}
            </span>
            <div className="account-text">
              <span className="account-email" title={session.user.email}>
                {session.user.email}
              </span>
              <span className={`sync sync-${syncStatus}`}>{SYNC_LABEL[syncStatus]}</span>
            </div>
            <button
              className="btn-icon"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => supabase!.auth.signOut()}
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        ) : (
          <div className="account-cta">
            <p>
              <strong>Sync & AI features</strong>
              <span>Sign in to save your pantry everywhere and let AI read lists and invent recipes.</span>
            </p>
            <button className="btn btn-secondary btn-block" onClick={onSignIn}>
              <Icon name="user" size={16} /> Sign in
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Bottom tab bar for small screens. */
export function TabBar({ view, onNavigate, counts }: Pick<Props, 'view' | 'onNavigate' | 'counts'>) {
  const tabs: { view: View; label: string; icon: IconName }[] = [
    { view: 'pantry', label: 'Pantry', icon: 'pantry' },
    { view: 'recipes', label: 'Recipes', icon: 'recipes' },
    { view: 'shopping', label: 'Shopping', icon: 'shopping' },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
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
