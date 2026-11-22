import type { ReactNode } from 'react';
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
